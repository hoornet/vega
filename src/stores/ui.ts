import { create } from "zustand";

import { NDKEvent } from "@nostr-dev-kit/ndk";
import { isRetiredTheme, resolveThemeId } from "../lib/themes";

export type View = "feed" | "search" | "relays" | "settings" | "profile" | "thread" | "article-editor" | "article" | "articles" | "media" | "podcasts" | "about" | "zaps" | "dm" | "notifications" | "bookmarks" | "hashtag" | "follows" | "v4v";
type FeedTab = "global" | "following" | "trending";
export type ArticlesTab = "following" | "latest";

interface ViewStackEntry {
  view: View;
  selectedNote: NDKEvent | null;
  selectedPubkey: string | null;
  /** The article that was open, so Back from "More from" or a writer's profile returns to it. */
  articleNaddr: string | null;
  articleEvent: NDKEvent | null;
  /** The hashtag page that was open: Back from a note to a tag's page must show that tag, not the one opened last. */
  hashtag: string | null;
}

/** Where we are, as Back will need it. */
const here = (s: Pick<UIState, "currentView" | "selectedNote" | "selectedPubkey" | "pendingArticleNaddr" | "pendingArticleEvent" | "pendingHashtag">): ViewStackEntry =>
  ({ view: s.currentView, selectedNote: s.selectedNote, selectedPubkey: s.selectedPubkey, articleNaddr: s.pendingArticleNaddr, articleEvent: s.pendingArticleEvent, hashtag: s.pendingHashtag });

const MAX_STACK = 20;

/**
 * List views that stay mounted, hidden, while Back can lead to them, so Back
 * finds the query, the results, the tab and the scroll position as they were.
 * The feed always stays. Profile and thread are not here: each has one slot
 * (`selectedPubkey`, `selectedNote`), so a second instance would show the
 * wrong person. See "Back keeps your place" in CLAUDE.md.
 */
export const KEPT_VIEWS: readonly View[] = ["search", "articles", "bookmarks", "hashtag", "notifications", "follows", "zaps", "media"];

/** The views to keep mounted right now: the one open, and every kept view Back can lead to. */
export function keptViews(s: Pick<UIState, "currentView" | "viewStack">): Set<View> {
  return new Set<View>([s.currentView, ...s.viewStack.map((e) => e.view).filter((v) => KEPT_VIEWS.includes(v))]);
}

/**
 * The hashtag pages to keep, one instance per tag: the tag open now, and every
 * tag Back can lead to. A hashtag page is a view with a subject, like a
 * profile, but unlike a profile it is cheap to hold several, so each tag gets
 * its own instance and Back finds that tag's rows and scroll, not the last
 * tag's offset on this tag's rows.
 */
export function keptHashtags(s: Pick<UIState, "currentView" | "viewStack" | "pendingHashtag">): string[] {
  const tags = s.viewStack.filter((e) => e.view === "hashtag" && e.hashtag).map((e) => e.hashtag as string);
  if (s.currentView === "hashtag" && s.pendingHashtag) tags.push(s.pendingHashtag);
  return Array.from(new Set(tags));
}

export type ProfileTab = "notes" | "articles" | "media";
/** The ids of Settings' groups, as `GROUPS` in SettingsView names them. */
export type SettingsGroupId = "appearance" | "account" | "wallet" | "notifications" | "what-you-see" | "advanced";
/** How many profiles' tabs are remembered for the session. */
const PROFILE_TABS_KEPT = 200;

