import type { Metrics } from "@/lib/types";
import { DEMAND_CHARGE_PLN_PER_KW_DAY, KOBIZE_FACTOR_KG_MWH } from "@/lib/constants";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-ink-2">{children}</div>
    </section>
  );
}

const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.8rem] text-ink">{children}</code>
);

export default function MethodologyTab({ metrics }: { metrics: Metrics }) {
  return (
    <div className="grid max-w-3xl gap-6">
      <Section title="1. Data">
        <p>
          Quarter-hourly RCE prices come from the PSE Open Data v2 API, and are averaged to hourly values. Hourly
          temperature, 100&nbsp;m wind speed and shortwave radiation for Warsaw, Gdańsk, Katowice and Poznań come
          from Open-Meteo. Daily EUR/PLN comes from NBP. Everything is aligned to Europe/Warsaw, and DST days keep
          their true 23 or 25 hours.
        </p>
      </Section>

      <Section title="2. Decision time and leakage control">
        <p>
          The forecast for delivery day D is made on D-1 at about 10:00, before the day-ahead auction gate closes and
          before D prices are published. At that moment, prices up to the end of D-1 are known. Every price feature
          (lags at 24, 48 and 168 hours, and prior-day and 7-day statistics) is keyed on calendar days strictly
          before D. A unit test overwrites a whole day of prices and asserts that none of that day&apos;s features
          change.
        </p>
        <p>
          Simplification: weather for day D uses observed values as a stand-in for a day-ahead weather forecast,
          because historical weather forecasts are not available without an API key.
        </p>
      </Section>

      <Section title="3. Model">
        <p>
          A LightGBM regressor on calendar, holiday, lagged-price and regional wind/solar features. Evaluation is
          walk-forward: training covers {metrics.trainStart} to {metrics.trainEnd}, and test days from{" "}
          {metrics.testStart} are predicted out-of-sample with an expanding-window refit every{" "}
          {metrics.refitEveryDays} days. The benchmark is 24h naive persistence (same hour on the previous day).
        </p>
      </Section>

      <Section title="4. Optimisation">
        <p>
          A linear programme decides <Code>x[s,t] ≥ 0</Code>, the kW moved from hour s to hour t within the shift
          window. It is subject to a per-hour flexible share, availability hours (an EV fleet can only charge while
          plugged in, 16:00–07:00), the contracted capacity (equal to the current site peak) and energy
          conservation. It minimises energy cost plus a peak demand charge. The schedule is
          planned on the forecast price and billed on the actual price. The same LP solved on actual prices gives
          the perfect-foresight bound, and the capture rate is realised savings divided by that bound.
        </p>
        <p>
          The browser solver (javascript-lp-solver) matches the Python reference (SciPy HiGHS) on every test
          fixture.
        </p>
        <p>
          Assumption: the peak demand charge is {DEMAND_CHARGE_PLN_PER_KW_DAY.toFixed(2)} PLN per kW of daily peak
          (≈18 PLN/kW·month for capacity-related distribution charges).
        </p>
      </Section>

      <Section title="5. CO₂ estimate">
        <p>
          No keyless hourly carbon-intensity feed exists for Poland. Hourly intensity is therefore estimated from
          the KOBiZE end-user grid factor ({KOBIZE_FACTOR_KG_MWH} kg CO₂/MWh), lowered by up to 35% when regional
          wind and solar output are high, and rescaled so the period mean equals the official factor. Treat the
          figures as directional estimates.
        </p>
      </Section>

      <Section title="6. Not modelled">
        <p>
          The model does not cover network tariffs beyond the peak-charge assumption, intraday or balancing
          markets, cross-midnight shifting, or process-specific rebound effects.
        </p>
      </Section>
    </div>
  );
}
