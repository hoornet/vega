import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { NDKEvent } from "@nostr-dev-kit/ndk";

const ME = "11".repeat(32);
const OTHER_ACCOUNT = "33".repeat(32);
const AUTHOR = "22".repeat(32);

const user = { pubkey: ME as string | null, follows: [] as string[], followsStatus: "loaded", follow: vi.fn(), unfollow: vi.fn() };
const mute = { mutedPubkeys: [] as string[], mute: vi.fn(), unmute: vi.fn() };
const bookmarks = { bookmarkedIds: [] as string[], addBookmark: vi.fn(), removeBookmark: vi.fn() };
const profile = { name: "Alice", lud16: "alice@example.com" as string | undefined };
const reactions = { groups: new Map<string, number>(), myReactions: new Set<string>() };
const addReaction = vi.fn();
const counts = { replies: 3 as number | null, sats: 0 };

vi.mock("../../hooks/useProfile", () => ({ useProfile: () => profile }));
vi.mock("../../hooks/useReactions", () => ({ useReactions: () => [reactions, addReaction] }));
vi.mock("../../hooks/useReplyCount", () => ({ useReplyCount: () => [counts.replies] }));
vi.mock("../../hooks/useZapCount", () => ({ useZapCount: () => ({ totalSats: counts.sats }) }));
vi.mock("../../stores/user", () => ({
  useCanSign: () => true,
  useUserStore: (sel: (s: typeof user) => unknown) => sel(user),
}));
vi.mock("../../stores/mute", () => ({ useMuteStore: (sel: (s: typeof mute) => unknown) => sel(mute) }));
vi.mock("../../stores/bookmark", () => ({ useBookmarkStore: (sel: (s: typeof bookmarks) => unknown) => sel(bookmarks) }));
vi.mock("../../lib/nostr", () => ({ publishRepost: vi.fn().mockResolvedValue(undefined), publishReaction: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../zap/ZapModal", () => ({ ZapModal: () => <div>zap dialog</div> }));
const quoteProps = vi.hoisted(() => ({ last: null as null | { returnFocus?: { current: HTMLElement | null } } }));
vi.mock("./QuoteModal", () => ({ QuoteModal: (props: { returnFocus?: { current: HTMLElement | null } }) => { quoteProps.last = props; return <div>quote dialog</div>; } }));

import { publishReaction, publishRepost } from "../../lib/nostr";
import { repostKey, useRepostedStore } from "../../stores/reposted";
import { useToastStore } from "../../stores/toast";
import { LoggedOutStats, NoteActions } from "./NoteActions";

const event = { id: "e".repeat(64), pubkey: AUTHOR, content: "hello nostr", tags: [] } as unknown as NDKEvent;
const onReplyToggle = vi.fn();
const NO_RELAYS = new Error("Not enough relays received the event (0 published, 1 required)");

// The outer div stands in for the note card: a click that reaches it would
// have opened the thread. "note text" is the rest of the card.
function renderRow(overrides: Partial<NDKEvent> = {}) {
  const onCardClick = vi.fn();
  render(
    <div onClick={onCardClick}>
      <p>note text</p>
      <NoteActions event={{ ...event, ...overrides } as NDKEvent} onReplyToggle={onReplyToggle} showReply={false} />
    </div>,
  );
  return onCardClick;
}

const reply = () => screen.getByLabelText(/^Reply/);
const band = () => reply().parentElement as HTMLElement;
const repostTrigger = () => screen.getByLabelText(/Repost or quote$/);
const item = (name: string | RegExp) => screen.getByRole("menuitem", { name });
const toasts = () => useToastStore.getState().toasts;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(publishRepost).mockResolvedValue(undefined as never);
  vi.mocked(publishReaction).mockResolvedValue(undefined as never);
  user.pubkey = ME;
  user.follows = [];
  user.followsStatus = "loaded";
  mute.mutedPubkeys = [];
  bookmarks.bookmarkedIds = [];
  profile.lud16 = "alice@example.com";
  reactions.groups = new Map();
  reactions.myReactions = new Set();
  counts.replies = 3;
  counts.sats = 0;
  useRepostedStore.setState({ byKey: {} });
  useToastStore.setState({ toasts: [] });
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
});

describe("the note action row", () => {
  it("is a band that the note card must not treat as a click on the note", () => {
    renderRow();
    expect(band().hasAttribute("data-no-navigate")).toBe(true);
  });

  it("replies on one click and shows the count", () => {
    renderRow();
    expect(reply().textContent).toBe("3");
    fireEvent.click(reply());
    expect(onReplyToggle).toHaveBeenCalledTimes(1);
  });

  it("puts the reply count in the button's name, not only on screen", () => {
    renderRow();
    expect(reply().getAttribute("aria-label")).toBe("Reply. 3 replies");
    cleanup();
    counts.replies = 1;
    renderRow();
    expect(reply().getAttribute("aria-label")).toBe("Reply. 1 reply");
    cleanup();
    counts.replies = 0;
    renderRow();
    expect(reply().getAttribute("aria-label")).toBe("Reply");
    expect(reply().textContent).toBe("");
  });
});

describe("repost", () => {
  // Repost used to be an 8px-wide glyph that published the moment it was hit.
  it("does not repost on the first click", () => {
    renderRow();
    fireEvent.click(repostTrigger());
    expect(publishRepost).not.toHaveBeenCalled();
    expect(item("Repost")).toBeTruthy();
    expect(item("Quote…")).toBeTruthy();
  });

  it("reposts from the menu, once, and remembers it", async () => {
    renderRow();
    fireEvent.click(repostTrigger());
    fireEvent.click(item("Repost"));
    expect(screen.queryByRole("menu")).toBeNull();
    await waitFor(() => expect(repostTrigger().getAttribute("aria-label")).toBe("Reposted. Repost or quote"));
    expect(publishRepost).toHaveBeenCalledTimes(1);
    expect(useRepostedStore.getState().byKey[repostKey(ME, event.id!)]).toBe("done");

    fireEvent.click(repostTrigger());
    const again = item("Reposted") as HTMLButtonElement;
    expect(again.disabled).toBe(true);
    fireEvent.click(again);
    expect(publishRepost).toHaveBeenCalledTimes(1);
  });

  // Feed rows are virtualised: scrolling a note away and back makes a new
  // component. A repost still on its way to the relays must not be offered
  // again by the new one.
  it("does not publish twice when the row is remounted while the repost is in flight", async () => {
    let settle: () => void = () => {};
    vi.mocked(publishRepost).mockReturnValueOnce(new Promise<void>((res) => { settle = res; }) as never);
    renderRow();
    fireEvent.click(repostTrigger());
    fireEvent.click(item("Repost"));
    cleanup();

    renderRow();
    fireEvent.click(repostTrigger());
    const pending = item("Reposting…") as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    fireEvent.click(pending);
    expect(publishRepost).toHaveBeenCalledTimes(1);

    settle();
    await waitFor(() => expect(useRepostedStore.getState().byKey[repostKey(ME, event.id!)]).toBe("done"));
  });

  it("does not show one account's repost as another's", async () => {
    renderRow();
    fireEvent.click(repostTrigger());
    fireEvent.click(item("Repost"));
    await waitFor(() => expect(useRepostedStore.getState().byKey[repostKey(ME, event.id!)]).toBe("done"));
    cleanup();

    user.pubkey = OTHER_ACCOUNT;
    renderRow();
    expect(repostTrigger().getAttribute("aria-label")).toBe("Repost or quote");
    fireEvent.click(repostTrigger());
    expect((item("Repost") as HTMLButtonElement).disabled).toBe(false);
  });

  // A repost that reached no relay used to end as an unhandled rejection:
  // the menu closed, the icon stayed grey, and nothing said why.
  it("says so when a repost reaches no relay, and lets it be tried again", async () => {
    vi.mocked(publishRepost).mockRejectedValueOnce(NO_RELAYS);
    renderRow();
    fireEvent.click(repostTrigger());
    fireEvent.click(item("Repost"));
    await waitFor(() => expect(toasts().length).toBe(1));
    expect(toasts()[0].type).toBe("warning");
    expect(toasts()[0].message).toContain("none of your relays accepted it");
    expect(toasts()[0].message).toContain("Nothing was reposted");
    expect(useRepostedStore.getState().byKey[repostKey(ME, event.id!)]).toBeUndefined();

    fireEvent.click(repostTrigger());
    fireEvent.click(item("Repost"));
    await waitFor(() => expect(publishRepost).toHaveBeenCalledTimes(2));
  });

  it("opens the quote dialog from the menu without publishing", () => {
    renderRow();
    fireEvent.click(repostTrigger());
    fireEvent.click(item("Quote…"));
    expect(screen.getByText("quote dialog")).toBeTruthy();
    // "Quote…" is gone by the time the dialog closes: it is told to give focus back to the button that opened the menu.
    expect(quoteProps.last?.returnFocus?.current).toBe(screen.getByRole("button", { name: /Repost or quote/ }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(publishRepost).not.toHaveBeenCalled();
  });
});

describe("reactions", () => {
  it("sends the picked reaction and closes the picker", async () => {
    renderRow();
    fireEvent.click(screen.getByLabelText("React with emoji"));
    fireEvent.click(screen.getByLabelText("React with 🔥"));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(publishReaction).toHaveBeenCalledWith(event.id, AUTHOR, "🔥");
    await waitFor(() => expect(addReaction).toHaveBeenCalledWith("🔥"));
  });

  it("says so when a reaction reaches no relay, and does not count it", async () => {
    vi.mocked(publishReaction).mockRejectedValueOnce(NO_RELAYS);
    renderRow();
    fireEvent.click(screen.getByLabelText("React with emoji"));
    fireEvent.click(screen.getByLabelText("React with 🔥"));
    await waitFor(() => expect(toasts().length).toBe(1));
    expect(toasts()[0].message).toContain("Your reaction was not sent");
    expect(addReaction).not.toHaveBeenCalled();
  });

  it("does not offer a reaction you already gave", () => {
    reactions.myReactions = new Set(["🔥"]);
    renderRow();
    fireEvent.click(screen.getByLabelText("React with emoji"));
    expect((screen.getByLabelText("React with 🔥") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("React with 😂") as HTMLButtonElement).disabled).toBe(false);
  });

  it("adds to an existing reaction from its pill, and not to your own", () => {
    reactions.groups = new Map([["🔥", 4], ["😂", 2]]);
    reactions.myReactions = new Set(["😂"]);
    renderRow();
    const fire = screen.getByLabelText("🔥 4. React with this too") as HTMLButtonElement;
    const laugh = screen.getByLabelText("😂 2. You reacted with this") as HTMLButtonElement;
    expect(laugh.disabled).toBe(true);
    fireEvent.click(fire);
    expect(publishReaction).toHaveBeenCalledWith(event.id, AUTHOR, "🔥");
  });

  // Pills are drawn after the fixed actions so they never move them.
  it("keeps the fixed actions ahead of the pills", () => {
    reactions.groups = new Map([["🔥", 4]]);
    renderRow();
    const order = Array.from(band().querySelectorAll("button")).map((b) => b.getAttribute("aria-label"));
    expect(order).toEqual(["Reply. 3 replies", "Repost or quote", "React with emoji", "Zap", "🔥 4. React with this too", "Bookmark", "More actions"]);
  });

  it("closes the picker when its own button is pressed again", () => {
    renderRow();
    const trigger = screen.getByLabelText("React with emoji");
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("zap and bookmark", () => {
  it("opens the zap dialog and closes any open menu", () => {
    renderRow();
    fireEvent.click(screen.getByLabelText("More actions"));
    fireEvent.click(screen.getByLabelText("Zap"));
    expect(screen.getByText("zap dialog")).toBeTruthy();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("shows sats already zapped, in the label too", () => {
    counts.sats = 2100;
    renderRow();
    const zap = screen.getByLabelText("Zap. 2,100 sats so far");
    expect(zap.textContent).toBe("2,100");
  });

  it("has no zap button for an author without a lightning address", () => {
    profile.lud16 = undefined;
    renderRow();
    expect(screen.queryByLabelText("Zap")).toBeNull();
  });

  it("toggles a bookmark both ways", () => {
    renderRow();
    fireEvent.click(screen.getByLabelText("Bookmark"));
    expect(bookmarks.addBookmark).toHaveBeenCalledWith(event.id);
    cleanup();
    bookmarks.bookmarkedIds = [event.id!];
    renderRow();
    fireEvent.click(screen.getByLabelText("Remove bookmark"));
    expect(bookmarks.removeBookmark).toHaveBeenCalledWith(event.id);
  });
});

describe("the More menu", () => {
  // It was hover-only, and missing on your own notes.
  it("is always there, with follow and mute for someone else's note", () => {
    renderRow();
    fireEvent.click(screen.getByLabelText("More actions"));
    expect(Array.from(screen.getAllByRole("menuitem")).map((i) => i.textContent)).toEqual(["Copy note ID", "Copy text", "Follow Alice", "Mute Alice"]);
  });

  it("follows and unfollows", () => {
    renderRow();
    fireEvent.click(screen.getByLabelText("More actions"));
    fireEvent.click(item("Follow Alice"));
    expect(user.follow).toHaveBeenCalledWith(AUTHOR);
    expect(screen.queryByRole("menu")).toBeNull();
    cleanup();

    user.follows = [AUTHOR];
    renderRow();
    fireEvent.click(screen.getByLabelText("More actions"));
    fireEvent.click(item("Unfollow Alice"));
    expect(user.unfollow).toHaveBeenCalledWith(AUTHOR);
  });

  // An empty follow list that has not loaded proves nothing: offering
  // "Follow" to someone already followed is the wrong label.
  it("does not offer Follow until the follow list is known", () => {
    user.followsStatus = "loading";
    renderRow();
    fireEvent.click(screen.getByLabelText("More actions"));
    expect(Array.from(screen.getAllByRole("menuitem")).map((i) => i.textContent)).toEqual(["Copy note ID", "Copy text", "Mute Alice"]);
    cleanup();

    user.follows = [AUTHOR];
    renderRow();
    fireEvent.click(screen.getByLabelText("More actions"));
    expect(item("Unfollow Alice")).toBeTruthy();
  });

  it("mutes and unmutes", () => {
    renderRow();
    fireEvent.click(screen.getByLabelText("More actions"));
    fireEvent.click(item("Mute Alice"));
    expect(mute.mute).toHaveBeenCalledWith(AUTHOR);
    cleanup();

    mute.mutedPubkeys = [AUTHOR];
    renderRow();
    fireEvent.click(screen.getByLabelText("More actions"));
    fireEvent.click(item("Unmute Alice"));
    expect(mute.unmute).toHaveBeenCalledWith(AUTHOR);
  });

  // Mute had two hover colours and the stylesheet's order picked the plain one.
  it("marks Mute as the dangerous item, and only Mute", () => {
    renderRow();
    fireEvent.click(screen.getByLabelText("More actions"));
    const cls = (name: string) => ` ${item(name).className} `;
    expect(cls("Mute Alice")).toContain(" hover:text-danger ");
    expect(cls("Mute Alice")).not.toContain(" hover:text-text ");
    expect(cls("Copy text")).toContain(" hover:text-text ");
    expect(cls("Copy text")).not.toContain(" hover:text-danger ");
  });

  it("offers copy on your own notes, and nothing about following yourself", () => {
    renderRow({ pubkey: ME });
    fireEvent.click(screen.getByLabelText("More actions"));
    expect(Array.from(screen.getAllByRole("menuitem")).map((i) => i.textContent)).toEqual(["Copy note ID", "Copy text"]);
  });

  it("copies the note's text and its ID", async () => {
    renderRow();
    fireEvent.click(screen.getByLabelText("More actions"));
    fireEvent.click(item("Copy text"));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("hello nostr"));
    await waitFor(() => expect(toasts().some((t) => t.message === "Text copied.")).toBe(true));

    fireEvent.click(screen.getByLabelText("More actions"));
    fireEvent.click(item("Copy note ID"));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(2));
    expect(vi.mocked(navigator.clipboard.writeText).mock.calls[1][0]).toMatch(/^nostr:nevent1/);
  });
});

describe("opening and closing", () => {
  it("shows only one popover at a time", () => {
    renderRow();
    fireEvent.click(repostTrigger());
    fireEvent.click(screen.getByLabelText("React with emoji"));
    fireEvent.click(screen.getByLabelText("More actions"));
    expect(screen.getAllByRole("menu").length).toBe(1);
    expect(screen.getByRole("menu").textContent).toContain("Copy note ID");
  });

  // The click that dismisses a menu used to carry on to the card and open the
  // thread. The target here is inside the card, so without the swallow this
  // click does reach `onCardClick`.
  it("closes on a click elsewhere in the card, and that click does not reach the card", () => {
    const onCardClick = renderRow();
    fireEvent.click(screen.getByLabelText("More actions"));
    // The stand-in card has no guard of its own, so opening the menu reached it.
    onCardClick.mockClear();
    fireEvent.click(screen.getByText("note text"));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onCardClick).not.toHaveBeenCalled();

    // With nothing open the same click is the card's again.
    fireEvent.click(screen.getByText("note text"));
    expect(onCardClick).toHaveBeenCalledTimes(1);
  });

  it("closes on a click in the row's own blank space", () => {
    renderRow();
    fireEvent.click(screen.getByLabelText("More actions"));
    fireEvent.click(band());
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("marks the row while a popover is open, so a list can lift it above the next note", () => {
    renderRow();
    expect(band().hasAttribute("data-popover-open")).toBe(false);
    fireEvent.click(screen.getByLabelText("More actions"));
    expect(band().hasAttribute("data-popover-open")).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(band().hasAttribute("data-popover-open")).toBe(false);
  });
});

describe("keyboard", () => {
  // Focus used to fall to <body> when the focused item unmounted, so the next
  // Tab started from the top of the window.
  it("returns focus to the button that opened the menu after an item is chosen", async () => {
    renderRow();
    const more = screen.getByLabelText("More actions");
    fireEvent.click(more);
    item("Copy text").focus();
    fireEvent.click(item("Copy text"));
    expect(document.activeElement).toBe(more);
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
  });

  it("returns focus to the trigger on Escape", () => {
    renderRow();
    const more = screen.getByLabelText("More actions");
    fireEvent.click(more);
    item("Copy text").focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it("keeps focus on the repost button after reposting", async () => {
    renderRow();
    fireEvent.click(repostTrigger());
    fireEvent.click(item("Repost"));
    expect(document.activeElement).toBe(repostTrigger());
    expect((repostTrigger() as HTMLButtonElement).disabled).toBe(false);
    await waitFor(() => expect(publishRepost).toHaveBeenCalled());
  });

  // Enter or Space on a button arrives as a click with detail 0.
  it("focuses the first item when opened from the keyboard, not when opened with the mouse", () => {
    renderRow();
    const more = screen.getByLabelText("More actions");
    more.focus();
    fireEvent.click(more, { detail: 1 });
    expect(document.activeElement).toBe(more);
    fireEvent.click(more, { detail: 1 });

    fireEvent.click(more, { detail: 0 });
    expect(document.activeElement).toBe(item("Copy note ID"));
  });

  it("moves through the menu with the arrow keys, Home and End", () => {
    renderRow();
    fireEvent.click(screen.getByLabelText("More actions"), { detail: 0 });
    const key = (k: string) => fireEvent.keyDown(document.activeElement as Element, { key: k });
    key("ArrowDown");
    expect(document.activeElement).toBe(item("Copy text"));
    key("End");
    expect(document.activeElement).toBe(item("Mute Alice"));
    key("ArrowDown");
    expect(document.activeElement).toBe(item("Copy note ID"));
    key("ArrowUp");
    expect(document.activeElement).toBe(item("Mute Alice"));
    key("Home");
    expect(document.activeElement).toBe(item("Copy note ID"));
  });

  it("closes the menu when Tab leaves it", () => {
    renderRow();
    fireEvent.click(screen.getByLabelText("More actions"), { detail: 0 });
    fireEvent.keyDown(document.activeElement as Element, { key: "Tab" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

// The first note under the compose box has no room above it. An upward menu
// there was cut off by the top of the scroll area.
describe("where a popover opens", () => {
  const rect = (top: number, left = 500) => ({ top, bottom: top + 32, left, right: left + 32, width: 32, height: 32, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

  // Scroll area from 100 to 700 down the window, `right` px wide from 0.
  function open(label: RegExp | string, triggerTop: number, opts: { right?: number; left?: number } = {}) {
    render(
      <div className="overflow-y-auto" data-testid="scroller">
        <NoteActions event={event} onReplyToggle={onReplyToggle} showReply={false} />
      </div>,
    );
    screen.getByTestId("scroller").getBoundingClientRect = () => ({ ...rect(100), bottom: 700, right: opts.right ?? 1000 }) as DOMRect;
    const trigger = screen.getByLabelText(label);
    trigger.getBoundingClientRect = () => rect(triggerTop, opts.left);
    Object.defineProperty(trigger, "offsetHeight", { value: 32, configurable: true });
    fireEvent.click(trigger);
    return ` ${screen.getByRole("menu").className} `;
  }
  const UP = " bottom-9 ";
  const DOWN = " top-9 ";

  it("opens upward when there is room above the note", () => {
    const cls = open("More actions", 500);
    expect(cls).toContain(UP);
    expect(cls).not.toContain(DOWN);
  });

  // 150px above the trigger: enough measured from the scroll area's edge to
  // tell it apart from the 250px there would be measured from the window.
  it("opens downward when the menu does not fit under the top of the scroll area", () => {
    const cls = open("More actions", 250);
    expect(cls).toContain(DOWN);
    expect(cls).not.toContain(UP);
  });

  it("lets a small popover open upward where a tall one cannot", () => {
    expect(open("React with emoji", 190)).toContain(UP);
    cleanup();
    expect(open(/Repost or quote$/, 190)).toContain(UP);
    cleanup();
    expect(open("More actions", 190)).toContain(DOWN);
  });

  it("does not open downward into the bottom edge either", () => {
    // 150 above, 18 below: neither fits a 156px menu, above is roomier.
    expect(open("More actions", 650)).toContain(UP);
  });

  // A narrow pane (wide sidebar, small window, large text): seven emoji in a
  // row ran past the right edge and put a horizontal scrollbar on the feed.
  it("wraps the reaction picker when there is no room for one row", () => {
    expect(open("React with emoji", 500, { right: 1000, left: 500 })).not.toContain(" flex-wrap ");
    cleanup();
    expect(open("React with emoji", 500, { right: 700, left: 500 })).toContain(" flex-wrap ");
  });
});

describe("the row for someone who cannot sign", () => {
  it("says what its numbers are, and still lets the note ID be copied", async () => {
    reactions.groups = new Map([["🔥", 4]]);
    counts.sats = 1500;
    render(<LoggedOutStats event={event} />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("3replies");
    expect(text).toContain("🔥4reactions");
    expect(text).toContain("1,500 sats");
    expect(screen.queryByLabelText(/^Reply/)).toBeNull();

    fireEvent.click(screen.getByLabelText("Copy note ID"));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    expect(vi.mocked(navigator.clipboard.writeText).mock.calls[0][0]).toMatch(/^nostr:nevent1/);
  });
});
