/** Mirrors pipeline/config.py. Peak demand charge, PLN per kW of daily peak (assumption). */
export const DEMAND_CHARGE_PLN_PER_KW_DAY = 0.6;

/** Mirrors pipeline/config.py. KOBiZE end-user grid factor, kg CO2/MWh (Dec 2024 edition). */
export const KOBIZE_FACTOR_KG_MWH = 597;

export const SCENARIO_LABELS = {
  high_wind: { title: "High Wind / Renewable Surplus", hint: "Low prices driven by strong wind" },
  evening_spike: { title: "Evening Peak Price Spike", hint: "Widest evening-vs-trough spread" },
  typical_weekday: { title: "Typical Weekday Baseline", hint: "Daily mean closest to the median" },
} as const;

export const FEATURE_LABELS: Record<string, string> = {
  lag_24h: "Price, same hour D-1",
  lag_48h: "Price, same hour D-2",
  lag_168h: "Price, same hour D-7",
  prev_day_mean: "Mean price D-1",
  prev_day_std: "Price volatility D-1",
  prev_day_max: "Max price D-1",
  roll7_mean: "7-day mean price",
  roll7_std: "7-day price volatility",
  wind_index: "Regional wind index",
  solar_index: "Regional solar index",
  temp_mean: "Mean temperature",
  hour_sin: "Hour of day (sin)",
  hour_cos: "Hour of day (cos)",
  dow_sin: "Day of week (sin)",
  dow_cos: "Day of week (cos)",
  month: "Month",
  is_weekend: "Weekend flag",
  is_holiday: "Polish public holiday",
};
