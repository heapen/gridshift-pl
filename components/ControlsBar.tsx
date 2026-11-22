"use client";

import { useState } from "react";
import { SCENARIO_LABELS } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import type { ScenarioKey, Scenarios } from "@/lib/types";

interface Props {
  dates: string[];
  date: string;
  split: "train" | "test";
  scenarios: Scenarios;
  onDateChange: (d: string) => void;
}

const ORDER: ScenarioKey[] = ["high_wind", "evening_spike", "typical_weekday"];

export default function ControlsBar({ dates, date, split, scenarios, onDateChange }: Props) {
  const [error, setError] = useState<string | null>(null);
  const first = dates[0];
  const last = dates[dates.length - 1];

  const pick = (value: string) => {
    if (dates.includes(value)) {
      setError(null);
      onDateChange(value);
    } else {
      setError(`No market data for ${value}. Choose a day between ${first} and ${last}.`);
    }
  };

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <label htmlFor="day" className="block text-xs font-medium uppercase tracking-wide text-ink-3">
          Market day
        </label>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <input
            id="day"
            type="date"
            value={date}
            min={first}
            max={last}
            onChange={(e) => e.target.value && pick(e.target.value)}
            className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink tabular"
          />
          <span className="text-sm text-ink-2">{formatDate(date)}</span>
          {split === "train" ? (
            <span
              className="rounded-full bg-warn-bg px-2.5 py-1 text-xs font-medium text-warn-text"
              title="This day was in the model's training period: its forecast is in-sample and flatters accuracy."
            >
              In-sample day
            </span>
          ) : (
            <span
              className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent"
              title="This day was forecast out-of-sample by walk-forward evaluation."
            >
              Out-of-sample day
            </span>
          )}
        </div>
        {error && (
          <p role="alert" className="mt-2 text-xs text-critical">
            {error}
          </p>
        )}
      </div>

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-ink-3">Market scenarios</p>
        <div className="mt-1 grid gap-2 sm:grid-cols-3">
          {ORDER.map((key) => {
            const active = scenarios[key] === date;
            return (
              <button
                key={key}
                onClick={() => pick(scenarios[key])}
                title={SCENARIO_LABELS[key].hint}
                aria-pressed={active}
                className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  active
                    ? "border-accent bg-accent-soft text-ink"
                    : "border-border bg-surface-2 text-ink-2 hover:border-accent hover:text-ink"
                }`}
              >
                <span className="block font-medium">{SCENARIO_LABELS[key].title}</span>
                <span className="block text-xs text-ink-3 tabular">{scenarios[key]}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
