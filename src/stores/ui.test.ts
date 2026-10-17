import { describe, it, expect, beforeEach, vi } from "vitest";
import { useUIStore, hasChosenFeedTab, hasChosenArticlesTab, keptViews, keptHashtags } from "./ui";
import type { NDKEvent } from "@nostr-dev-kit/ndk";

describe("useUIStore", () => {
  beforeEach(() => {
    // Reset store to initial state
    useUIStore.setState({
      currentView: "feed",
      selectedPubkey: null,
      selectedNote: null,
      previousView: "feed",
      viewStack: [],
      feedTab: "global",
      pendingSearch: null,
      pendingDMPubkey: null,
      pendingArticleNaddr: null,
      pendingHashtag: null,
      profileTabs: {},
      trip: 0,
      showHelp: false,
      feedLanguageFilter: null,
    });
  });

  it("hides RSS articles by default and persists turning it off", () => {
    expect(useUIStore.getState().hideRssArticles).toBe(true);
    useUIStore.getState().setHideRssArticles(false);
    expect(useUIStore.getState().hideRssArticles).toBe(false);
    expect(localStorage.getItem("wrystr_hide_rss_articles")).toBe("false");
    useUIStore.getState().setHideRssArticles(true);
    expect(localStorage.getItem("wrystr_hide_rss_articles")).toBe("true");
  });

  // Esc and Back used to jump to a thread or profile opened before the last
  // sidebar click, because sidebar navigation left the back stack in place.
  it("setView starts a fresh back stack", () => {
    useUIStore.getState().openProfile("aa".repeat(32));
    useUIStore.getState().openHashtag("nostr");
    expect(useUIStore.getState().viewStack.length).toBe(2);

    useUIStore.getState().setView("settings");

    expect(useUIStore.getState().currentView).toBe("settings");
    expect(useUIStore.getState().viewStack).toEqual([]);
  });

  it("setFeedTab changes the tab", () => {
    useUIStore.getState().setFeedTab("following");
    expect(useUIStore.getState().feedTab).toBe("following");
  });

  it("setFeedTab to trending", () => {
    useUIStore.getState().setFeedTab("trending");
    expect(useUIStore.getState().feedTab).toBe("trending");
  });

  it("openProfile sets pubkey and view", () => {
    useUIStore.getState().openProfile("abc123");
    const state = useUIStore.getState();
    expect(state.currentView).toBe("profile");
    expect(state.selectedPubkey).toBe("abc123");
    expect(state.previousView).toBe("feed");
  });

  it("openThread sets note and previousView", () => {
    const mockNote = { id: "note1" } as any;
    useUIStore.getState().openThread(mockNote, "feed");
    const state = useUIStore.getState();
    expect(state.currentView).toBe("thread");
    expect(state.selectedNote).toBe(mockNote);
    expect(state.previousView).toBe("feed");
  });

  it("goBack returns to previous view", () => {
    useUIStore.getState().openProfile("abc123");
    expect(useUIStore.getState().currentView).toBe("profile");

    useUIStore.getState().goBack();
    expect(useUIStore.getState().currentView).toBe("feed");
    expect(useUIStore.getState().selectedNote).toBeNull();
  });

  it("goBack defaults to feed when previousView equals currentView", () => {
    // Both are "feed" initially
    useUIStore.getState().goBack();
    expect(useUIStore.getState().currentView).toBe("feed");
  });

  it("goBack returns to the hashtag page that was open, with its tag", () => {
    useUIStore.getState().openHashtag("vega");
    useUIStore.getState().openThread({} as NDKEvent);
    useUIStore.getState().openHashtag("nostr");
    useUIStore.getState().goBack();
    expect(useUIStore.getState().currentView).toBe("thread");
    useUIStore.getState().goBack();
    expect(useUIStore.getState().currentView).toBe("hashtag");
    expect(useUIStore.getState().pendingHashtag).toBe("vega");
  });

  it("keeps mounted the view that is open and every kept view Back can lead to, and no other", () => {
    useUIStore.getState().setView("search");
    useUIStore.getState().openProfile("pk");
    useUIStore.getState().openThread({} as NDKEvent);
    // Profile and thread are on the way back but are not kept views: each has one slot.
    expect([...keptViews(useUIStore.getState())].sort()).toEqual(["search", "thread"]);
    useUIStore.getState().openView("bookmarks");
    expect([...keptViews(useUIStore.getState())].sort()).toEqual(["bookmarks", "search"]);
    // A sidebar destination is a fresh start: nothing is kept from before it.
    useUIStore.getState().setView("articles");
    expect([...keptViews(useUIStore.getState())]).toEqual(["articles"]);
  });

  it("counts a sidebar trip, so the view chosen is a fresh instance even when it is the one on screen", () => {
    useUIStore.getState().setView("notifications");
    const start = useUIStore.getState().trip;
    useUIStore.getState().openThread({} as NDKEvent);
    useUIStore.getState().setView("notifications");
    expect(useUIStore.getState().trip).toBe(start + 1);
    // Choosing the view already on screen with nothing behind it changes nothing.
    useUIStore.getState().setView("notifications");
    expect(useUIStore.getState().trip).toBe(start + 1);
  });

  it("keeps one hashtag page per tag Back can lead to", () => {
    useUIStore.getState().openHashtag("vega");
    useUIStore.getState().openThread({} as NDKEvent);
    useUIStore.getState().openHashtag("nostr");
    expect(keptHashtags(useUIStore.getState())).toEqual(["vega", "nostr"]);
    useUIStore.getState().openThread({} as NDKEvent);
    useUIStore.getState().openHashtag("vega");
    expect(keptHashtags(useUIStore.getState())).toEqual(["vega", "nostr"]);
    useUIStore.getState().goBack();
    expect(keptHashtags(useUIStore.getState())).toEqual(["vega", "nostr"]);
    useUIStore.getState().setView("feed");
    expect(keptHashtags(useUIStore.getState())).toEqual([]);
  });

  it("remembers the tab last open on each profile, the newest two hundred", () => {
    const { rememberProfileTab } = useUIStore.getState();
    rememberProfileTab("alice", "articles");
    rememberProfileTab("bob", "media");
    rememberProfileTab("alice", "notes");
    expect(useUIStore.getState().profileTabs).toEqual({ bob: "media", alice: "notes" });
    for (let i = 0; i < 200; i++) rememberProfileTab(`p${i}`, "articles");
    const kept = Object.keys(useUIStore.getState().profileTabs);
    expect(kept).toHaveLength(200);
    expect(kept).not.toContain("bob");
    expect(kept).toContain("p199");
  });

  it("openSearch sets pending search and view", () => {
    useUIStore.getState().openSearch("bitcoin");
    const state = useUIStore.getState();
    expect(state.currentView).toBe("search");
    expect(state.pendingSearch).toBe("bitcoin");
  });

  it("openDM sets pending DM pubkey", () => {
    useUIStore.getState().openDM("pubkey123");
    const state = useUIStore.getState();
    expect(state.currentView).toBe("dm");
    expect(state.pendingDMPubkey).toBe("pubkey123");
  });

  it("setView changes the current view", () => {
    useUIStore.getState().setView("settings");
    expect(useUIStore.getState().currentView).toBe("settings");
  });

  it("toggleHelp toggles showHelp", () => {
    expect(useUIStore.getState().showHelp).toBe(false);
    useUIStore.getState().toggleHelp();
    expect(useUIStore.getState().showHelp).toBe(true);
    useUIStore.getState().toggleHelp();
    expect(useUIStore.getState().showHelp).toBe(false);
  });

  it("setFeedLanguageFilter sets the filter", () => {
    useUIStore.getState().setFeedLanguageFilter("Latin");
    expect(useUIStore.getState().feedLanguageFilter).toBe("Latin");
  });

  it("setFeedLanguageFilter clears with null", () => {
    useUIStore.getState().setFeedLanguageFilter("Latin");
    useUIStore.getState().setFeedLanguageFilter(null);
    expect(useUIStore.getState().feedLanguageFilter).toBeNull();
  });
});

