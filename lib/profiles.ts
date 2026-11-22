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
    availableHours: null,
  },
  cnc_plant: {
    id: "cnc_plant",
    name: "CNC Manufacturing Plant",
    description: "Two-shift machining plant (06:00-22:00); batch jobs can be re-sequenced.",
    baseKw: [320, 300, 300, 300, 310, 600, 1400, 1500, 1520, 1540, 1550, 1500, 1450, 1520, 1550, 1540, 1500, 1480, 1450, 1420, 1400, 1350, 700, 380],
    flexPct: 0.2,
    windowH: 3,
    capacityFactor: 1,
    availableHours: null,
  },
  ev_fleet: {
    id: "ev_fleet",
    name: "EV Fleet Charging Depot",
    description: "Last-mile delivery fleet, plugged in 16:00-07:00; charging can be deferred within the evening and within the early-morning window.",
    baseKw: [650, 520, 380, 260, 180, 150, 140, 130, 120, 120, 130, 140, 150, 160, 180, 250, 450, 800, 1100, 1200, 1200, 1150, 1000, 820],
    flexPct: 0.7,
    windowH: 8,
    capacityFactor: 1,
    availableHours: [0, 1, 2, 3, 4, 5, 6, 16, 17, 18, 19, 20, 21, 22, 23],
  },
};

export const PROFILE_ORDER: ProfileId[] = ["cold_storage", "cnc_plant", "ev_fleet"];

const DST_HOUR_INDEX = 2; // local 02:00 is skipped (spring) or repeated (autumn)

function adjustForDst<T>(values: T[], nHours: number): T[] {
  const out = [...values];
  if (nHours === 23) out.splice(DST_HOUR_INDEX, 1);
  else if (nHours === 25) out.splice(DST_HOUR_INDEX + 1, 0, out[DST_HOUR_INDEX]);
  else if (nHours !== 24) throw new Error(`Unsupported day length: ${nHours} hours`);
  return out;
}

/** Base load (kW) for a local day with 23, 24 or 25 hours. */
export function baseForDay(profile: Profile, nHours: number, scale = 1): number[] {
  return adjustForDst(profile.baseKw, nHours).map((v) => v * scale);
}

/** Per-hour mask of hours in which load may move, for a 23/24/25-hour day. */
export function availableForDay(profile: Profile, nHours: number): boolean[] {
  const hours = new Set(profile.availableHours ?? Array.from({ length: 24 }, (_, h) => h));
  return adjustForDst(Array.from({ length: 24 }, (_, h) => hours.has(h)), nHours);
}
