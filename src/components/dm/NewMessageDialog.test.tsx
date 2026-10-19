import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { nip19 } from "@nostr-dev-kit/ndk";

const user = vi.hoisted(() => ({ follows: ["alice", "bob", "carol"], followsStatus: "loaded" as "idle" | "loading" | "loaded" | "unknown", pubkey: "me" }));
vi.mock("../../stores/user", () => ({ useUserStore: <T,>(pick: (s: typeof user) => T) => pick(user) }));
const lookup = vi.hoisted(() => ({ resolve: null as null | ((v: string | null) => void) }));
vi.mock("../../lib/nostr", () => ({
  fetchProfiles: vi.fn(async () => new Map([["alice", { name: "Alice", nip05: "alice@example.com" }], ["bob", { displayName: "Bob the Builder" }], ["carol", { name: "carol.smith" }]])),
  resolveNip05: vi.fn((id: string) => new Promise<string | null>((resolve) => { lookup.resolve = (v) => resolve(v ?? (id === "dave@example.com" ? "d".repeat(64) : null)); })),
}));
vi.mock("../../hooks/useProfile", () => ({ peekCachedProfile: async () => undefined, primeProfileCache: () => {} }));

import { NewMessageDialog, readKey } from "./NewMessageDialog";
import { resolveNip05 } from "../../lib/nostr";

