"use client";

import type { Profile } from "@/lib/types";
import type { SliderState } from "./Dashboard";
import { formatKw } from "@/lib/format";

interface Props {
  profile: Profile;
  value: SliderState;
  onChange: (v: SliderState) => void;
}

interface SliderProps {
  id: string;
  label: string;
  display: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}

function Slider({ id, label, display, hint, min, max, step, value, onChange }: SliderProps) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
        </label>
        <span className="text-sm font-semibold text-ink tabular">{display}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full"
      />
      <p className="mt-1 hidden text-xs text-ink-3 sm:block">{hint}</p>
    </div>
  );
}

export default function SliderPanel({ profile, value, onChange }: Props) {
  const peak = Math.max(...profile.baseKw) * value.scale;
  return (
    <fieldset className="grid content-start gap-4 sm:gap-5">
      <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">Flexibility constraints</legend>
      <Slider
        id="scale"
        label="Site size (peak base load)"
        display={formatKw(peak)}
        hint="Scales the whole load profile. Contracted capacity equals this peak."
        min={0.25}
        max={2}
        step={0.05}
        value={value.scale}
        onChange={(scale) => onChange({ ...value, scale })}
      />
      <Slider
        id="flex"
        label="Max shiftable load"
        display={`${Math.round(value.flex * 100)}%`}
        hint="Share of each hour's load that may be moved."
        min={0}
        max={1}
        step={0.05}
        value={value.flex}
        onChange={(flex) => onChange({ ...value, flex })}
      />
      <Slider
        id="window"
        label="Max shift window"
        display={`±${value.window} h`}
        hint="How far earlier or later a unit of load may move."
        min={0}
        max={12}
        step={1}
        value={value.window}
        onChange={(window) => onChange({ ...value, window })}
      />
    </fieldset>
  );
}