interface UIState {
  currentView: View;
  sidebarCollapsed: boolean;
  selectedPubkey: string | null;
  selectedNote: NDKEvent | null;
  previousView: View;
  viewStack: ViewStackEntry[];
  /** Counts sidebar trips. A kept view is keyed by it, so choosing a destination in the sidebar starts it fresh even when it is the view already on screen. */
  trip: number;
  /** The tab last open on each profile, for the session: Back to a profile, or opening it again, lands where you were. */
  profileTabs: Record<string, ProfileTab>;
  rememberProfileTab: (pubkey: string, tab: ProfileTab) => void;
  feedTab: FeedTab;
  /** The Articles tab. Kept here, not in the view: opening an article unmounts the list, and Back used to land on Latest. */
  articlesTab: ArticlesTab;
  pendingSearch: string | null;
  pendingDMPubkey: string | null;
  /** A Settings group to scroll to when Settings opens (a link from the zap dialog or Value 4 Value). */
  pendingSettingsGroup: SettingsGroupId | null;
  openSettings: (group: SettingsGroupId) => void;
  pendingArticleNaddr: string | null;
  pendingArticleEvent: NDKEvent | null;
  pendingHashtag: string | null;
  showHelp: boolean;
  /**
   * The sign-up flow opened over the app: at the name step for a new
   * account, or at the sign-in step for someone with a key. Null when the
   * app is on screen. One flow for every way in; the welcome screen is only
   * for a first launch.
   */
  signup: "create" | "login" | null;
  /** Goes up each time something asks for the compose box ("Write a note"); the box takes focus when it changes. */
  composeRequest: number;
  /**
   * Until when a request from outside Vega (`vega --compose`) waits for a compose box that is not
   * there yet; 0 for none. The box ignores a request made before it mounted, on purpose: an empty
   * view's "Write a note" is for the box on screen. A launch is not: on a cold start the box mounts
   * only once the session is restored, seconds later with a remote signer.
   */
  composePendingUntil: number;
  /** The account whose profile should open in its edit form ("Add a Lightning address"); taken by the view once it has. */
  editProfileFor: string | null;
  showDebugPanel: boolean;
  feedLanguageFilter: string | null;
  /** Hide RSS-bridge reposts on the Articles Latest tab. Default on. */
  hideRssArticles: boolean;
  followsTab: "followers" | "following" | "find";
  fontSize: number;
  easyReadFont: boolean;
  themeId: string;
  setView: (view: View) => void;
  setFollowsTab: (tab: "followers" | "following" | "find") => void;
  /** Switch feed tab. `remember: false` is for defaults the app picks; only the user's own choice is kept across restarts. */
  setFeedTab: (tab: FeedTab, opts?: { remember?: boolean }) => void;
  /** Switch the Articles tab. As with the feed, only the user's own choice is kept across restarts. */
  setArticlesTab: (tab: ArticlesTab, opts?: { remember?: boolean }) => void;
  openProfile: (pubkey: string) => void;
  /** Show a view reached from another view (People or Zap history from the account menu), so Back returns there. `setView` is for the sidebar and clears the way back. */
  openView: (view: View) => void;
  openThread: (note: NDKEvent, from?: View) => void;
  openSearch: (query: string) => void;
  openHashtag: (tag: string) => void;
  openDM: (pubkey: string) => void;
  openArticle: (naddr: string, event?: NDKEvent) => void;
  goBack: () => void;
  setFeedLanguageFilter: (filter: string | null) => void;
  setHideRssArticles: (hide: boolean) => void;
  setFontSize: (size: number) => void;
  setEasyReadFont: (on: boolean) => void;
  setTheme: (id: string) => void;
  toggleSidebar: () => void;
  toggleHelp: () => void;
  openSignup: (step: "create" | "login") => void;
  /** Show the feed with the compose box focused. */
  requestCompose: () => void;
  /** `requestCompose`, and a box that mounts within `holdMs` takes the request too (`takePendingCompose`). */
  requestComposeWhenReady: (holdMs: number) => void;
  /** Whether a request is still waiting for a box, and from now on not: the box that asks has taken it. */
  takePendingCompose: () => boolean;
  /** Show the account's profile with the edit form open. */
  openProfileEditor: (pubkey: string) => void;
  closeSignup: () => void;
  toggleDebugPanel: () => void;
}

const SIDEBAR_KEY = "wrystr_sidebar_collapsed";
const FONT_SIZE_KEY = "wrystr_font_size";
const EASY_READ_FONT_KEY = "wrystr_easy_read_font";
const THEME_KEY = "wrystr_theme";

/**
 * The stored theme, mapped off any theme that no longer exists.
 *
 * A retired id is rewritten so the replacement sticks. An unknown id is left
 * in storage: it may belong to a newer build of Vega, and that choice should
 * survive one launch of this build.
 */
function initialThemeId(): string {
  const stored = localStorage.getItem(THEME_KEY);
  const id = resolveThemeId(stored);
  if (stored && isRetiredTheme(stored)) {
    try {
      localStorage.setItem(THEME_KEY, id);
    } catch {
      // Storage is full or blocked. Resolving again on the next launch is fine;
      // failing here would stop the whole store from loading.
    }
  }
  return id;
}
const SCRIPT_FILTER_KEY = "wrystr_script_filter";
const FEED_TAB_KEY = "wrystr_feed_tab";

/** Has the user ever picked a feed tab themselves? */
export function hasChosenFeedTab(): boolean {
  const stored = localStorage.getItem(FEED_TAB_KEY);
  return stored === "global" || stored === "following" || stored === "trending";
}

