"""Hourly grid CO2 intensity proxy (estimate).

No keyless hourly carbon-intensity feed exists for Poland, so the hourly
intensity is approximated from the KOBiZE annual end-user factor, modulated
down when regional wind and solar output are high:

    raw_t = BASE * (1 - 0.35 * clip(0.6 * wind_t + 0.4 * solar_t, 0, 1))
    e_t   = raw_t * BASE / mean(raw)

The rescaling keeps the period mean equal to the official annual factor, so
the proxy only redistributes intensity across hours. Results are an estimate
and are labelled as such everywhere they are shown.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from pipeline.config import KOBIZE_FACTOR_KG_MWH

MAX_RENEWABLE_DISCOUNT = 0.35
WIND_WEIGHT = 0.6
SOLAR_WEIGHT = 0.4


def proxy_intensity(wind_norm: pd.Series, solar_norm: pd.Series) -> pd.Series:
    """Return hourly CO2 intensity in kg/MWh from normalised [0, 1] indices."""
    share = np.clip(WIND_WEIGHT * wind_norm + SOLAR_WEIGHT * solar_norm, 0.0, 1.0)
    raw = KOBIZE_FACTOR_KG_MWH * (1.0 - MAX_RENEWABLE_DISCOUNT * share)
    return raw * (KOBIZE_FACTOR_KG_MWH / raw.mean())
