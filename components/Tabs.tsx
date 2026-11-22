"use client";

export type TabId = "optimisation" | "accuracy" | "methodology";

const TABS: { id: TabId; label: string }[] = [
  { id: "optimisation", label: "Optimisation" },
  { id: "accuracy", label: "Model accuracy" },
  { id: "methodology", label: "Methodology" },
];

export default function Tabs({ value, onChange }: { value: TabId; onChange: (t: TabId) => void }) {
  return (
    <div role="tablist" aria-label="Dashboard views" className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border px-3 pt-3">
      {TABS.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={`whitespace-nowrap px-4 py-2 text-sm font-medium transition-colors ${
              active ? "border-b-2 border-accent text-ink" : "border-b-2 border-transparent text-ink-3 hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
