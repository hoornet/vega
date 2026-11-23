import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

// Where a conversation can be started from, after the October 2026 UI review:
// a "+" in the list's header and a button in the empty pane, both opening the
// New message dialog. The corner link that took "npub1… or hex pubkey" is gone.

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
const signer = vi.hoisted(() => ({ has: true }));
const inbox = vi.hoisted(() => ({ answer: null as null | ((events: unknown[]) => void) }));
vi.mock("../../lib/nostr", () => ({
  fetchDMConversations: vi.fn(() => new Promise<unknown[]>((resolve) => { inbox.answer = resolve; })), fetchDMThread: vi.fn(async () => []), sendDM: vi.fn(), decryptDM: vi.fn(),
  getNDK: () => ({ signer: signer.has ? {} : undefined }), ensureConnected: vi.fn(async () => true), isPoolSilent: () => false,
  fetchProfiles: vi.fn(async () => new Map()), resolveNip05: vi.fn(async () => null),
}));
const profiles = vi.hoisted(() => ({ byKey: {} as Record<string, { name?: string; picture?: string }> }));
vi.mock("../../hooks/useProfile", () => ({ useProfile: (pk: string) => profiles.byKey[pk] ?? null, peekCachedProfile: async () => undefined, primeProfileCache: () => {} }));
// One stable state object: a new one per call made the dialog's [follows] effect run on every render.
const user = vi.hoisted(() => ({ pubkey: "me", loggedIn: true, follows: ["alice"], followsStatus: "loaded" }));
vi.mock("../../stores/user", () => ({ useUserStore: Object.assign(<T,>(pick?: (s: typeof user) => T) => (pick ? pick(user) : user), { getState: () => user }) }));
vi.mock("../../stores/ui", () => ({ useUIStore: Object.assign(() => ({ openProfile: vi.fn(), pendingDMPubkey: null }), { setState: vi.fn(), getState: () => ({}) }) }));
const notif = vi.hoisted(() => ({ dmLastSeen: {}, markDMRead: vi.fn(), computeDMUnread: vi.fn() }));
vi.mock("../../stores/notifications", () => ({ useNotificationsStore: Object.assign(<T,>(pick?: (s: typeof notif) => T) => (pick ? pick(notif) : notif), { getState: () => notif }) }));
const mutes = vi.hoisted(() => ({ mutedPubkeys: [] as string[] }));
vi.mock("../../stores/mute", () => ({ useMuteStore: Object.assign(<T,>(pick: (s: typeof mutes) => T) => pick(mutes), { getState: () => mutes }) }));
vi.mock("../../lib/socialToasts", () => ({ setMuted: vi.fn() }));
vi.mock("../feed/TextSegments", () => ({ tryHandleUrlInternally: vi.fn(), tryOpenNostrEntity: vi.fn() }));

import { DMView } from "./DMView";
import { decryptDM, sendDM, fetchDMThread, ensureConnected } from "../../lib/nostr";
import { setMuted } from "../../lib/socialToasts";

const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
const answerInbox = (events: unknown[] = []) => act(async () => { inbox.answer?.(events); await Promise.resolve(); await Promise.resolve(); });
beforeEach(() => {
  signer.has = true; inbox.answer = null; Element.prototype.scrollIntoView = vi.fn();
  user.follows = ["alice"]; user.followsStatus = "loaded"; mutes.mutedPubkeys = [];
  notif.computeDMUnread.mockReset(); vi.mocked(setMuted).mockReset(); localStorage.clear(); profiles.byKey = {};
});
afterEach(cleanup);