/**
 * The tab the feed opens on. The last one the user picked, if any. Otherwise
 * the people they chose to follow, not the unfiltered firehose every launch
 * used to open on; signed out there is no Following, so Trending, which is
 * also where "Look around first" has always landed.
 */
function initialFeedTab(): FeedTab {
  const stored = localStorage.getItem(FEED_TAB_KEY);
  if (stored === "global" || stored === "following" || stored === "trending") return stored;
  return localStorage.getItem("wrystr_pubkey") ? "following" : "trending";
}
const HIDE_RSS_ARTICLES_KEY = "wrystr_hide_rss_articles";
const ARTICLES_TAB_KEY = "wrystr_articles_tab";

/** Has the user ever picked an Articles tab themselves? */
export function hasChosenArticlesTab(): boolean {
  const stored = localStorage.getItem(ARTICLES_TAB_KEY);
  return stored === "following" || stored === "latest";
}

/**
 * The tab Articles opens on: the last one the user picked, else the writers
 * they follow. Latest is everyone's, and even filtered it opened on "Privacy
 * notice" and "Refund and guarantee policy" from accounts nobody follows,
 * one click away from a tab that looked like a publication. Signed out there
 * is no Following.
 */
function initialArticlesTab(): ArticlesTab {
  const stored = localStorage.getItem(ARTICLES_TAB_KEY);
  if (stored === "following" || stored === "latest") return stored;
  return localStorage.getItem("wrystr_pubkey") ? "following" : "latest";
}

