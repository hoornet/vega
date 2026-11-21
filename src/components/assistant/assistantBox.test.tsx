import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";

// `@vega` in a box (CLAUDE.md, "The assistant"): it asks instead of posting, says what is sent
// where, streams the answer into a card, asks once before a cloud model, and never posts the
// question. Through the compose box, as the user meets it.

vi.mock("../../lib/nostr", () => ({ publishNote: vi.fn(), publishPoll: vi.fn(), fetchUserNotes: vi.fn() }));
vi.mock("../../lib/upload", () => ({ uploadImage: vi.fn(), uploadBytes: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: vi.fn() }));
vi.mock("../poll/PollCompose", () => ({ PollCompose: () => null }));
vi.mock("../shared/EmojiPicker", () => ({ EmojiPicker: () => null }));
vi.mock("../../hooks/useAutoResize", () => ({ useAutoResize: () => () => {} }));
vi.mock("../../stores/user", () => ({ useUserStore: () => ({ profile: null, npub: "npub1me" }), useCanSign: () => true }));
vi.mock("../../stores/feed", () => ({ useFeedStore: { getState: () => ({ notes: [] }), setState: () => {} } }));
vi.mock("../../hooks/useProfile", () => ({ peekCachedProfile: vi.fn(async (pk: string) => ({ name: pk === "alice" ? "Alice" : "Bob" })) }));
const client = vi.hoisted(() => ({ askAssistant: vi.fn() }));
vi.mock("../../lib/assistant/client", () => client);

import { ComposeBox } from "../feed/ComposeBox";
import { AssistantSourceProvider } from "./source";
import { forgetSessionConsent, agreedThisSessionTo } from "./useAssistantBox";
import { publishNote, fetchUserNotes } from "../../lib/nostr";
import { useAssistantStore } from "../../stores/assistant";
import { useMuteStore } from "../../stores/mute";
import { useUIStore } from "../../stores/ui";
import { setCurrentAccount } from "../../lib/currentAccount";
import { DEFAULT_ASSISTANT_SETTINGS } from "../../lib/assistant/settings";
import type { PackSource } from "../../lib/assistant/context";
import type { AskOptions } from "../../types/assistant";

const FEED: PackSource = {
  kind: "feed",
  notes: [
    { id: "n1", pubkey: "alice", createdAt: 1000, kind: 1, content: "Relays are like post offices." },
    { id: "n2", pubkey: "bob", createdAt: 1100, kind: 1, content: "a note from someone muted" },
  ],
};

/** The request in flight: stream pieces into it, finish it, or fail it. */
let asked: { options: AskOptions; finish: (text: string) => void; fail: (reason: string) => void; cancel: ReturnType<typeof vi.fn> } | null;

function stubAsk() {
  client.askAssistant.mockReset().mockImplementation((_provider, options: AskOptions) => {
    let resolve!: (t: string) => void;
    let reject!: (e: unknown) => void;
    const done = new Promise<string>((res, rej) => { resolve = res; reject = rej; });
    let streamed = "";
    const onText = options.onText;
    const cancel = vi.fn(() => resolve(streamed));
    asked = { options: { ...options, onText: (t) => { streamed += t; onText?.(t); } }, finish: resolve, fail: reject, cancel };
    return { done, cancel };
  });
}

const settings = (change = {}) =>
  useAssistantStore.setState({ settings: { ...DEFAULT_ASSISTANT_SETTINGS, enabled: true, model: { ollama: "llama3.2:3b" }, ...change } });
const box = () => screen.getByPlaceholderText("What's on your mind?") as HTMLTextAreaElement;
const type = (text: string) => { fireEvent.focus(box()); fireEvent.change(box(), { target: { value: text } }); };
const renderBox = () => render(<AssistantSourceProvider source={() => FEED}><ComposeBox /></AssistantSourceProvider>);
const askButton = () => screen.getByRole("button", { name: "Ask Vega" });

beforeEach(() => {
  localStorage.clear();
  asked = null;
  stubAsk();
  forgetSessionConsent();
  vi.mocked(publishNote).mockReset();
  vi.mocked(fetchUserNotes).mockReset().mockResolvedValue([]);
  useMuteStore.setState({ mutedPubkeys: [], mutedKeywords: [] });
  setCurrentAccount("me");
  settings();
});
afterEach(cleanup);

