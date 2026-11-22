import { describe, it, expect } from "vitest";
import type { NDKEvent } from "@nostr-dev-kit/ndk";
import { replySource } from "./source";
import type { PackSource } from "../../lib/assistant/context";

// What a reply box asks Vega about: the thread or profile around it, or the note alone.

const reply = { id: "r", pubkey: "bob", created_at: 5, kind: 1, content: "the note answered" } as unknown as NDKEvent;
const thread: PackSource = { kind: "thread", notes: [{ id: "root", pubkey: "alice", createdAt: 1, kind: 1, content: "root" }] };

describe("replySource", () => {
  it("in a thread, the thread with the note answered marked", () => {
    const got = replySource(() => thread, reply)();
    expect(got).toMatchObject({ kind: "thread", replyTo: { id: "r", content: "the note answered" } });
  });

  it("on a profile, the profile with the note answered marked", () => {
    const profile: PackSource = { kind: "profile", pubkey: "bob", about: "", nip05: "", notes: [] };
    expect(replySource(() => profile, reply)()).toMatchObject({ kind: "profile", replyTo: { id: "r" } });
  });

  it("in the feed or anywhere else, the note alone: not thirty notes nobody asked about", () => {
    const feed: PackSource = { kind: "feed", notes: thread.kind === "thread" ? thread.notes : [] };
    expect(replySource(() => feed, reply)()).toMatchObject({ kind: "note", note: { id: "r" } });
    expect(replySource(null, reply)()).toMatchObject({ kind: "note", note: { id: "r" } });
  });
});
