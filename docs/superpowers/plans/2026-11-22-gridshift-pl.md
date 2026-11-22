# GridShift PL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build GridShift PL end to end — a Python pipeline that ingests real RCE + weather data, trains a leakage-free 24h-ahead price forecast and exports static JSON, plus a Next.js dashboard that re-solves an industrial load-shift LP in the browser.

**Architecture:** Offline Python (`pipeline/`) → `data/processed/*.parquet` (git-ignored) → `public/data/*.json` (committed). Next.js App Router reads the JSON and runs `lib/optimizer.ts` (javascript-lp-solver), which is parity-tested against `pipeline/optimizer.py` (scipy HiGHS).

**Tech Stack:** Python 3.11+, pandas, pyarrow, requests, holidays, lightgbm, scikit-learn, scipy, pytest · Node 20+, Next.js (App Router), TypeScript, Tailwind CSS, Recharts, javascript-lp-solver, vitest.

**Spec:** `docs/superpowers/specs/2026-11-22-gridshift-pl-design.md`

## Global Constraints

- All code, comments, identifiers, UI copy, README, commit messages: professional English.
- Timezone: every timestamp tz-aware `Europe/Warsaw`; DST days keep 23/25 local hours.
- Decision time for delivery day D: D−1 ~10:00 Europe/Warsaw, before day-ahead gate closure. No feature for D may depend on any price of day D.
- Window: 180 full days ending yesterday (Warsaw) + ≥ 7 extra days of history for the 168h lag.
- Split: first ~120 of the 180 days = train, last ~60 = test; every test prediction out-of-sample.
- `data/` is git-ignored; `public/data/` total < 5 MB.
- No Python at runtime on Vercel; no secrets; all APIs keyless.
- CO₂ is always labelled "estimate" in UI and README.
- Commit per verified module; messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Verified API facts (live check 2026-11-22):**
- PSE `GET https://api.raporty.pse.pl/api/rce-pln?$filter=business_date ge 'YYYY-MM-DD' and business_date le 'YYYY-MM-DD'` (field is `business_date`, NOT `doba`; `$top` unsupported). Rows: `dtime` (local period END), `dtime_utc`, `period`, `rce_pln`, `business_date`, `publication_ts`. 100 rows/page; follow `nextLink` (absolute URL) until absent. Quarter-hourly since 2024-06-14.
- Use `dtime_utc − 15 min` as the UTC period start, then convert to Warsaw — unambiguous across DST.

## Review Focus

1. DST days (last Sunday of March / October inside the window): 92 / 100 quarter-hours → 23 / 25 hourly rows; optimiser and charts must render 23/25 points, not crash or pad. → tests in Task 2, Task 5, Task 6.
2. Missing/partial data (a city weather gap, a missing RCE quarter-hour, NBP weekend): forward-fill bounded gaps ≤ 2 h, fail loudly beyond. → Task 2.
3. Slider extremes (flex 0%, window 0 h → zero savings exactly; flex 100%, window max) must solve without errors or NaN. → Task 5.
4. Bad forecast day: realised savings negative and capture rate negative/undefined (perfect-foresight savings ≈ 0) must render as a number or "n/a", never `Infinity`/`NaN`. → Task 4, Task 5.
5. Selecting a train-period day must show the "in-sample" badge; scenario shortcuts must point at dates that exist in `days.json`. → Task 3, Task 6.

---

### Task 1: Environment + scaffold

**Files:**
- Create: `.gitignore`, `requirements.txt`, `pyproject.toml` (pytest config: `testpaths=["tests"]`, `pythonpath=["."]`), `pipeline/__init__.py`, `pipeline/config.py`, `tests/__init__.py`

**Interfaces — Produces (`pipeline/config.py`):**
- `TZ = "Europe/Warsaw"`, `WINDOW_DAYS = 180`, `LAG_BUFFER_DAYS = 10`, `TEST_DAYS = 60`
- `CITIES: dict[str, tuple[float, float]] = {"warsaw": (52.23, 21.01), "gdansk": (54.35, 18.65), "katowice": (50.26, 19.02), "poznan": (52.41, 16.93)}`
- `ROOT, DATA_RAW, DATA_PROCESSED, PUBLIC_DATA: pathlib.Path`
- `def window(today: date | None = None) -> tuple[date, date, date]` → `(fetch_start, model_start, end)` where `end` = yesterday in Warsaw, `model_start = end − 179 days`, `fetch_start = model_start − LAG_BUFFER_DAYS`.

