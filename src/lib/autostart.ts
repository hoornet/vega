import { invoke } from "@tauri-apps/api/core";

/** Why this build cannot add Vega to the login items (`autostart_unavailable` in lib.rs). */
export type AutostartUnavailable = "development" | "flatpak";

export interface AutostartStatus {
  /** A login entry for Vega exists. It starts Vega with `--hidden`: in the tray, with no window. */
  enabled: boolean;
  unavailable: AutostartUnavailable | null;
}

export function readAutostart(): Promise<AutostartStatus> {
  return invoke<AutostartStatus>("autostart_status");
}

/** Writes or removes the login entry, and resolves to whether it exists afterwards. */
export function setAutostart(on: boolean): Promise<boolean> {
  return invoke<boolean>("set_autostart", { on });
}
