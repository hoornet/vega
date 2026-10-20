import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import type { NDKEvent } from "@nostr-dev-kit/ndk";

vi.mock("../../lib/nostr", () => ({ fetchUserNotesNIP65: vi.fn(), fetchAuthorArticles: vi.fn() }));
const me = vi.hoisted(() => ({ pubkey: "me", profile: null as unknown, ownProfileRead: "pending" as "pending" | "found" | "none" | "unknown", canSign: false }));
vi.mock("../../stores/user", () => ({ useUserStore: () => me, useCanSign: () => me.canSign }));
vi.mock("../../stores/mute", () => ({ useMuteStore: () => ({ mutedPubkeys: [] as string[], mute: () => {}, unmute: () => {} }) }));
const onRelays = vi.hoisted(() => ({ profile: null as Record<string, unknown> | null }));
vi.mock("../../hooks/useProfile", () => ({ useProfile: () => onRelays.profile }));
vi.mock("../../hooks/useReputation", () => ({ useReputation: () => ({ data: null, loading: false }) }));
vi.mock("../feed/NoteCard", () => ({ NoteCard: ({ event }: { event: NDKEvent }) => <article>{event.content}</article> }));
vi.mock("../article/ArticleCard", () => ({ ArticleCard: ({ event }: { event: NDKEvent }) => <article>{event.content}</article> }));
vi.mock("../zap/ZapModal", () => ({ ZapModal: () => null }));
vi.mock("../shared/ImageLightbox", () => ({ ImageLightbox: () => null }));
vi.mock("./EditProfileForm", () => ({ EditProfileForm: () => <form aria-label="Edit profile" /> }));
vi.mock("../feed/TextSegments", () => ({
  tryHandleUrlInternally: () => false,
  tryOpenNostrEntity: () => false,
  // Stands in for the real one: says which account it was asked to name.
  MentionName: ({ pubkey, fallback }: { pubkey?: string; fallback: string }) => <>{pubkey ? `the name of ${pubkey.slice(0, 4)}` : fallback}</>,
}));
vi.mock("./ProfileMediaGallery", () => ({ ProfileMediaGallery: ({ notes, loading }: { notes: NDKEvent[]; loading: boolean }) => <p>{loading ? "gallery loading" : `gallery of ${notes.length}`}</p> }));
vi.mock("../shared/FollowButton", () => ({ FollowButton: () => null }));

import { ProfileView } from "./ProfileView";
import { useUIStore } from "../../stores/ui";
import { fetchUserNotesNIP65, fetchAuthorArticles } from "../../lib/nostr";
import { recordFetchOutcome } from "../../lib/nostr/fetchTotals";

const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);
const note = (text: string) => ({ id: text, content: text, created_at: 1000, kind: 1, pubkey: "pk", tags: [] }) as unknown as NDKEvent;
/** What the relays hold, per person. "silent": nobody answers. */
const relays = { notes: {} as Record<string, NDKEvent[] | "silent" | "throws">, articles: {} as Record<string, NDKEvent[] | "silent"> };
/** Lets a load run, including the three-second pause before it asks a second time. */
const settle = async (ms = 3100) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const open = async (pubkey: string) => { act(() => { useUIStore.setState({ selectedPubkey: pubkey }); }); };
const rows = () => screen.queryAllByRole("article").map((e) => e.textContent);
const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));