export const useUIStore = create<UIState>((set, get) => ({
  currentView: "feed",
  sidebarCollapsed: localStorage.getItem(SIDEBAR_KEY) === "true",
  selectedPubkey: null,
  selectedNote: null,
  previousView: "feed",
  viewStack: [],
  trip: 0,
  profileTabs: {},
  rememberProfileTab: (pubkey, tab) => set((s) => {
    const { [pubkey]: _was, ...rest } = s.profileTabs;
    const next: Record<string, ProfileTab> = { ...rest, [pubkey]: tab };
    const keys = Object.keys(next);
    for (const key of keys.slice(0, Math.max(0, keys.length - PROFILE_TABS_KEPT))) delete next[key];
    return { profileTabs: next };
  }),
  feedTab: initialFeedTab(),
  articlesTab: initialArticlesTab(),
  pendingSearch: null,
  pendingDMPubkey: null,
  pendingSettingsGroup: null,
  pendingArticleNaddr: null,
  pendingArticleEvent: null,
  pendingHashtag: null,
  showHelp: false,
  signup: null,
  composeRequest: 0,
  composePendingUntil: 0,
  editProfileFor: null,
  showDebugPanel: false,
  feedLanguageFilter: localStorage.getItem(SCRIPT_FILTER_KEY) || null,
  hideRssArticles: localStorage.getItem(HIDE_RSS_ARTICLES_KEY) !== "false",
  // People opens on the people you follow: the list a new account can act
  // on, not a zero under a different name.
  followsTab: "following",
  fontSize: parseInt(localStorage.getItem(FONT_SIZE_KEY) || "14", 10),
  easyReadFont: localStorage.getItem(EASY_READ_FONT_KEY) === "true",
  themeId: initialThemeId(),
  // A sidebar destination is a fresh start: nothing to go "back" to. Leaving
  // the stack in place made Esc and Back jump to a thread or profile visited
  // before the last sidebar click. It is also a fresh instance of a kept view
  // (`trip`): Notifications chosen again from a thread opened out of it must
  // not be the old list at its old scroll, with its first load never run again.
  setView: (currentView) => set((s) => ({ currentView, viewStack: [], pendingSettingsGroup: null, trip: s.viewStack.length > 0 || s.currentView !== currentView ? s.trip + 1 : s.trip })),
  setArticlesTab: (articlesTab, opts) => {
    if (opts?.remember !== false) localStorage.setItem(ARTICLES_TAB_KEY, articlesTab);
    set({ articlesTab });
  },
  openSignup: (step) => set({ signup: step }),
  requestCompose: () => set((s) => ({ currentView: "feed", viewStack: [], composeRequest: s.composeRequest + 1 })),
  requestComposeWhenReady: (holdMs) => set((s) => ({ currentView: "feed", viewStack: [], composeRequest: s.composeRequest + 1, composePendingUntil: Date.now() + holdMs })),
  takePendingCompose: () => {
    const waiting = get().composePendingUntil > Date.now();
    if (get().composePendingUntil !== 0) set({ composePendingUntil: 0 });
    return waiting;
  },
  openProfileEditor: (pubkey) => { get().openProfile(pubkey); set({ editProfileFor: pubkey }); },
  closeSignup: () => set({ signup: null }),
  setFeedTab: (feedTab, opts) => {
    if (opts?.remember !== false) localStorage.setItem(FEED_TAB_KEY, feedTab);
    set({ feedTab });
  },
  setFollowsTab: (followsTab) => set({ followsTab }),
  openView: (view) => set((s) => {
    // Choosing the view that is already open is not a step: a second entry made the first Back look like nothing.
    if (s.currentView === view) return {};
    return { currentView: view, previousView: s.currentView as View, viewStack: [...s.viewStack, here(s)].slice(-MAX_STACK) };
  }),
  openProfile: (pubkey) => set((s) => {
    const stack = [...s.viewStack, here(s)].slice(-MAX_STACK);
    return { currentView: "profile", selectedPubkey: pubkey, previousView: s.currentView as View, viewStack: stack };
  }),
  openThread: (note, _from) => set((s) => {
    const stack = [...s.viewStack, here(s)].slice(-MAX_STACK);
    return { currentView: "thread", selectedNote: note, previousView: s.currentView as View, viewStack: stack };
  }),
  openSearch: (query) => set({ currentView: "search", pendingSearch: query }),
  openHashtag: (tag) => set((s) => {
    const stack = [...s.viewStack, here(s)].slice(-MAX_STACK);
    return { currentView: "hashtag", pendingHashtag: tag, previousView: s.currentView as View, viewStack: stack };
  }),
  openDM: (pubkey) => set({ currentView: "dm", pendingDMPubkey: pubkey }),
  // A sidebar destination, so the way back is cleared as setView does; the group is what Settings scrolls to.
  openSettings: (group) => set((s) => ({ currentView: "settings", viewStack: [], trip: s.trip + 1, pendingSettingsGroup: group })),
  openArticle: (naddr, event) => set((s) => {
    const stack = [...s.viewStack, here(s)].slice(-MAX_STACK);
    return { currentView: "article", pendingArticleNaddr: naddr, pendingArticleEvent: event ?? null, previousView: s.currentView as View, viewStack: stack };
  }),
  goBack: () => set((s) => {
    const stack = [...s.viewStack];
    const prev = stack.pop();
    if (prev) {
      return { showHelp: false, currentView: prev.view, selectedNote: prev.selectedNote, selectedPubkey: prev.selectedPubkey, pendingArticleNaddr: prev.articleNaddr, pendingArticleEvent: prev.articleEvent, pendingHashtag: prev.hashtag, viewStack: stack };
    }
    return { showHelp: false, currentView: "feed", selectedNote: null, viewStack: [] };
  }),
  setFeedLanguageFilter: (feedLanguageFilter) => {
    if (feedLanguageFilter) {
      localStorage.setItem(SCRIPT_FILTER_KEY, feedLanguageFilter);
    } else {
      localStorage.removeItem(SCRIPT_FILTER_KEY);
    }
    set({ feedLanguageFilter });
  },
  setHideRssArticles: (hideRssArticles) => {
    localStorage.setItem(HIDE_RSS_ARTICLES_KEY, String(hideRssArticles));
    set({ hideRssArticles });
  },
  setFontSize: (fontSize) => {
    localStorage.setItem(FONT_SIZE_KEY, String(fontSize));
    set({ fontSize });
  },
  setEasyReadFont: (easyReadFont) => {
    localStorage.setItem(EASY_READ_FONT_KEY, String(easyReadFont));
    set({ easyReadFont });
  },
  setTheme: (themeId) => {
    localStorage.setItem(THEME_KEY, themeId);
    set({ themeId });
  },
  toggleSidebar: () => set((s) => {
    const next = !s.sidebarCollapsed;
    localStorage.setItem(SIDEBAR_KEY, String(next));
    return { sidebarCollapsed: next };
  }),
  toggleHelp: () => set((s) => ({ showHelp: !s.showHelp })),
  toggleDebugPanel: () => set((s) => ({ showDebugPanel: !s.showDebugPanel })),
}));

// Pause all in-page media (video/audio) when navigating between views
// This prevents background playback when opening thread from feed, etc.
// Note: the podcast player <audio> has a ref and is managed separately.
let prevView = useUIStore.getState().currentView;
useUIStore.subscribe((s) => {
  if (s.currentView !== prevView) {
    prevView = s.currentView;
    document.querySelectorAll<HTMLMediaElement>("main video, main audio").forEach((el) => {
      if (!el.paused) el.pause();
    });
  }
});