const onPick = vi.fn();
const onClose = vi.fn();
const field = () => screen.getByRole("combobox", { name: "Who to message" });
// The name and the NIP-05 under it; not the avatar's initial.
const names = () => screen.queryAllByRole("option").map((o) => [...o.querySelectorAll("span.block")].map((s) => s.textContent).join(" ") || o.querySelector("span.truncate")?.textContent?.trim());
const selected = () => { const o = screen.queryAllByRole("option").find((o) => o.getAttribute("aria-selected") === "true"); return o ? ([...o.querySelectorAll("span.block")].map((s) => s.textContent).join(" ") || o.querySelector("span.truncate")?.textContent?.trim()) : undefined; };
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
const answerLookup = (v?: string | null) => act(async () => { lookup.resolve?.(v ?? null); await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => { onPick.mockReset(); onClose.mockReset(); vi.mocked(resolveNip05).mockClear(); lookup.resolve = null; user.follows = ["alice", "bob", "carol"]; user.followsStatus = "loaded"; });
afterEach(cleanup);

describe("NewMessageDialog", () => {
  it("lists the people you follow by name, newest first, and filters as you type", async () => {
    render(<NewMessageDialog onClose={onClose} onPick={onPick} />);
    await settle();
    expect(names()).toEqual(["carol.smith", "Bob the Builder", "Alice alice@example.com"]);
    fireEvent.change(field(), { target: { value: "bob" } });
    expect(names()).toEqual(["Bob the Builder"]);
  });

  it("Enter picks the highlighted person; the arrow keys move the highlight; the pointer picks", async () => {
    render(<NewMessageDialog onClose={onClose} onPick={onPick} />);
    await settle();
    expect(selected()).toContain("carol.smith");
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith("bob");
    fireEvent.click(screen.getByText("Alice"));
    expect(onPick).toHaveBeenLastCalledWith("alice");
  });

  it("picks a highlighted person whose name has a dot or an @ in it, and only looks up when asked to", async () => {
    render(<NewMessageDialog onClose={onClose} onPick={onPick} />);
    await settle();
    fireEvent.change(field(), { target: { value: "carol.smith" } });
    expect(names()).toEqual(["carol.smith", "Look up carol.smith"]);
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith("carol");
    expect(resolveNip05).not.toHaveBeenCalled();
    fireEvent.change(field(), { target: { value: "example.com" } });
    expect(names()).toEqual(["Alice alice@example.com", "Look up example.com"]);
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(selected()).toBe("Look up example.com");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(resolveNip05).toHaveBeenCalledWith("example.com");
  });

  it("takes a public key in either form, with the prefix it was copied with", async () => {
    render(<NewMessageDialog onClose={onClose} onPick={onPick} />);
    await settle();
    fireEvent.change(field(), { target: { value: `nostr:${nip19.npubEncode("a".repeat(64))}` } });
    expect(names()).toEqual([]);
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith("a".repeat(64));
    fireEvent.change(field(), { target: { value: "B".repeat(64) } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(onPick).toHaveBeenLastCalledWith("b".repeat(64));
  });

  it("says what went wrong in a sentence, and never echoes a secret key", async () => {
    render(<NewMessageDialog onClose={onClose} onPick={onPick} />);
    await settle();
    fireEvent.change(field(), { target: { value: "npub1notakey" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toBe("That is not a whole public key. Check that all of it was copied.");
    expect(field().getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id);
    fireEvent.change(field(), { target: { value: "zebra" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toContain('No one you follow is called "zebra"');
    fireEvent.change(field(), { target: { value: "nsec1" + "q".repeat(58) } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toContain("secret key");
    expect(screen.getByRole("alert").textContent).not.toContain("qqqq");
    fireEvent.change(field(), { target: { value: "me" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onPick).not.toHaveBeenCalled();
  });

  it("looks up a name@domain address; says when nobody is there; drops a result the user did not wait for", async () => {
    const { unmount } = render(<NewMessageDialog onClose={onClose} onPick={onPick} />);
    await settle();
    fireEvent.change(field(), { target: { value: "dave@example.com" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(screen.getByRole("button", { name: /Looking up/ })).toBeTruthy();
    await answerLookup();
    expect(resolveNip05).toHaveBeenCalledWith("dave@example.com");
    expect(onPick).toHaveBeenCalledWith("d".repeat(64));
    fireEvent.change(field(), { target: { value: "nobody@example.com" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    await answerLookup();
    expect(screen.getByRole("alert").textContent).toBe("No one found at nobody@example.com.");
    // A lookup still on its way when the dialog closes opens nothing.
    onPick.mockClear();
    fireEvent.change(field(), { target: { value: "dave@example.com" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    unmount();
    await answerLookup();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("tells someone who follows nobody what to paste, and says so truthfully while the list loads", async () => {
    user.follows = [];
    user.followsStatus = "loading";
    const { unmount } = render(<NewMessageDialog onClose={onClose} onPick={onPick} />);
    await settle();
    expect(screen.getByText(/Loading the people you follow/)).toBeTruthy();
    unmount();
    user.followsStatus = "unknown";
    render(<NewMessageDialog onClose={onClose} onPick={onPick} />);
    await settle();
    expect(screen.getByText(/could not be loaded/)).toBeTruthy();
    cleanup();
    user.followsStatus = "loaded";
    render(<NewMessageDialog onClose={onClose} onPick={onPick} />);
    await settle();
    expect(screen.getByText(/You follow nobody yet/)).toBeTruthy();
  });
});

describe("readKey", () => {
  it("reads hex, npub, nprofile, prefixed keys, NIP-05 and bare domains, warns on nsec, and nothing else", () => {
    expect(readKey("")).toBeNull();
    expect(readKey("A".repeat(64))).toEqual({ pubkey: "a".repeat(64) });
    expect(readKey(nip19.npubEncode("c".repeat(64)))).toEqual({ pubkey: "c".repeat(64) });
    expect(readKey(`nostr:${nip19.npubEncode("c".repeat(64))}`)).toEqual({ pubkey: "c".repeat(64) });
    expect(readKey(`https://njump.me/${nip19.npubEncode("c".repeat(64))}`)).toEqual({ pubkey: "c".repeat(64) });
    expect(readKey(nip19.nprofileEncode({ pubkey: "c".repeat(64) }))).toEqual({ pubkey: "c".repeat(64) });
    expect(readKey("npub1oops")).toEqual({ error: "That is not a whole public key. Check that all of it was copied." });
    expect(readKey("nsec1" + "q".repeat(58))).toEqual({ error: "That is a secret key. Never paste it here: a public key starts with npub1." });
    expect(readKey("alice@example.com")).toEqual({ lookup: "alice@example.com" });
    expect(readKey("example.com")).toEqual({ lookup: "example.com" });
    expect(readKey("alice")).toBeNull();
  });
});
