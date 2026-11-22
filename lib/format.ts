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

/** Ratio (0.87) to percentage text ("87%"). */
export const formatPct = (v: number | null | undefined) => (isNum(v) ? `${signed(v * 100)}%` : "n/a");

export const formatKw = (v: number | null | undefined) => (isNum(v) ? `${signed(v)} kW` : "n/a");

export const formatKg = (v: number | null | undefined) => (isNum(v) ? `${signed(v)} kg` : "n/a");

/** Local clock hour "HH:00" read straight from the ISO string (keeps Warsaw time). */
export const formatHour = (iso: string) => iso.slice(11, 16);

/** "Mon, 9 Nov 2026" for an ISO date (YYYY-MM-DD). */
export function formatDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
