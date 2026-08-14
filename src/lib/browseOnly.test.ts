import { describe, it, expect, beforeEach } from "vitest";
import { isBrowseOnly, setBrowseOnly } from "./browseOnly";

const KEY = "wrystr_browse_only";

describe("browse-only mode (issue #34)", () => {
  beforeEach(() => {
    localStorage.removeItem(KEY);
    localStorage.removeItem("wrystr_pubkey");
  });

  it("is off by default, so existing users still see onboarding", () => {
    expect(isBrowseOnly()).toBe(false);
  });

  it("persists across restarts", () => {
    setBrowseOnly(true);
    expect(isBrowseOnly()).toBe(true);
  });

  it("can be cleared", () => {
    setBrowseOnly(true);
    setBrowseOnly(false);
    expect(isBrowseOnly()).toBe(false);
  });

  it("treats any other stored value as off", () => {
    localStorage.setItem(KEY, "true");
    expect(isBrowseOnly()).toBe(false);
  });

  // The bug this feature fixes: App gated onboarding solely on wrystr_pubkey,
  // so signing out and restarting put you back at the welcome wall even though
  // Vega is perfectly usable without an identity.
  it("lets the onboarding gate pass with no pubkey", () => {
    const gate = () => !!localStorage.getItem("wrystr_pubkey") || isBrowseOnly();
    expect(gate()).toBe(false);
    setBrowseOnly(true);
    expect(gate()).toBe(true);
  });

  it("still passes the gate after a later sign-out", () => {
    // Not cleared on login on purpose: someone who once chose to look around
    // should never be walled again.
    setBrowseOnly(true);
    localStorage.setItem("wrystr_pubkey", "abc");
    localStorage.removeItem("wrystr_pubkey");
    expect(isBrowseOnly()).toBe(true);
  });
});
