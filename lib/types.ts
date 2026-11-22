/** Shared data contracts between the Python pipeline exports and the UI. */

export type ProfileId = "cold_storage" | "cnc_plant" | "ev_fleet";

export interface HourPoint {
  ts: string; // ISO timestamp with Europe/Warsaw offset (period start)
  actual: number; // PLN/MWh
  forecast: number; // PLN/MWh, 24h-ahead model
  persistence: number; // PLN/MWh, same hour previous day
  wind: number; // normalised regional wind index [0, 1]
  solar: number; // normalised regional solar index [0, 1]
  co2: number; // estimated grid intensity, kg CO2/MWh
}

export interface DayData {
  split: "train" | "test";
  eurPln: number;
  mae: number;
  maePersistence: number;
  hours: HourPoint[];
}

export interface DaysFile {
  generatedAt: string;
  days: Record<string, DayData>;
}

export interface Metrics {
  generatedAt: string;
  model: { mae: number; rmse: number };
  persistence: { mae: number; rmse: number };
  maeImprovementPct: number;
  rmseImprovementPct: number;
  testStart: string;
  testEnd: string;
  trainStart: string;
  trainEnd: string;
  testHours: number;
  trainHours: number;
  refitEveryDays: number;
}

export interface FeatureImportance {
  feature: string;
  gain: number;
}

export type ScenarioKey = "high_wind" | "evening_spike" | "typical_weekday";
export type Scenarios = Record<ScenarioKey, string>;

export interface Profile {
  id: ProfileId;
  name: string;
  description: string;
  baseKw: number[]; // 24 local clock hours
  flexPct: number;
  windowH: number;
  capacityFactor: number;
  availableHours: number[] | null; // clock hours load may move in/out; null = all
}

export interface OptimizerInput {
  base: number[];
  forecast: number[];
  actual: number[];
  co2: number[];
  eurPln: number;
  flex: number;
  window: number;
  capacityKw: number;
  demandCharge: number;
  available?: boolean[]; // per-hour mask for this day; omitted = all hours
}

export interface OptimizerResult {
  baselineCostPln: number;
  optimisedCostPln: number;
  energySavingsPln: number;
  demandSavingsPln: number;
  savingsPln: number;
  savingsEur: number;
  perfectSavingsPln: number;
  captureRate: number | null;
  peakReductionPct: number;
  co2ReductionKg: number;
  shiftedKw: number[];
}
