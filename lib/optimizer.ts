/**
 * Browser load-shift optimiser — the same linear programme as
 * pipeline/optimizer.py (scipy HiGHS), solved with javascript-lp-solver.
 *
 *   variables  x[s,t] >= 0  kW moved from hour s to t, 0 < |s - t| <= W
 *              P      >= 0  daily peak load (kW)
 *   minimise   sum_{s,t} x[s,t] * (p_t - p_s) / 1000  +  lambda * P
 *   subject to sum_t x[s,t] <= f * b_s                    (flexible share)
 *              b_t - out_t + in_t <= C                    (contracted capacity)
 *              b_t - out_t + in_t - P <= 0                (peak definition)
 *
 * Parity with Python is asserted on objective-derived KPIs (LP optima may be
 * non-unique, so hourly schedules can legitimately differ).
 */
import solver, { type LpModel } from "javascript-lp-solver";
import type { OptimizerInput, OptimizerResult } from "./types";

export const MIN_PERFECT_SAVINGS_PLN = 1;

const PEAK = "peak";
const varName = (s: number, t: number) => `x_${s}_${t}`;

export function solve(
  base: number[],
  planPrice: number[],
  flex: number,
  window: number,
  capacityKw: number,
  demandCharge: number,
): number[] {
  const n = base.length;
  if (flex <= 0 || window <= 0) return [...base];

  const constraints: LpModel["constraints"] = {};
  const variables: LpModel["variables"] = {};
  for (let t = 0; t < n; t++) {
    constraints[`out_${t}`] = { max: flex * base[t] };
    constraints[`cap_${t}`] = { max: capacityKw - base[t] };
    constraints[`pk_${t}`] = { max: -base[t] };
  }
  const pairs: [number, number][] = [];
  for (let s = 0; s < n; s++) {
    for (let t = 0; t < n; t++) {
      if (s === t || Math.abs(s - t) > window) continue;
      pairs.push([s, t]);
      variables[varName(s, t)] = {
        cost: (planPrice[t] - planPrice[s]) / 1000,
        [`out_${s}`]: 1,
        [`cap_${s}`]: -1,
        [`cap_${t}`]: 1,
        [`pk_${s}`]: -1,
        [`pk_${t}`]: 1,
      };
    }
  }
  const peakVar: Record<string, number> = { cost: demandCharge };
  for (let t = 0; t < n; t++) peakVar[`pk_${t}`] = -1;
  variables[PEAK] = peakVar;

  const result = solver.Solve({ optimize: "cost", opType: "min", constraints, variables });
  if (!result.feasible) {
    console.warn("Load-shift LP infeasible; returning the base schedule.");
    return [...base];
  }

  const shifted = [...base];
  for (const [s, t] of pairs) {
    const x = Number(result[varName(s, t)] ?? 0);
    if (x > 0) {
      shifted[s] -= x;
      shifted[t] += x;
    }
  }
  return shifted;
}

const energyCost = (price: number[], load: number[]) =>
  load.reduce((acc, kw, i) => acc + (price[i] * kw) / 1000, 0);

export function evaluate(input: OptimizerInput): OptimizerResult {
  const { base, forecast, actual, co2, eurPln, flex, window, capacityKw, demandCharge } = input;
  const planned = solve(base, forecast, flex, window, capacityKw, demandCharge);
  const perfect = solve(base, actual, flex, window, capacityKw, demandCharge);

  const peak = (xs: number[]) => Math.max(...xs);
  const baseEnergy = energyCost(actual, base);
  const baseDemand = demandCharge * peak(base);
  const planEnergy = energyCost(actual, planned);
  const planDemand = demandCharge * peak(planned);
  const perfTotal = energyCost(actual, perfect) + demandCharge * peak(perfect);

  const energySavingsPln = baseEnergy - planEnergy;
  const demandSavingsPln = baseDemand - planDemand;
  const savingsPln = energySavingsPln + demandSavingsPln;
  const perfectSavingsPln = baseEnergy + baseDemand - perfTotal;

  return {
    baselineCostPln: baseEnergy + baseDemand,
    optimisedCostPln: planEnergy + planDemand,
    energySavingsPln,
    demandSavingsPln,
    savingsPln,
    savingsEur: savingsPln / eurPln,
    perfectSavingsPln,
    captureRate: perfectSavingsPln >= MIN_PERFECT_SAVINGS_PLN ? savingsPln / perfectSavingsPln : null,
    peakReductionPct: ((peak(base) - peak(planned)) / peak(base)) * 100,
    co2ReductionKg: base.reduce((acc, b, i) => acc + (co2[i] * (b - planned[i])) / 1000, 0),
    shiftedKw: planned,
  };
}
