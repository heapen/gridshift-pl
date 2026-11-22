"use client";

export type TabId = "optimisation" | "accuracy" | "methodology";

const TABS: { id: TabId; label: string; short: string }[] = [
  { id: "optimisation", label: "Optimisation", short: "Optimisation" },
  { id: "accuracy", label: "Model accuracy", short: "Accuracy" },
  { id: "methodology", label: "Methodology", short: "Method" },
];

export default function Tabs({ value, onChange }: { value: TabId; onChange: (t: TabId) => void }) {
  return (
    <div role="tablist" aria-label="Dashboard views" className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border px-2 pt-2 sm:px-3 sm:pt-3">
      {TABS.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={`flex-1 whitespace-nowrap px-2 py-2 text-sm font-medium sm:flex-none sm:px-4 transition-colors ${
              active ? "border-b-2 border-accent text-ink" : "border-b-2 border-transparent text-ink-3 hover:text-ink"
            }`}
          >
            <span className="sm:hidden">{t.short}</span>
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
