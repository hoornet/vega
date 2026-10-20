import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

const profiles = vi.hoisted(() => ({ byPubkey: {} as Record<string, unknown> }));
vi.mock("../../hooks/useProfile", () => ({ useProfile: (pubkey: string) => profiles.byPubkey[pubkey] ?? null }));
vi.mock("../../lib/nostr", () => ({ fetchNoteById: vi.fn(), fetchByAddr: vi.fn(), fetchArticle: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { MentionName, renderTextSegments } from "./TextSegments";
import { parseContent } from "../../lib/parsing";
import { nip19 } from "@nostr-dev-kit/ndk";

// The pair from the NIP-19 specification.
const HEX = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
const NPUB = "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6";
const text = (node: React.ReactNode) => render(<p>{node}</p>).container.textContent;

afterEach(() => { cleanup(); profiles.byPubkey = {}; });

// A mention reads as every other mention of that account does.
describe("MentionName", () => {
  it("is the account's name", () => {
    profiles.byPubkey[HEX] = { displayName: "Ana K.", name: "ana" };
    expect(text(<MentionName pubkey={HEX} fallback="unused" />)).toBe("Ana K.");
  });

  it("is the account's shortened public address when it has no name", () => {
    expect(text(<MentionName pubkey={HEX} fallback="unused" />)).toBe("npub180c…h6w6");
    profiles.byPubkey[HEX] = { name: "   " };
    cleanup();
    expect(text(<MentionName pubkey={HEX} fallback="unused" />)).toBe("npub180c…h6w6");
  });

  it("is what it was given for a mention that names no account", () => {
    expect(text(<MentionName fallback="event:abcdefgh…" />)).toBe("event:abcdefgh…");
  });
});

describe("a mention in a note", () => {
  const segments = parseContent(`ask nostr:${NPUB} about it`);
  const noop = () => {};

  it("is the name once it is known", () => {
    profiles.byPubkey[HEX] = { name: "ana" };
    expect(text(renderTextSegments(segments, noop, { resolveMentions: true }))).toBe("ask @ana about it");
  });

  it("is the shortened public address until then, with one ellipsis", () => {
    expect(text(renderTextSegments(segments, noop, { resolveMentions: true }))).toBe("ask @npub180c…h6w6 about it");
  });

  // An event reference that is not a note: shown as the parser wrote it, not cut again.
  it("shows a mention that names no account as it was given, once", () => {
    const nevent = nip19.neventEncode({ id: "ab".repeat(32), kind: 30023 });
    const text_ = text(renderTextSegments(parseContent(`see nostr:${nevent} now`), noop, { resolveMentions: true }));
    expect(text_).toMatch(/^see @event:[a-z0-9]{8}… now$/);
  });

  it("is the shortened public address where names are not looked up", () => {
    expect(text(renderTextSegments(segments, noop))).toBe("ask @npub180c…h6w6 about it");
  });
});
