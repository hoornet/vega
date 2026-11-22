import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { nip19 } from "@nostr-dev-kit/ndk";

// `@` in a box suggests people to mention, through the real compose box: follows first, the search
// relays for the rest, Enter or a click writes `nostr:npub1…`, and `@vega` stays the assistant's.

const ALICE = "a".repeat(64);
const ALBERT = "b".repeat(64);
const ZOE = "e".repeat(64);
const PROFILES: Record<string, { name: string; nip05?: string }> = {
  [ALICE]: { name: "alice", nip05: "alice@example.com" },
  [ALBERT]: { name: "albert" },
};

vi.mock("../../lib/nostr", () => ({ publishNote: vi.fn(), publishPoll: vi.fn(), fetchUserNotes: vi.fn(), fetchProfiles: vi.fn(async () => new Map()), searchUsers: vi.fn(async () => []) }));
vi.mock("../../lib/upload", () => ({ uploadImage: vi.fn(), uploadBytes: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: vi.fn() }));
vi.mock("../poll/PollCompose", () => ({ PollCompose: () => null }));
vi.mock("../shared/EmojiPicker", () => ({ EmojiPicker: () => null }));
vi.mock("../../hooks/useAutoResize", () => ({ useAutoResize: () => () => {} }));
const user = vi.hoisted(() => ({ profile: null, npub: "npub1me", pubkey: "f".repeat(64), follows: [] as string[] }));
vi.mock("../../stores/user", () => ({
  useUserStore: (pick?: (s: typeof user) => unknown) => (pick ? pick(user) : user),
  useCanSign: () => true,
}));
vi.mock("../../stores/feed", () => ({ useFeedStore: { getState: () => ({ notes: [] }), setState: () => {} } }));
vi.mock("../../hooks/useProfile", () => ({
  peekCachedProfile: vi.fn(async (pk: string) => PROFILES[pk] ?? undefined),
  primeProfileCache: vi.fn(),
  useProfile: (pk: string) => PROFILES[pk] ?? null,
}));

import { ComposeBox } from "./ComposeBox";
import { publishNote, searchUsers, fetchProfiles } from "../../lib/nostr";
import { primeProfileCache } from "../../hooks/useProfile";
import { useMuteStore } from "../../stores/mute";
import { forgetFollowProfiles } from "../../hooks/useMentions";
import { useAssistantStore } from "../../stores/assistant";
import { DEFAULT_ASSISTANT_SETTINGS } from "../../lib/assistant/settings";

const box = () => screen.getByPlaceholderText("What's on your mind?") as HTMLTextAreaElement;
/** Types text with the caret at its end, as a person would. */
const type = (text: string) => {
  fireEvent.focus(box());
  fireEvent.change(box(), { target: { value: text } });
  box().setSelectionRange(text.length, text.length);
  fireEvent.select(box());
};
const options = () => screen.queryAllByRole("option").map((o) => o.getAttribute("aria-label"));

beforeEach(() => {
  localStorage.clear();
  forgetFollowProfiles();
  user.follows = [ALICE, ALBERT];
  vi.mocked(publishNote).mockReset();
  vi.mocked(searchUsers).mockReset().mockResolvedValue([]);
  useAssistantStore.setState({ settings: { ...DEFAULT_ASSISTANT_SETTINGS } });
  useMuteStore.setState({ mutedPubkeys: [] });
  vi.mocked(fetchProfiles).mockReset().mockResolvedValue(new Map());
  vi.mocked(primeProfileCache).mockClear();
});
afterEach(cleanup);

