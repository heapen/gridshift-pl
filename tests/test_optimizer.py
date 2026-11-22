"""Invariant tests for the reference load-shift LP (pipeline.optimizer)."""
import numpy as np
import pytest

from pipeline.optimizer import evaluate, solve
from pipeline.profiles import PROFILES, base_for_day


def _random_case(n=24, seed=1):
    rng = np.random.default_rng(seed)
    base = rng.uniform(500, 1000, n)
    price = rng.uniform(100, 900, n)
    return base, price


def test_energy_conserved():
    base, price = _random_case()
    shifted = solve(base, price, flex=0.3, window=4, capacity_kw=1.2 * base.max())
    assert shifted.sum() == pytest.approx(base.sum(), rel=1e-9)


def test_respects_capacity_and_flex():
    base, price = _random_case(seed=2)
    cap = 1.1 * base.max()
    shifted = solve(base, price, flex=0.25, window=3, capacity_kw=cap)
    assert shifted.max() <= cap + 1e-6
    # a site can never drop below its non-flexible share in any hour
    assert np.all(shifted >= (1 - 0.25) * base - 1e-6)


def test_zero_flex_zero_savings():
    base, price = _random_case(seed=3)
    res = evaluate(base, price, price, np.full(24, 600.0), 4.25, flex=0.0, window=4, capacity_kw=1e9)
    assert res["savingsPln"] == 0.0
    res = evaluate(base, price, price, np.full(24, 600.0), 4.25, flex=0.5, window=0, capacity_kw=1e9)
    assert res["savingsPln"] == 0.0


def test_moves_load_to_cheap_hour():
    base = np.full(24, 1000.0)
    price = np.array([100.0] * 23 + [10.0])
    shifted = solve(base, price, flex=0.2, window=1, capacity_kw=2000.0, demand_charge=0.0)
    assert shifted[23] > 1000.0
    assert shifted[22] < 1000.0


def test_dst_25h_day_solves():
    base = base_for_day(PROFILES["cnc_plant"], 25, 1.0)
    assert len(base) == 25
    price = np.linspace(200, 800, 25)
    shifted = solve(base, price, flex=0.2, window=3, capacity_kw=1.2 * base.max())
    assert len(shifted) == 25


def test_23h_day_profile_length():
    assert len(base_for_day(PROFILES["ev_fleet"], 23, 1.0)) == 23


def test_capture_rate_none_when_no_opportunity():
    base, _ = _random_case(seed=4)
    flat = np.full(24, 500.0)
    forecast = np.linspace(100, 900, 24)
    res = evaluate(base, forecast, flat, np.full(24, 600.0), 4.25, flex=0.3, window=4, capacity_kw=1e9,
                   demand_charge=0.0)
    assert res["captureRate"] is None
    assert res["perfectSavingsPln"] == pytest.approx(0.0, abs=1e-6)


def test_evaluate_reports_negative_savings_on_bad_forecast():
    base = np.full(24, 1000.0)
    actual = np.array([100.0] * 12 + [900.0] * 12)
    forecast = actual[::-1].copy()  # forecast says the opposite
    res = evaluate(base, forecast, actual, np.full(24, 600.0), 4.25, flex=0.3, window=12,
                   capacity_kw=2000.0, demand_charge=0.0)
    assert res["savingsPln"] < 0
    assert res["perfectSavingsPln"] > 0
    assert res["captureRate"] < 0
    assert res["savingsEur"] == pytest.approx(res["savingsPln"] / 4.25)


def test_default_capacity_never_raises_peak():
    profile = PROFILES["ev_fleet"]
    base = base_for_day(profile, 24, 1.0)
    price = np.linspace(900, 100, 24)
    shifted = solve(base, price, profile.flex_pct, profile.window_h, profile.capacity_factor * base.max())
    assert shifted.max() <= base.max() + 1e-6


def test_demand_charge_shaves_peak_on_flat_prices():
    profile = PROFILES["ev_fleet"]
    base = base_for_day(profile, 24, 1.0)
    flat = np.full(24, 500.0)
    shifted = solve(base, flat, profile.flex_pct, profile.window_h, base.max(), demand_charge=0.6)
    assert shifted.max() < base.max() * 0.95
    assert shifted.sum() == pytest.approx(base.sum(), rel=1e-9)


def test_evaluate_splits_energy_and_demand_savings():
    profile = PROFILES["ev_fleet"]
    base = base_for_day(profile, 24, 1.0)
    flat = np.full(24, 500.0)
    res = evaluate(base, flat, flat, np.full(24, 600.0), 4.25, profile.flex_pct, profile.window_h,
                   base.max(), demand_charge=0.6)
    assert res["energySavingsPln"] == pytest.approx(0.0, abs=1e-6)
    assert res["demandSavingsPln"] > 0
    assert res["savingsPln"] == pytest.approx(res["energySavingsPln"] + res["demandSavingsPln"])
    assert res["peakReductionPct"] > 5


def test_ev_fleet_never_charges_while_vehicles_are_out():
    from pipeline.profiles import available_for_day

    profile = PROFILES["ev_fleet"]
    base = base_for_day(profile, 24, 1.0)
    available = available_for_day(profile, 24)
    price = np.full(24, 900.0)
    price[10:14] = 50.0  # tempting midday trough while the fleet is on the road
    shifted = solve(base, price, profile.flex_pct, profile.window_h, base.max(), available=available)
    unplugged = ~available
    assert unplugged.sum() == 9  # 07:00-15:59
    np.testing.assert_allclose(shifted[unplugged], base[unplugged])
    assert shifted.sum() == pytest.approx(base.sum(), rel=1e-9)


def test_available_for_day_follows_dst_rule():
    from pipeline.profiles import available_for_day

    profile = PROFILES["ev_fleet"]
    assert len(available_for_day(profile, 23)) == 23
    assert len(available_for_day(profile, 25)) == 25
    assert available_for_day(PROFILES["cold_storage"], 24).all()
