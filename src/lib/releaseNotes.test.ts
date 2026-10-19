import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const http = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("./proxy", () => ({ fetchWithProxy: http.fetch }));

import { notesBetween, panelBody, fetchNotesSince, RELEASES_URL, type GitHubRelease } from "./releaseNotes";

function release(tag: string, over: Partial<GitHubRelease> = {}): GitHubRelease {
  return {
    tag_name: tag,
    name: `Vega ${tag}`,
    body: `### Changed in ${tag}\n\nSomething.`,
    draft: false,
    prerelease: false,
    published_at: "2026-10-19T17:18:16Z",
    ...over,
  };
}

// The header every release body written from the workflow's template starts with.
const HEADER = [
  "## Vega v0.16.0",
  "",
  "Cross-platform Nostr desktop client — polished UI, deep Lightning integration, first-class long-form writing.",
  "",
  '> **Windows note:** The installer is not yet code-signed. Windows SmartScreen will show an "Unknown publisher" warning — click "More info → Run anyway" to install.',
  "",
].join("\n");

describe("notesBetween", () => {
  const releases = [
    release("v0.15.9"),
    release("v0.16.1"),
    release("v0.15.10"),
    release("v0.16.0"),
    release("v0.16.2"),
  ];

  it("lists the releases after the installed one up to the offered one, newest first", () => {
    expect(notesBetween(releases, "0.15.10", "0.16.1").map((n) => n.version)).toEqual(["0.16.1", "0.16.0"]);
  });

  it("leaves out the installed version and includes the offered one", () => {
    const versions = notesBetween(releases, "0.15.9", "0.16.0").map((n) => n.version);
    expect(versions).not.toContain("0.15.9");
    expect(versions).toEqual(["0.16.0", "0.15.10"]);
  });

  it("compares versions as numbers, not as text", () => {
    // "0.15.10" sorts before "0.15.9" as text.
    expect(notesBetween(releases, "0.15.8", "0.15.10").map((n) => n.version)).toEqual(["0.15.10", "0.15.9"]);
  });

  it("skips drafts and pre-releases", () => {
    const list = [
      release("v0.16.1", { draft: true }),
      release("v0.16.0", { prerelease: true }),
      release("v0.15.10"),
    ];
    expect(notesBetween(list, "0.15.9", "0.16.1").map((n) => n.version)).toEqual(["0.15.10"]);
  });

  it("reads tags and versions with or without a leading v", () => {
    const list = [release("0.16.0"), release("v0.15.10")];
    expect(notesBetween(list, "v0.15.9", "v0.16.0").map((n) => n.version)).toEqual(["0.16.0", "0.15.10"]);
  });

  it("skips tags that are not a plain version", () => {
    const list = [release("v0.16.0-rc1"), release("nightly"), release("v0.16.0")];
    expect(notesBetween(list, "0.15.10", "0.16.0").map((n) => n.version)).toEqual(["0.16.0"]);
  });

  it("gives nothing when the installed version is the offered one", () => {
    expect(notesBetween(releases, "0.16.1", "0.16.1")).toEqual([]);
  });

  it("gives the panel's body and the release's own title", () => {
    const list = [
      release("v0.16.0", { name: "Vega v0.16.0", body: `${HEADER}### Security\n\nChecked.` }),
      release("v0.15.10", { name: "Vega v0.15.10 — A safety release" }),
      release("v0.15.9", { name: "v0.15.9" }),
    ];
    expect(notesBetween(list, "0.15.8", "0.16.0")).toEqual([
      { version: "0.16.0", title: null, body: "### Security\n\nChecked." },
      { version: "0.15.10", title: "A safety release", body: "### Changed in v0.15.10\n\nSomething." },
      { version: "0.15.9", title: null, body: "### Changed in v0.15.9\n\nSomething." },
    ]);
  });

  it("takes the title from the body's heading when the release name has none", () => {
    const list = [release("v0.15.6", {
      name: "Vega v0.15.6",
      body: "## Vega v0.15.6 — Your DMs reach your DM relays\n\n> **Windows note:** Unsigned.\n\n### Direct messages\n\nText.",
    })];
    expect(notesBetween(list, "0.15.5", "0.15.6")).toEqual([
      { version: "0.15.6", title: "Your DMs reach your DM relays", body: "### Direct messages\n\nText." },
    ]);
  });

  it("cuts a cumulative changelog down to the release's own section", () => {
    const body = `${HEADER}### v0.14.0 — Its own app identifier\n\nMoved.\n\n### v0.13.2 — Mute-aware search\n\nOlder.`;
    expect(notesBetween([release("v0.14.0", { body })], "0.13.2", "0.14.0")).toEqual([
      { version: "0.14.0", title: "Its own app identifier", body: "Moved." },
    ]);
  });

  it("gives an empty body while the release still carries the workflow's text for older versions", () => {
    const body = `${HEADER}### v0.14.0 — Its own app identifier\n\nMoved.`;
    expect(notesBetween([release("v0.16.1", { body })], "0.16.0", "0.16.1")).toEqual([
      { version: "0.16.1", title: null, body: "" },
    ]);
  });
});