describe("@ in the compose box", () => {
  it("suggests the people you follow, best match first", async () => {
    render(<ComposeBox />);
    type("thanks @al");
    await waitFor(() => expect(options()).toEqual(["albert", "alice, alice@example.com"]));
    expect(screen.getByRole("listbox", { name: "People to mention" })).toBeTruthy();
    expect(box().getAttribute("aria-expanded")).toBe("true");
  });

  it("Enter writes the mention instead of posting, and the box says who it mentions", async () => {
    render(<ComposeBox />);
    type("thanks @ali");
    await waitFor(() => expect(options()).toEqual(["alice, alice@example.com"]));
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(box().value).toBe(`thanks nostr:${nip19.npubEncode(ALICE)} `);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByText("Mentions:").textContent).toBe("Mentions: alice");
    expect(publishNote).not.toHaveBeenCalled();
  });

  it("arrow keys move, a click picks", async () => {
    render(<ComposeBox />);
    type("@al");
    await waitFor(() => expect(options()).toHaveLength(2));
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1].getAttribute("aria-selected")).toBe("true");
    expect(box().getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[1].id);
    fireEvent.click(screen.getAllByRole("option")[0]);
    expect(box().value).toBe(`nostr:${nip19.npubEncode(ALBERT)} `);
  });

  it("Escape closes the list and keeps the text", async () => {
    render(<ComposeBox />);
    type("hi @al");
    await waitFor(() => expect(options()).toHaveLength(2));
    fireEvent.keyDown(box(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(box().value).toBe("hi @al");
  });

  it("asks the search relays when the people you follow are not enough", async () => {
    vi.mocked(searchUsers).mockResolvedValue([{ pubkey: ZOE, content: JSON.stringify({ name: "zoe" }) }] as never);
    render(<ComposeBox />);
    type("hi @zo");
    await waitFor(() => expect(options()).toEqual(["zoe"]), { timeout: 2000 });
    expect(searchUsers).toHaveBeenCalledWith("zo", 10);
  });

  it("primes the cache with a search result's date, so an older copy cannot replace a newer profile", async () => {
    vi.mocked(searchUsers).mockResolvedValue([{ pubkey: ZOE, created_at: 123, content: JSON.stringify({ name: "zoe" }) }] as never);
    render(<ComposeBox />);
    type("hi @zo");
    await waitFor(() => expect(options()).toEqual(["zoe"]), { timeout: 2000 });
    expect(primeProfileCache).toHaveBeenCalledWith(ZOE, expect.objectContaining({ name: "zoe", created_at: 123 }));
  });

  it("never suggests someone you mute, followed or found", async () => {
    useMuteStore.setState({ mutedPubkeys: [ALICE, ZOE] });
    vi.mocked(searchUsers).mockResolvedValue([{ pubkey: ZOE, content: JSON.stringify({ name: "alzoe" }) }] as never);
    render(<ComposeBox />);
    type("thanks @al");
    await waitFor(() => expect(options()).toEqual(["albert"]));
    await new Promise((r) => setTimeout(r, 500));
    expect(options()).toEqual(["albert"]);
  });

  it("keeps the person highlighted when the list reorders under it", async () => {
    // A follow whose name arrives late, after search results are already on screen.
    const LATE = "c".repeat(64);
    user.follows = [LATE];
    let names: (m: Map<string, unknown>) => void = () => {};
    vi.mocked(fetchProfiles).mockImplementation(() => new Promise((r) => { names = r as never; }));
    vi.mocked(searchUsers).mockResolvedValue([
      { pubkey: ZOE, content: JSON.stringify({ name: "alfred" }) },
      { pubkey: ALBERT, content: JSON.stringify({ name: "alma" }) },
    ] as never);
    render(<ComposeBox />);
    type("@al");
    await waitFor(() => expect(options()).toEqual(["alfred", "alma"]), { timeout: 2000 });
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    await act(async () => { names(new Map([[LATE, { name: "alice" }]])); });
    await waitFor(() => expect(options()).toEqual(["alice", "alfred", "alma"]));
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(box().value).toBe(`nostr:${nip19.npubEncode(ALBERT)} `);
  });

  it("picks through the browser's edit, so Ctrl+Z takes it back", async () => {
    const exec = vi.fn(() => false);
    Object.defineProperty(document, "execCommand", { value: exec, configurable: true });
    try {
      render(<ComposeBox />);
      type("thanks @ali");
      await waitFor(() => expect(options()).toEqual(["alice, alice@example.com"]));
      fireEvent.keyDown(box(), { key: "Enter" });
      expect(exec).toHaveBeenCalledWith("insertText", false, `nostr:${nip19.npubEncode(ALICE)} `);
      expect(box().value).toBe(`thanks nostr:${nip19.npubEncode(ALICE)} `);
    } finally {
      delete (document as { execCommand?: unknown }).execCommand;
    }
  });

  it("asks again for names no relay returned, after a while", async () => {
    const LATE = "c".repeat(64);
    user.follows = [LATE];
    vi.mocked(fetchProfiles).mockRejectedValueOnce(new Error("offline"));
    const now = vi.spyOn(Date, "now");
    try {
      now.mockReturnValue(1_000_000);
      render(<ComposeBox />);
      type("@");
      await waitFor(() => expect(fetchProfiles).toHaveBeenCalledTimes(1));
      type("");
      type("@");
      await new Promise((r) => setTimeout(r, 20));
      expect(fetchProfiles).toHaveBeenCalledTimes(1); // not on every keystroke
      now.mockReturnValue(1_000_000 + 31_000);
      vi.mocked(fetchProfiles).mockResolvedValueOnce(new Map([[LATE, { name: "carl" }]]) as never);
      type("");
      type("@");
      await waitFor(() => expect(options()).toEqual(["carl"]));
      expect(fetchProfiles).toHaveBeenLastCalledWith([LATE]);
    } finally {
      now.mockRestore();
    }
  });

  it("@vega at the start stays the assistant's while it is on", async () => {
    useAssistantStore.setState({ settings: { ...DEFAULT_ASSISTANT_SETTINGS, enabled: true } });
    render(<ComposeBox />);
    type("@ve");
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("listbox")).toBeNull();
    type("hi @al");
    await waitFor(() => expect(options()).toHaveLength(2));
  });

  it("an email address suggests nobody", async () => {
    render(<ComposeBox />);
    type("write to jure@al");
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
