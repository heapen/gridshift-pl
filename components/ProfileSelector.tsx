"use client";

import { PROFILES, PROFILE_ORDER } from "@/lib/profiles";
import type { ProfileId } from "@/lib/types";
import { PROFILE_SHORT_NAMES } from "@/lib/constants";
import { formatKw } from "@/lib/format";

export default function ProfileSelector({ value, onChange }: { value: ProfileId; onChange: (id: ProfileId) => void }) {
  const selected = PROFILES[value];
  return (
    <fieldset>
      <legend className="text-xs font-medium uppercase tracking-wide text-ink-3">Facility profile</legend>
      {/* Phones: three compact buttons; laptops: full cards with description. */}
      <div className="mt-2 grid grid-cols-3 gap-2 lg:grid-cols-1">
        {PROFILE_ORDER.map((id) => {
          const p = PROFILES[id];
          const active = id === value;
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              aria-pressed={active}
              aria-label={p.name}
              className={`min-w-0 rounded-xl border px-2 py-2 text-left transition-colors lg:p-3 ${
                active ? "border-accent bg-accent-soft" : "border-border bg-surface-2 hover:border-accent"
              }`}
            >
              <span className="block text-sm font-semibold leading-snug text-ink lg:hidden">{PROFILE_SHORT_NAMES[id]}</span>
              <span className="hidden flex-wrap items-baseline justify-between gap-x-2 lg:flex">
                <span className="text-sm font-semibold text-ink">{p.name}</span>
                <span className="text-xs text-ink-3 tabular">
                  peak {formatKw(Math.max(...p.baseKw))} · {Math.round(p.flexPct * 100)}% flex · ±{p.windowH} h
                </span>
              </span>
              <span className="mt-0.5 hidden text-xs leading-relaxed text-ink-2 lg:block">{p.description}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-ink-2 lg:hidden">
        <span className="font-medium text-ink">{selected.name}.</span> {selected.description}
      </p>
    </fieldset>
  );
}
