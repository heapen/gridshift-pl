"use client";

import { Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DayData, FeatureImportance, Metrics } from "@/lib/types";
import { FEATURE_LABELS } from "@/lib/constants";
import { formatChangePct, hourLabels } from "@/lib/format";
import { AXIS_PROPS, ChartFrame, makeTooltip } from "./ChartFrame";

interface Props {
  day: DayData;
  date: string;
  metrics: Metrics;
  importance: FeatureImportance[];
}

const PriceTooltip = makeTooltip("PLN/MWh");
const SIX_HOUR_TICKS = ["00:00", "06:00", "12:00", "18:00", "23:00"];
const ShareTooltip = makeTooltip("%", 1);

function MetricsTable({ metrics }: { metrics: Metrics }) {
  const rows = [
    { name: "LightGBM (24h-ahead)", ...metrics.model, strong: true },
    { name: "Naive persistence (D-1)", ...metrics.persistence, strong: false },
  ];
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full text-sm tabular">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-ink-3">
            <th className="pb-2 font-medium">Model</th>
            <th className="pb-2 text-right font-medium">MAE</th>
            <th className="pb-2 text-right font-medium">RMSE</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-t border-border">
              <td className={`py-2 ${r.strong ? "font-semibold text-ink" : "text-ink-2"}`}>{r.name}</td>
              <td className="py-2 text-right text-ink">{r.mae.toFixed(1)}</td>
              <td className="py-2 text-right text-ink">{r.rmse.toFixed(1)}</td>
            </tr>
          ))}
          <tr className="border-t border-border">
            <td className="py-2 text-ink-2">Improvement vs. persistence</td>
            <td className={`py-2 text-right font-semibold ${metrics.maeImprovementPct > 0 ? "text-good" : "text-critical"}`}>{formatChangePct(metrics.maeImprovementPct)}</td>
            <td className={`py-2 text-right font-semibold ${metrics.rmseImprovementPct > 0 ? "text-good" : "text-critical"}`}>{formatChangePct(metrics.rmseImprovementPct)}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-xs text-ink-3">
        PLN/MWh, out-of-sample test period {metrics.testStart} to {metrics.testEnd} ({metrics.testHours.toLocaleString("en-GB")} hours),
        expanding-window refit every {metrics.refitEveryDays} days.
      </p>
    </div>
  );
}

export default function ModelAccuracyTab({ day, date, metrics, importance }: Props) {
  const labels = hourLabels(day.hours.map((h) => h.ts));
  const rows = day.hours.map((h, i) => ({
    hour: labels[i],
    actual: h.actual,
    forecast: h.forecast,
    persistence: h.persistence,
  }));
  const featRows = importance.map((f) => ({
    name: FEATURE_LABELS[f.feature] ?? f.feature,
    share: Math.round(f.gain * 1000) / 10,
  }));

  return (
    <div className="grid grid-cols-1 gap-8">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div>
          <h3 className="mb-3 text-sm font-semibold text-ink">Forecast accuracy, test period</h3>
          <MetricsTable metrics={metrics} />
        </div>
        <ChartFrame
          title={`Forecast vs. actual, ${date}`}
          unit="PLN/MWh"
          legend={[
            { label: "Actual", color: "var(--series-1)" },
            { label: `LightGBM · MAE ${day.mae.toFixed(0)}`, color: "var(--series-2)", dashed: true },
            { label: `Persistence · MAE ${day.maePersistence.toFixed(0)}`, color: "var(--series-muted)", dashed: true },
          ]}
        >
          <div className="h-60 w-full">
            <ResponsiveContainer>
              <LineChart data={rows} margin={{ top: 6, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--grid)" />
                <XAxis dataKey="hour" {...AXIS_PROPS} ticks={SIX_HOUR_TICKS} interval={0} />
                <YAxis {...AXIS_PROPS} width={48} />
                <Tooltip content={<PriceTooltip />} cursor={{ stroke: "var(--text-3)", strokeDasharray: "3 3" }} />
                <Line isAnimationActive={false} type="monotone" dataKey="actual" name="Actual" stroke="var(--series-1)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line isAnimationActive={false} type="monotone" dataKey="forecast" name="LightGBM" stroke="var(--series-2)" strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4 }} />
                <Line isAnimationActive={false} type="monotone" dataKey="persistence" name="Persistence" stroke="var(--series-muted)" strokeWidth={2} strokeDasharray="2 3" dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {day.split === "train" && (
            <p className="mt-2 text-xs text-warn-text">This is an in-sample (training) day, so the model fit is optimistic.</p>
          )}
        </ChartFrame>
      </div>

      <ChartFrame title="Feature importance" unit="share of total LightGBM gain" legend={[]}>
        <div className="h-[420px] w-full">
          <ResponsiveContainer>
            <BarChart data={featRows} layout="vertical" margin={{ top: 0, right: 48, bottom: 0, left: 0 }} barCategoryGap={4}>
              <CartesianGrid horizontal={false} stroke="var(--grid)" />
              <XAxis type="number" {...AXIS_PROPS} unit="%" />
              <YAxis type="category" dataKey="name" {...AXIS_PROPS} width={132} interval={0} tick={{ fill: "var(--text-3)", fontSize: 10.5 }} />
              <Tooltip content={<ShareTooltip />} cursor={{ fill: "var(--surface-2)" }} />
              <Bar isAnimationActive={false} dataKey="share" name="Gain share" fill="var(--series-1)" radius={[0, 4, 4, 0]} maxBarSize={18}>
                <LabelList dataKey="share" position="right" formatter={(v: number) => `${v}%`} fill="var(--text-2)" fontSize={11} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartFrame>
    </div>
  );
}