describe("DMView: starting a conversation", () => {
  it("says it is loading, then that there are none, and opens the dialog from the pane and from the header", async () => {
    render(<DMView />);
    await settle();
    expect(screen.getByText("Loading your conversations…")).toBeTruthy();
    expect(screen.queryByText("No conversations yet.")).toBeNull();
    await answerInbox([]);
    expect(screen.getByText("No conversations yet.")).toBeTruthy();
    expect(screen.getByText(/Start one with someone you follow, or paste a public key/)).toBeTruthy();
    expect(screen.queryByText(/npub1… or hex pubkey/)).toBeNull();
    const entries = screen.getAllByRole("button", { name: "New message" });
    expect(entries).toHaveLength(2);
    fireEvent.click(entries[1]);
    expect(screen.getByRole("dialog", { name: "New message" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Who to message" }));
  });

  it("opens the conversation picked, with nothing in it yet, closes the dialog and puts focus in the message box", async () => {
    render(<DMView />);
    await settle();
    await answerInbox([]);
    fireEvent.click(screen.getAllByRole("button", { name: "New message" })[0]);
    fireEvent.change(screen.getByRole("combobox", { name: "Who to message" }), { target: { value: "a".repeat(64) } });
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Who to message" }), { key: "Enter" });
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("New conversation")).toBeTruthy();
    expect(screen.getByText(/Encrypted, only the two of you can read it/)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByPlaceholderText(/^Message /));
  });

  it("keeps a conversation started while the list was still loading", async () => {
    render(<DMView />);
    await settle();
    fireEvent.click(screen.getAllByRole("button", { name: "New message" })[0]);
    fireEvent.change(screen.getByRole("combobox", { name: "Who to message" }), { target: { value: "a".repeat(64) } });
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Who to message" }), { key: "Enter" });
    await settle();
    expect(screen.getByText("New conversation")).toBeTruthy();
    await answerInbox([{ id: "m1", kind: 4, pubkey: "b".repeat(64), created_at: 1000, content: "hi", tags: [["p", "me"]] }]);
    // Still the picked conversation, still in the list.
    expect(screen.getByText("New conversation")).toBeTruthy();
    expect(screen.getByPlaceholderText(/^Message /)).toBeTruthy();
  });

  it("offers no way to start a conversation to a read-only account", async () => {
    signer.has = false;
    render(<DMView />);
    await settle();
    expect(screen.getByText(/Direct messages require a private key login/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New message" })).toBeNull();
  });
});

// Message requests: a conversation with someone you do not follow and never wrote to is kept apart,
// collapsed, uncounted, never opened by itself; the nine identical shop links of November 2026.
describe("DMView: message requests", () => {
  const FRIEND = "a".repeat(64);
  const SPAM = "b".repeat(64);
  const PEN_PAL = "c".repeat(64);
  const msg = (id: string, from: string, to: string, at: number) => ({ id, kind: 4, pubkey: from, created_at: at, content: "x", tags: [["p", to]] });
  const rows = () => screen.queryAllByRole("button").map((b) => b.textContent ?? "");

  beforeEach(() => { user.pubkey = "me"; user.follows = [FRIEND]; vi.mocked(decryptDM).mockResolvedValue("hello"); });

  it("keeps a stranger's conversation in a collapsed group, opens your messages on a friend, and counts only those", async () => {
    render(<DMView />);
    await settle();
    // The stranger's message is the newest.
    await answerInbox([msg("s1", SPAM, "me", 3000), msg("f1", FRIEND, "me", 2000), msg("p1", PEN_PAL, "me", 1000), msg("p2", "me", PEN_PAL, 1500)]);
    const toggle = screen.getByRole("button", { name: /Message requests/ });
    expect(toggle.textContent).toContain("1");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // Two conversations in your messages (the friend, and the person you wrote to); the stranger is not listed.
    expect(rows().filter((t) => t.includes("NIP-04"))).toHaveLength(2);
    // Opened on the friend, not on the newer stranger.
    expect(screen.queryByText("Message request")).toBeNull();
    const counted = notif.computeDMUnread.mock.calls[notif.computeDMUnread.mock.calls.length - 1][0] as Array<{ partnerPubkey: string }>;
    expect(counted.map((c) => c.partnerPubkey).sort()).toEqual([FRIEND, PEN_PAL].sort());
    expect(JSON.parse(localStorage.getItem("wrystr_dm_inbox_me")!).sort()).toEqual([FRIEND, PEN_PAL].sort());

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(rows().filter((t) => t.includes("NIP-04"))).toHaveLength(3);
  });

  it("says what a request is, offers Mute, and does not load a stranger's pictures", async () => {
    vi.mocked(decryptDM).mockResolvedValue("look https://pics.example/a.png");
    vi.mocked(fetchDMThread).mockResolvedValueOnce([msg("s1", SPAM, "me", 3000)] as never);
    render(<DMView />);
    await settle();
    await answerInbox([msg("s1", SPAM, "me", 3000)]);
    fireEvent.click(screen.getByRole("button", { name: /Message requests/ }));
    fireEvent.click(rows().map((t, i) => [t, i] as const).filter(([t]) => t.includes("NIP-04")).map(([, i]) => screen.queryAllByRole("button")[i])[0]);
    await settle();
    expect(screen.getByText("Message request")).toBeTruthy();
    expect(screen.getByText(/Replying moves this to your messages/)).toBeTruthy();
    expect(document.querySelector('img[src="https://pics.example/a.png"]')).toBeNull();
    expect(screen.getByRole("link", { name: "https://pics.example/a.png" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(setMuted).toHaveBeenCalledWith(SPAM, expect.any(String), true);
  });

  it("moves a request to your messages once you answer it", async () => {
    vi.mocked(sendDM).mockResolvedValue(undefined as never);
    render(<DMView />);
    await settle();
    await answerInbox([msg("s1", SPAM, "me", 3000)]);
    fireEvent.click(screen.getByRole("button", { name: /Message requests/ }));
    fireEvent.click(screen.queryAllByRole("button").find((b) => b.textContent?.includes("NIP-04"))!);
    await settle();
    fireEvent.change(screen.getByPlaceholderText(/^Message /), { target: { value: "hi, who are you?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await settle();
    expect(screen.queryByRole("button", { name: /Message requests/ })).toBeNull();
    expect(screen.queryByText("Message request")).toBeNull();
    // Answered, it can still be muted, from the conversation's bar.
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(setMuted).toHaveBeenCalledWith(SPAM, expect.any(String), true);
  });

  it("leaves muted people out, and sorts nobody out while the follow list has not loaded", async () => {
    mutes.mutedPubkeys = [PEN_PAL];
    user.followsStatus = "loading";
    render(<DMView />);
    await settle();
    await answerInbox([msg("s1", SPAM, "me", 3000), msg("p1", PEN_PAL, "me", 1000)]);
    expect(screen.queryByRole("button", { name: /Message requests/ })).toBeNull();
    expect(rows().filter((t) => t.includes("NIP-04"))).toHaveLength(1);
    // Nothing is remembered for the poller from a list that could not be judged.
    expect(localStorage.getItem("wrystr_dm_inbox_me")).toBeNull();
  });

  it("keeps a conversation you answered as yours when your reply is outside what was loaded", async () => {
    localStorage.setItem("wrystr_dm_answered_me", JSON.stringify([SPAM]));
    render(<DMView />);
    await settle();
    await answerInbox([msg("s1", SPAM, "me", 3000)]);
    expect(screen.queryByRole("button", { name: /Message requests/ })).toBeNull();
  });

  it("records who you answered: from what was loaded, and from a send that ends after Messages has gone", async () => {
    let finish: () => void = () => {};
    vi.mocked(sendDM).mockImplementation(() => new Promise<never>((resolve) => { finish = () => resolve(undefined as never); }));
    profiles.byKey = { [SPAM]: { name: "shop" } };
    const view = render(<DMView />);
    await settle();
    await answerInbox([msg("p1", PEN_PAL, "me", 1000), msg("p2", "me", PEN_PAL, 1500), msg("s1", SPAM, "me", 3000)]);
    expect(JSON.parse(localStorage.getItem("wrystr_dm_answered_me")!)).toEqual([PEN_PAL]);
    fireEvent.click(screen.getByRole("button", { name: /Message requests/ }));
    fireEvent.click(screen.getByTitle("shop").closest("button")!);
    await settle();
    fireEvent.change(screen.getByPlaceholderText(/^Message /), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    view.unmount();
    await act(async () => { finish(); });
    expect(JSON.parse(localStorage.getItem("wrystr_dm_answered_me")!).sort()).toEqual([PEN_PAL, SPAM].sort());
  });

  it("does not load a stranger's avatar, in the list or the conversation's bar", async () => {
    profiles.byKey = { [SPAM]: { name: "shop", picture: "https://track.example/me.png" }, [FRIEND]: { name: "friend", picture: "https://pics.example/friend.png" } };
    render(<DMView />);
    await settle();
    await answerInbox([msg("s1", SPAM, "me", 3000), msg("f1", FRIEND, "me", 2000)]);
    fireEvent.click(screen.getByRole("button", { name: /Message requests/ }));
    fireEvent.click(screen.getByTitle("shop").closest("button")!);
    await settle();
    expect(screen.getByText("Message request")).toBeTruthy();
    expect(document.querySelector('img[src="https://track.example/me.png"]')).toBeNull();
    expect(document.querySelector('img[src="https://pics.example/friend.png"]')).toBeTruthy();
  });

  it("clears the badge after a load that found nothing, and leaves it after one that failed", async () => {
    render(<DMView />);
    await settle();
    await answerInbox([]);
    expect(notif.computeDMUnread).toHaveBeenLastCalledWith([]);
    cleanup();
    notif.computeDMUnread.mockReset();
    vi.mocked(ensureConnected).mockResolvedValueOnce(false);
    render(<DMView />);
    await settle();
    expect(screen.getAllByText(/could not be loaded|Couldn't reach/).length).toBeGreaterThan(0);
    expect(notif.computeDMUnread).not.toHaveBeenCalled();
  });
});
