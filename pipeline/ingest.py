"""Module A — ingest RCE prices, regional weather and EUR/PLN into one hourly dataset.

Sources (all keyless):
* PSE Open Data v2 ``rce-pln`` — quarter-hourly RCE prices (PLN/MWh).
* Open-Meteo archive (+ forecast endpoint as fallback for the latest hours).
* NBP table A — daily EUR/PLN mid rate.

Every timestamp is handled in UTC on the wire and converted to Europe/Warsaw
locally, which keeps DST transition days (23 / 25 local hours) unambiguous.

Run: ``python -m pipeline.ingest``
"""
from __future__ import annotations

import hashlib
import json
import time
from datetime import date, timedelta

import pandas as pd
import requests

from pipeline.config import (
    CITIES,
    DATA_RAW,
    DATASET_PATH,
    TZ,
    WEATHER_VARS,
    window,
)

PSE_URL = "https://api.raporty.pse.pl/api/rce-pln"
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
NBP_URL = "https://api.nbp.pl/api/exchangerates/rates/a/eur/{start}/{end}/?format=json"

MAX_FILL_HOURS = 2
USER_AGENT = "gridshift-pl-pipeline/0.1"


# --------------------------------------------------------------------------- #
# HTTP helpers
# --------------------------------------------------------------------------- #
def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": USER_AGENT, "Accept": "application/json"})
    return s


def _get_json(session, url: str, params: dict | None = None, retries: int = 5) -> dict:
    """GET with exponential backoff; raises after ``retries`` failed attempts."""
    last_exc: Exception | None = None
    for attempt in range(retries):
        try:
            resp = session.get(url, params=params, timeout=60)
            resp.raise_for_status()
            return resp.json()
        except (requests.RequestException, ValueError) as exc:  # pragma: no cover - network
            last_exc = exc
            print(f"  retry {attempt + 1}/{retries} for {url}: {exc}")
            time.sleep(2**attempt)
    raise RuntimeError(f"Request failed after {retries} attempts: {url}") from last_exc


def _cache_path(kind: str, key: str):
    digest = hashlib.sha1(key.encode()).hexdigest()[:16]
    return DATA_RAW / kind / f"{digest}.json"


def _cached_get(session, kind: str, url: str, params: dict | None, use_cache: bool) -> dict:
    key = url + json.dumps(params or {}, sort_keys=True)
    path = _cache_path(kind, key)
    if use_cache and path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    payload = _get_json(session, url, params)
    if use_cache:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload), encoding="utf-8")
    return payload


# --------------------------------------------------------------------------- #
# RCE prices
# --------------------------------------------------------------------------- #
def fetch_rce(start: date, end: date, session=None, use_cache: bool = True) -> pd.DataFrame:
    """Fetch raw quarter-hourly RCE rows for business dates in [start, end].

    Follows the OData ``nextLink`` until the last page.
    """
    session = session or _session()
    params = {"$filter": f"business_date ge '{start.isoformat()}' and business_date le '{end.isoformat()}'"}
    url: str | None = PSE_URL
    rows: list[dict] = []
    while url:
        payload = _cached_get(session, "rce", url, params, use_cache)
        rows.extend(payload.get("value", []))
        url = payload.get("nextLink")
        params = None  # nextLink already embeds the filter
    if not rows:
        raise ValueError(f"No RCE rows returned for {start}..{end}")
    return pd.DataFrame(rows)


def rce_to_hourly(raw: pd.DataFrame) -> pd.Series:
    """Aggregate quarter-hourly RCE to hourly means on a Europe/Warsaw index.

    ``dtime_utc`` marks the END of each 15-minute period, so the period start
    is ``dtime_utc - 15 min``. Raises ``ValueError`` if an hour is incomplete.
    """
    df = raw[["dtime_utc", "rce_pln"]].copy()
    start_utc = pd.to_datetime(df["dtime_utc"]).dt.tz_localize("UTC") - pd.Timedelta(minutes=15)
    df = df.assign(hour_utc=start_utc.dt.floor("h"), rce_pln=df["rce_pln"].astype(float))
    df = df.drop_duplicates(subset=["dtime_utc"])
    grouped = df.groupby("hour_utc")["rce_pln"]
    counts = grouped.count()
    bad = counts[counts != 4]
    if not bad.empty:
        raise ValueError(f"{len(bad)} hour(s) without exactly 4 quarter-hours, e.g. {bad.index[0]}")
    hourly = grouped.mean()
    hourly.index = hourly.index.tz_convert(TZ)
    hourly.index.name = "timestamp"
    hourly.name = "price_pln_mwh"
    return hourly


# --------------------------------------------------------------------------- #
# Weather
# --------------------------------------------------------------------------- #
def _weather_frame(payload: dict, city: str) -> pd.DataFrame:
    hourly = payload["hourly"]
    idx = pd.to_datetime(hourly["time"]).tz_localize("UTC")
    data = {f"{city}_{var}": hourly[var] for var in WEATHER_VARS}
    return pd.DataFrame(data, index=idx, dtype="float64")