- [ ] **Step 1:** `winget install -e --id Python.Python.3.12` and `winget install -e --id OpenJS.NodeJS.LTS`; open a new shell. Verify: `py -3.12 --version` → `Python 3.12.x`; `node --version` → `v20+`/`v22+`.
- [ ] **Step 2:** Configure git identity locally (values from user). Create `.venv` with `py -3.12 -m venv .venv`; `requirements.txt`: pandas, pyarrow, requests, holidays, lightgbm, scikit-learn, scipy, pytest. Install. Verify: `.venv\Scripts\python -c "import lightgbm, scipy, holidays"` exits 0.
- [ ] **Step 3:** `.gitignore`: `.venv/`, `data/`, `node_modules/`, `.next/`, `__pycache__/`, `*.parquet`, `.env*`, `next-env.d.ts` not ignored.
- [ ] **Step 4:** Test `tests/test_config.py::test_window` — `window(date(2026,11,22))` == `(date(2026,5,16), date(2026,5,26), date(2026,11,21))`. Implement, pass.
- [ ] **Step 5:** Commit `chore: scaffold Python pipeline and project config`.

### Task 2: Module A — ingestion (`pipeline/ingest.py`)

**Files:** Create `pipeline/ingest.py`, `tests/test_ingest.py`, `tests/fixtures/rce_dst_sample.json` (hand-built, ~8 rows around 2026-10-25 02:00–03:00 local).

**Interfaces — Produces:**
- `fetch_rce(start: date, end: date, session=None) -> pd.DataFrame` — raw rows, follows `nextLink`, caches each page JSON under `DATA_RAW/rce/`, 3 retries with exponential backoff.
- `rce_to_hourly(raw: pd.DataFrame) -> pd.Series` — index tz-aware Warsaw hourly (period start), name `price_pln_mwh`, mean of quarter-hours; raises `ValueError` if any hour has ≠ 4 quarter-hours.
- `fetch_weather(start: date, end: date) -> pd.DataFrame` — archive endpoint, `timezone=Europe/Warsaw`, hourly vars `temperature_2m, wind_speed_100m, shortwave_radiation`; columns `f"{city}_{var}"`; for dates the archive lacks (last ~5 days) fall back to `https://api.open-meteo.com/v1/forecast` with `past_days`. Request with `timezone=GMT` and convert to Warsaw locally (Open-Meteo local-time output is ambiguous at DST).
- `fetch_eur_pln(start: date, end: date) -> pd.Series` — NBP `https://api.nbp.pl/api/exchangerates/rates/a/eur/{start}/{end}/?format=json` (≤ 93 days per request → chunk), daily, forward-filled to every calendar day.
- `build_dataset(today: date | None = None) -> pd.DataFrame` — joins on hourly Warsaw index from `fetch_start` to `end`, adds `eur_pln` by local date, ffill gaps ≤ 2 h, raises if any remaining NaN; writes `DATA_PROCESSED/market_weather_hourly.parquet`; prints row count, date range, NaN counts, duplicate count.
- CLI: `python -m pipeline.ingest`.

- [ ] **Step 1: Failing tests**
  - `test_rce_to_hourly_dst_fall`: fixture day 2026-10-25 full (100 quarter-hours synthetic) → 25 hourly rows for that local date; two rows at local 02:00 with distinct UTC offsets (+02:00, +01:00).
  - `test_rce_to_hourly_mean`: four quarter-hours 100,200,300,400 → hourly 250.0.
  - `test_rce_to_hourly_incomplete_raises`: 3 quarter-hours → `ValueError`.
  - `test_fetch_rce_follows_nextlink`: fake session returning page1 with `nextLink` then page2 without → concatenated rows, 2 calls.
  - `test_eur_pln_ffill_weekend`: Friday rate only → Sat/Sun same value.
- [ ] **Step 2:** Run `pytest tests/test_ingest.py -v` → FAIL.
- [ ] **Step 3:** Implement functions above.
- [ ] **Step 4:** Run tests → PASS.
- [ ] **Step 5:** Run `python -m pipeline.ingest` for real. Expected: ~(190 × 24) ≈ 4,560 rows (±1 per DST day), 0 NaN, 0 duplicates; prices in plausible range (−500 … 3,000 PLN/MWh). Record the printed stats for README.
- [ ] **Step 6:** Commit `feat(pipeline/ingest): ingest RCE prices, weather and EUR/PLN into hourly dataset`.

### Task 3: Module B — features + forecast + export (`pipeline/features.py`, `pipeline/forecast.py`)

