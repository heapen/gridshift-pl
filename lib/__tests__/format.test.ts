import { describe, expect, it } from "vitest";
import { formatEur, formatHour, formatKw, formatPct, formatPln } from "@/lib/format";

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
