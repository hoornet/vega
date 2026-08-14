import type { View } from "../stores/ui";

/**
 * One-time, post-upgrade notices about behaviour that CHANGED — not a changelog.
 *
 * The update banner only exists *before* you upgrade: it disappears the moment
 * you install, and its "What's new" panel is collapsed behind a click. So a user
 * who hits "Update & restart" without expanding it sees nothing, ever. These
 * notices fill that gap, on the first launch of the new version.
 *
 * Add an entry ONLY when an upgrade changes something the user already relied on:
 * a changed default, a removed feature, an action now required. New features
 * belong in the changelog. If this appears every release it becomes the
 * changelog, and it will be dismissed unread — the scarcity is the whole point.
 *
 * Write the body for someone who has never seen the thing it names. Anything a
 * notice points at is by definition new to the reader, so give the full path
 * ("the new switch under Settings → Relay reach"), never a bare label they have
 * no way to locate. The action button is a shortcut, not the instructions.
 *
 * Notices ship in the binary rather than being parsed from the updater body:
 * they must work offline, survive the updater never having fetched notes, and
 * carry a target view rather than prose.
 */
export type ReleaseNotice = {
  /** Version that introduced the change. Shown to users upgrading from below it. */
  version: string;
  title: string;
  body: string;
  action?: { label: string; view: View };
};

export const RELEASE_NOTICES: ReleaseNotice[] = [
  {
    version: "0.15.2",
    title: "Vega now connects only to your relays",
    body:
      "Previously it could also connect to relays used by people you follow, even if you had configured only one. " +
      "If your feed looks quieter than before, you can turn that behaviour back on with the new switch under Settings → Relay reach.",
    action: { label: "Open settings", view: "settings" },
  },
];

const LAST_SEEN_KEY = "wrystr_last_seen_version";

/** Numeric compare of dotted versions. Returns <0, 0, >0. Non-numeric parts sort as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".");
  const pb = b.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = Number.parseInt(pa[i] ?? "0", 10) || 0;
    const nb = Number.parseInt(pb[i] ?? "0", 10) || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/**
 * Notices for versions the user has upgraded *through* since they last ran Vega.
 *
 * A fresh install gets nothing: with no stored version there is no old behaviour
 * to have been surprised by, and "we changed X" is meaningless to someone who
 * never saw X. The same applies to a downgrade, which yields an empty list.
 */
export function pendingNotices(currentVersion: string): ReleaseNotice[] {
  let lastSeen: string | null = null;
  try {
    lastSeen = localStorage.getItem(LAST_SEEN_KEY);
  } catch { /* ignore */ }
  if (!lastSeen) return [];
  return RELEASE_NOTICES.filter(
    (n) => compareVersions(lastSeen, n.version) < 0 && compareVersions(n.version, currentVersion) <= 0,
  ).sort((a, b) => compareVersions(a.version, b.version));
}

/**
 * Record the running version as seen. Called on dismiss AND on every startup —
 * including the first — so a fresh install is stamped immediately and only ever
 * sees notices for upgrades it actually lives through.
 */
export function markVersionSeen(currentVersion: string): void {
  try {
    localStorage.setItem(LAST_SEEN_KEY, currentVersion);
  } catch { /* ignore */ }
}
