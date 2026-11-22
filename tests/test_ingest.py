"""Tests for pipeline.ingest: RCE parsing, DST handling, pagination, FX fill."""
from datetime import date, datetime, timedelta, timezone

import pandas as pd
import pytest

from pipeline import ingest


def _quarter_hour_rows(local_day: date, prices=None) -> pd.DataFrame:
    """Build PSE-like rows for every quarter-hour of a Warsaw local day."""
    start = pd.Timestamp(local_day, tz="Europe/Warsaw").tz_convert("UTC")
    end = pd.Timestamp(local_day + timedelta(days=1), tz="Europe/Warsaw").tz_convert("UTC")
    ends = pd.date_range(start + pd.Timedelta(minutes=15), end, freq="15min")
    rows = []
    for i, ts_end in enumerate(ends):
        rows.append(
            {
                "dtime_utc": ts_end.strftime("%Y-%m-%d %H:%M:%S"),
                "rce_pln": float(prices[i]) if prices is not None else 100.0 + i,
                "business_date": local_day.isoformat(),
            }
        )
    return pd.DataFrame(rows)


def test_rce_to_hourly_dst_fall():
    raw = _quarter_hour_rows(date(2026, 10, 25))
    assert len(raw) == 100
    hourly = ingest.rce_to_hourly(raw)
    assert len(hourly) == 25
    two_am = hourly[hourly.index.hour == 2]
    assert len(two_am) == 2
    offsets = {ts.utcoffset() for ts in two_am.index}
    assert offsets == {timedelta(hours=2), timedelta(hours=1)}
    assert str(hourly.index.tz) == "Europe/Warsaw"
    assert hourly.name == "price_pln_mwh"


def test_rce_to_hourly_mean():
    prices = [100, 200, 300, 400] + [0] * 92
    raw = _quarter_hour_rows(date(2026, 11, 2), prices)
    hourly = ingest.rce_to_hourly(raw)
    assert hourly.iloc[0] == pytest.approx(250.0)
    assert len(hourly) == 24


def test_rce_to_hourly_incomplete_raises():
    raw = _quarter_hour_rows(date(2026, 11, 2)).drop(index=0)
    with pytest.raises(ValueError):
        ingest.rce_to_hourly(raw)


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload
        self.status_code = 200

    def json(self):
        return self._payload

    def raise_for_status(self):
        return None


class _FakeSession:
    def __init__(self, pages):
        self.pages = list(pages)
        self.calls = []

    def get(self, url, params=None, timeout=None):
        self.calls.append((url, params))
        return _FakeResponse(self.pages.pop(0))


def test_fetch_rce_follows_nextlink(tmp_path, monkeypatch):
    monkeypatch.setattr(ingest, "DATA_RAW", tmp_path)
    row = {"dtime_utc": "2026-11-01 23:15:00", "rce_pln": 1.0, "business_date": "2026-11-02"}
    page1 = {"value": [row], "nextLink": "https://api.raporty.pse.pl/api/rce-pln?$after=abc"}
    page2 = {"value": [dict(row, dtime_utc="2026-11-01 23:30:00")]}
    session = _FakeSession([page1, page2])
    df = ingest.fetch_rce(date(2026, 11, 2), date(2026, 11, 2), session=session, use_cache=False)
    assert len(df) == 2
    assert len(session.calls) == 2
    assert session.calls[1][0] == page1["nextLink"]


def test_eur_pln_ffill_weekend():
    # Friday 2026-11-06 published, weekend has no fixing.
    rates = pd.Series([4.25], index=pd.to_datetime(["2026-11-06"]).date)
    filled = ingest.fill_daily_rates(rates, date(2026, 11, 6), date(2026, 11, 8))
    assert list(filled.values) == [4.25, 4.25, 4.25]
    assert list(filled.index) == [date(2026, 11, 6), date(2026, 11, 7), date(2026, 11, 8)]


def _assemble_inputs(gap_hours: int):
    start, end = date(2026, 11, 2), date(2026, 11, 2)
    idx = pd.date_range(pd.Timestamp(start, tz="Europe/Warsaw"), periods=24, freq="h", name="timestamp")
    prices = pd.Series(range(24), index=idx, dtype=float, name="price_pln_mwh")
    prices.iloc[5 : 5 + gap_hours] = float("nan")
    prices = prices.dropna()
    weather = pd.DataFrame({"warsaw_temperature_2m": 5.0}, index=idx)
    fx = pd.Series({start: 4.25})
    return prices, weather, fx, start, end


def test_assemble_fills_gap_up_to_two_hours():
    df = ingest.assemble(*_assemble_inputs(2))
    assert df["price_pln_mwh"].isna().sum() == 0
    assert df["price_pln_mwh"].iloc[6] == 4.0  # forward-filled from 04:00


def test_assemble_rejects_gap_longer_than_two_hours():
    with pytest.raises(ValueError):
        ingest.assemble(*_assemble_inputs(3))