describe("Back from an article", () => {
  beforeEach(() => {
    useUIStore.setState({ currentView: "articles", viewStack: [], pendingArticleNaddr: null, pendingArticleEvent: null, selectedNote: null, selectedPubkey: null });
  });

  it("returns to the article that was open before, not to the one just left", () => {
    const a = { id: "a" } as unknown as NDKEvent;
    const b = { id: "b" } as unknown as NDKEvent;
    useUIStore.getState().openArticle("naddr1a", a);
    // "More from" opens another article from inside the reader.
    useUIStore.getState().openArticle("naddr1b", b);
    expect(useUIStore.getState().pendingArticleNaddr).toBe("naddr1b");
    useUIStore.getState().goBack();
    expect(useUIStore.getState().currentView).toBe("article");
    expect(useUIStore.getState().pendingArticleNaddr).toBe("naddr1a");
    expect(useUIStore.getState().pendingArticleEvent).toBe(a);
    useUIStore.getState().goBack();
    expect(useUIStore.getState().currentView).toBe("articles");
  });

  it("returns to the article from the writer's profile", () => {
    const a = { id: "a" } as unknown as NDKEvent;
    useUIStore.getState().openArticle("naddr1a", a);
    useUIStore.getState().openProfile("ab".repeat(32));
    useUIStore.getState().goBack();
    expect(useUIStore.getState().currentView).toBe("article");
    expect(useUIStore.getState().pendingArticleNaddr).toBe("naddr1a");
  });
});

describe("openView", () => {
  beforeEach(() => { useUIStore.setState({ currentView: "feed", viewStack: [], pendingArticleNaddr: null, pendingArticleEvent: null }); });

  it("pushes the way back, which goBack takes", () => {
    useUIStore.getState().openView("follows");
    expect(useUIStore.getState().currentView).toBe("follows");
    useUIStore.getState().goBack();
    expect(useUIStore.getState().currentView).toBe("feed");
    expect(useUIStore.getState().viewStack).toEqual([]);
  });

  it("does not push a second entry for the view already open", () => {
    useUIStore.getState().openView("follows");
    useUIStore.getState().openView("follows");
    expect(useUIStore.getState().viewStack).toHaveLength(1);
    useUIStore.getState().goBack();
    expect(useUIStore.getState().currentView).toBe("feed");
  });
});

