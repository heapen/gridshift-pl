"""Project-wide configuration: paths, time window, locations and constants."""
from __future__ import annotations

from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = "Europe/Warsaw"
WARSAW = ZoneInfo(TZ)

# Modelling window: 180 full days ending yesterday (Warsaw time), plus a
# history buffer so the 168h lag is available for the first modelled day.
WINDOW_DAYS = 180
LAG_BUFFER_DAYS = 10
TEST_DAYS = 60

# Representative locations for the four regional weather signals (lat, lon).
CITIES: dict[str, tuple[float, float]] = {
    "warsaw": (52.23, 21.01),
    "gdansk": (54.35, 18.65),
    "katowice": (50.26, 19.02),
    "poznan": (52.41, 16.93),
}
WEATHER_VARS = ("temperature_2m", "wind_speed_100m", "shortwave_radiation")

# Average CO2 emission factor for electricity consumed from the Polish grid,
# in kg CO2 per MWh. Source: KOBiZE "Emission factors for electricity"
# (December 2024 edition, end-user factor: 597 kg CO2/MWh).
KOBIZE_FACTOR_KG_MWH = 597.0

ROOT = Path(__file__).resolve().parent.parent
DATA_RAW = ROOT / "data" / "raw"
DATA_PROCESSED = ROOT / "data" / "processed"
PUBLIC_DATA = ROOT / "public" / "data"
DATASET_PATH = DATA_PROCESSED / "market_weather_hourly.parquet"


def window(today: date | None = None) -> tuple[date, date, date]:
    """Return (fetch_start, model_start, end) for the modelling window.

    ``end`` is yesterday in Warsaw time; ``model_start`` is the first of the
    180 modelled days; ``fetch_start`` adds the lag history buffer.
    """
    if today is None:
        today = datetime.now(WARSAW).date()
    end = today - timedelta(days=1)
    model_start = end - timedelta(days=WINDOW_DAYS - 1)
    fetch_start = model_start - timedelta(days=LAG_BUFFER_DAYS)
    return fetch_start, model_start, end
