import { describe, it, expect, vi, beforeEach } from "vitest";
import { nip19 } from "@nostr-dev-kit/ndk";

// What a `nostr:` link names, and what opening it does: a profile at once, a note or an article
// once a relay has it, hint relays only with Relay reach on, and nothing else.

const nostr = vi.hoisted(() => ({
  fetchLinkedEvent: vi.fn(),
  reach: true,
}));

vi.mock("./nostr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./nostr")>();
  return {
    ...actual,
    fetchLinkedEvent: nostr.fetchLinkedEvent,
    isOutboxRelaysEnabled: () => nostr.reach,
  };
});

import { readNostrReference, openNostrReference } from "./nostrLinks";
import { useUIStore } from "../stores/ui";

const PUBKEY = "7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e";
const ID = "b9f5441e45ca39179320e0031cfb18e34078673dcc3d3e3a3b3a981760aa5696";
const RELAY = "wss://relay.example.com";

beforeEach(() => {
  nostr.fetchLinkedEvent.mockReset();
  nostr.reach = true;
  useUIStore.setState({ currentView: "feed", viewStack: [], selectedPubkey: null, selectedNote: null });
});

describe("readNostrReference", () => {
  it("reads people, notes and articles, with or without nostr:", () => {
    expect(readNostrReference(nip19.npubEncode(PUBKEY))).toEqual({ kind: "profile", pubkey: PUBKEY });
    expect(readNostrReference(`nostr:${nip19.nprofileEncode({ pubkey: PUBKEY, relays: [RELAY] })}`))
      .toEqual({ kind: "profile", pubkey: PUBKEY });
    expect(readNostrReference(`nostr://${nip19.noteEncode(ID)}`)).toEqual({ kind: "note", id: ID, relays: [] });
    expect(readNostrReference(`NOSTR:${nip19.neventEncode({ id: ID, author: PUBKEY, relays: [RELAY] }).toUpperCase()}`))
      .toEqual({ kind: "note", id: ID, author: PUBKEY, relays: [RELAY] });
    const naddr = nip19.naddrEncode({ kind: 30023, pubkey: PUBKEY, identifier: "my-article", relays: [RELAY] });
    expect(readNostrReference(` nostr:${naddr} `))
      .toEqual({ kind: "article", pubkey: PUBKEY, identifier: "my-article", naddr, relays: [RELAY] });
  });

  it("does not open a secret key, a broken reference or an address that is not an article", () => {
    expect(readNostrReference(nip19.nsecEncode(new Uint8Array(32).fill(1)))).toBeNull();
    expect(readNostrReference(`nostr:${nip19.nsecEncode(new Uint8Array(32).fill(1))}`)).toBeNull();
    expect(readNostrReference(nip19.npubEncode(PUBKEY).slice(0, -1) + "q")).toBeNull();
    expect(readNostrReference(nip19.naddrEncode({ kind: 30311, pubkey: PUBKEY, identifier: "live" }))).toBeNull();
    expect(readNostrReference("hello")).toBeNull();
    expect(readNostrReference("")).toBeNull();
  });
});

function event(kind: number, encoded = "naddr1fromevent"): { kind: number; created_at: number; encode: () => string } {
  return { kind, created_at: 1, encode: () => encoded };
}

describe("openNostrReference", () => {
  it("opens a profile at once, without a lookup", async () => {
    expect(await openNostrReference({ kind: "profile", pubkey: PUBKEY })).toEqual({ status: "opened" });
    expect(useUIStore.getState().currentView).toBe("profile");
    expect(useUIStore.getState().selectedPubkey).toBe(PUBKEY);
    expect(nostr.fetchLinkedEvent).not.toHaveBeenCalled();
  });

  it("opens a note in its thread once a relay has it, asking by its author too", async () => {
    const note = event(1);
    nostr.fetchLinkedEvent.mockResolvedValue(note);
    const outcome = await openNostrReference({ kind: "note", id: ID, author: PUBKEY, relays: [RELAY] });
    expect(outcome).toEqual({ status: "opened" });
    expect(nostr.fetchLinkedEvent).toHaveBeenCalledWith({ ids: [ID], authors: [PUBKEY], limit: 1 }, [RELAY]);
    expect(useUIStore.getState().currentView).toBe("thread");
    expect(useUIStore.getState().selectedNote).toBe(note);
  });

  it("opens a note that turns out to be an article as an article", async () => {
    const article = event(30023, "naddr1encoded");
    nostr.fetchLinkedEvent.mockResolvedValue(article);
    await openNostrReference({ kind: "note", id: ID, relays: [] });
    expect(nostr.fetchLinkedEvent).toHaveBeenCalledWith({ ids: [ID], limit: 1 }, []);
    expect(useUIStore.getState().currentView).toBe("article");
    expect(useUIStore.getState().pendingArticleNaddr).toBe("naddr1encoded");
    expect(useUIStore.getState().pendingArticleEvent).toBe(article);
  });

  it("asks for an article by its address", async () => {
    const article = event(30023);
    nostr.fetchLinkedEvent.mockResolvedValue(article);
    await openNostrReference({ kind: "article", pubkey: PUBKEY, identifier: "my-article", naddr: "naddr1link", relays: [] });
    expect(nostr.fetchLinkedEvent).toHaveBeenCalledWith(
      { kinds: [30023], authors: [PUBKEY], "#d": ["my-article"], limit: 1 },
      [],
    );
    expect(useUIStore.getState().pendingArticleNaddr).toBe("naddr1link");
  });

  it("says not found, and whether Relay reach kept the link's relays unasked", async () => {
    nostr.fetchLinkedEvent.mockResolvedValue(null);
    nostr.reach = false;
    expect(await openNostrReference({ kind: "note", id: ID, relays: [RELAY] }))
      .toEqual({ status: "not-found", what: "note", hintsUnasked: true });
    // Only hints that could be asked count: a local relay never would be.
    expect(await openNostrReference({ kind: "note", id: ID, relays: ["ws://127.0.0.1:4869"] }))
      .toEqual({ status: "not-found", what: "note", hintsUnasked: false });
    nostr.reach = true;
    expect(await openNostrReference({ kind: "article", pubkey: PUBKEY, identifier: "x", naddr: "naddr1x", relays: [RELAY] }))
      .toEqual({ status: "not-found", what: "article", hintsUnasked: false });
    expect(useUIStore.getState().currentView).toBe("feed");
  });

  it("hands the lookup only the hints that may be asked", async () => {
    nostr.fetchLinkedEvent.mockResolvedValue(null);
    await openNostrReference({ kind: "note", id: ID, relays: ["ws://relay.example.com", "wss://localhost", RELAY] });
    expect(nostr.fetchLinkedEvent).toHaveBeenCalledWith({ ids: [ID], limit: 1 }, [RELAY]);
  });

  it("moves nothing once a newer request has come", async () => {
    nostr.fetchLinkedEvent.mockResolvedValue(event(1));
    expect(await openNostrReference({ kind: "note", id: ID, relays: [] }, () => false)).toEqual({ status: "superseded" });
    expect(await openNostrReference({ kind: "profile", pubkey: PUBKEY }, () => false)).toEqual({ status: "superseded" });
    expect(useUIStore.getState().currentView).toBe("feed");
  });
});
