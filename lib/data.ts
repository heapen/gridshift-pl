import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { DaysFile, FeatureImportance, Metrics, Scenarios } from "./types";

export interface DashboardData {
  days: DaysFile;
  metrics: Metrics;
  importance: FeatureImportance[];
  scenarios: Scenarios;
}

const read = <T,>(name: string): T =>
  JSON.parse(readFileSync(path.join(process.cwd(), "public", "data", name), "utf-8")) as T;

/** Load pipeline exports at build time (the page is statically prerendered). */
export function loadData(): DashboardData {
  return {
    days: read<DaysFile>("days.json"),
    metrics: read<Metrics>("metrics.json"),
    importance: read<FeatureImportance[]>("feature_importance.json"),
    scenarios: read<Scenarios>("scenarios.json"),
  };
}