beforeEach(() => {
  vi.useFakeTimers();
  onRelays.profile = null;
  relays.notes = { [ALICE]: [note("alice 1"), note("alice 2")], [BOB]: [note("bob 1")] };
  relays.articles = { [ALICE]: [note("alice essay")], [BOB]: [] };
  vi.mocked(fetchUserNotesNIP65).mockReset().mockImplementation(async (pubkey: string) => {
    const held = relays.notes[pubkey] ?? [];
    if (held === "throws") throw new Error("relay said no");
    if (held === "silent") { recordFetchOutcome(false); return []; }
    recordFetchOutcome(true);
    return held;
  });
  vi.mocked(fetchAuthorArticles).mockReset().mockImplementation(async (pubkey: string) => {
    const held = relays.articles[pubkey] ?? [];
    if (held === "silent") { recordFetchOutcome(false); return []; }
    recordFetchOutcome(true);
    return held;
  });
  useUIStore.setState({ selectedPubkey: ALICE, profileTabs: {} });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

// The own profile before anything is on it: a way to set it up, not an
// italic hint pointing at a small button in the opposite corner.
describe("ProfileView: the own profile when empty", () => {
  const ME = "me";
  beforeEach(() => { me.profile = null; me.ownProfileRead = "none"; me.canSign = true; relays.notes[ME] = []; relays.articles[ME] = []; });
  afterEach(() => { me.canSign = false; me.ownProfileRead = "pending"; });

  it("offers to set up a profile that has no name and no bio", async () => {
    render(<ProfileView />);
    await open(ME);
    await settle(0);
    expect(screen.queryByText(/No bio yet/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Set up your profile" }));
    expect(screen.getByRole("form", { name: "Edit profile" })).toBeTruthy();
  });

  // A profile that has not loaded is not a missing one: the form would open
  // on nothing and the save would replace whatever the relays hold.
  it("offers nothing while the relays have not said whether there is a profile", async () => {
    for (const read of ["pending", "unknown"] as const) {
      me.ownProfileRead = read;
      render(<ProfileView />);
      await open(ME);
      await settle(0);
      expect(screen.queryByRole("button", { name: "Set up your profile" })).toBeNull();
      expect(screen.queryByText(/No bio yet/)).toBeNull();
      cleanup();
    }
  });

  it("offers to set up a profile that is held but has no name, whatever the relays said", async () => {
    me.ownProfileRead = "unknown";
    me.profile = { about: "" };
    render(<ProfileView />);
    await open(ME);
    await settle(0);
    expect(screen.getByRole("button", { name: "Set up your profile" })).toBeTruthy();
  });

  it("offers neither setup nor a first note to an account that cannot sign", async () => {
    me.canSign = false;
    render(<ProfileView />);
    await open(ME);
    await settle();
    expect(screen.queryByRole("button", { name: "Set up your profile" })).toBeNull();
    expect(screen.getByText("You haven't posted yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Write your first note" })).toBeNull();
  });

  // The way Zaps opens it: the view mounts with the request already made,
  // and its own reset on a new pubkey runs in the same commit.
  it("opens in the edit form when asked for from elsewhere, once", async () => {
    act(() => useUIStore.getState().openProfileEditor(ME));
    render(<ProfileView />);
    await settle(0);
    expect(screen.getByRole("form", { name: "Edit profile" })).toBeTruthy();
    expect(useUIStore.getState().editProfileFor).toBeNull();
    cleanup();
    render(<ProfileView />);
    await settle(0);
    expect(screen.queryByRole("form", { name: "Edit profile" })).toBeNull();
  });

  it("does not open the edit form for a request about another account, or for one that cannot sign", async () => {
    act(() => useUIStore.getState().openProfileEditor(ME));
    act(() => useUIStore.setState({ selectedPubkey: ALICE }));
    render(<ProfileView />);
    await settle(0);
    expect(screen.queryByRole("form", { name: "Edit profile" })).toBeNull();
    expect(useUIStore.getState().editProfileFor).toBe(ME);
    cleanup();
    me.canSign = false;
    act(() => useUIStore.setState({ selectedPubkey: ME }));
    render(<ProfileView />);
    await settle(0);
    expect(screen.queryByRole("form", { name: "Edit profile" })).toBeNull();
    expect(useUIStore.getState().editProfileFor).toBeNull();
  });

  it("says only that there is no bio once there is a name, a display name included", async () => {
    onRelays.profile = { displayName: "Me" };
    me.profile = { displayName: "Me" };
    render(<ProfileView />);
    await open(ME);
    await settle(0);
    expect(screen.getByText("No bio yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Set up your profile" })).toBeNull();
  });

  it("offers a first note when there are none, and asks for the compose box", async () => {
    render(<ProfileView />);
    await open(ME);
    await settle();
    expect(screen.getByText("You haven't posted yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Write your first note" }));
    expect(useUIStore.getState().currentView).toBe("feed");
    expect(useUIStore.getState().composeRequest).toBeGreaterThan(0);
  });

  it("does not offer a first note on someone else's empty profile", async () => {
    relays.notes[ALICE] = [];
    render(<ProfileView />);
    await open(ALICE);
    await settle();
    expect(screen.getByText("No notes yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Write your first note" })).toBeNull();
  });
});

