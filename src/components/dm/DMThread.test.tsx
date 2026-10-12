import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import type { NDKEvent } from "@nostr-dev-kit/ndk";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("../../lib/nostr", () => ({
  fetchDMConversations: vi.fn(),
  fetchDMThread: vi.fn(),
  sendDM: vi.fn(),
  decryptDM: vi.fn(async (event: { content: string }) => event.content),
  getNDK: vi.fn(),
  ensureConnected: vi.fn(),
  isPoolSilent: vi.fn(() => false),
}));
vi.mock("../../hooks/useProfile", () => ({ useProfile: (pubkey: string) => ({ name: pubkey.startsWith("33") ? "Chico" : "Zeppo" }) }));
vi.mock("../../stores/user", () => ({ useUserStore: () => ({ pubkey: "me", loggedIn: true }) }));
vi.mock("../../stores/ui", () => ({ useUIStore: Object.assign(() => ({ openProfile: vi.fn(), pendingDMPubkey: null }), { setState: vi.fn() }) }));
vi.mock("../../stores/notifications", () => ({ useNotificationsStore: Object.assign(() => ({}), { getState: () => ({ markDMRead: vi.fn(), computeDMUnread: vi.fn() }) }) }));
vi.mock("../feed/TextSegments", () => ({ tryHandleUrlInternally: vi.fn(), tryOpenNostrEntity: vi.fn() }));

import { DMView, ThreadPanel } from "./DMView";
import { fetchDMConversations, fetchDMThread, sendDM, getNDK, ensureConnected } from "../../lib/nostr";

const ME = "me";
const ZEPPO = "22".repeat(32);
const CHICO = "33".repeat(32);
const message = (id: string, content: string, pubkey = ME) => ({ id, pubkey, content, created_at: 1760000000, tags: [["p", ZEPPO]] }) as unknown as NDKEvent;
const box = (name = "Zeppo") => screen.getByPlaceholderText(`Message ${name}…`) as HTMLTextAreaElement;
const send = () => screen.getByRole("button", { name: "Send" });
const NO_RELAYS = new Error("Not enough relays received the event (0 published, 1 required)");
const loaded = () => waitFor(() => expect(screen.queryByText("Loading messages…")).toBeNull());
/** A read of the thread that comes back when told to. */
function heldRead() {
  let answer: (messages: NDKEvent[]) => void = () => {};
  let fail: (err: Error) => void = () => {};
  vi.mocked(fetchDMThread).mockImplementationOnce(() => new Promise((resolve, reject) => { answer = resolve; fail = reject; }));
  return { answer: (messages: NDKEvent[]) => answer(messages), fail: (err: Error) => fail(err) };
}
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });

