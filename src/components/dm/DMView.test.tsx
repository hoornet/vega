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
vi.mock("../../hooks/useProfile", () => ({ useProfile: () => null, peekCachedProfile: async () => undefined, primeProfileCache: () => {} }));
// One stable state object: a new one per call made the dialog's [follows] effect run on every render.
const user = vi.hoisted(() => ({ pubkey: "me", loggedIn: true, follows: ["alice"], followsStatus: "loaded" }));
vi.mock("../../stores/user", () => ({ useUserStore: Object.assign(<T,>(pick?: (s: typeof user) => T) => (pick ? pick(user) : user), { getState: () => user }) }));
vi.mock("../../stores/ui", () => ({ useUIStore: Object.assign(() => ({ openProfile: vi.fn(), pendingDMPubkey: null }), { setState: vi.fn(), getState: () => ({}) }) }));
vi.mock("../../stores/notifications", () => ({ useNotificationsStore: Object.assign(() => ({}), { getState: () => ({ markDMRead: vi.fn(), computeDMUnread: vi.fn() }) }) }));
vi.mock("../feed/TextSegments", () => ({ tryHandleUrlInternally: vi.fn(), tryOpenNostrEntity: vi.fn() }));

import { DMView } from "./DMView";

const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
const answerInbox = (events: unknown[] = []) => act(async () => { inbox.answer?.(events); await Promise.resolve(); await Promise.resolve(); });
beforeEach(() => { signer.has = true; inbox.answer = null; Element.prototype.scrollIntoView = vi.fn(); });
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
