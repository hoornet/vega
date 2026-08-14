import { describe, it, expect, beforeEach } from "vitest";
import { compareVersions, pendingNotices, markVersionSeen, RELEASE_NOTICES } from "./releaseNotices";

const LAST_SEEN_KEY = "wrystr_last_seen_version";

describe("compareVersions", () => {
  it("orders by numeric part, not string", () => {
    // "0.9.0" > "0.15.0" as strings; the whole point is that it isn't here.
    expect(compareVersions("0.15.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("0.15.1", "0.15.2")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });

  it("treats missing and non-numeric parts as zero", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.0-beta", "1.2.0")).toBe(0);
  });
});

describe("pendingNotices", () => {
  beforeEach(() => localStorage.removeItem(LAST_SEEN_KEY));

  it("shows nothing on a fresh install", () => {
    // No stored version: there is no old behaviour this user was surprised by.
    expect(pendingNotices("0.15.2")).toEqual([]);
  });

  it("shows a notice when upgrading through the version that introduced it", () => {
    markVersionSeen("0.15.1");
    const notices = pendingNotices("0.15.2");
    expect(notices.map((n) => n.version)).toContain("0.15.2");
  });

  it("shows nothing when the version is unchanged", () => {
    markVersionSeen("0.15.2");
    expect(pendingNotices("0.15.2")).toEqual([]);
  });

  it("does not repeat a notice on later upgrades", () => {
    markVersionSeen("0.15.2");
    expect(pendingNotices("0.16.0")).toEqual([]);
  });

  it("still shows a skipped notice when several versions are jumped at once", () => {
    // 0.15.1 -> 0.16.0 must not silently swallow the 0.15.2 notice.
    markVersionSeen("0.15.1");
    expect(pendingNotices("0.16.0").map((n) => n.version)).toContain("0.15.2");
  });

  it("shows nothing on a downgrade", () => {
    markVersionSeen("0.16.0");
    expect(pendingNotices("0.15.2")).toEqual([]);
  });

  it("keeps every notice pointed at a real view", () => {
    for (const notice of RELEASE_NOTICES) {
      expect(notice.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(notice.title.length).toBeGreaterThan(0);
      expect(notice.body.length).toBeGreaterThan(0);
    }
  });
});
