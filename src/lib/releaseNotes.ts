import { fetchWithProxy } from "./proxy";
import { withinTime } from "./timeLimit";
import { compareVersions } from "./releaseNotices";

/**
 * Release notes for the update banner's "What's new", read from the GitHub releases.
 *
 * The updater's own notes (`latest.json`) are the fixed text in release.yml,
 * whose newest section is v0.14.0: per-version notes left the workflow after
 * v0.14.1 broke its parser, and the real notes are put on the GitHub release
 * afterwards. So the panel asks GitHub, once, when it is opened.
 */

export const RELEASES_URL = "https://api.github.com/repos/hoornet/vega/releases?per_page=20";
const TIME_LIMIT_MS = 8000;

/** The fields of a GitHub release that are read here. */
export interface GitHubRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
}

export interface ReleaseNotes {
  /** "0.16.0", without the leading v. */
  version: string;
  /** The release's own title, when it has one besides "Vega v0.16.0". */
  title: string | null;
  /** Markdown for the panel (see `panelBody`). Empty when the release has no notes of its own yet. */
  body: string;
}

const VERSION = /^v?(\d+\.\d+\.\d+)$/i;
/** `### v0.14.0 — title`: a version's section in the workflow's cumulative changelog. */
const VERSION_HEADING = /^#{2,3}\s+v(\d+\.\d+\.\d+)\b/i;

/** "v0.16.0" or "0.16.0" to "0.16.0"; anything else (a suffix, a name) to null. */
function plainVersion(tag: string): string | null {
  const m = VERSION.exec(tag.trim());
  return m ? m[1] : null;
}

/**
 * What follows the version in "Vega v0.16.0 — A title", "## Vega v0.15.6 — A title"
 * or "### v0.14.0 — A title". Null when nothing does, or the text does not start
 * with a version.
 */
function subtitle(text: string): string | null {
  const m = /^#*\s*(?:Vega\s+)?v?\d+\.\d+\.\d+\S*\s*(.*)$/i.exec(text.trim());
  if (!m) return null;
  const rest = m[1].replace(/^[\s—–:-]+/, "").trim();
  return rest || null;
}

function releaseTitle(name: string | null, body: string, version: string): string | null {
  const named = (name ?? "").trim();
  if (named && !/^(?:Vega\s+)?v?\d+\.\d+\.\d+/i.test(named)) return named;
  const fromName = named ? subtitle(named) : null;
  if (fromName) return fromName;
  // The title can also be on the body's first heading, which the panel takes off.
  for (const line of body.split("\n")) {
    const m = VERSION_HEADING.exec(line.replace(/^(#{2,3})\s+Vega\s+/i, "$1 "));
    const title = m && m[1] === version ? subtitle(line) : null;
    if (title) return title;
  }
  return null;
}

function paragraphEnd(lines: string[], from: number): number {
  let i = from;
  while (i < lines.length && lines[i].trim() !== "") i++;
  return i;
}

function skipBlank(lines: string[], from: number): number {
  let i = from;
  while (i < lines.length && lines[i].trim() === "") i++;
  return i;
}

/**
 * The release body without the release page's header.
 *
 * A body written from the workflow's template starts with a `## Vega vX.Y.Z`
 * heading, a one-line tagline and a `> **Windows note:**` blockquote. They say
 * what Vega is and how to install it, not what changed, so they are taken off.
 * The tagline is recognised by where it is (between the heading and the Windows
 * note), so an opening paragraph of real notes right under the heading stays.
 * A body that does not start with that heading is returned as it is.
 *
 * Given the release's `version`, a cumulative changelog (`### vX.Y.Z` sections,
 * as the workflow wrote up to v0.14.0) is cut down to that version's section,
 * without its heading. One with no section for that version is the workflow's
 * fixed text standing in before the notes were applied, and gives "".
 */
export function panelBody(body: string, version?: string): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  let i = skipBlank(lines, 0);
  if (/^##\s+Vega\s+v?\d+\.\d+\.\d+/i.test(lines[i] ?? "")) {
    i = skipBlank(lines, i + 1);
    const isNote = (n: number) => /^>\s*\*\*Windows note:?\*\*/i.test(lines[n] ?? "");
    if (!isNote(i) && !(lines[i] ?? "").startsWith(">")) {
      const after = skipBlank(lines, paragraphEnd(lines, i));
      if (isNote(after)) i = after;
    }
    if (isNote(i)) {
      while (i < lines.length && lines[i].startsWith(">")) i++;
      i = skipBlank(lines, i);
    }
  }
  const rest = lines.slice(i);
  if (!version) return rest.join("\n").trim();

  const sections = rest.reduce<number[]>((acc, line, n) => {
    if (VERSION_HEADING.test(line.trim())) acc.push(n);
    return acc;
  }, []);
  if (sections.length === 0) return rest.join("\n").trim();
  const own = sections.findIndex((n) => VERSION_HEADING.exec(rest[n].trim())?.[1] === version);
  if (own === -1) return "";
  const end = own + 1 < sections.length ? sections[own + 1] : rest.length;
  return rest.slice(sections[own] + 1, end).join("\n").trim();
}

/**
 * The notes of the releases after `installedVersion`, up to and including
 * `offeredVersion`, newest first. Drafts, pre-releases and tags that are not
 * a plain `vX.Y.Z` are left out.
 */
export function notesBetween(
  releases: GitHubRelease[],
  installedVersion: string,
  offeredVersion: string,
): ReleaseNotes[] {
  const from = plainVersion(installedVersion);
  const to = plainVersion(offeredVersion);
  if (!from || !to) return [];
  return releases
    .filter((r) => !r.draft && !r.prerelease)
    .map((r) => ({ release: r, version: plainVersion(r.tag_name) }))
    .filter((x): x is { release: GitHubRelease; version: string } =>
      x.version !== null && compareVersions(x.version, from) > 0 && compareVersions(x.version, to) <= 0)
    .sort((a, b) => compareVersions(b.version, a.version))
    .map(({ release, version }) => {
      const body = release.body ?? "";
      return { version, title: releaseTitle(release.name, body, version), body: panelBody(body, version) };
    });
}

function isRelease(value: unknown): value is GitHubRelease {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  const textOrNull = (v: unknown) => v === null || v === undefined || typeof v === "string";
  return typeof r.tag_name === "string"
    && typeof r.draft === "boolean"
    && typeof r.prerelease === "boolean"
    && textOrNull(r.name)
    && textOrNull(r.body);
}

async function readReleases(signal: AbortSignal): Promise<GitHubRelease[]> {
  const res = await fetchWithProxy(RELEASES_URL, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal,
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const data: unknown = await res.json();
  if (!Array.isArray(data)) throw new Error("GitHub did not send a list of releases");
  return data.filter(isRelease);
}

/**
 * The notes of every release since `installedVersion`, as `notesBetween` gives
 * them, or null when GitHub could not be asked or did not answer with releases.
 * Goes out through the user's proxy setting. Never throws.
 */
export async function fetchNotesSince(
  installedVersion: string,
  offeredVersion: string,
): Promise<ReleaseNotes[] | null> {
  const controller = new AbortController();
  try {
    const releases = await withinTime(readReleases(controller.signal), TIME_LIMIT_MS, "GitHub did not answer in time");
    return notesBetween(releases, installedVersion, offeredVersion);
  } catch {
    controller.abort();
    return null;
  }
}