describe("ProfileView: who it is", () => {
  it("calls an account with no name by its shortened public address, once as the name and once to copy", async () => {
    render(<ProfileView />);
    await open(ALICE);
    await settle(0);
    const address = (await import("../../lib/utils")).shortNpub(ALICE);
    expect(address).toMatch(/^npub1.{3}….{4}$/);
    expect(screen.getAllByText(address)).toHaveLength(2);
    expect(document.body.textContent).not.toContain(ALICE.slice(0, 8));
  });

  it("calls an account by its name when it has one", async () => {
    onRelays.profile = { name: "alice" };
    render(<ProfileView />);
    await open(ALICE);
    await settle(0);
    expect(screen.getByText("alice")).toBeTruthy();
  });

  // A mention in a bio was the start of the key and two ellipses.
  it("shows a mention in the bio by the mentioned account's name", async () => {
    const { nip19 } = await import("@nostr-dev-kit/ndk");
    onRelays.profile = { name: "alice", about: `works with nostr:${nip19.npubEncode(BOB)} on things` };
    render(<ProfileView />);
    await open(ALICE);
    await settle(0);
    expect(screen.getByText("@the name of bbbb")).toBeTruthy();
    expect(document.body.textContent).not.toContain("……");
  });
});

describe("ProfileView: notes", () => {
  it("says it is loading, then shows the notes", async () => {
    render(<ProfileView />);
    expect(screen.getByRole("status").textContent).toBe("Loading notes…");
    await settle(0);
    expect(rows()).toEqual(["alice 1", "alice 2"]);
  });

  it("says there are none when a relay answered with none, after asking twice", async () => {
    relays.notes[ALICE] = [];
    render(<ProfileView />);
    await settle(2900);
    expect(screen.queryByText("No notes yet.")).toBeNull(); // still asking
    await settle(300);
    expect(screen.getByText("No notes yet.")).toBeTruthy();
    expect(fetchUserNotesNIP65).toHaveBeenCalledTimes(2);
  });

  // The whole point: this used to read "No notes yet." on someone with a year of posts.
  it("says the relays could not be reached when nobody answered, and asks again on Try again", async () => {
    relays.notes[ALICE] = "silent";
    render(<ProfileView />);
    await settle();
    expect(screen.getByRole("alert").textContent).toContain("so these notes can't be loaded");
    expect(screen.queryByText("No notes yet.")).toBeNull();
    relays.notes[ALICE] = [note("alice 1")];
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await settle(0);
    expect(rows()).toEqual(["alice 1"]);
  });

  it("shows a failure with its reason", async () => {
    relays.notes[ALICE] = "throws";
    render(<ProfileView />);
    await settle();
    expect(screen.getByRole("alert").textContent).toContain("relay said no");
  });
});

describe("ProfileView: the media tab is drawn from the notes", () => {
  it("shows the gallery of the notes that loaded", async () => {
    render(<ProfileView />);
    await settle(0);
    tab("Media");
    expect(screen.getByText("gallery of 2")).toBeTruthy();
  });

  // Without the notes it must not say "no media".
  it("says the relays could not be reached when the notes could not be loaded", async () => {
    relays.notes[ALICE] = "silent";
    render(<ProfileView />);
    await settle();
    tab("Media");
    expect(screen.getByRole("alert").textContent).toContain("so this person's media can't be loaded");
    expect(screen.queryByText(/gallery/)).toBeNull();
  });
});

