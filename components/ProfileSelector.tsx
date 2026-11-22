"use client";

import { PROFILES, PROFILE_ORDER } from "@/lib/profiles";
import type { ProfileId } from "@/lib/types";
import { formatKw } from "@/lib/format";

export default function ProfileSelector({ value, onChange }: { value: ProfileId; onChange: (id: ProfileId) => void }) {
  return (
    <fieldset>
      <legend className="text-xs font-medium uppercase tracking-wide text-ink-3">Facility profile</legend>
      <div className="mt-2 grid gap-2">
        {PROFILE_ORDER.map((id) => {
          const p = PROFILES[id];
          const active = id === value;
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              aria-pressed={active}
              className={`rounded-xl border p-3 text-left transition-colors ${
                active ? "border-accent bg-accent-soft" : "border-border bg-surface-2 hover:border-accent"
              }`}
            >
              <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="text-sm font-semibold text-ink">{p.name}</span>
                <span className="text-xs text-ink-3 tabular">
                  peak {formatKw(Math.max(...p.baseKw))} · {Math.round(p.flexPct * 100)}% flex · ±{p.windowH} h
                </span>
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-ink-2">{p.description}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
