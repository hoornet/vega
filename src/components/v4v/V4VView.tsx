import { useState } from "react";
import { V4VDashboard } from "./V4VDashboard";
import { V4VSettings } from "./V4VSettings";
import { V4VHistory } from "./V4VHistory";

const TABS = ["dashboard", "settings", "history"] as const;
type Tab = (typeof TABS)[number];

export function V4VView() {
  const [tab, setTab] = useState<Tab>("dashboard");

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b border-border-subtle shrink-0">
        <div className="flex items-center px-4 pt-3 pb-0">
          <h1 className="text-text text-[14px] font-medium mr-6">Value 4 Value</h1>
          <div className="flex">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 text-[11px] border-b-2 transition-colors ${
                  tab === t
                    ? "border-accent text-accent"
                    : "border-transparent text-text-dim hover:text-text"
                }`}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === "dashboard" && <V4VDashboard />}
        {tab === "settings" && <V4VSettings />}
        {tab === "history" && <V4VHistory />}
      </div>
    </div>
  );
}
