"use client";

/** Shared chart chrome: title, unit, legend swatches (identity never colour-only). */

export interface LegendItem {
  label: string;
  color: string;
  dashed?: boolean;
}

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5">
          <svg width="18" height="8" aria-hidden>
            <line
              x1="1"
              y1="4"
              x2="17"
              y2="4"
              stroke={it.color}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={it.dashed ? "4 3" : undefined}
            />
          </svg>
          {it.label}
        </li>
      ))}
    </ul>
  );
}

export function ChartFrame({
  title,
  unit,
  legend,
  children,
}: {
  title: string;
  unit: string;
  legend: LegendItem[];
  children: React.ReactNode;
}) {
  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-ink">
          {title} <span className="font-normal text-ink-3">({unit})</span>
        </span>
        <Legend items={legend} />
      </figcaption>
      {children}
    </figure>
  );
}

interface TooltipRow {
  name?: string | number;
  value?: number | string | (number | string)[];
  color?: string;
  dataKey?: string | number;
}

export function makeTooltip(unit: string, digits = 0) {
  return function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipRow[]; label?: string | number }) {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-sm">
        <p className="mb-1 font-semibold text-ink tabular">{label}</p>
        {payload.map((p) => (
          <p key={String(p.dataKey)} className="flex items-center justify-between gap-4 text-ink-2">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="font-medium text-ink tabular">
              {typeof p.value === "number" ? p.value.toLocaleString("en-GB", { maximumFractionDigits: digits }) : p.value} {unit}
            </span>
          </p>
        ))}
      </div>
    );
  };
}

export const AXIS_PROPS = {
  stroke: "var(--text-3)",
  tick: { fill: "var(--text-3)", fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: "var(--border)" },
} as const;