describe("@vega in a box", () => {
  it("a question is not kept as the compose draft", () => {
    vi.useFakeTimers();
    try {
      renderBox();
      type("@vega what is this?");
      act(() => { vi.advanceTimersByTime(1500); });
      expect(localStorage.getItem("wrystr_compose_draft")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("is ordinary text while the assistant is off", () => {
    settings({ enabled: false });
    renderBox();
    type("@vega what is this?");
    expect(screen.getByRole("button", { name: "Post" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ask Vega" })).toBeNull();
  });

  it("turns Post into Ask Vega and says what is sent where", () => {
    renderBox();
    type("@vega what is everyone talking about?");
    expect(askButton()).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Post" })).toBeNull();
    expect(screen.getByText("Your feed, 2 notes, stays on this computer (llama3.2:3b)")).toBeTruthy();
  });

  it("never posts the question, by button or by Ctrl+Enter", async () => {
    renderBox();
    type("@vega summarise");
    fireEvent.keyDown(box(), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(client.askAssistant).toHaveBeenCalledTimes(1));
    expect(publishNote).not.toHaveBeenCalled();
  });

  it("streams the answer into a card, and Use as draft puts it in the box without the @vega line", async () => {
    renderBox();
    type("@vega draft a reply");
    fireEvent.click(askButton());
    await waitFor(() => expect(asked).not.toBeNull());
    act(() => { asked!.options.onText!("Relays carry "); asked!.options.onText!("your notes."); });
    expect(await screen.findByText("Relays carry your notes.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    await act(async () => asked!.finish("Relays carry your notes."));
    fireEvent.click(await screen.findByRole("button", { name: "Use as draft" }));
    expect(box().value).toBe("Relays carry your notes.");
    expect(screen.queryByRole("region", { name: "Vega's answer" })).toBeNull();
    expect(screen.getByRole("button", { name: "Post" })).toBeTruthy();
  });

  it("sends the feed's notes as quoted data, with names, and leaves out the muted", async () => {
    useMuteStore.setState({ mutedPubkeys: ["bob"] });
    renderBox();
    type("@vega what is this about?");
    fireEvent.click(askButton());
    await waitFor(() => expect(asked).not.toBeNull());
    const sent = asked!.options.messages[0].content;
    expect(sent).toContain('author="Alice"');
    expect(sent).toContain("post offices");
    expect(sent).not.toContain("muted");
    expect(sent).toContain("The user asks: what is this about?");
    expect(asked!.options.system).toMatch(/not instructions/);
  });

  it("Stop keeps what arrived", async () => {
    renderBox();
    type("@vega explain");
    fireEvent.click(askButton());
    await waitFor(() => expect(asked).not.toBeNull());
    act(() => asked!.options.onText!("Half an answer"));
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
    expect(asked!.cancel).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Use as draft" })).toBeTruthy());
    expect(screen.getByText("Half an answer")).toBeTruthy();
    expect(screen.getByText("· stopped")).toBeTruthy();
  });

  it("emptying the box takes the answer away: there is no history", async () => {
    renderBox();
    type("@vega explain");
    fireEvent.click(askButton());
    await waitFor(() => expect(asked).not.toBeNull());
    await act(async () => asked!.finish("An answer"));
    expect(await screen.findByText("An answer")).toBeTruthy();
    type("");
    expect(screen.queryByText("An answer")).toBeNull();
  });

  it("a missing key says where to add one", async () => {
    settings({ preset: "claude" });
    useAssistantStore.getState().update({ trustedProviders: ["https://api.anthropic.com"] });
    renderBox();
    type("@vega hi");
    fireEvent.click(askButton());
    await waitFor(() => expect(asked).not.toBeNull());
    await act(async () => asked!.fail("No API key is saved for this provider. Add one in Settings → Assistant."));
    expect((await screen.findByRole("alert")).textContent).toMatch(/No API key/);
    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(useUIStore.getState().currentView).toBe("settings");
    expect(useUIStore.getState().pendingSettingsGroup).toBe("assistant");
  });

  it("no model: says so before anything is sent", async () => {
    settings({ model: {} });
    renderBox();
    type("@vega hi");
    fireEvent.click(askButton());
    expect((await screen.findByRole("alert")).textContent).toBe("Choose a model in Settings → Assistant.");
    expect(client.askAssistant).not.toHaveBeenCalled();
  });
});

describe("before a cloud model", () => {
  it("asks first, and Cancel sends nothing", async () => {
    settings({ preset: "claude" });
    renderBox();
    type("@vega what is this?");
    expect(screen.getByText("Your feed, 2 notes → Anthropic (claude-sonnet-5-5)")).toBeTruthy();
    fireEvent.click(askButton());
    expect(await screen.findByRole("dialog", { name: "Send to Anthropic?" })).toBeTruthy();
    expect(screen.getByText(/Your feed \(2 notes\) will be sent to Anthropic/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(client.askAssistant).not.toHaveBeenCalled();
  });

  it("asks once a session, and never again after Don't ask again", async () => {
    settings({ preset: "claude" });
    renderBox();
    type("@vega what is this?");
    fireEvent.click(askButton());
    fireEvent.click(await screen.findByLabelText("Don't ask again for Anthropic"));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(client.askAssistant).toHaveBeenCalledTimes(1));
    expect(useAssistantStore.getState().settings.trustedProviders).toEqual(["https://api.anthropic.com"]);

    await act(async () => asked!.finish("ok"));
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
    forgetSessionConsent();
    fireEvent.click(askButton());
    await waitFor(() => expect(client.askAssistant).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a model on this computer is never asked about", async () => {
    renderBox();
    type("@vega hi");
    fireEvent.click(askButton());
    await waitFor(() => expect(client.askAssistant).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("in my tone", () => {
  it("brings the user's own recent notes along, when that is switched on", async () => {
    vi.mocked(fetchUserNotes).mockResolvedValue([{ id: "m1", pubkey: "me", created_at: 900, kind: 1, content: "gm, shipping today" }] as never);
    renderBox();
    type("@vega draft a reply in my tone");
    expect(screen.getByText(/your recent notes, stays on this computer/)).toBeTruthy();
    fireEvent.click(askButton());
    await waitFor(() => expect(asked).not.toBeNull());
    expect(fetchUserNotes).toHaveBeenCalledWith("me", 30);
    expect(asked!.options.messages[0].content).toContain("gm, shipping today");
  });

  it("does not fetch them when that is switched off", async () => {
    settings({ useMyNotes: false });
    renderBox();
    type("@vega draft a reply in my tone");
    fireEvent.click(askButton());
    await waitFor(() => expect(asked).not.toBeNull());
    expect(fetchUserNotes).not.toHaveBeenCalled();
  });
});

describe("what the reviewers found", () => {
  it("Stop while the question is still being put together sends nothing", async () => {
    let notesArrive!: (v: never[]) => void;
    vi.mocked(fetchUserNotes).mockReturnValue(new Promise((r) => { notesArrive = r; }) as never);
    renderBox();
    type("@vega draft a reply in my tone");
    fireEvent.click(askButton());
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
    await act(async () => notesArrive([]));
    await new Promise((r) => setTimeout(r, 0));
    expect(client.askAssistant).not.toHaveBeenCalled();
    expect(screen.getByText("Stopped before anything arrived.")).toBeTruthy();
  });

  it("Send without Don't ask again is remembered for this session only, and Ask again forgets it", async () => {
    settings({ preset: "claude" });
    renderBox();
    type("@vega hi");
    fireEvent.click(askButton());
    fireEvent.click(await screen.findByRole("button", { name: "Send" }));
    await waitFor(() => expect(client.askAssistant).toHaveBeenCalled());
    expect(agreedThisSessionTo("https://api.anthropic.com")).toBe(true);
    expect(useAssistantStore.getState().settings.trustedProviders).toEqual([]);
    forgetSessionConsent();
    expect(agreedThisSessionTo("https://api.anthropic.com")).toBe(false);
  });
});

