# GridShift PL — Design

Date: 2026-11-22
Status: Draft for approval

## 1. Intent

GridShift PL is an interactive industrial load-shifting and energy-cost
optimisation simulator for the Polish wholesale electricity market (RCE —
Rynkowa Cena Energii Elektrycznej). It turns real hourly price volatility
into a concrete business question: *"If a flexible industrial site had
planned its load on a day-ahead price forecast, how much would it really
have saved?"*

**Why:** it is a portfolio project. The audience is hiring managers and
recruiters evaluating candidates for Data Science, BI and Full-Stack
Analytics roles in Warsaw and across Europe. It must demonstrate, in one
coherent live product: data engineering (public API ingestion, timezone
handling), leakage-free time-series ML with an honest baseline comparison,
mathematical optimisation, and a polished, fast web front end.

## 2. Goals, non-goals, anti-goals

**Goals**
- Real data: last 180 days of RCE prices and weather for 4 Polish cities.
- Leakage-free 24h-ahead price forecast (LightGBM) benchmarked against a
  24h naive persistence model, reported with MAE and RMSE.
- Load-shift optimiser that plans on the *forecast* and is billed on the
  *actual* price, showing realised savings, perfect-foresight upper bound,
  and capture rate.
- Instant interaction in the browser (sliders re-solve in milliseconds).
- Zero-risk Vercel deployment: no Python at runtime; static JSON only.
- Case-study `README.md` populated with real pipeline metrics.
- Clean, atomic, module-by-module git history.

**Non-goals**
- Automatic daily refresh / scheduled pipeline (possible later extension).
- User accounts, persistence of user scenarios, backend API.
- Intraday / balancing market modelling, network tariffs, demand charges.
- Probabilistic forecasting.

**Anti-goals (failure even if it "works")**
- Any feature leakage (e.g. same-day prices or future weather actuals used
  as features in a way unavailable at decision time) that inflates metrics.
- Savings numbers computed with perfect foresight presented as achievable.
- CO₂ figures presented as measured when they are estimates.
- Any non-English text in code, UI, docs or commits.
- A Vercel deploy that depends on a Python runtime or secrets.

## 3. Constraints

- **Language:** all code, comments, folder names, UI copy, README and commit
  messages in professional English.
- **Environment:** Windows 11. Python 3.11+ and Node.js 20+ are not
  installed; install via `winget`. Project stays in the current folder
  (`C:\Users\alpar\OneDrive\Masaüstü\gridshift-pl`; OneDrive sync is off).
  The non-ASCII path segment (`Masaüstü`) must not break tooling — use
  `pathlib` in Python and verify Next.js build works from this path.
- **Data sources (all keyless):**
  - PSE Open Data v2: `https://api.raporty.pse.pl/api/rce-pln`, filter
    `$filter=doba ge 'YYYY-MM-DD' and doba le 'YYYY-MM-DD'`, follow
    `nextLink` pagination. RCE is derived from the TGE day-ahead (RDN)
    fixing and has been quarter-hourly since Oct 2025, so the whole window
    is expected to be 15-min data (92/96/100 quarter-hours per day across
    DST). Builder verifies this against the live API; the pipeline
    aggregates to hourly mean and fails loudly on unexpected granularity.
  - Open-Meteo archive (`archive-api.open-meteo.com/v1/archive`) and
    forecast endpoints: hourly `temperature_2m`, `wind_speed_100m`,
    `shortwave_radiation` for Warsaw, Gdańsk, Katowice, Poznań.
  - NBP API (`api.nbp.pl`) for daily EUR/PLN mid rate (table A).
- **Time:** all timestamps aligned to `Europe/Warsaw`. DST days (23h / 25h)
  must be handled explicitly (see §6.1).
- **Data in git:** raw/processed data (`data/`) is git-ignored. Only the
  compact exported JSON in `public/data/` is committed (target < 5 MB total).
- **Deployment target:** Vercel, Next.js App Router, static data.

