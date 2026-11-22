"""Leakage and calendar tests for pipeline.features."""
from datetime import date

import pandas as pd
import pytest

from pipeline.features import FEATURES, build_features
from tests.conftest import make_hourly


def test_no_same_day_price_leakage(hourly):
    day = date(2026, 10, 20)
    base = build_features(hourly)
    tampered = hourly.copy()
    mask = tampered.index.date == day
    tampered.loc[mask, "price_pln_mwh"] = 1e6
    changed = build_features(tampered)
    a = base.loc[base["local_date"] == day, FEATURES]
    b = changed.loc[changed["local_date"] == day, FEATURES]
    pd.testing.assert_frame_equal(a, b)


def test_lag_24h_same_clock_hour_across_dst(hourly):
    feat = build_features(hourly)
    target = pd.Timestamp("2026-10-26 10:00", tz="Europe/Warsaw")
    source = pd.Timestamp("2026-10-25 10:00", tz="Europe/Warsaw")
    assert feat.loc[target, "lag_24h"] == pytest.approx(hourly.loc[source, "price_pln_mwh"])


def test_dst_fall_day_has_25_rows(hourly):
    feat = build_features(hourly)
    assert (feat["local_date"] == date(2026, 10, 25)).sum() == 25


def test_holiday_flag():
    feat = build_features(make_hourly("2026-10-25", "2026-11-15"))
    assert feat.loc[feat["local_date"] == date(2026, 11, 11), "is_holiday"].eq(1).all()
    assert feat.loc[feat["local_date"] == date(2026, 11, 12), "is_holiday"].eq(0).all()
