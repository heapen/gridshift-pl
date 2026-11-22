import { describe, expect, it } from "vitest";
import fixtures from "./parity_fixtures.json";
import { evaluate, solve } from "@/lib/optimizer";
import { PROFILES, baseForDay } from "@/lib/profiles";
import type { ProfileId } from "@/lib/types";

const close = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.max(1e-3 * Math.abs(expected), 0.01));

describe("parity with the Python reference optimiser", () => {
  for (const c of fixtures.cases) {
    it(`${c.profile} / ${c.scenario} / scale ${c.scale}`, () => {
      const res = evaluate(c.input);
      close(res.savingsPln, c.expected.savingsPln);
      close(res.energySavingsPln, c.expected.energySavingsPln);
      close(res.demandSavingsPln, c.expected.demandSavingsPln);
      close(res.perfectSavingsPln, c.expected.perfectSavingsPln);
      close(res.peakReductionPct, c.expected.peakReductionPct);
      close(res.co2ReductionKg, c.expected.co2ReductionKg);
      close(res.baselineCostPln, c.expected.baselineCostPln);
      if (c.expected.captureRate === null) expect(res.captureRate).toBeNull();
      else close(res.captureRate as number, c.expected.captureRate);
    });
  }
});

describe("solver invariants", () => {
  const base = Array.from({ length: 24 }, (_, i) => 600 + 300 * Math.sin(i / 3));
  const price = Array.from({ length: 24 }, (_, i) => 400 + 250 * Math.cos(i / 4));
  const cap = Math.max(...base);

  it("conserves energy", () => {
    const shifted = solve(base, price, 0.3, 4, cap, 0.6);
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    expect(sum(shifted)).toBeCloseTo(sum(base), 6);
  });

  it("returns zero savings with zero flexibility or zero window", () => {
    const input = { base, forecast: price, actual: price, co2: base.map(() => 600), eurPln: 4.25, capacityKw: cap, demandCharge: 0.6 };
    expect(evaluate({ ...input, flex: 0, window: 4 }).savingsPln).toBe(0);
    expect(evaluate({ ...input, flex: 0.5, window: 0 }).savingsPln).toBe(0);
  });

  it("handles a 25-hour DST day", () => {
    const b = baseForDay(PROFILES.cnc_plant, 25, 1);
    expect(b).toHaveLength(25);
    const p = Array.from({ length: 25 }, (_, i) => 200 + 20 * i);
    expect(solve(b, p, 0.2, 3, Math.max(...b), 0.6)).toHaveLength(25);
  });

  it("produces only finite KPIs at slider extremes", () => {
    const input = { base, forecast: price, actual: price, co2: base.map(() => 600), eurPln: 4.25, capacityKw: cap, demandCharge: 0.6, flex: 1, window: 12 };
    const t0 = performance.now();
    const res = evaluate(input);
    const ms = performance.now() - t0;
    for (const [k, v] of Object.entries(res)) {
      if (k === "shiftedKw" || v === null) continue;
      expect(Number.isFinite(v as number), k).toBe(true);
    }
    console.log(`extreme solve (2 LPs, 24h, window 12): ${ms.toFixed(1)} ms`);
  });
});

describe("profiles", () => {
  it("match the Python source of truth", () => {
    for (const [id, py] of Object.entries(fixtures.profiles)) {
      const ts = PROFILES[id as ProfileId];
      expect(ts.baseKw).toEqual(py.base_kw);
      expect(ts.flexPct).toBe(py.flex_pct);
      expect(ts.windowH).toBe(py.window_h);
      expect(ts.capacityFactor).toBe(py.capacity_factor);
      expect(ts.name).toBe(py.name);
      expect(ts.availableHours).toEqual(py.available_hours);
    }
  });
});
