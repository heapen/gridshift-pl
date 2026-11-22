"use client";

import type { OptimizerResult } from "@/lib/types";
import { formatEur, formatKg, formatPct, formatPln } from "@/lib/format";

function Card({ label, value, sub, children }: { label: string; value: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-3">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-ink tabular sm:text-[1.7rem]">{value}</p>
      {sub && <p className="mt-1 text-sm text-ink-2 tabular">{sub}</p>}
      {children}
    </div>
  );
}

export default function KpiCards({ result }: { result: OptimizerResult }) {
  const loss = result.savingsPln < -0.5;
  const capture = result.captureRate;

  return (
    <section aria-label="Key results" className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Card
        label="Realised savings / day"
        value={<span className={loss ? "text-critical" : undefined}>{formatPln(result.savingsPln)}</span>}
        sub={`${formatEur(result.savingsEur)} · energy ${formatPln(result.energySavingsPln)} · peak charge ${formatPln(result.demandSavingsPln)}`}
      >
        {loss && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-critical">
            <span aria-hidden>▼</span>
            <span>Loss: the forecast misled the plan on this day. Shown honestly, not hidden.</span>
          </p>
        )}
      </Card>
      <Card
        label="Capture rate"
        value={formatPct(capture)}
        sub={
          capture === null
            ? "No shifting opportunity on this day"
            : `of ${formatPln(result.perfectSavingsPln)} perfect-foresight savings`
        }
      />
      <Card
        label="Peak load reduction"
        value={formatPct(result.peakReductionPct / 100)}
        sub="vs. the unshifted daily peak"
      />
      <Card label="CO₂ reduction (estimate)" value={formatKg(result.co2ReductionKg)} sub="Weather-based grid intensity proxy" />
    </section>
  );
}
