import { describe, it, expect, beforeEach } from "vitest";
import { isRequest, rememberInbox, mayAnnounce } from "./messageRequests";

const ME = "f".repeat(64);
const FRIEND = "a".repeat(64);
const STRANGER = "b".repeat(64);
const PEN_PAL = "c".repeat(64);

describe("isRequest", () => {
  const follows = new Set([FRIEND]);

  it("is a stranger who wrote to you and got no answer", () => {
    expect(isRequest({ partner: STRANGER, senders: [STRANGER, STRANGER] }, ME, follows, true)).toBe(true);
  });

  it("is not someone you follow, or someone you wrote to", () => {
    expect(isRequest({ partner: FRIEND, senders: [FRIEND] }, ME, follows, true)).toBe(false);
    expect(isRequest({ partner: PEN_PAL, senders: [PEN_PAL, ME] }, ME, follows, true)).toBe(false);
  });

  it("is never decided while the follow list has not loaded, or for a conversation you just started", () => {
    expect(isRequest({ partner: STRANGER, senders: [STRANGER] }, ME, new Set(), false)).toBe(false);
    expect(isRequest({ partner: STRANGER, senders: [] }, ME, follows, true)).toBe(false);
  });
});

describe("mayAnnounce", () => {
  const cacheFollows = (pubkeys: string[]) =>
    localStorage.setItem(`wrystr_contact_list_${ME}`, JSON.stringify({ tags: pubkeys.map((p) => ["p", p]), content: "", createdAt: 1 }));

  beforeEach(() => localStorage.clear());

  it("announces everyone until Messages has sorted the conversations once, or with no follow list cached", () => {
    cacheFollows([FRIEND]);
    expect(mayAnnounce(ME, STRANGER)).toBe(true);
    localStorage.clear();
    rememberInbox(ME, [PEN_PAL]);
    expect(mayAnnounce(ME, STRANGER)).toBe(true);
  });

  it("then announces people you follow and people in your messages, and not strangers", () => {
    cacheFollows([FRIEND]);
    rememberInbox(ME, [PEN_PAL]);
    expect(mayAnnounce(ME, FRIEND)).toBe(true);
    expect(mayAnnounce(ME, PEN_PAL)).toBe(true);
    expect(mayAnnounce(ME, STRANGER)).toBe(false);
  });

  it("reads a broken record as not knowing", () => {
    cacheFollows([FRIEND]);
    localStorage.setItem(`wrystr_dm_inbox_${ME}`, "{not json");
    expect(mayAnnounce(ME, STRANGER)).toBe(true);
  });
});
