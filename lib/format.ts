/** Display formatting. Every helper returns "n/a" for null / non-finite input. */

const MINUS = "−";
const group = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });

const isNum = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

function signed(v: number): string {
  const rounded = Math.round(v);
  const body = group.format(Math.abs(rounded));
  return rounded < 0 ? `${MINUS}${body}` : body;
}

export const formatPln = (v: number | null | undefined) => (isNum(v) ? `${signed(v)} PLN` : "n/a");

export function formatEur(v: number | null | undefined): string {
  if (!isNum(v)) return "n/a";
  const s = signed(v);
  return s.startsWith(MINUS) ? `${MINUS}€${s.slice(1)}` : `€${s}`;
}

/** Signed fixed-decimal text; values that round to zero never show a minus sign. */
function signedFixed(v: number, digits: number): string {
  const body = Math.abs(v).toFixed(digits);
  return v < 0 && Number(body) !== 0 ? `${MINUS}${body}` : body;
}

/** Ratio (0.87) to percentage text: "87%", or "87.0%" with digits = 1. */
export function formatPct(v: number | null | undefined, digits = 0): string {
  if (!isNum(v)) return "n/a";
  return digits === 0 ? `${signed(v * 100)}%` : `${signedFixed(v * 100, digits)}%`;
}

export const formatKw = (v: number | null | undefined) => (isNum(v) ? `${signed(v)} kW` : "n/a");

/** Kilograms; keeps one decimal below 10 kg so small amounts do not read as zero. */
export function formatKg(v: number | null | undefined): string {
  if (!isNum(v)) return "n/a";
  return Math.abs(v) < 10 ? `${signedFixed(v, 1)} kg` : `${signed(v)} kg`;
}

/** Local clock hour "HH:00" read straight from the ISO string (keeps Warsaw time). */
export const formatHour = (iso: string) => iso.slice(11, 16);

/** "Mon, 9 Nov 2026" for an ISO date (YYYY-MM-DD). */
export function formatDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * Error change vs. a baseline, given as an improvement percentage
 * (positive = lower error). 21.2 -> "−21.2%", -5 -> "+5.0%".
 */
export function formatChangePct(improvementPct: number): string {
  if (!Number.isFinite(improvementPct)) return "n/a";
  const change = -improvementPct;
  const body = Math.abs(change).toFixed(1);
  if (change < 0) return `${MINUS}${body}%`;
  if (change > 0) return `+${body}%`;
  return `${body}%`;
}

/** Axis labels for a day's hours; the repeated autumn DST hour gets a "*" suffix. */
export function hourLabels(timestamps: string[]): string[] {
  return timestamps.map((ts, i) =>
    i > 0 && formatHour(ts) === formatHour(timestamps[i - 1]) ? `${formatHour(ts)}*` : formatHour(ts),
  );
}
