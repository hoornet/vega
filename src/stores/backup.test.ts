import { describe, it, expect, beforeEach, vi } from "vitest";
import { useBackupStore } from "./backup";

const isBackupPending = (pubkey: string | null) => !!pubkey && useBackupStore.getState().pending.includes(pubkey);

const ANA = "aa".repeat(32);
const BO = "bb".repeat(32);
const stored = () => JSON.parse(localStorage.getItem("wrystr_backup_pending") ?? "[]");

beforeEach(() => {
  localStorage.clear();
  useBackupStore.setState({ pending: [] });
});

// Who pressed "I'll back up my key later", until the key has been copied once.
describe("the backup reminder", () => {
  it("remembers an account, for the next launch too", () => {
    useBackupStore.getState().markPending(ANA);
    expect(isBackupPending(ANA)).toBe(true);
    expect(stored()).toEqual([ANA]);
  });

  it("is per account", () => {
    useBackupStore.getState().markPending(ANA);
    useBackupStore.getState().markPending(BO);
    expect(isBackupPending(BO)).toBe(true);
    useBackupStore.getState().clearPending(BO);
    expect(isBackupPending(ANA)).toBe(true);
    expect(isBackupPending(BO)).toBe(false);
    expect(stored()).toEqual([ANA]);
  });

  it("ends once the key has been copied", () => {
    useBackupStore.getState().markPending(ANA);
    useBackupStore.getState().clearPending(ANA);
    expect(isBackupPending(ANA)).toBe(false);
    expect(stored()).toEqual([]);
  });

  it("is not doubled by asking twice", () => {
    useBackupStore.getState().markPending(ANA);
    useBackupStore.getState().markPending(ANA);
    expect(stored()).toEqual([ANA]);
  });

  it("is false for nobody", () => {
    expect(isBackupPending(null)).toBe(false);
  });

  // The store reads storage once, when the module loads.
  it("reads what was stored at launch, and nothing that is not a key", async () => {
    for (const [raw, want] of [[JSON.stringify([ANA, 5, null]), [ANA]], ["{not json", []], ['"ana"', []], [JSON.stringify([BO]), [BO]]] as const) {
      localStorage.setItem("wrystr_backup_pending", raw);
      vi.resetModules();
      const fresh = await import("./backup");
      expect(fresh.useBackupStore.getState().pending).toEqual(want);
    }
  });
});