## 4. Approaches considered

**Overall architecture** (decided by the user): heavy Python data/ML layer
offline → JSON in `public/data/` → Next.js app performs instant
optimisation client-side. Alternative of a Python serverless API on Vercel
was rejected for deployment risk.

**Day selection UX** (user picked B)
- A. Fixed "tomorrow" scenario only — simplest, but cannot audit the model.
- **B. Date picker over 180 days + 3 one-click scenario shortcuts** — chosen;
  lets recruiters audit forecast vs actual on any day.
- C. B + daily auto refresh via GitHub Actions — deferred (maintenance).

**Optimisation price basis** (user picked B)
- A. Optimise on actual prices — inflated, unachievable savings.
- **B. Plan on forecast, bill on actual; show realised savings, perfect
  foresight upper bound, capture rate** — chosen.
- C. Toggle between both — dilutes the message.

**CO₂ intensity** (user picked A)
- **A. Weather-derived hourly proxy intensity, clearly labelled estimate** —
  chosen.
- B. ENTSO-E actual generation mix — requires token/secret.
- C. Static factor — shift always yields 0 CO₂ change; useless KPI.

**Browser LP solver** (user picked 1)
- **1. `javascript-lp-solver` (pure JS, small)** — chosen.
- 2. `glpk.js` (WASM) — heavier, loading complexity, overkill.
- 3. Hand-written simplex / min-cost flow — high bug risk, little signal.

