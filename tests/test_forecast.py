"""Walk-forward, scenario and CO2 proxy tests for pipeline.forecast / pipeline.co2."""
from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest

from pipeline import forecast
from pipeline.co2 import proxy_intensity
from pipeline.config import KOBIZE_FACTOR_KG_MWH
from pipeline.features import build_features


class _DummyModel:
    def predict(self, X):
        return np.zeros(len(X))


def test_test_predictions_out_of_sample(hourly, monkeypatch):
    feat = build_features(hourly)
    seen_max_dates = []

    def fake_fit(train):
        seen_max_dates.append(train["local_date"].max())
        return _DummyModel()

    monkeypatch.setattr(forecast, "_fit_model", fake_fit)
    model_start = date(2026, 9, 10)
    pred, _ = forecast.train_and_predict(feat, model_start, test_days=21)
    test = pred[pred["split"] == "test"]
    first_test = test["local_date"].min()
    assert first_test == date(2026, 11, 9) - timedelta(days=20)
    # first fit = in-sample model; every subsequent fit precedes its block
    block_starts = sorted(test["local_date"].unique())[::7]
    assert len(seen_max_dates) == 1 + len(block_starts)
    for max_train, block_start in zip(seen_max_dates[1:], block_starts):
        assert max_train < block_start
    assert set(pred["split"]) == {"train", "test"}
    assert pred["local_date"].min() == model_start


def test_pick_scenarios_dates_exist(hourly):
    feat = build_features(hourly)
    feat = feat[feat["local_date"] >= date(2026, 9, 10)].copy()
    feat["forecast"] = feat["price_pln_mwh"]
    feat["split"] = np.where(feat["local_date"] >= date(2026, 10, 20), "test", "train")
    scen = forecast.pick_scenarios(feat)
    days = {d.isoformat() for d in feat["local_date"].unique()}
    assert set(scen) == {"high_wind", "evening_spike", "typical_weekday"}
    for key, iso in scen.items():
        assert iso in days, key
        assert date.fromisoformat(iso) >= date(2026, 10, 20)  # prefers test days
    wd = date.fromisoformat(scen["typical_weekday"])
    assert wd.weekday() < 5


def test_co2_proxy_mean_equals_base():
    wind = pd.Series(np.linspace(0, 1, 100))
    solar = pd.Series(np.zeros(100))
    out = proxy_intensity(wind, solar)
    assert out.mean() == pytest.approx(KOBIZE_FACTOR_KG_MWH, rel=1e-6)
    assert out.iloc[-1] < out.iloc[0]