describe("panelBody", () => {
  it("takes off the heading, the tagline and the Windows note", () => {
    expect(panelBody(`${HEADER}### Security\n\nChecked.\n`)).toBe("### Security\n\nChecked.");
  });

  it("keeps an opening paragraph that comes after the header", () => {
    expect(panelBody(`${HEADER}A large release.\n\n### Security\n\nChecked.`)).toBe("A large release.\n\n### Security\n\nChecked.");
  });

  it("keeps the first paragraph under the heading when no Windows note follows it", () => {
    const body = "## Vega v0.15.5 — Private relays\n\nSome relays keep your messages\nbehind a step.\n\n### Fixes\n\nFixed.";
    expect(panelBody(body)).toBe("Some relays keep your messages\nbehind a step.\n\n### Fixes\n\nFixed.");
  });

  it("keeps a blockquote that is not the Windows note", () => {
    const body = "## Vega v0.15.0\n\n> **Superseded by v0.15.1.**\n\n### What was new";
    expect(panelBody(body)).toBe("> **Superseded by v0.15.1.**\n\n### What was new");
  });

  it("strips nothing when the body does not start with the header", () => {
    const body = "## Fixes\n\nCross-platform Nostr desktop client.\n\n> **Windows note:** Unsigned.";
    expect(panelBody(body)).toBe(body);
  });

  it("reads Windows line endings", () => {
    expect(panelBody(HEADER.replace(/\n/g, "\r\n") + "### Security\r\n\r\nChecked.")).toBe("### Security\n\nChecked.");
  });

  it("gives the version's own section of a cumulative changelog, without its heading", () => {
    const body = `${HEADER}### v0.13.2 — Search\n\nNewer.\n\n### v0.13.1 — Reader\n\nOlder.`;
    expect(panelBody(body, "0.13.1")).toBe("Older.");
    expect(panelBody(body, "0.13.2")).toBe("Newer.");
    expect(panelBody(body, "0.16.0")).toBe("");
    expect(panelBody(body)).toBe("### v0.13.2 — Search\n\nNewer.\n\n### v0.13.1 — Reader\n\nOlder.");
  });
});

describe("fetchNotesSince", () => {
  beforeEach(() => { http.fetch.mockReset(); });
  afterEach(() => { vi.useRealTimers(); });

  const answer = (status: number, json: () => Promise<unknown>) => ({ ok: status >= 200 && status < 300, status, json });

  it("asks GitHub's API through the proxy helper and returns the notes in range", async () => {
    http.fetch.mockResolvedValue(answer(200, async () => [release("v0.16.1"), release("v0.16.0"), release("v0.15.10")]));
    const notes = await fetchNotesSince("0.15.10", "0.16.1");
    expect(notes?.map((n) => n.version)).toEqual(["0.16.1", "0.16.0"]);
    expect(http.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = http.fetch.mock.calls[0];
    expect(url).toBe(RELEASES_URL);
    expect(init.headers).toEqual({ Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" });
  });

  it("returns null when GitHub refuses (rate limit)", async () => {
    http.fetch.mockResolvedValue(answer(403, async () => ({ message: "API rate limit exceeded" })));
    await expect(fetchNotesSince("0.15.10", "0.16.1")).resolves.toBeNull();
  });

  it("returns null when GitHub does not answer in time", async () => {
    vi.useFakeTimers();
    http.fetch.mockReturnValue(new Promise(() => {}));
    const pending = fetchNotesSince("0.15.10", "0.16.1");
    await vi.advanceTimersByTimeAsync(8000);
    await expect(pending).resolves.toBeNull();
    const init = http.fetch.mock.calls[0][1] as { signal: AbortSignal };
    expect(init.signal.aborted).toBe(true);
  });

  it("returns null when the answer is not JSON", async () => {
    http.fetch.mockResolvedValue(answer(200, async () => { throw new SyntaxError("Unexpected token <"); }));
    await expect(fetchNotesSince("0.15.10", "0.16.1")).resolves.toBeNull();
  });

  it("returns null when the answer is not a list of releases", async () => {
    http.fetch.mockResolvedValue(answer(200, async () => ({ message: "Not Found" })));
    await expect(fetchNotesSince("0.15.10", "0.16.1")).resolves.toBeNull();
  });

  it("returns null when the request fails", async () => {
    http.fetch.mockRejectedValue(new Error("error sending request"));
    await expect(fetchNotesSince("0.15.10", "0.16.1")).resolves.toBeNull();
  });
});