describe("ProfileView: articles", () => {
  it("are asked for when their tab is first opened, not before", async () => {
    render(<ProfileView />);
    await settle();
    expect(fetchAuthorArticles).not.toHaveBeenCalled();
    tab("Articles");
    expect(screen.getByRole("status").textContent).toBe("Loading articles…");
    await settle(0);
    expect(rows()).toEqual(["alice essay"]);
    expect(fetchAuthorArticles).toHaveBeenCalledTimes(1);
  });

  it("are kept when leaving the tab and coming back", async () => {
    render(<ProfileView />);
    await settle();
    tab("Articles");
    await settle(0);
    tab("Notes");
    tab("Articles");
    expect(rows()).toEqual(["alice essay"]);
    expect(fetchAuthorArticles).toHaveBeenCalledTimes(1);
  });

  it("says the relays could not be reached when nobody answered", async () => {
    relays.articles[ALICE] = "silent";
    render(<ProfileView />);
    await settle();
    tab("Articles");
    await settle();
    expect(screen.getByRole("alert").textContent).toContain("so these articles can't be loaded");
    expect(screen.queryByText("No articles yet.")).toBeNull();
  });
});

describe("ProfileView: opening one profile from another", () => {
  // One person's notes stayed under the next person's name while the new
  // ones loaded, and their articles for good.
  it("drops the first person's notes at once", async () => {
    render(<ProfileView />);
    await settle(0);
    expect(rows()).toEqual(["alice 1", "alice 2"]);
    await open(BOB);
    expect(rows()).toEqual([]);
    expect(screen.getByRole("status").textContent).toBe("Loading notes…");
    await settle(0);
    expect(rows()).toEqual(["bob 1"]);
  });

  it("does not keep the first person's notes when the second person's cannot be loaded", async () => {
    relays.notes[BOB] = "silent";
    render(<ProfileView />);
    await settle(0);
    await open(BOB);
    await settle();
    expect(rows()).toEqual([]);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("does not show the first person's articles under the second", async () => {
    render(<ProfileView />);
    await settle();
    tab("Articles");
    await settle(0);
    expect(rows()).toEqual(["alice essay"]);
    await open(BOB);
    await settle();
    // Back on Notes for the new person, and their articles have not been asked for.
    expect(rows()).toEqual(["bob 1"]);
    expect(fetchAuthorArticles).toHaveBeenCalledTimes(1);
    tab("Articles");
    await settle();
    expect(rows()).toEqual([]);
    expect(screen.getByText("No articles yet.")).toBeTruthy();
    expect(vi.mocked(fetchAuthorArticles).mock.calls.map(([pk]) => pk)).toEqual([ALICE, BOB, BOB]);
  });

  // Coming back must not fetch articles nobody has asked to see on this visit.
  it("does not ask for a person's articles again just because their profile is opened again", async () => {
    render(<ProfileView />);
    await settle();
    tab("Articles");
    await settle(0);
    tab("Notes");
    await open(BOB);
    await settle();
    await open(ALICE);
    await settle();
    expect(screen.getByRole("tab", { name: "Notes" }).getAttribute("aria-selected")).toBe("true");
    expect(vi.mocked(fetchAuthorArticles).mock.calls.map(([pk]) => pk)).toEqual([ALICE]);
  });

  it("opens on the remembered tab when mounted afresh, as Back from an article does", async () => {
    useUIStore.setState({ profileTabs: { [ALICE]: "articles" } });
    render(<ProfileView />);
    expect(screen.getByRole("tab", { name: "Articles" }).getAttribute("aria-selected")).toBe("true");
    await settle(0);
    expect(rows()).toEqual(["alice essay"]);
    expect(vi.mocked(fetchAuthorArticles).mock.calls.map(([pk]) => pk)).toEqual([ALICE]);
  });

  it("opens on the tab that was last open on that person, and asks for the articles then, since they are showing", async () => {
    render(<ProfileView />);
    await settle();
    tab("Articles");
    await settle(0);
    await open(BOB);
    await settle();
    expect(screen.getByRole("tab", { name: "Notes" }).getAttribute("aria-selected")).toBe("true");
    expect(vi.mocked(fetchAuthorArticles).mock.calls.map(([pk]) => pk)).toEqual([ALICE]);
    await open(ALICE);
    await settle(0);
    expect(screen.getByRole("tab", { name: "Articles" }).getAttribute("aria-selected")).toBe("true");
    expect(rows()).toEqual(["alice essay"]);
    expect(vi.mocked(fetchAuthorArticles).mock.calls.map(([pk]) => pk)).toEqual([ALICE, ALICE]);
  });
});
