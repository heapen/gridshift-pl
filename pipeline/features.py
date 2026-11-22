"""Module B — leakage-free feature engineering for 24h-ahead RCE forecasting.

Decision time for delivery day D is D-1 ~10:00 Europe/Warsaw, before the
day-ahead gate closure. At that moment every price up to and including day
D-1 is public (published on D-2), and no price of day D is. Every
price-derived feature below is therefore keyed on *calendar days strictly
before D*, never on row offsets — which also keeps lags correct on 23h/25h
DST days.

Weather features use observed values for day D as a stand-in for a
day-ahead weather forecast (historical forecasts are not available
keylessly). This is a documented simplification.
"""
from __future__ import annotations

from datetime import timedelta

import holidays
import numpy as np
import pandas as pd

from pipeline.config import CITIES

PRICE = "price_pln_mwh"

FEATURES: list[str] = [
    "hour_sin",
    "hour_cos",
    "dow_sin",
    "dow_cos",
    "month",
    "is_weekend",
    "is_holiday",
    "lag_24h",
    "lag_48h",
    "lag_168h",
    "prev_day_mean",
    "prev_day_std",
    "prev_day_max",
    "roll7_mean",
    "roll7_std",
    "wind_index",
    "solar_index",
    "temp_mean",
]


def _clock_hour_lookup(df: pd.DataFrame) -> pd.Series:
    """Mean price per (local_date, clock hour); fills the skipped spring hour."""
    table = df.groupby(["local_date", "hour"])[PRICE].mean().unstack("hour")
    table = table.reindex(columns=range(24)).ffill(axis=1).bfill(axis=1)
    return table.stack()


def _daily_stats(df: pd.DataFrame) -> pd.DataFrame:
    daily = df.groupby("local_date")[PRICE].agg(["mean", "std", "max"])
    sum_ = df.groupby("local_date")[PRICE].sum()
    sumsq = df.groupby("local_date")[PRICE].apply(lambda s: (s**2).sum())
    count = df.groupby("local_date")[PRICE].count()
    # 7-day pooled mean/std over hourly prices of the 7 days ending on that day
    s7, q7, n7 = (x.rolling(7, min_periods=7).sum() for x in (sum_, sumsq, count))
    daily["roll7_mean"] = s7 / n7
    daily["roll7_std"] = np.sqrt(np.maximum(q7 / n7 - (s7 / n7) ** 2, 0.0))
    return daily


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """Return ``df`` augmented with model features, ``local_date`` and ``hour``.

    Rows whose lag history is incomplete keep NaN features; callers drop them.
    """
    out = df.copy()
    idx = out.index
    out["local_date"] = idx.date
    out["hour"] = idx.hour
    dow = idx.day_of_week

    out["hour_sin"] = np.sin(2 * np.pi * out["hour"] / 24)
    out["hour_cos"] = np.cos(2 * np.pi * out["hour"] / 24)
    out["dow_sin"] = np.sin(2 * np.pi * dow / 7)
    out["dow_cos"] = np.cos(2 * np.pi * dow / 7)
    out["month"] = idx.month
    out["is_weekend"] = (dow >= 5).astype(int)
    years = sorted({d.year for d in out["local_date"]})
    pl_holidays = holidays.Poland(years=years)
    out["is_holiday"] = [int(d in pl_holidays) for d in out["local_date"]]

    # Price lags: same clock hour on D-1, D-2, D-7 (calendar based).
    lookup = _clock_hour_lookup(out)
    for days, name in ((1, "lag_24h"), (2, "lag_48h"), (7, "lag_168h")):
        keys = pd.MultiIndex.from_arrays(
            [[d - timedelta(days=days) for d in out["local_date"]], out["hour"]]
        )
        out[name] = lookup.reindex(keys).to_numpy()

    # Daily statistics strictly from day D-1 and earlier.
    daily = _daily_stats(out)
    prev = daily.copy()
    prev.index = [d + timedelta(days=1) for d in prev.index]
    prev = prev.rename(
        columns={"mean": "prev_day_mean", "std": "prev_day_std", "max": "prev_day_max"}
    )
    mapped = prev.reindex(out["local_date"])
    for col in ("prev_day_mean", "prev_day_std", "prev_day_max", "roll7_mean", "roll7_std"):
        out[col] = mapped[col].to_numpy()

    # Regional renewable / weather indicators (observed weather, see module doc).
    wind_cubed = sum(out[f"{c}_wind_speed_100m"] ** 3 for c in CITIES) / len(CITIES)
    solar = sum(out[f"{c}_shortwave_radiation"] for c in CITIES) / len(CITIES)
    # Monotone scaling to [0, 1] for display; tree models are invariant to it.
    out["wind_index"] = wind_cubed / wind_cubed.max()
    out["solar_index"] = solar / max(solar.max(), 1e-9)
    out["temp_mean"] = sum(out[f"{c}_temperature_2m"] for c in CITIES) / len(CITIES)
    return out
