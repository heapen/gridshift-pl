"use client";

import type { OptimizerResult } from "@/lib/types";
import { formatEur, formatKg, formatPct, formatPln } from "@/lib/format";

function Card({ label, value, sub, children }: { label: string; value: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-surface p-3 sm:p-4">
      <p className="text-[11px] font-medium uppercase leading-tight tracking-wide text-ink-3 sm:text-xs">{label}</p>
      <p className="mt-1.5 text-xl font-semibold tracking-tight text-ink tabular sm:mt-2 sm:text-2xl lg:text-[1.7rem]">{value}</p>
      {sub && <p className="mt-1 text-xs leading-snug text-ink-2 tabular sm:text-sm">{sub}</p>}
      {children}
    </div>
  );
}

export default function KpiCards({ result }: { result: OptimizerResult }) {
  const loss = result.savingsPln < -0.5;
  const capture = result.captureRate;

  return (
    <section aria-label="Key results" className="mt-4 grid grid-cols-2 gap-2 sm:mt-6 sm:gap-3 lg:grid-cols-4">
      <Card
        label="Realised savings / day"
        value={<span className={loss ? "text-critical" : undefined}>{formatPln(result.savingsPln)}</span>}
        sub={
          <>
            {formatEur(result.savingsEur)}
            <span className="hidden sm:inline">
              {" "}
              · energy {formatPln(result.energySavingsPln)} · peak charge {formatPln(result.demandSavingsPln)}
            </span>
          </>
        }
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
        sub={capture === null ? "No shifting opportunity" : `of ${formatPln(result.perfectSavingsPln)} perfect foresight`}
      />
      <Card label="Peak load reduction" value={formatPct(result.peakReductionPct / 100)} sub="vs. unshifted daily peak" />
      <Card label="CO₂ reduction (est.)" value={formatKg(result.co2ReductionKg)} sub="Weather-based intensity proxy" />
    </section>
  );
}
