import { describe, it, expect, vi, beforeEach } from "vitest";

const fs = vi.hoisted(() => ({
  writeTextFile: vi.fn(),
  open: vi.fn(),
  exists: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
  stat: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => fs);
vi.mock("@tauri-apps/api/path", () => ({ homeDir: vi.fn().mockResolvedValue("/home/user") }));
vi.mock("./nostr/core", () => ({ getNDK: () => ({ pool: { relays: new Map() } }), getActiveFetchCount: () => 0 }));

import { cleanupLegacyDiagLog, cleanupLegacyDiagMirror, isDiagLogEnabled, setDiagLogEnabled } from "./feedDiagnostics";

const LOG = "/home/user/vega-diag.log";
const OURS = '{"ts":1776168414522,"t":"session_start","v":"vega-diag-v1"}\n{"ts":1,"t":"mem"}';
let headContent = OURS;

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  fs.exists.mockResolvedValue(true);
  headContent = OURS;
  fs.open.mockImplementation(async () => ({
    read: async (buf: Uint8Array) => {
      const bytes = new TextEncoder().encode(headContent);
      const n = Math.min(bytes.length, buf.length);
      buf.set(bytes.subarray(0, n));
      return n;
    },
    close: async () => {},
  }));
  fs.remove.mockResolvedValue(undefined);
});

describe("legacy diagnostics log cleanup", () => {
  it("removes the runaway log we wrote", async () => {
    await cleanupLegacyDiagLog();
    expect(fs.remove).toHaveBeenCalledWith(LOG);
    expect(localStorage.getItem("vega_diag_legacy_cleanup")).toBe("done");
  });

  it("leaves a same-named file alone when it isn't ours", async () => {
    // Someone else's ~/vega-diag.log must not be deleted just for matching the name.
    headContent = "dear diary, today I wrote my own vega-diag.log";
    await cleanupLegacyDiagLog();
    expect(fs.remove).not.toHaveBeenCalled();
  });

  it("never deletes a log the user is actively collecting", async () => {
    setDiagLogEnabled(true);
    await cleanupLegacyDiagLog();
    expect(fs.remove).not.toHaveBeenCalled();
  });

  it("does not run twice", async () => {
    await cleanupLegacyDiagLog();
    fs.remove.mockClear();
    await cleanupLegacyDiagLog();
    expect(fs.remove).not.toHaveBeenCalled();
  });

  it("retries on a later launch if the delete failed", async () => {
    fs.remove.mockRejectedValueOnce(new Error("EBUSY"));
    await cleanupLegacyDiagLog();
    // Not marked done, so the next launch gets another go.
    expect(localStorage.getItem("vega_diag_legacy_cleanup")).toBeNull();
  });

  it("is a no-op when there is no log at all", async () => {
    fs.exists.mockResolvedValue(false);
    await cleanupLegacyDiagLog();
    expect(fs.remove).not.toHaveBeenCalled();
    expect(localStorage.getItem("vega_diag_legacy_cleanup")).toBe("done");
  });
});

describe("diagnostics log switch", () => {
  it("is off unless explicitly turned on", () => {
    expect(isDiagLogEnabled()).toBe(false);
  });

  it("round-trips through localStorage", () => {
    setDiagLogEnabled(true);
    expect(isDiagLogEnabled()).toBe(true);
    setDiagLogEnabled(false);
    expect(isDiagLogEnabled()).toBe(false);
  });
});

describe("legacy localStorage mirror", () => {
  it("drops the 166 KB blob the old build left behind", () => {
    localStorage.setItem("wrystr_feed_diag", "[]");
    cleanupLegacyDiagMirror();
    expect(localStorage.getItem("wrystr_feed_diag")).toBeNull();
  });
});
