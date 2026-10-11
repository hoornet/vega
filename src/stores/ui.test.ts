import { describe, it, expect, beforeEach } from "vitest";
import { useUIStore } from "./ui";

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