def fetch_weather(start: date, end: date, session=None, use_cache: bool = True) -> pd.DataFrame:
    """Hourly weather for all cities on a Europe/Warsaw index.

    Uses the archive endpoint; any missing hours (latest days) are filled from
    the forecast endpoint, which serves recent past days with the same variables.
    """
    session = session or _session()
    # Pad by one day on each side so the local-time window is fully covered.
    q_start, q_end = start - timedelta(days=1), end + timedelta(days=1)
    frames = []
    for city, (lat, lon) in CITIES.items():
        params = {
            "latitude": lat,
            "longitude": lon,
            "start_date": q_start.isoformat(),
            "end_date": min(q_end, date.today()).isoformat(),
            "hourly": ",".join(WEATHER_VARS),
            "timezone": "GMT",
        }
        archive = _weather_frame(_cached_get(session, "weather", ARCHIVE_URL, params, use_cache), city)
        if archive.isna().any().any():
            recent_start = max(q_start, end - timedelta(days=60))
            f_params = dict(params, start_date=recent_start.isoformat())
            forecast = _weather_frame(_cached_get(session, "weather", FORECAST_URL, f_params, use_cache), city)
            archive = archive.combine_first(forecast)
        frames.append(archive)
    weather = pd.concat(frames, axis=1)
    weather.index = weather.index.tz_convert(TZ)
    weather.index.name = "timestamp"
    return weather


# --------------------------------------------------------------------------- #
# EUR/PLN
# --------------------------------------------------------------------------- #
def fill_daily_rates(rates: pd.Series, start: date, end: date) -> pd.Series:
    """Reindex a sparse (business-day) rate series to every calendar day, forward-filled."""
    days = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    full_index = sorted(set(days) | set(rates.index))
    filled = rates.reindex(full_index).sort_index().ffill()
    out = filled.reindex(days)
    if out.isna().any():
        raise ValueError("EUR/PLN rate missing at the start of the window")
    out.name = "eur_pln"
    return out


def fetch_eur_pln(start: date, end: date, session=None, use_cache: bool = True) -> pd.Series:
    """Daily NBP EUR/PLN mid rate for every calendar day in [start, end]."""
    session = session or _session()
    lookback = start - timedelta(days=7)  # covers a leading weekend/holiday
    points: dict[date, float] = {}
    chunk_start = lookback
    while chunk_start <= end:
        chunk_end = min(chunk_start + timedelta(days=90), end)
        url = NBP_URL.format(start=chunk_start.isoformat(), end=chunk_end.isoformat())
        payload = _cached_get(session, "nbp", url, None, use_cache)
        for r in payload["rates"]:
            points[date.fromisoformat(r["effectiveDate"])] = float(r["mid"])
        chunk_start = chunk_end + timedelta(days=1)
    return fill_daily_rates(pd.Series(points), start, end)


# --------------------------------------------------------------------------- #
# Assembly
# --------------------------------------------------------------------------- #
def assemble(prices: pd.Series, weather: pd.DataFrame, fx: pd.Series, start: date, end: date) -> pd.DataFrame:
    """Join sources on a complete hourly Warsaw index and validate gaps."""
    idx_start = pd.Timestamp(start, tz=TZ)
    idx_end = pd.Timestamp(end + timedelta(days=1), tz=TZ)
    index = pd.date_range(idx_start, idx_end, freq="h", inclusive="left", name="timestamp")
    df = pd.DataFrame(index=index)
    df = df.join(prices).join(weather)
    df = df.ffill(limit=MAX_FILL_HOURS)
    local_dates = df.index.date
    df["eur_pln"] = [fx[d] for d in local_dates]
    missing = df.isna().sum()
    if missing.any():
        raise ValueError(f"Unfilled gaps remain:\n{missing[missing > 0]}")
    return df


def build_dataset(today: date | None = None) -> pd.DataFrame:
    fetch_start, model_start, end = window(today)
    session = _session()
    print(f"Window: fetch {fetch_start} .. {end} (model from {model_start})")
    # NBP intermittently answers 404 to long-running shared sessions, so FX is
    # fetched first on its own session.
    fx = fetch_eur_pln(fetch_start, end, session=_session())
    raw = fetch_rce(fetch_start, end, session=session)
    prices = rce_to_hourly(raw)
    weather = fetch_weather(fetch_start, end, session=session)
    df = assemble(prices, weather, fx, fetch_start, end)

    DATASET_PATH.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(DATASET_PATH)

    print(f"Raw RCE rows: {len(raw):,}")
    print(f"Hourly rows:  {len(df):,}  ({df.index.min()} .. {df.index.max()})")
    print(f"Duplicates:   {df.index.duplicated().sum()}")
    print(f"NaN total:    {int(df.isna().sum().sum())}")
    print(df["price_pln_mwh"].describe().round(2).to_string())
    print(f"Saved -> {DATASET_PATH}")
    return df


if __name__ == "__main__":
    build_dataset()