describe("feed tab memory", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("remembers a tab the user picked", () => {
    expect(hasChosenFeedTab()).toBe(false);
    useUIStore.getState().setFeedTab("global");
    expect(useUIStore.getState().feedTab).toBe("global");
    expect(localStorage.getItem("wrystr_feed_tab")).toBe("global");
    expect(hasChosenFeedTab()).toBe(true);
  });

  it("does not remember a default the app picked", () => {
    useUIStore.getState().setFeedTab("trending", { remember: false });
    expect(useUIStore.getState().feedTab).toBe("trending");
    expect(localStorage.getItem("wrystr_feed_tab")).toBeNull();
    expect(hasChosenFeedTab()).toBe(false);
  });

  // The opening tab is decided when the store module loads, so each case
  // loads a fresh copy of it.
  async function openingTab(seed: Record<string, string>) {
    localStorage.clear();
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
    vi.resetModules();
    const fresh = await import("./ui");
    return fresh.useUIStore.getState().feedTab;
  }

  it("opens on the tab picked last time", async () => {
    expect(await openingTab({ wrystr_feed_tab: "global", wrystr_pubkey: "ab".repeat(32) })).toBe("global");
  });

  it("opens on Following for a signed-in account that never picked one", async () => {
    expect(await openingTab({ wrystr_pubkey: "ab".repeat(32) })).toBe("following");
  });

  it("opens on Trending when signed out", async () => {
    expect(await openingTab({})).toBe("trending");
  });

  it("ignores a stored value that is not a tab", async () => {
    expect(await openingTab({ wrystr_feed_tab: "nonsense" })).toBe("trending");
  });
});

describe("articles tab memory", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("remembers a tab the user picked, and not a default the app picked", () => {
    expect(hasChosenArticlesTab()).toBe(false);
    useUIStore.getState().setArticlesTab("latest");
    expect(useUIStore.getState().articlesTab).toBe("latest");
    expect(localStorage.getItem("wrystr_articles_tab")).toBe("latest");
    expect(hasChosenArticlesTab()).toBe(true);
    useUIStore.getState().setArticlesTab("following", { remember: false });
    expect(useUIStore.getState().articlesTab).toBe("following");
    expect(localStorage.getItem("wrystr_articles_tab")).toBe("latest");
  });

  async function openingTab(seed: Record<string, string>) {
    localStorage.clear();
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
    vi.resetModules();
    const fresh = await import("./ui");
    return fresh.useUIStore.getState().articlesTab;
  }

  it("opens on the tab picked last time, else on Following when signed in, else on Latest", async () => {
    expect(await openingTab({ wrystr_articles_tab: "latest", wrystr_pubkey: "ab".repeat(32) })).toBe("latest");
    expect(await openingTab({ wrystr_pubkey: "ab".repeat(32) })).toBe("following");
    expect(await openingTab({})).toBe("latest");
    expect(await openingTab({ wrystr_articles_tab: "nonsense", wrystr_pubkey: "ab".repeat(32) })).toBe("following");
  });
});

// The theme is read when the store module loads, so each case loads a fresh copy.
describe("the theme the app starts with", () => {
  async function startWith(stored: string | null) {
    localStorage.clear();
    if (stored !== null) localStorage.setItem("wrystr_theme", stored);
    vi.resetModules();
    const fresh = await import("./ui");
    return { themeId: fresh.useUIStore.getState().themeId, storedAfter: localStorage.getItem("wrystr_theme") };
  }

  it("uses the stored theme", async () => {
    expect(await startWith("reader")).toEqual({ themeId: "reader", storedAfter: "reader" });
  });

  it("uses the default when nothing is stored, and stores nothing", async () => {
    expect(await startWith(null)).toEqual({ themeId: "midnight", storedAfter: null });
  });

  // Sepia was removed. Its users get the nearest theme, and the replacement
  // is written back so it is their choice from then on.
  it("moves a retired theme to its replacement and remembers that", async () => {
    expect(await startWith("sepia")).toEqual({ themeId: "gruvbox", storedAfter: "gruvbox" });
  });

  // An id this build does not know may come from a newer build. Showing the
  // default is right; erasing the choice is not.
  it("shows the default for an unknown theme without overwriting the stored choice", async () => {
    expect(await startWith("solarized")).toEqual({ themeId: "midnight", storedAfter: "solarized" });
  });

  it("still starts when the replacement cannot be written", async () => {
    localStorage.clear();
    localStorage.setItem("wrystr_theme", "sepia");
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
    try {
      vi.resetModules();
      const fresh = await import("./ui");
      expect(fresh.useUIStore.getState().themeId).toBe("gruvbox");
    } finally {
      setItem.mockRestore();
    }
  });
});
