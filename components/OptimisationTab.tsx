"use client";

import { useMemo } from "react";
import { Area, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DayData, OptimizerResult } from "@/lib/types";
import { hourLabels } from "@/lib/format";
import { AXIS_PROPS, ChartFrame, makeTooltip } from "./ChartFrame";

interface Props {
  day: DayData;
  base: number[];
  result: OptimizerResult;
}

const PriceTooltip = makeTooltip("PLN/MWh");
const LoadTooltip = makeTooltip("kW");

export default function OptimisationTab({ day, base, result }: Props) {
  const rows = useMemo(
    () =>
      hourLabels(day.hours.map((h) => h.ts)).map((label, i) => ({
        hour: label,
        actual: day.hours[i].actual,
        forecast: day.hours[i].forecast,
        base: Math.round(base[i]),
        shifted: Math.round(result.shiftedKw[i]),
      })),
    [day, base, result],
  );
  // Step charts need a closing point so the last hour (23:00-24:00) gets its full width.
  const chartRows = useMemo(() => [...rows, { ...rows[rows.length - 1], hour: "24:00" }], [rows]);

  return (
    <div className="grid gap-6">
      <ChartFrame
        title="RCE price"
        unit="PLN/MWh"
        legend={[
          { label: "Actual RCE (billing)", color: "var(--series-1)" },
          { label: "24h-ahead forecast (planning)", color: "var(--series-2)", dashed: true },
        ]}
      >
        <div className="h-56 w-full">
          <ResponsiveContainer>
            <LineChart data={chartRows} syncId="day" margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="hour" {...AXIS_PROPS} interval="preserveStartEnd" minTickGap={18} />
              <YAxis {...AXIS_PROPS} width={48} />
              <Tooltip content={<PriceTooltip />} cursor={{ stroke: "var(--text-3)", strokeDasharray: "3 3" }} />
              <Line isAnimationActive={false} type="stepAfter" dataKey="actual" name="Actual RCE" stroke="var(--series-1)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              <Line isAnimationActive={false} type="stepAfter" dataKey="forecast" name="Forecast" stroke="var(--series-2)" strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </ChartFrame>

      <ChartFrame
        title="Site load"
        unit="kW"
        legend={[
          { label: "Baseline schedule", color: "var(--series-muted)", dashed: true },
          { label: "Optimised schedule", color: "var(--series-3)" },
        ]}
      >
        <div className="h-56 w-full">
          <ResponsiveContainer>
            <ComposedChart data={chartRows} syncId="day" margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="hour" {...AXIS_PROPS} interval="preserveStartEnd" minTickGap={18} />
              <YAxis {...AXIS_PROPS} width={48} />
              <Tooltip content={<LoadTooltip />} cursor={{ stroke: "var(--text-3)", strokeDasharray: "3 3" }} />
              <Area isAnimationActive={false} type="stepAfter" dataKey="shifted" name="Optimised" stroke="var(--series-3)" strokeWidth={2} fill="var(--series-3)" fillOpacity={0.18} activeDot={{ r: 4 }} />
              <Line isAnimationActive={false} type="stepAfter" dataKey="base" name="Baseline" stroke="var(--series-muted)" strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ChartFrame>

      <details className="rounded-xl border border-border bg-surface-2 p-3 text-sm">
        <summary className="cursor-pointer font-medium text-ink">Hourly table ({rows.length} hours)</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-right text-xs tabular">
            <thead className="text-ink-3">
              <tr>
                <th className="py-1 text-left font-medium">Hour</th>
                <th className="py-1 font-medium">Actual PLN/MWh</th>
                <th className="py-1 font-medium">Forecast PLN/MWh</th>
                <th className="py-1 font-medium">Baseline kW</th>
                <th className="py-1 font-medium">Optimised kW</th>
              </tr>
            </thead>
            <tbody className="text-ink-2">
              {rows.map((r) => (
                <tr key={r.hour} className="border-t border-border">
                  <td className="py-1 text-left">{r.hour}</td>
                  <td>{r.actual.toFixed(0)}</td>
                  <td>{r.forecast.toFixed(0)}</td>
                  <td>{r.base}</td>
                  <td>{r.shifted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
