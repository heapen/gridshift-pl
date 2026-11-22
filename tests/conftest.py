"""Shared synthetic hourly dataset mirroring the ingest output schema."""
import numpy as np
import pandas as pd
import pytest

from pipeline.config import CITIES, WEATHER_VARS


def make_hourly(start="2026-09-01", end="2026-11-10", seed=0) -> pd.DataFrame:
    idx = pd.date_range(
        pd.Timestamp(start, tz="Europe/Warsaw"),
        pd.Timestamp(end, tz="Europe/Warsaw"),
        freq="h",
        inclusive="left",
        name="timestamp",
    )
    rng = np.random.default_rng(seed)
    hours = idx.hour.to_numpy()
    price = 500 + 150 * np.sin((hours - 6) / 24 * 2 * np.pi) + rng.normal(0, 40, len(idx))
    df = pd.DataFrame({"price_pln_mwh": price}, index=idx)
    for city in CITIES:
        df[f"{city}_temperature_2m"] = 10 + rng.normal(0, 3, len(idx))
        df[f"{city}_wind_speed_100m"] = np.abs(rng.normal(20, 8, len(idx)))
        df[f"{city}_shortwave_radiation"] = np.clip(400 * np.sin((hours - 6) / 12 * np.pi), 0, None)
    df["eur_pln"] = 4.25
    return df


@pytest.fixture
def hourly():
    return make_hourly()
