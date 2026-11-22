// @vitest-environment jsdom
/**
 * End-to-end UI wiring: renders the real dashboard on the real pipeline exports
 * and checks that what a visitor sees matches the Python reference optimiser.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import Dashboard from "@/components/Dashboard";
import type { DashboardData } from "@/lib/data";
import { SCENARIO_LABELS } from "@/lib/constants";
import { formatEur, formatKg, formatPct, formatPln } from "@/lib/format";
import { PROFILES } from "@/lib/profiles";
import type { ProfileId, ScenarioKey } from "@/lib/types";
import fixtures from "./parity_fixtures.json";

const read = (name: string) => JSON.parse(readFileSync(path.join(process.cwd(), "public", "data", name), "utf-8"));
const data: DashboardData = {
  days: read("days.json"),
  metrics: read("metrics.json"),
  importance: read("feature_importance.json"),
  scenarios: read("scenarios.json"),
};

beforeAll(() => {
  // Recharts' ResponsiveContainer needs ResizeObserver, which jsdom lacks.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

/** KPI card label -> displayed value text. */
function kpis(): Record<string, string> {
  const section = screen.getByRole("region", { name: "Key results" });
  const out: Record<string, string> = {};
  for (const card of Array.from(section.children)) {
    const [label, value] = Array.from(card.querySelectorAll("p"));
    out[label.textContent ?? ""] = value.textContent ?? "";
  }
  return out;
}

function expectedKpis(profile: ProfileId, scenario: ScenarioKey) {
  const c = fixtures.cases.find((f) => f.profile === profile && f.scenario === scenario && f.scale === 1);
  if (!c) throw new Error(`no fixture for ${profile}/${scenario}`);
  const e = c.expected;
  return {
    eur: formatEur(e.savingsEur),
    kpis: {
      "Realised savings / day": formatPln(e.savingsPln),
      "Capture rate": formatPct(e.captureRate, 1),
      "Peak load reduction": formatPct(e.peakReductionPct / 100, 1),
      "CO₂ reduction (est.)": formatKg(e.co2ReductionKg),
    },
  };
}

const scenarioButton = (key: ScenarioKey) =>
  screen.getByRole("button", { name: new RegExp(`^${SCENARIO_LABELS[key].title}`) });
const profileButton = (id: ProfileId) => screen.getByRole("button", { name: PROFILES[id].name });

describe("dashboard", () => {
  it("opens on the EV fleet / high-wind case with every KPI non-trivial", () => {
    render(<Dashboard data={data} />);
    expect(scenarioButton("high_wind").getAttribute("aria-pressed")).toBe("true");
    expect(profileButton("ev_fleet").getAttribute("aria-pressed")).toBe("true");
    const shown = kpis();
    expect(shown).toEqual(expectedKpis("ev_fleet", "high_wind").kpis);
    for (const v of Object.values(shown)) expect(v).not.toMatch(/^(0 PLN|0\.0%|0\.0 kg|n\/a)$/);
  });

  it("matches the Python reference for every profile x scenario", () => {
    render(<Dashboard data={data} />);
    for (const profile of Object.keys(PROFILES) as ProfileId[]) {
      fireEvent.click(profileButton(profile));
      for (const scenario of Object.keys(SCENARIO_LABELS) as ScenarioKey[]) {
        fireEvent.click(scenarioButton(scenario));
        const { kpis: want, eur } = expectedKpis(profile, scenario);
        expect(kpis(), `${profile}/${scenario}`).toEqual(want);
        expect(screen.getByRole("region", { name: "Key results" }).textContent).toContain(eur);
      }
    }
  });

  it("never shows NaN or Infinity at slider extremes", () => {
    render(<Dashboard data={data} />);
    for (const [flex, window] of [["0", "8"], ["0.7", "0"], ["1", "12"]]) {
      fireEvent.change(screen.getByLabelText("Max shiftable load"), { target: { value: flex } });
      fireEvent.change(screen.getByLabelText("Max shift window"), { target: { value: window } });
      const text = screen.getByRole("region", { name: "Key results" }).textContent ?? "";
      expect(text).not.toMatch(/NaN|Infinity/);
      if (flex === "0" || window === "0") {
        expect(kpis()["Realised savings / day"]).toBe("0 PLN");
        expect(kpis()["Capture rate"]).toBe("n/a");
      }
    }
  });

  it("flags training days as in-sample and renders all 25 hours on the DST day", () => {
    render(<Dashboard data={data} />);
    const day = screen.getByLabelText("Market day");
    fireEvent.change(day, { target: { value: data.metrics.trainStart } });
    expect(screen.getByText("In-sample day")).toBeTruthy();
    fireEvent.change(day, { target: { value: "2026-10-25" } });
    expect(screen.getByText("Out-of-sample day")).toBeTruthy();
    expect(screen.getByText("Hourly table (25 hours)")).toBeTruthy();
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows).toHaveLength(26); // header + 25 hours
  });

  it("rejects a date outside the data window with a visible message", () => {
    render(<Dashboard data={data} />);
    fireEvent.change(screen.getByLabelText("Market day"), { target: { value: "2020-01-01" } });
    expect(screen.getByRole("alert").textContent).toMatch(/No market data for 2020-01-01/);
  });
});
