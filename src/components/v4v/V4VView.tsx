import { useState } from "react";
import { V4VDashboard } from "./V4VDashboard";
import { V4VSettings } from "./V4VSettings";
import { V4VHistory } from "./V4VHistory";
import { ViewHeader } from "../shared/ViewHeader";
import { Tabs, tabPanelProps } from "../shared/Tabs";

const TABS = ["dashboard", "settings", "history"] as const;
type Tab = (typeof TABS)[number];

export function V4VView() {
  const [tab, setTab] = useState<Tab>("dashboard");

  return (
    <div className="h-full flex flex-col">
      <ViewHeader title="Value 4 Value" />
      <Tabs
        label="Value 4 Value"
        panel="v4v-panel"
        tabs={TABS.map((t) => ({ id: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))}
        value={tab}
        onChange={setTab}
      />

      {/* Content */}
      <div {...tabPanelProps("v4v-panel", tab)} className="flex-1 overflow-y-auto">
        {tab === "dashboard" && <V4VDashboard />}
        {tab === "settings" && <V4VSettings />}
        {tab === "history" && <V4VHistory />}
      </div>
    </div>
  );
}
