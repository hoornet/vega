import { describe, it, expect, vi, beforeEach } from "vitest";
import { nip19 } from "@nostr-dev-kit/ndk";

// A `nostr:` link handed over from outside: it waits for onboarding, an open dialog or unsent
// text holds it with a word, a newer link wins, and the toast says what became of it.

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

const opener = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("./nostrLinks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./nostrLinks")>();
  return { ...actual, openNostrReference: opener.open };
});

const PUBKEY = "7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e";
const ID = "b9f5441e45ca39179320e0031cfb18e34078673dcc3d3e3a3b3a981760aa5696";
const PROFILE_LINK = `nostr:${nip19.npubEncode(PUBKEY)}`;
const NOTE_LINK = `nostr:${nip19.noteEncode(ID)}`;

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// The module keeps whether onboarding is done; each test starts from a fresh copy.
async function load() {
  vi.resetModules();
  const launch = await import("./launchCommands");
  const { useToastStore } = await import("../stores/toast");
  const unsent = await import("./unsentText");
  return { ...launch, toasts: () => useToastStore.getState().toasts, holdUnsentText: unsent.holdUnsentText };
}

beforeEach(() => {
  opener.open.mockReset().mockResolvedValue({ status: "opened" });
  document.body.innerHTML = "";
});

describe("a nostr: link from outside", () => {
  it("waits for onboarding, then opens the newest link that arrived", async () => {
    const { openLinkFromOutside, launchCommandsReady } = await load();
    openLinkFromOutside(NOTE_LINK);
    openLinkFromOutside(PROFILE_LINK);
    expect(opener.open).not.toHaveBeenCalled();
    launchCommandsReady();
    expect(opener.open).toHaveBeenCalledTimes(1);
    expect(opener.open.mock.calls[0][0]).toEqual({ kind: "profile", pubkey: PUBKEY });
  });

  it("is run from the launch queue", async () => {
    const { runLaunchCommand, launchCommandsReady } = await load();
    launchCommandsReady();
    runLaunchCommand({ open: PROFILE_LINK });
    expect(opener.open).toHaveBeenCalledTimes(1);
  });

  it("is held by an open dialog, and says so", async () => {
    const { openLinkFromOutside, launchCommandsReady, toasts } = await load();
    launchCommandsReady();
    document.body.innerHTML = '<div role="dialog" aria-modal="true"></div>';
    openLinkFromOutside(NOTE_LINK);
    expect(opener.open).not.toHaveBeenCalled();
    expect(toasts().map((t) => t.message)).toEqual([
      "A dialog is open, so Vega didn't open the link. Close it, then open the link again.",
    ]);
  });

  it("is held by text not sent yet, and says so", async () => {
    const { openLinkFromOutside, launchCommandsReady, toasts, holdUnsentText } = await load();
    launchCommandsReady();
    const release = holdUnsentText("reply");
    openLinkFromOutside(NOTE_LINK);
    expect(opener.open).not.toHaveBeenCalled();
    expect(toasts().map((t) => t.message)).toEqual([
      "Your reply isn't sent yet, so Vega didn't open the link. Send or clear it first.",
    ]);
    release();
  });

  it("says when it cannot be read", async () => {
    const { openLinkFromOutside, launchCommandsReady, toasts } = await load();
    launchCommandsReady();
    openLinkFromOutside(`nostr:${nip19.naddrEncode({ kind: 30311, pubkey: PUBKEY, identifier: "live" })}`);
    expect(opener.open).not.toHaveBeenCalled();
    expect(toasts()[0]).toMatchObject({ type: "error", message: "Vega can't open that link. It opens links to people, notes and articles." });
  });

  it("says it is opening, and takes that back once it opened", async () => {
    let finish!: (outcome: unknown) => void;
    opener.open.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { openLinkFromOutside, launchCommandsReady, toasts } = await load();
    launchCommandsReady();
    openLinkFromOutside(NOTE_LINK);
    expect(toasts().map((t) => t.message)).toEqual(["Opening the link…"]);
    finish({ status: "opened" });
    await settle();
    expect(toasts()).toEqual([]);
  });

  it("says what was not found, and points at Relay reach when that kept the link's relays unasked", async () => {
    const { openLinkFromOutside, launchCommandsReady, toasts } = await load();
    launchCommandsReady();
    opener.open.mockResolvedValue({ status: "not-found", what: "note", hintsUnasked: true });
    openLinkFromOutside(NOTE_LINK);
    await settle();
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]).toMatchObject({
      type: "error",
      message: "Couldn't find that note on your relays. The link names other relays, which Vega asks only with Relay reach on.",
    });
    expect(toasts()[0].action?.label).toBe("Relays");

    opener.open.mockResolvedValue({ status: "not-found", what: "article", hintsUnasked: false });
    openLinkFromOutside(NOTE_LINK);
    await settle();
    expect(toasts()[0]).toMatchObject({ message: "Couldn't find that article on your relays." });
    expect(toasts()[0].action).toBeUndefined();
  });

  it("asks again before it moves: a reply begun while the link was loading holds it, and says so", async () => {
    let finish!: (outcome: unknown) => void;
    opener.open.mockImplementation((_reference: unknown, stillWanted: () => boolean) =>
      new Promise((resolve) => { finish = () => resolve(stillWanted() ? { status: "opened" } : { status: "superseded" }); }));
    const { openLinkFromOutside, launchCommandsReady, toasts, holdUnsentText } = await load();
    launchCommandsReady();
    openLinkFromOutside(NOTE_LINK);
    const stillWanted = opener.open.mock.calls[0][1] as () => boolean;
    expect(stillWanted()).toBe(true);
    const release = holdUnsentText("message");
    expect(stillWanted()).toBe(false);
    finish(undefined);
    await settle();
    expect(toasts().map((t) => t.message)).toEqual([
      "Your message isn't sent yet, so Vega didn't open the link. Send or clear it first.",
    ]);
    release();
  });

  it("asks again before it moves: a dialog opened while the link was loading holds it", async () => {
    opener.open.mockReturnValue(new Promise(() => {}));
    const { openLinkFromOutside, launchCommandsReady } = await load();
    launchCommandsReady();
    openLinkFromOutside(NOTE_LINK);
    const stillWanted = opener.open.mock.calls[0][1] as () => boolean;
    document.body.innerHTML = '<div role="dialog" aria-modal="true"></div>';
    expect(stillWanted()).toBe(false);
  });

  it("lets a newer link win over a lookup still running", async () => {
    const { openLinkFromOutside, launchCommandsReady } = await load();
    launchCommandsReady();
    opener.open.mockReturnValue(new Promise(() => {}));
    openLinkFromOutside(NOTE_LINK);
    const firstStillWanted = opener.open.mock.calls[0][1] as () => boolean;
    expect(firstStillWanted()).toBe(true);
    openLinkFromOutside(PROFILE_LINK);
    expect(firstStillWanted()).toBe(false);
    expect((opener.open.mock.calls[1][1] as () => boolean)()).toBe(true);
  });
});