**Files:** Create `pipeline/features.py`, `pipeline/forecast.py`, `pipeline/co2.py`, `tests/test_features.py`, `tests/test_forecast.py`.

**Interfaces — Produces:**
- `features.build_features(df: pd.DataFrame) -> pd.DataFrame` with columns: `hour_sin, hour_cos, dow_sin, dow_cos, month, is_weekend, is_holiday` (holidays.Poland), `lag_24h, lag_48h, lag_168h` (same local clock hour on D−1/D−2/D−7, joined by (local date − k, hour) — NOT `shift(24)` rows, which breaks on DST), `prev_day_mean, prev_day_std, prev_day_max, roll7_mean, roll7_std` (from days ≤ D−1 only), `wind_index, solar_index, temp_mean` (4-city means; `wind_index` = mean of `wind_speed_100m**3`, scaled by its train-period max). Target column `price_pln_mwh`. Adds `local_date`.
- `co2.proxy_intensity(wind_index: pd.Series, solar_index_norm: pd.Series) -> pd.Series` — kg/MWh: `BASE * (1 − 0.35 * clip(0.6*wind_norm + 0.4*solar_norm, 0, 1))` then rescaled per whole dataset so its mean = `BASE`; `BASE = KOBIZE_FACTOR_KG_MWH` constant in `config.py` (builder looks up latest KOBiZE published grid factor and cites year in a comment; ~650 fallback).
- `forecast.train_and_predict(feat: pd.DataFrame, model_start: date, test_days: int) -> pd.DataFrame` — adds `forecast` and `persistence` (= `lag_24h`) and `split ∈ {"train","test"}`. Test days predicted by expanding-window refit every 7 days (train on all days < first day of the refit block). Train days get in-sample predictions from the first model. LightGBM params: `n_estimators=600, learning_rate=0.03, num_leaves=31, min_child_samples=20, subsample=0.8, colsample_bytree=0.8, random_state=42`.
- `forecast.metrics(pred: pd.DataFrame) -> dict` — test-set `mae`, `rmse` for model and persistence, `improvement_pct`.
- `forecast.pick_scenarios(pred: pd.DataFrame) -> dict[str, str]` — keys `high_wind, evening_spike, typical_weekday` → ISO dates, rules from spec §6.2, preferring test days.
- `forecast.export(pred, metrics, importance, scenarios) -> None` writes to `PUBLIC_DATA`:
  - `days.json`: `{ "generatedAt", "days": { "YYYY-MM-DD": { "split", "eurPln", "hours": [ { "ts": ISO-with-offset, "actual", "forecast", "persistence", "wind", "solar", "co2" } ] } } }` (round prices to 2 dp, indices to 3 dp).
  - `metrics.json`, `feature_importance.json` (`[{feature, gain}]` top 15, gain normalised to sum 1), `scenarios.json`.
- CLI: `python -m pipeline.forecast` runs build_features → train → metrics → export, prints MAE/RMSE table and scenario dates.

- [ ] **Step 1: Failing tests (`tests/test_features.py`)**
  - `test_no_same_day_price_leakage`: build features on a synthetic frame, then overwrite all prices of one day D with 1e6 and rebuild → every feature row of day D is unchanged (all columns except target).
  - `test_lag_24h_same_clock_hour_across_dst`: on 2026-10-26 10:00, `lag_24h` == price at 2026-10-25 10:00.
  - `test_holiday_flag`: 2026-11-11 (Independence Day) → `is_holiday == 1`.
- [ ] **Step 2: Failing tests (`tests/test_forecast.py`)**
  - `test_test_predictions_out_of_sample`: monkeypatch model fit to record max training date; for every refit block, max train date < block start.
  - `test_pick_scenarios_dates_exist`: synthetic predictions → all three dates are keys of the input days.
  - `test_co2_proxy_mean_equals_base`: mean of output ≈ BASE (rel 1e-6), and higher wind → lower intensity.
- [ ] **Step 3:** Run both → FAIL. Implement. Run → PASS.
- [ ] **Step 4:** Run `python -m pipeline.forecast`. Expected: model MAE < persistence MAE on test set (if not, investigate before committing — do not tune on the test set; report honestly). `public/data/` size < 5 MB (`du`). Record metrics.
- [ ] **Step 5:** Commit `feat(pipeline/forecast): leakage-free features, LightGBM 24h forecast and JSON export`.

### Task 4: Module C (Python) — reference optimiser (`pipeline/optimizer.py`)

**Files:** Create `pipeline/optimizer.py`, `pipeline/profiles.py`, `tests/test_optimizer.py`.

