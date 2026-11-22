"""Module B — 24h-ahead RCE forecast, persistence benchmark and JSON export.

Walk-forward evaluation: the first ~120 modelled days are the training
period; the last ``TEST_DAYS`` days are predicted out-of-sample with an
expanding-window refit every 7 days (each refit only sees days before the
block it predicts). Training-period days receive in-sample predictions so the
dashboard can show all 180 days; they are flagged ``split="train"``.

Run: ``python -m pipeline.forecast``
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone

import lightgbm as lgb
import numpy as np
import pandas as pd

from pipeline.co2 import proxy_intensity
from pipeline.config import DATASET_PATH, PUBLIC_DATA, TEST_DAYS, WINDOW_DAYS
from pipeline.features import FEATURES, PRICE, build_features

REFIT_EVERY_DAYS = 7
LGBM_PARAMS = dict(
    n_estimators=600,
    learning_rate=0.03,
    num_leaves=31,
    min_child_samples=20,
    subsample=0.8,
    subsample_freq=1,
    colsample_bytree=0.8,
    random_state=42,
    verbose=-1,
)
EVENING_PEAK_HOURS = range(17, 21)  # 17:00-21:00 local


def _fit_model(train: pd.DataFrame) -> lgb.LGBMRegressor:
    model = lgb.LGBMRegressor(**LGBM_PARAMS)
    model.fit(train[FEATURES], train[PRICE])
    return model


def train_and_predict(
    feat: pd.DataFrame, model_start: date, test_days: int = TEST_DAYS
) -> tuple[pd.DataFrame, lgb.LGBMRegressor]:
    """Return (predictions frame, latest fitted model).

    Adds ``forecast``, ``persistence`` (= ``lag_24h``) and ``split`` columns
    for every row from ``model_start`` on.
    """
    data = feat[feat["local_date"] >= model_start].copy()
    if data[FEATURES].isna().any().any():
        bad = data.loc[data[FEATURES].isna().any(axis=1), "local_date"].unique()
        raise ValueError(f"Missing features on modelled days, e.g. {bad[:3]}")

    days = sorted(data["local_date"].unique())
    test_start = days[-test_days]
    data["split"] = np.where(data["local_date"] >= test_start, "test", "train")
    data["persistence"] = data["lag_24h"]
    data["forecast"] = np.nan

    train_mask = data["split"] == "train"
    in_sample = _fit_model(data[train_mask])
    data.loc[train_mask, "forecast"] = in_sample.predict(data.loc[train_mask, FEATURES])

    test_days_list = [d for d in days if d >= test_start]
    model = in_sample
    for i in range(0, len(test_days_list), REFIT_EVERY_DAYS):
        block = test_days_list[i : i + REFIT_EVERY_DAYS]
        model = _fit_model(data[data["local_date"] < block[0]])
        mask = data["local_date"].isin(block)
        data.loc[mask, "forecast"] = model.predict(data.loc[mask, FEATURES])
    return data, model


def _mae(a: pd.Series, b: pd.Series) -> float:
    return float(np.mean(np.abs(a - b)))


def _rmse(a: pd.Series, b: pd.Series) -> float:
    return float(np.sqrt(np.mean((a - b) ** 2)))


def metrics(pred: pd.DataFrame) -> dict:
    """Out-of-sample accuracy of the model vs. 24h persistence (PLN/MWh)."""
    test = pred[pred["split"] == "test"]
    y = test[PRICE]
    m_mae, p_mae = _mae(y, test["forecast"]), _mae(y, test["persistence"])
    m_rmse, p_rmse = _rmse(y, test["forecast"]), _rmse(y, test["persistence"])
    train = pred[pred["split"] == "train"]
    return {
        "model": {"mae": round(m_mae, 2), "rmse": round(m_rmse, 2)},
        "persistence": {"mae": round(p_mae, 2), "rmse": round(p_rmse, 2)},
        "maeImprovementPct": round((1 - m_mae / p_mae) * 100, 1),
        "rmseImprovementPct": round((1 - m_rmse / p_rmse) * 100, 1),
        "testStart": test["local_date"].min().isoformat(),
        "testEnd": test["local_date"].max().isoformat(),
        "trainStart": train["local_date"].min().isoformat(),
        "trainEnd": train["local_date"].max().isoformat(),
        "testHours": int(len(test)),
        "trainHours": int(len(train)),
        "refitEveryDays": REFIT_EVERY_DAYS,
    }


def pick_scenarios(pred: pd.DataFrame) -> dict[str, str]:
    """Select the three showcase days (ISO dates), preferring test days."""
    pool = pred[pred["split"] == "test"] if (pred["split"] == "test").any() else pred
    g = pool.groupby("local_date")
    daily = pd.DataFrame(
        {
            "mean": g[PRICE].mean(),
            "min": g[PRICE].min(),
            "wind": g["wind_index"].mean(),
            "holiday": g["is_holiday"].max(),
        }
    )
    evening = pool[pool["hour"].isin(EVENING_PEAK_HOURS)].groupby("local_date")[PRICE].max()
    daily["spread"] = evening.reindex(daily.index) - daily["min"]

    cheap = daily[daily["mean"] <= daily["mean"].quantile(0.25)]
    high_wind = cheap["wind"].idxmax()
    evening_spike = daily["spread"].idxmax()
    is_weekday = np.array([d.weekday() < 5 for d in daily.index])
    weekdays = daily[is_weekday & (daily["holiday"] == 0).to_numpy()]
    typical = (weekdays["mean"] - daily["mean"].median()).abs().idxmin()
    return {
        "high_wind": high_wind.isoformat(),
        "evening_spike": evening_spike.isoformat(),
        "typical_weekday": typical.isoformat(),
    }


def feature_importance(model: lgb.LGBMRegressor, top: int = 15) -> list[dict]:
    gain = model.booster_.feature_importance(importance_type="gain")
    s = pd.Series(gain, index=FEATURES).sort_values(ascending=False)
    s = s / s.sum()
    return [{"feature": k, "gain": round(float(v), 4)} for k, v in s.head(top).items()]


def _days_payload(pred: pd.DataFrame) -> dict:
    pred = pred.assign(co2=proxy_intensity(pred["wind_index"], pred["solar_index"]))
    days: dict[str, dict] = {}
    for d, g in pred.groupby("local_date", sort=True):
        hours = [
            {
                "ts": ts.isoformat(),
                "actual": round(float(r[PRICE]), 2),
                "forecast": round(float(r["forecast"]), 2),
                "persistence": round(float(r["persistence"]), 2),
                "wind": round(float(r["wind_index"]), 3),
                "solar": round(float(r["solar_index"]), 3),
                "co2": round(float(r["co2"]), 1),
            }
            for ts, r in g.iterrows()
        ]
        days[d.isoformat()] = {
            "split": g["split"].iloc[0],
            "eurPln": round(float(g["eur_pln"].iloc[0]), 4),
            "mae": round(_mae(g[PRICE], g["forecast"]), 2),
            "maePersistence": round(_mae(g[PRICE], g["persistence"]), 2),
            "hours": hours,
        }
    return days


def export(pred: pd.DataFrame, met: dict, importance: list[dict], scenarios: dict) -> None:
    PUBLIC_DATA.mkdir(parents=True, exist_ok=True)
    generated = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    files = {
        "days.json": {"generatedAt": generated, "days": _days_payload(pred)},
        "metrics.json": {"generatedAt": generated, **met},
        "feature_importance.json": importance,
        "scenarios.json": scenarios,
    }
    for name, payload in files.items():
        (PUBLIC_DATA / name).write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")


def main() -> None:
    df = pd.read_parquet(DATASET_PATH)
    # Anchor the window on the dataset itself (it may have been built earlier).
    last_day = df.index.max().date()
    model_start = last_day - timedelta(days=WINDOW_DAYS - 1)

    feat = build_features(df)
    pred, model = train_and_predict(feat, model_start)
    met = metrics(pred)
    imp = feature_importance(model)
    scen = pick_scenarios(pred)
    export(pred, met, imp, scen)

    print(f"Modelled days: {pred['local_date'].nunique()} ({model_start} .. {last_day})")
    print(f"Train {met['trainStart']}..{met['trainEnd']} | Test {met['testStart']}..{met['testEnd']}")
    print(f"{'':12}{'MAE':>10}{'RMSE':>10}")
    print(f"{'LightGBM':12}{met['model']['mae']:>10}{met['model']['rmse']:>10}")
    print(f"{'Persistence':12}{met['persistence']['mae']:>10}{met['persistence']['rmse']:>10}")
    print(f"MAE improvement {met['maeImprovementPct']}% | RMSE improvement {met['rmseImprovementPct']}%")
    print(f"Scenarios: {scen}")
    print("Top features:", [f["feature"] for f in imp[:5]])
    for f in sorted(PUBLIC_DATA.glob("*.json")):
        print(f"  {f.name}: {f.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
