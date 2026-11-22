"""Module C — reference load-shift optimiser (scipy HiGHS).

Linear programme for one local day with hours t = 0..n-1:

    variables   x[s,t] >= 0   kW moved from hour s to hour t, 0 < |s-t| <= W
                P      >= 0   daily peak load (kW)
    minimise    sum_t p_t * L_t / 1000  +  lambda * P
                with L_t = b_t - sum_t' x[t,t'] + sum_s x[s,t]
    subject to  sum_t x[s,t] <= f * b_s        (per-hour flexible share)
                x[s,t] = 0 unless s and t are available hours (e.g. EV plugged in)
                L_t <= C                        (contracted capacity)
                L_t <= P                        (peak definition)

``p_t`` is in PLN/MWh, loads in kW over 1-hour steps, ``lambda`` is a peak
demand charge in PLN per kW of daily peak (a documented tariff assumption).
Energy is conserved by construction. Since sum_t p_t b_t is constant, the
energy term reduces to sum x[s,t] * (p_t - p_s) / 1000.

The schedule is planned on the *forecast* price and billed on the *actual*
price; the same LP solved on actual prices gives the perfect-foresight bound.
``lib/optimizer.ts`` implements the identical formulation for the browser.

Run: ``python -m pipeline.optimizer`` (writes TypeScript parity fixtures)
"""
from __future__ import annotations

import json

import numpy as np
from scipy.optimize import linprog
from scipy.sparse import lil_matrix

from pipeline.config import DEMAND_CHARGE_PLN_PER_KW_DAY, PUBLIC_DATA, ROOT
from pipeline.profiles import PROFILES, available_for_day, base_for_day

MIN_PERFECT_SAVINGS_PLN = 1.0  # below this, capture rate is undefined
PARITY_PATH = ROOT / "lib" / "__tests__" / "parity_fixtures.json"


def _pairs(n: int, window: int, available=None) -> list[tuple[int, int]]:
    ok = np.ones(n, dtype=bool) if available is None else np.asarray(available, dtype=bool)
    return [
        (s, t)
        for s in range(n)
        for t in range(n)
        if s != t and abs(s - t) <= window and ok[s] and ok[t]
    ]


def solve(
    base_kw,
    plan_price,
    flex: float,
    window: int,
    capacity_kw: float,
    demand_charge: float = DEMAND_CHARGE_PLN_PER_KW_DAY,
    available=None,
) -> np.ndarray:
    """Return the cost-minimising shifted load profile L_t (kW)."""
    base = np.asarray(base_kw, dtype=float)
    price = np.asarray(plan_price, dtype=float)
    n = len(base)
    if flex <= 0 or window <= 0:
        return base.copy()

    pairs = _pairs(n, int(window), available)
    if not pairs:
        return base.copy()
    m = len(pairs)
    p_col = m  # index of the peak variable
    c = np.zeros(m + 1)
    c[:m] = [(price[t] - price[s]) / 1000.0 for s, t in pairs]
    c[p_col] = demand_charge

    # rows: [0,n) outflow, [n,2n) capacity, [2n,3n) peak definition
    a = lil_matrix((3 * n, m + 1))
    for k, (s, t) in enumerate(pairs):
        a[s, k] = 1.0
        for offset in (n, 2 * n):
            a[offset + s, k] -= 1.0
            a[offset + t, k] += 1.0
    for t in range(n):
        a[2 * n + t, p_col] = -1.0
    b_ub = np.concatenate([flex * base, capacity_kw - base, -base])

    res = linprog(c, A_ub=a.tocsr(), b_ub=b_ub, bounds=(0, None), method="highs")
    if not res.success:
        raise RuntimeError(f"LP failed: {res.message}")
    x = res.x[:m]
    shifted = base.copy()
    for k, (s, t) in enumerate(pairs):
        shifted[s] -= x[k]
        shifted[t] += x[k]
    return shifted


def _cost_pln(price: np.ndarray, load_kw: np.ndarray, demand_charge: float) -> tuple[float, float]:
    """Return (energy cost, peak demand cost) in PLN."""
    return float(np.sum(price * load_kw) / 1000.0), float(demand_charge * load_kw.max())