**Interfaces — Produces:**
- `profiles.PROFILES: dict[str, Profile]`, keys `cold_storage, cnc_plant, ev_fleet`; `Profile` dataclass `{id, name, description, base_kw: list[float] (24 values), flex_pct, window_h, capacity_factor=1.2}` with defaults from spec §6.3 table. `profiles.base_for_day(profile, n_hours: int, scale: float) -> np.ndarray` — 23h day drops local hour 02:00 entry, 25h day repeats it.
- `optimizer.solve(base_kw, plan_price, flex, window, capacity_kw) -> np.ndarray` (shifted load L_t). Variables `x[s,t]` for `0<|s−t|≤window`; constraints per spec §6.3; `linprog(method="highs")`. If `flex==0` or `window==0` return `base_kw` copy.
- `optimizer.evaluate(base_kw, forecast, actual, co2, eur_pln, flex, window, capacity_kw) -> dict` with keys `baselineCostPln, optimisedCostPln, savingsPln, savingsEur, perfectSavingsPln, captureRate (None if |perfect| < 1 PLN), peakReductionPct, co2ReductionKg, shiftedKw (list)`. Costs: `Σ price[PLN/MWh] · kW / 1000` (1 h steps).
- `optimizer.write_parity_fixtures(days_json_path, out_path)` — for each profile × 3 scenario days × 2 slider settings, write inputs + `evaluate` output (minus `shiftedKw`) to `lib/__tests__/parity_fixtures.json`. CLI `python -m pipeline.optimizer`.

- [ ] **Step 1: Failing tests**
  - `test_energy_conserved`: random 24h case → `sum(L) == approx(sum(base))`.
  - `test_respects_capacity_and_flex`: `max(L) ≤ capacity + 1e-6`; outflow per hour ≤ flex·base.
  - `test_zero_flex_zero_savings`: flex=0 → savings exactly 0.
  - `test_moves_load_to_cheap_hour`: prices `[100]*23 + [10]` at hour 23, window 1, flat base → load increases at hour 23.
  - `test_dst_25h_day_solves`: 25-hour inputs → 25 outputs.
  - `test_capture_rate_none_when_no_opportunity`: flat actual prices → `captureRate is None`.
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS.
- [ ] **Step 3:** Run `python -m pipeline.optimizer` → fixtures file written; print realised/perfect savings + capture rate per profile for the 3 scenarios (record for README).
- [ ] **Step 4:** Commit `feat(optimizer): reference load-shift LP in Python with parity fixtures`.

### Task 5: Next.js scaffold + TS optimiser (`lib/optimizer.ts`)

**Files:** Create Next.js app in repo root (`npx create-next-app@latest . --ts --tailwind --app --eslint --no-src-dir --import-alias "@/*" --use-npm`, keep existing files), `lib/types.ts`, `lib/profiles.ts`, `lib/optimizer.ts`, `lib/__tests__/optimizer.test.ts`, `vitest.config.ts`.

**Interfaces — Produces:**
- `lib/types.ts`: `HourPoint {ts, actual, forecast, persistence, wind, solar, co2}`, `DayData {split: "train"|"test", eurPln, hours: HourPoint[]}`, `DaysFile`, `Metrics`, `FeatureImportance`, `Scenarios`, `Profile` (mirrors Python), `OptimizerResult` (same keys as Python `evaluate`).
- `lib/profiles.ts`: `PROFILES: Record<ProfileId, Profile>` same numbers as `pipeline/profiles.py`; `baseForDay(profile, nHours, scale): number[]` same DST rule.
- `lib/optimizer.ts`: `solve(base, planPrice, flex, window, capacityKw): number[]` and `evaluate(input): OptimizerResult` — identical formulation using `javascript-lp-solver` (`solver.Solve(model)`; variables `x_s_t`, constraints `out_s`, `cap_t`). Guard: flex 0 / window 0 → base copy; non-feasible result → base copy + `console.warn`.
- Python's `profiles.py` remains the source of truth; add a vitest that compares `lib/profiles.ts` with the profiles embedded in parity fixtures.

- [ ] **Step 1:** Scaffold; `npm i recharts javascript-lp-solver`; `npm i -D vitest @types/javascript-lp-solver` (if no types exist, add `lib/javascript-lp-solver.d.ts`). Add script `"test": "vitest run"`.
- [ ] **Step 2: Failing tests (`lib/__tests__/optimizer.test.ts`)**
  - `parity: matches Python objective and KPIs` — for every fixture: `savingsPln`, `perfectSavingsPln`, `peakReductionPct`, `co2ReductionKg` within `max(1e-3·|v|, 0.01)`; `captureRate` both null or within 1e-3.
  - `energy conserved`, `zero flex → zero savings`, `25h day returns 25 points`, `flex 1.0 window 12 → finite numbers only`.
  - `profiles match python fixtures`.
