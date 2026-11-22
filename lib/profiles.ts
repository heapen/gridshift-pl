/**
 * Facility profiles — mirrors pipeline/profiles.py (the source of truth).
 * A vitest parity test fails if the two drift apart.
 */
import type { Profile, ProfileId } from "./types";

export const PROFILES: Record<ProfileId, Profile> = {
  cold_storage: {
    id: "cold_storage",
    name: "Cold Storage Warehouse",
    description: "Refrigerated logistics hub; thermal inertia allows pre-cooling and deferral.",
    baseKw: [780, 770, 760, 760, 760, 770, 790, 820, 850, 880, 900, 920, 930, 930, 920, 900, 880, 860, 840, 830, 820, 810, 800, 790],
    flexPct: 0.3,
    windowH: 4,
    capacityFactor: 1,
  },
  cnc_plant: {
    id: "cnc_plant",
    name: "CNC Manufacturing Plant",
    description: "Two-shift machining plant (06:00-22:00); batch jobs can be re-sequenced.",
    baseKw: [320, 300, 300, 300, 310, 600, 1400, 1500, 1520, 1540, 1550, 1500, 1450, 1520, 1550, 1540, 1500, 1480, 1450, 1420, 1400, 1350, 700, 380],
    flexPct: 0.2,
    windowH: 3,
    capacityFactor: 1,
  },
  ev_fleet: {
    id: "ev_fleet",
    name: "EV Fleet Charging Depot",
    description: "Last-mile delivery fleet returning in the evening; charging is highly deferrable.",
    baseKw: [650, 520, 380, 260, 180, 150, 140, 130, 120, 120, 130, 140, 150, 160, 180, 250, 450, 800, 1100, 1200, 1200, 1150, 1000, 820],
    flexPct: 0.7,
    windowH: 8,
    capacityFactor: 1,
  },
};

export const PROFILE_ORDER: ProfileId[] = ["cold_storage", "cnc_plant", "ev_fleet"];

const DST_HOUR_INDEX = 2; // local 02:00 is skipped (spring) or repeated (autumn)

/** Base load (kW) for a local day with 23, 24 or 25 hours. */
export function baseForDay(profile: Profile, nHours: number, scale = 1): number[] {
  const base = [...profile.baseKw];
  if (nHours === 23) base.splice(DST_HOUR_INDEX, 1);
  else if (nHours === 25) base.splice(DST_HOUR_INDEX + 1, 0, base[DST_HOUR_INDEX]);
  else if (nHours !== 24) throw new Error(`Unsupported day length: ${nHours} hours`);
  return base.map((v) => v * scale);
}
