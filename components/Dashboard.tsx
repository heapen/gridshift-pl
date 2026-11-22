"use client";

import { useMemo, useState } from "react";
import type { DashboardData } from "@/lib/data";
import { evaluate } from "@/lib/optimizer";
import { PROFILES, availableForDay, baseForDay } from "@/lib/profiles";
import type { ProfileId } from "@/lib/types";
import { DEMAND_CHARGE_PLN_PER_KW_DAY } from "@/lib/constants";
import ControlsBar from "./ControlsBar";
import ProfileSelector from "./ProfileSelector";
import SliderPanel from "./SliderPanel";
import KpiCards from "./KpiCards";
import OptimisationTab from "./OptimisationTab";
import ModelAccuracyTab from "./ModelAccuracyTab";
import MethodologyTab from "./MethodologyTab";
import Tabs, { type TabId } from "./Tabs";

export interface SliderState {
  scale: number; // multiplier on the profile's base load
  flex: number; // 0..1
  window: number; // hours
}

const defaultsFor = (id: ProfileId): SliderState => ({
  scale: 1,
  flex: PROFILES[id].flexPct,
  window: PROFILES[id].windowH,
});

export default function Dashboard({ data }: { data: DashboardData }) {
  const { days, metrics, importance, scenarios } = data;
  const dates = useMemo(() => Object.keys(days.days).sort(), [days]);

  // Open on the most instructive case: a deferrable fleet on a price-spike day.
  const [date, setDate] = useState<string>(scenarios.evening_spike);
  const [profileId, setProfileId] = useState<ProfileId>("ev_fleet");
  const [sliders, setSliders] = useState<SliderState>(defaultsFor("ev_fleet"));
  const [tab, setTab] = useState<TabId>("optimisation");

  const day = days.days[date];
  const profile = PROFILES[profileId];

  const { base, result } = useMemo(() => {
    const hours = day.hours;
    const base = baseForDay(profile, hours.length, sliders.scale);
    const result = evaluate({
      base,
      forecast: hours.map((h) => h.forecast),
      actual: hours.map((h) => h.actual),
      co2: hours.map((h) => h.co2),
      eurPln: day.eurPln,
      flex: sliders.flex,
      window: sliders.window,
      capacityKw: profile.capacityFactor * Math.max(...base),
      demandCharge: DEMAND_CHARGE_PLN_PER_KW_DAY,
      available: availableForDay(profile, hours.length),
    });
    return { base, result };
  }, [day, profile, sliders]);

  const selectProfile = (id: ProfileId) => {
    setProfileId(id);
    setSliders(defaultsFor(id));
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
      <header className="mb-4 sm:mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">GridShift PL</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          Industrial load shifting on the Polish RCE market
        </h1>
        <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-ink-2 sm:text-sm">
          Pick a real market day and a facility. The optimiser plans flexible load on a 24h-ahead
          price forecast (made before the day-ahead gate closure), then bills that plan on the
          actual RCE price — so the savings shown are what the site would really have achieved.
        </p>
      </header>

      <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
        <ControlsBar
          dates={dates}
          date={date}
          split={day.split}
          scenarios={scenarios}
          onDateChange={setDate}
        />
        <div className="mt-4 grid grid-cols-1 gap-4 sm:mt-5 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <ProfileSelector value={profileId} onChange={selectProfile} />
          <SliderPanel profile={profile} value={sliders} onChange={setSliders} />
        </div>
      </section>

      <KpiCards result={result} />

      <section className="mt-6 rounded-2xl border border-border bg-surface">
        <Tabs value={tab} onChange={setTab} />
        <div className="p-4 sm:p-5">
          {tab === "optimisation" && <OptimisationTab day={day} base={base} result={result} />}
          {tab === "accuracy" && (
            <ModelAccuracyTab day={day} date={date} metrics={metrics} importance={importance} />
          )}
          {tab === "methodology" && <MethodologyTab metrics={metrics} />}
        </div>
      </section>

      <footer className="mt-8 text-xs leading-relaxed text-ink-3">
        Data: PSE Open Data (RCE), Open-Meteo, NBP · Model window {metrics.trainStart} to{" "}
        {metrics.testEnd} · Pipeline run {days.generatedAt.slice(0, 10)} · CO₂ figures are estimates.
      </footer>
    </main>
  );
}