- [ ] **Step 3:** `npm test` → FAIL. Implement. `npm test` → PASS. Also time a 25h, window 12 solve < 50 ms (log in test).
- [ ] **Step 4:** Commit `feat(optimizer): browser LP solver with Python parity tests`.

### Task 6: Module D — dashboard (`app/`, `components/`)

**Files:** `app/layout.tsx`, `app/page.tsx` (client shell), `app/globals.css`, `components/ControlsBar.tsx` (date picker + scenario buttons + in-sample badge), `components/ProfileSelector.tsx`, `components/SliderPanel.tsx`, `components/KpiCards.tsx`, `components/LoadPriceChart.tsx`, `components/ModelAccuracyTab.tsx`, `components/FeatureImportanceChart.tsx`, `components/MethodologyTab.tsx`, `lib/data.ts` (`loadData(): Promise<{days, metrics, importance, scenarios}>` fetching `/data/*.json`), `lib/format.ts` (`formatPln`, `formatEur`, `formatPct` — returns "n/a" for null/non-finite).

Behaviour (spec §6.4):
- Default selection: `scenarios.typical_weekday`, profile `cold_storage`.
- Date picker: native `<input type="date">` with `min`/`max` from days; dates absent from data are rejected with an inline message.
- Sliders: base load scale 25–200% (shown as kW peak), flex 0–100% step 5, window 0–12 h step 1; changing profile resets sliders to profile defaults.
- KPI cards: Realised savings (PLN + EUR), Capture rate, Peak load reduction, CO₂ reduction "(estimate)". Negative savings shown in red with tooltip "Forecast error on this day cost money — shown honestly."
- Optimisation tab: Recharts `ComposedChart` — base load (area), shifted load (area/line), actual & forecast price (lines, right axis, PLN/MWh); x labels local `HH:mm` from `ts`; works for 23/25 points.
- Model Accuracy tab: MAE/RMSE table model vs persistence + improvement %, forecast vs actual line for the selected day, feature-importance horizontal bar chart.
- Methodology tab: data sources, decision-time framing (D−1 10:00 before gate closure), leakage controls, observed-weather simplification, LP formulation, CO₂ proxy formula.
- Recompute via `useMemo` on (day, profile, sliders).

- [ ] **Step 1:** Add `lib/__tests__/format.test.ts`: `formatPct(null) === "n/a"`, `formatPct(Infinity) === "n/a"`, `formatPln(-1234.5)` contains "−1,234" or "-1,234". Run → FAIL → implement → PASS.
- [ ] **Step 2:** Build components above.
- [ ] **Step 3:** `npm run build` → success, no type errors; `npm run lint` clean.
- [ ] **Step 4:** Run dev server via preview; verify in browser: each scenario button loads its date; a train date shows "In-sample" badge; slider to flex 0 → savings 0; a DST date (2026-10-25) renders 25 points; mobile width has no horizontal scroll; no console errors. Take screenshots into `docs/screenshots/`.
- [ ] **Step 5:** Commit `feat(frontend): interactive load-shifting dashboard`.

### Task 7: README case study + final gates

**Files:** Create `README.md`; optionally `docs/screenshots/*.png`.

- [ ] **Step 1:** Write README sections per spec §6.5 using the numbers recorded in Tasks 2–4 (no placeholders): problem, data (row counts, date range), approach (decision time, features, walk-forward), results table (MAE/RMSE model vs persistence, improvement %), optimisation results per scenario (realised, perfect-foresight, capture rate), architecture diagram (Mermaid), limitations, how to run (`python -m pipeline.ingest`, `python -m pipeline.forecast`, `python -m pipeline.optimizer`, `npm run dev`), tech stack, screenshots.
- [ ] **Step 2:** Run `ds-quality-gate` checklist: full end-to-end run from clean `data/`, `pytest -q` all pass, `npm test` all pass, `npm run build` passes, `git ls-files | grep -E "\.parquet|data/"` returns only `public/data/` JSON.
- [ ] **Step 3:** `verification-before-completion`: re-run all commands, capture output.
- [ ] **Step 4:** Commit `docs: add README case study with pipeline results`.
