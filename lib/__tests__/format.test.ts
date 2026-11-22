import { describe, expect, it } from "vitest";
import { formatChangePct, formatEur, formatHour, formatKg, formatKw, formatPct, formatPln, hourLabels } from "@/lib/format";

describe("format helpers", () => {
  it("returns n/a for null and non-finite values", () => {
    expect(formatPct(null)).toBe("n/a");
    expect(formatPct(Infinity)).toBe("n/a");
    expect(formatPln(NaN)).toBe("n/a");
  });

  it("formats currency with grouping and sign", () => {
    expect(formatPln(-1234.5)).toMatch(/^[−-]1,23[45] PLN$/);
    expect(formatEur(2500)).toBe("€2,500");
    expect(formatPln(0.2)).toBe("0 PLN");
  });

  it("formats percentages and power", () => {
    expect(formatPct(0.873)).toBe("87%");
    expect(formatPct(-0.12)).toBe("−12%");
    expect(formatKw(1500)).toBe("1,500 kW");
  });

  it("formats the local clock hour from an ISO timestamp with offset", () => {
    expect(formatHour("2026-10-25T02:00:00+02:00")).toBe("02:00");
    expect(formatHour("2026-10-25T02:00:00+01:00")).toBe("02:00");
    expect(formatHour("2026-11-09T17:00:00+01:00")).toBe("17:00");
  });
});

describe("formatChangePct", () => {
  it("shows an error reduction as a minus and an increase as a plus", () => {
    expect(formatChangePct(21.2)).toBe("−21.2%");
    expect(formatChangePct(-5)).toBe("+5.0%");
    expect(formatChangePct(0)).toBe("0.0%");
  });
});

describe("hourLabels", () => {
  it("marks the repeated autumn 02:00 so both hours stay distinct", () => {
    const ts = ["2026-10-25T01:00:00+02:00", "2026-10-25T02:00:00+02:00", "2026-10-25T02:00:00+01:00", "2026-10-25T03:00:00+01:00"];
    expect(hourLabels(ts)).toEqual(["01:00", "02:00", "02:00*", "03:00"]);
  });
});

describe("KPI precision", () => {
  it("does not round a near-perfect capture rate up to 100%", () => {
    expect(formatPct(0.9954, 1)).toBe("99.5%");
    expect(formatPct(1, 1)).toBe("100.0%");
    expect(formatPct(0, 1)).toBe("0.0%");
    expect(formatPct(-0.0001, 1)).toBe("0.0%");
  });

  it("keeps a decimal for small CO2 amounts so they do not read as zero", () => {
    expect(formatKg(0.2894)).toBe("0.3 kg");
    expect(formatKg(-8.04)).toBe("−8.0 kg");
    expect(formatKg(23.4)).toBe("23 kg");
    expect(formatKg(-0.01)).toBe("0.0 kg");
  });
});