def evaluate(
    base_kw,
    forecast,
    actual,
    co2,
    eur_pln: float,
    flex: float,
    window: int,
    capacity_kw: float,
    demand_charge: float = DEMAND_CHARGE_PLN_PER_KW_DAY,
    available=None,
) -> dict:
    """Plan on ``forecast``, bill on ``actual``; return KPI dict (camelCase keys)."""
    base = np.asarray(base_kw, dtype=float)
    forecast = np.asarray(forecast, dtype=float)
    actual = np.asarray(actual, dtype=float)
    co2 = np.asarray(co2, dtype=float)

    planned = solve(base, forecast, flex, window, capacity_kw, demand_charge, available)
    perfect = solve(base, actual, flex, window, capacity_kw, demand_charge, available)

    base_energy, base_demand = _cost_pln(actual, base, demand_charge)
    plan_energy, plan_demand = _cost_pln(actual, planned, demand_charge)
    perf_energy, perf_demand = _cost_pln(actual, perfect, demand_charge)

    energy_savings = base_energy - plan_energy
    demand_savings = base_demand - plan_demand
    savings = energy_savings + demand_savings
    perfect_savings = (base_energy + base_demand) - (perf_energy + perf_demand)
    capture = savings / perfect_savings if perfect_savings >= MIN_PERFECT_SAVINGS_PLN else None

    return {
        "baselineCostPln": base_energy + base_demand,
        "optimisedCostPln": plan_energy + plan_demand,
        "energySavingsPln": energy_savings,
        "demandSavingsPln": demand_savings,
        "savingsPln": savings,
        "savingsEur": savings / eur_pln,
        "perfectSavingsPln": perfect_savings,
        "captureRate": capture,
        "peakReductionPct": float((base.max() - planned.max()) / base.max() * 100.0),
        "co2ReductionKg": float(np.sum(co2 * (base - planned)) / 1000.0),
        "shiftedKw": planned.tolist(),
    }


def write_parity_fixtures(days_path=PUBLIC_DATA / "days.json", out_path=PARITY_PATH) -> list[dict]:
    """Solve every profile x scenario day x slider setting and save inputs + KPIs."""
    days = json.loads(days_path.read_text(encoding="utf-8"))["days"]
    scenarios = json.loads((PUBLIC_DATA / "scenarios.json").read_text(encoding="utf-8"))
    # Also cover any DST transition day in the window (23 or 25 local hours).
    for iso, day in sorted(days.items()):
        if len(day["hours"]) != 24:
            scenarios[f"dst_{iso}"] = iso
    cases = []
    for profile in PROFILES.values():
        settings = [
            (1.0, profile.flex_pct, profile.window_h),
            (1.5, min(profile.flex_pct + 0.2, 1.0), min(profile.window_h + 2, 12)),
        ]
        for scen_key, iso in scenarios.items():
            day = days[iso]
            hours = day["hours"]
            for scale, flex, window in settings:
                base = base_for_day(profile, len(hours), scale)
                capacity = profile.capacity_factor * base.max()
                inputs = {
                    "base": base.tolist(),
                    "forecast": [h["forecast"] for h in hours],
                    "actual": [h["actual"] for h in hours],
                    "co2": [h["co2"] for h in hours],
                    "eurPln": day["eurPln"],
                    "flex": flex,
                    "window": window,
                    "capacityKw": capacity,
                    "demandCharge": DEMAND_CHARGE_PLN_PER_KW_DAY,
                    "available": available_for_day(profile, len(hours)).tolist(),
                }
                res = evaluate(
                    inputs["base"], inputs["forecast"], inputs["actual"], inputs["co2"],
                    inputs["eurPln"], flex, window, capacity,
                    available=inputs["available"],
                )
                res.pop("shiftedKw")
                cases.append(
                    {"profile": profile.id, "scenario": scen_key, "date": iso,
                     "scale": scale, "input": inputs, "expected": res}
                )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"profiles": {k: p.to_dict() for k, p in PROFILES.items()}, "cases": cases}
    out_path.write_text(json.dumps(payload, indent=1), encoding="utf-8")
    return cases


def main() -> None:
    cases = write_parity_fixtures()
    print(f"Wrote {len(cases)} parity cases -> {PARITY_PATH}")
    print(f"{'profile':14}{'scenario':17}{'date':12}{'savings':>10}{'perfect':>10}{'capture':>9}{'peak%':>7}{'CO2kg':>8}")
    for c in cases:
        if c["scale"] != 1.0:
            continue
        e = c["expected"]
        cap = "n/a" if e["captureRate"] is None else f"{e['captureRate'] * 100:.0f}%"
        print(
            f"{c['profile']:14}{c['scenario']:17}{c['date']:12}{e['savingsPln']:>10.0f}"
            f"{e['perfectSavingsPln']:>10.0f}{cap:>9}{e['peakReductionPct']:>7.1f}{e['co2ReductionKg']:>8.0f}"
        )


if __name__ == "__main__":
    main()