**Forecast model:** LightGBM (builder's call, gain-based feature importance);
`HistGradientBoostingRegressor` is the documented fallback if LightGBM
cannot be installed.

## 5. Repository layout

```
gridshift-pl/
  pipeline/
    ingest.py        # Module A
    features.py      # Module B
    forecast.py      # Module B
    optimizer.py     # Module C (reference LP, scipy linprog)
    export.py        # writes public/data/*.json (may live inside forecast.py)
    config.py        # dates, cities, profiles, constants
  tests/             # pytest
  data/raw/, data/processed/   # git-ignored
  app/               # Next.js App Router
  components/
  lib/optimizer.ts   # Module C (browser LP, javascript-lp-solver)
  lib/__tests__/     # vitest, incl. parity fixtures from Python
  public/data/       # committed JSON
  docs/superpowers/specs/
  README.md
```

## 6. Design by module

### 6.1 Module A — `pipeline/ingest.py`

- Window: the 180 full days ending yesterday (Europe/Warsaw) at run time,
  plus enough extra history before it for the 168h lag (≥ 7 extra days),
  so all 180 days have complete features.
- Fetch RCE with date filter and `nextLink` pagination; retries with
  backoff; cache raw responses under `data/raw/`.
- Parse the period/timestamp fields from PSE, localise to Europe/Warsaw
  (respecting DST), aggregate 15-min to hourly mean.
- Fetch Open-Meteo archive for the 4 cities (hourly, timezone
  Europe/Warsaw). For the most recent days not yet in the archive, fall back
  to the forecast endpoint's past-days data.
- Fetch NBP EUR/PLN daily mid rate; forward-fill weekends/holidays.
- Output `data/processed/market_weather_hourly.parquet`: one row per local
  hour with tz-aware timestamp, `price_pln_mwh`, per-city weather columns,
  `eur_pln`.
- DST: keep true local hours (23 or 25 per day). The optimiser and UI work
  with the actual number of hours in the selected day.
- Validation: report row counts, missing-value counts, duplicate
  timestamps, and date coverage; fail loudly on gaps > a small threshold.

### 6.2 Module B — `pipeline/features.py`, `pipeline/forecast.py`

**Decision-time convention (user decision):** forecasts for delivery day D
are made at **D−1 ~10:00 Europe/Warsaw, before the day-ahead auction gate
closure**, i.e. before D prices are published. The business framing: the
site must commit its day-ahead load schedule / bid before prices are known,
which is why a forecast is needed. Information available at the cutoff:
all prices up to and including day D−1 (published on D−2), so 24h/48h/168h
lags, persistence baseline and rolling windows ending at end of D−1 are
valid. Leakage tests must encode this cutoff (no feature for D may depend
on any price of day D). Methodology tab and README state this framing
plainly. Weather features for D use the *observed* weather as a stand-in
for a day-ahead weather forecast — this is a documented simplification
(historical weather forecasts are not available keylessly); README must
state it.

Features:
- Cyclical hour-of-day and day-of-week (sin/cos), month.
- Polish public holidays (`holidays` package, PL) and weekend flag.
- Lagged prices: 24h, 48h, 168h (for 24h-ahead day D, the 24h lag is the same
  hour on D−1 — valid at decision time).
- Rolling volatility / mean computed strictly on past data, ending at the
  end of D−1 (shifted so no same-day values leak).
- Regional renewable indicators: wind index (mean of `wind_speed_100m`³,
  normalised) and solar index (mean `shortwave_radiation`), plus
  temperature.

Model & evaluation:
- Walk-forward: first ~120 days train, last ~60 days test. Builder decides
  between single split vs expanding-window refits (e.g. weekly); the
  constraint is that every test-day prediction is out-of-sample.
- Baseline: 24h naive persistence (price at same hour of D−1).
- Report MAE and RMSE (PLN/MWh) for model and baseline on the test set,
  plus % improvement.
- Training-period days still get in-sample predictions so the date picker
  covers 180 days; the UI marks them as "in-sample".

Exports (`public/data/`):
- `days.json` (or per-month chunks): per day → hourly timestamps, actual
  price, forecast price, wind/solar index, CO₂ proxy intensity, EUR/PLN,
  `split` flag (train/test).
- `metrics.json`: MAE/RMSE for model and baseline, test window dates,
  generated-at timestamp, data coverage.
- `feature_importance.json`: top features by gain.
- `scenarios.json`: the 3 auto-selected days (rules below), chosen from the
  test window when possible.
- `profiles.json`: facility profiles (see 6.3).
- `parity_fixtures.json` (test-only, may live under `lib/__tests__/`):
  Python optimiser inputs + objective/KPIs for TS parity tests.

Scenario selection rules:
- **High Wind / Renewable Surplus Day:** highest daily wind index among days
  in the bottom quartile of mean price.
- **Evening Peak Price Spike Day:** max of (max price 17:00–21:00 − min
  price of the day).
- **Typical Weekday Baseline:** non-holiday weekday whose mean price is
  closest to the median daily mean.

### 6.3 Module C — `pipeline/optimizer.py`, `lib/optimizer.ts`

Inputs: base load profile `b_t` (kW, per hour of selected day), flex share
`f`, shift window `W` hours, site connection capacity `C` (kW), planning
price `p̂_t` (forecast), billing price `p_t` (actual), CO₂ intensity `e_t`.

Decision variables: `x_{s,t} ≥ 0` = kW moved from hour `s` to hour `t`,
for `0 < |s − t| ≤ W`, within the selected day (no cross-midnight shifting —
builder may note this as a simplification).

Constraints:
- Outflow: `Σ_t x_{s,t} ≤ f · b_s` for each `s`.
- Capacity: `b_t − Σ_t' x_{t,t'} + Σ_s x_{s,t} ≤ C` for each `t`.
- Energy is conserved by construction (every unit moved out lands elsewhere).

Objective: minimise `Σ_t p̂_t · L_t` where `L_t` is the shifted load.

Outputs/KPIs (computed against actual price):
- Baseline cost, optimised cost, **realised savings** (PLN and EUR).
- **Perfect-foresight savings**: same LP solved with `p_t`.
- **Capture rate** = realised / perfect-foresight savings.
- **Peak load reduction %** = (max b − max L) / max b.
- **CO₂ reduction** (kg, estimate) = Σ e_t·(b_t − L_t).
- A forecast-planned schedule can lose money on a bad forecast day; that
  must be shown honestly (negative savings allowed).

Parity: Python (`scipy.optimize.linprog`, HiGHS) is the reference. TS uses
the identical formulation with `javascript-lp-solver`. Parity tests compare
objective value and KPIs within a small tolerance (not per-hour schedules,
since LP optima may be non-unique) over fixtures for every profile and the
3 scenario days.

**Facility profiles** (defaults, slider-adjustable):

| Profile | Base load shape | Flex % | Window | Capacity |
|---|---|---|---|---|
| Cold Storage Warehouse | Flat ~800 kW, mild daytime rise | 30% | ±4 h | builder sets, ~1.2× peak |
| CNC Manufacturing Plant | ~1.5 MW 06–22 (two shifts), low overnight | 20% | ±3 h | ~1.2× peak |
| EV Fleet Charging Depot | Evening peak 18–23 ~1.2 MW | 70% | ±8 h | ~1.2× peak |

Sliders: base load scale (kW), max shiftable %, max shift window (h).
Capacity scales with base load.

**CO₂ proxy:** start from KOBiZE annual average grid emission factor
(~0.65 tCO₂/MWh; builder confirms the latest published value and cites it),
modulated hourly downward by normalised wind + solar index within a bounded
range so the daily mean stays near the annual factor. Labelled "estimate"
in UI and README with the formula.

### 6.4 Module D — `app/`, `components/`

Next.js (App Router, TypeScript, Tailwind CSS, Recharts). Single-page
dashboard, responsive, light theme with optional dark mode (builder's call).

Layout (top to bottom):
```
GridShift PL — header, one-line value proposition, data freshness
[ Date picker ▾ ] [High Wind] [Evening Spike] [Typical Weekday]  (in-sample badge)
[ Profile selector: Cold Storage | CNC Plant | EV Fleet ]
[ Sliders: base load | flex % | window ]
KPI cards: Realised savings (PLN/EUR) · Capture rate · Peak reduction · CO₂ (est.)
Tabs: [Optimisation]  [Model Accuracy]  [Methodology]
  Optimisation: 24h chart — actual price & forecast (line, right axis),
                base vs shifted load (area/bars, left axis)
  Model Accuracy: MAE/RMSE model vs persistence, forecast vs actual for the
                  selected day, feature importance bar chart
  Methodology: short explanation of data, leakage control, LP, CO₂ proxy
```
- All optimisation runs client-side on slider change (debounced if needed).
- Static data loaded from `/data/*.json`.

### 6.5 README (case study)

Problem → data → approach → results (real MAE/RMSE, improvement %, example
savings and capture rate on the 3 scenarios) → architecture diagram →
limitations (observed weather as forecast proxy, CO₂ proxy, no network
tariffs) → how to run → tech stack. Screenshots of the dashboard.

## 7. Quality & verification

- `pytest` for ingestion parsing (DST, 15-min aggregation, pagination),
  leakage checks (features at D never depend on prices from D), optimiser
  invariants (energy conservation, bounds).
- `vitest` for `lib/optimizer.ts` incl. Python parity fixtures.
- `ds-quality-gate`: no leakage, Europe/Warsaw alignment, no large data in
  git, full end-to-end run with row counts and summary stats.
- `next build` succeeds; app visually checked in the browser.

## 8. Git

Initialise a repo. Atomic commits per verified module, roughly:
`docs: design spec` → `chore: project scaffold` → `pipeline/ingest` →
`pipeline/features+forecast` → `optimizer (py + ts)` → `frontend` →
`docs/README`. English commit messages.

## 9. Left to the builder

- Exact LightGBM hyperparameters and walk-forward refit cadence.
- Exact base-load curves per profile (within shapes above) and capacity.
- JSON chunking strategy and exact schema.
- Visual styling details, colour palette, dark mode.
- Retry/backoff parameters, caching details.
- Vercel deployment itself is out of scope for this session unless the user
  asks (the app must be deploy-ready).
