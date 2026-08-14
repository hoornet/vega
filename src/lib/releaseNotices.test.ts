import { describe, it, expect, beforeEach } from "vitest";
import {
  compareVersions, selectNotices, pendingNotices, markVersionSeen,
  RELEASE_NOTICES, type ReleaseNotice,
} from "./releaseNotices";

const LAST_SEEN_KEY = "wrystr_last_seen_version";

/** Fixtures, so the rules stay under test while RELEASE_NOTICES is empty. */
const NOTICES: ReleaseNotice[] = [
  { version: "0.15.2", title: "A", body: "a" },
  { version: "0.16.0", title: "B", body: "b" },
];

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

describe("selectNotices", () => {
  it("shows nothing on a fresh install", () => {
    // No stored version: there is no old behaviour this user was surprised by.
    expect(selectNotices(NOTICES, null, "0.16.0")).toEqual([]);
  });

  it("shows a notice when upgrading through the version that introduced it", () => {
    expect(selectNotices(NOTICES, "0.15.1", "0.15.2").map((n) => n.version)).toEqual(["0.15.2"]);
  });

  it("shows nothing when the version is unchanged", () => {
    expect(selectNotices(NOTICES, "0.15.2", "0.15.2")).toEqual([]);
  });

  it("does not repeat a notice already seen", () => {
    expect(selectNotices(NOTICES, "0.15.2", "0.15.2")).toEqual([]);
  });

  it("does not swallow notices when several versions are jumped at once", () => {
    // Matters for AUR and winget users, who routinely skip releases.
    expect(selectNotices(NOTICES, "0.15.1", "0.16.0").map((n) => n.version))
      .toEqual(["0.15.2", "0.16.0"]);
  });

  it("does not show notices from versions newer than the running build", () => {
    expect(selectNotices(NOTICES, "0.15.1", "0.15.2").map((n) => n.version)).toEqual(["0.15.2"]);
  });

  it("shows nothing on a downgrade", () => {
    expect(selectNotices(NOTICES, "0.16.0", "0.15.2")).toEqual([]);
  });

  it("returns notices oldest-first", () => {
    const reversed = [...NOTICES].reverse();
    expect(selectNotices(reversed, "0.15.1", "0.16.0").map((n) => n.version))
      .toEqual(["0.15.2", "0.16.0"]);
  });
});

describe("pendingNotices", () => {
  beforeEach(() => localStorage.removeItem(LAST_SEEN_KEY));

  it("reads the stored last-seen version", () => {
    markVersionSeen("0.15.1");
    expect(() => pendingNotices("0.15.2")).not.toThrow();
  });

  it("shows nothing on a fresh install regardless of registry contents", () => {
    expect(pendingNotices("9.9.9")).toEqual([]);
  });
});

describe("RELEASE_NOTICES registry", () => {
  it("has well-formed entries", () => {
    // Empty is the normal state — a release with nothing to say here is expected.
    for (const notice of RELEASE_NOTICES) {
      expect(notice.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(notice.title.length).toBeGreaterThan(0);
      expect(notice.body.length).toBeGreaterThan(0);
    }
  });
});