beforeEach(() => {
  vi.mocked(fetchDMThread).mockReset().mockResolvedValue([]);
  vi.mocked(sendDM).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(getNDK).mockReturnValue({ signer: {} } as never);
  vi.mocked(ensureConnected).mockResolvedValue(true);
  vi.mocked(fetchDMConversations).mockReset().mockResolvedValue([]);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe("Messages: sending", () => {
  it("empties the box and shows the thread with the message in it", async () => {
    render(<ThreadPanel partnerPubkey={ZEPPO} myPubkey={ME} />);
    await loaded();
    vi.mocked(fetchDMThread).mockResolvedValueOnce([message("m1", "hello Zeppo")]);
    type("hello Zeppo");
    fireEvent.click(send());
    expect(await screen.findByText("hello Zeppo")).toBeTruthy();
    expect(sendDM).toHaveBeenCalledWith(ZEPPO, "hello Zeppo");
    expect(box().value).toBe("");
  });

  it("keeps the message in the box and says why when it could not be sent", async () => {
    vi.mocked(sendDM).mockRejectedValue(NO_RELAYS);
    render(<ThreadPanel partnerPubkey={ZEPPO} myPubkey={ME} />);
    await loaded();
    type("hello Zeppo");
    fireEvent.click(send());
    expect(await screen.findByText("Couldn't send: none of your relays accepted it. Your message is still in the box. Check your relays and try again.")).toBeTruthy();
    expect(box().value).toBe("hello Zeppo");
    expect(fetchDMThread).toHaveBeenCalledTimes(1); // the load: nothing went out, so there is nothing new to read
  });

  // The message was out and the box was empty. A failed re-read of the thread
  // then said "Couldn't send… still in the box", and the message was sent again.
  it("does not say a message failed when it went out and only the re-read failed", async () => {
    render(<ThreadPanel partnerPubkey={ZEPPO} myPubkey={ME} />);
    await loaded();
    vi.mocked(fetchDMThread).mockRejectedValueOnce(new Error("relays timed out"));
    type("hello Zeppo");
    fireEvent.click(send());
    await waitFor(() => expect(fetchDMThread).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(screen.queryByText(/Couldn't send/)).toBeNull();
    expect(box().value).toBe("");
    expect(sendDM).toHaveBeenCalledTimes(1);
  });

  it("clears an earlier failure when the next try goes out", async () => {
    vi.mocked(sendDM).mockRejectedValueOnce(NO_RELAYS);
    render(<ThreadPanel partnerPubkey={ZEPPO} myPubkey={ME} />);
    await loaded();
    type("hello Zeppo");
    fireEvent.click(send());
    expect(await screen.findByText(/Couldn't send/)).toBeTruthy();
    fireEvent.click(send());
    await waitFor(() => expect(box().value).toBe(""));
    expect(screen.queryByText(/Couldn't send/)).toBeNull();
  });

  it("sends once for two quick presses", async () => {
    let finish: () => void = () => {};
    vi.mocked(sendDM).mockImplementation(() => new Promise<never>((resolve) => { finish = () => resolve(undefined as never); }));
    render(<ThreadPanel partnerPubkey={ZEPPO} myPubkey={ME} />);
    await loaded();
    type("hello Zeppo");
    fireEvent.click(send());
    fireEvent.click(send());
    expect(sendDM).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
  });
});

describe("Messages: which read of the thread counts", () => {
  // The box is free while the thread is re-read, so a second message can
  // overtake the first one's read. The older read then came back last and
  // took the second message off the screen.
  it("does not let an older re-read replace a newer one", async () => {
    render(<ThreadPanel partnerPubkey={ZEPPO} myPubkey={ME} />);
    await loaded();
    const first = heldRead();
    type("one");
    fireEvent.click(send());
    await waitFor(() => expect(box().value).toBe(""));
    const second = heldRead();
    type("two");
    fireEvent.click(send());
    await waitFor(() => expect(fetchDMThread).toHaveBeenCalledTimes(3));

    await act(async () => { second.answer([message("m1", "one"), message("m2", "two")]); });
    expect(screen.getByText("two")).toBeTruthy();
    await act(async () => { first.answer([message("m1", "one")]); });
    expect(screen.getByText("two")).toBeTruthy();
  });

  // The box is free during the first load too. A message sent then is
  // re-read at once, and "Loading messages…" followed only the first load:
  // overtaken, it stayed above the messages for good.
  it("stops saying it is loading when a send's re-read overtakes the first load", async () => {
    const first = heldRead();
    render(<ThreadPanel partnerPubkey={ZEPPO} myPubkey={ME} />);
    expect(screen.getByText("Loading messages…")).toBeTruthy();
    const reread = heldRead();
    type("ok");
    fireEvent.click(send());
    await waitFor(() => expect(fetchDMThread).toHaveBeenCalledTimes(2));

    await act(async () => { reread.answer([message("m0", "earlier"), message("m1", "ok")]); });
    expect(screen.queryByText("Loading messages…")).toBeNull();
    expect(screen.getByText("ok")).toBeTruthy();
    // The first load comes back last, without the new message: it must not take it off the screen.
    await act(async () => { first.answer([message("m0", "earlier")]); });
    expect(screen.getByText("ok")).toBeTruthy();
    expect(screen.queryByText("Loading messages…")).toBeNull();
  });

  // The re-read failed, the first load is still on its way and has the messages.
  it("goes on loading while a read that could still be shown is on its way, and shows it", async () => {
    const first = heldRead();
    render(<ThreadPanel partnerPubkey={ZEPPO} myPubkey={ME} />);
    const reread = heldRead();
    type("ok");
    fireEvent.click(send());
    await waitFor(() => expect(fetchDMThread).toHaveBeenCalledTimes(2));

    await act(async () => { reread.fail(new Error("timed out")); });
    expect(screen.getByText("Loading messages…")).toBeTruthy();
    expect(screen.queryByText("No messages yet. Say hello!")).toBeNull();
    await act(async () => { first.answer([message("m0", "earlier")]); });
    expect(screen.getByText("earlier")).toBeTruthy();
    expect(screen.queryByText("Loading messages…")).toBeNull();
  });

  it("stops saying it is loading when every read has failed", async () => {
    const first = heldRead();
    render(<ThreadPanel partnerPubkey={ZEPPO} myPubkey={ME} />);
    await act(async () => { first.fail(new Error("timed out")); });
    expect(screen.queryByText("Loading messages…")).toBeNull();
  });
});

// One panel for every conversation kept what was typed for one person in the
// box for the next, and let a send that finished after a switch put the old
// conversation's messages under the new one's name.
describe("Messages: each conversation is its own", () => {
  const conversations = () => [
    { ...message("z0", "from Zeppo", ZEPPO), tags: [["p", ME]], created_at: 1760000200 },
    { ...message("c0", "from Chico", CHICO), tags: [["p", ME]], created_at: 1760000100 },
  ] as unknown as NDKEvent[];
  const row = (name: string) => screen.getByTitle(name).closest("button") as HTMLElement;
  const open = async () => {
    vi.mocked(fetchDMConversations).mockResolvedValue(conversations());
    vi.mocked(fetchDMThread).mockImplementation(async (_me: string, partner: string) => [message(`t-${partner.slice(0, 2)}`, partner === ZEPPO ? "hello Zeppo" : "hello Chico")]);
    render(<DMView />);
    await screen.findByText("hello Zeppo"); // the newest conversation is opened
  };

  it("does not carry what was typed for one person into the box for the next", async () => {
    await open();
    fireEvent.change(box("Zeppo"), { target: { value: "only for Zeppo" } });
    fireEvent.click(row("Chico"));
    await screen.findByText("hello Chico");
    expect(box("Chico").value).toBe("");
  });

  it("does not put one conversation's messages under the other's name when a send finishes after the switch", async () => {
    await open();
    let finish: () => void = () => {};
    vi.mocked(sendDM).mockImplementation(() => new Promise<never>((resolve) => { finish = () => resolve(undefined as never); }));
    fireEvent.change(box("Zeppo"), { target: { value: "for Zeppo" } });
    fireEvent.click(send());
    expect(sendDM).toHaveBeenCalledWith(ZEPPO, "for Zeppo");

    fireEvent.click(row("Chico"));
    await screen.findByText("hello Chico");
    fireEvent.change(box("Chico"), { target: { value: "a draft for Chico" } });
    // Zeppo's send goes out now, and its panel is gone.
    await act(async () => { finish(); });
    await act(async () => {});

    expect(screen.getByText("hello Chico")).toBeTruthy();
    expect(screen.queryByText("hello Zeppo")).toBeNull();
    expect(screen.queryByText("Loading messages…")).toBeNull();
    expect(box("Chico").value).toBe("a draft for Chico"); // not emptied by the other conversation's send
  });

  it("shows the conversation that was picked, not one still loading from before", async () => {
    vi.mocked(fetchDMConversations).mockResolvedValue(conversations());
    const zeppo = heldRead();
    render(<DMView />);
    await waitFor(() => expect(fetchDMThread).toHaveBeenCalledTimes(1));
    const chico = heldRead();
    fireEvent.click(row("Chico"));
    await act(async () => { chico.answer([message("c1", "hello Chico")]); });
    await act(async () => { zeppo.answer([message("z1", "hello Zeppo")]); });
    expect(screen.getByText("hello Chico")).toBeTruthy();
    expect(screen.queryByText("hello Zeppo")).toBeNull();
    expect(screen.queryByText("Loading messages…")).toBeNull();
  });
});

// Send is in the corner toasts are drawn in. A relay's sign-in warning, which
// opening Messages raises, sat on it. How far the stack is lifted is measured
// in the browser; here, that the box asks for it and stops asking when it goes.
describe("Messages: toasts stay off the box", () => {
  const floor = () => document.documentElement.style.getPropertyValue("--toast-floor");

  it("tells the toast stack to start above the message box, and stops when the conversation is closed", async () => {
    // Nothing is laid out here, so heights are made up: 111 for the bar that
    // holds the box and nothing else, 500 for anything bigger or other.
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get(this: HTMLElement) { return this.querySelector("textarea") && !this.querySelector(".overflow-y-auto") ? 111 : 500; },
    });
    try {
      const view = render(<ThreadPanel partnerPubkey={ZEPPO} myPubkey={ME} />);
      await loaded();
      expect(floor()).toBe("111px");
      view.unmount();
      expect(floor()).toBe("");
    } finally {
      delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
    }
  });
});
