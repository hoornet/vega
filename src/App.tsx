import { useState, useEffect, lazy, Suspense, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Sidebar } from "./components/sidebar/Sidebar";
import { Feed } from "./components/feed/Feed";
import { OnboardingFlow } from "./components/onboarding/OnboardingFlow";
import { PodcastPlayerBar } from "./components/podcast/PodcastPlayerBar";
import { ToastContainer } from "./components/shared/ToastContainer";
import { ReleaseNoticeBanner } from "./components/shared/ReleaseNoticeBanner";
import { UpdateBanner } from "./components/shared/UpdateBanner";
import { isBrowseOnly } from "./lib/browseOnly";

// Lazy-loaded views — only fetched when navigated to
const SearchView = lazy(() => import("./components/search/SearchView").then(m => ({ default: m.SearchView })));
const RelaysView = lazy(() => import("./components/shared/RelaysView").then(m => ({ default: m.RelaysView })));
const SettingsView = lazy(() => import("./components/shared/SettingsView").then(m => ({ default: m.SettingsView })));
const ProfileView = lazy(() => import("./components/profile/ProfileView").then(m => ({ default: m.ProfileView })));
const ThreadView = lazy(() => import("./components/thread/ThreadView").then(m => ({ default: m.ThreadView })));
const ArticleEditor = lazy(() => import("./components/article/ArticleEditor").then(m => ({ default: m.ArticleEditor })));
const ArticleView = lazy(() => import("./components/article/ArticleView").then(m => ({ default: m.ArticleView })));
const ArticleFeed = lazy(() => import("./components/article/ArticleFeed").then(m => ({ default: m.ArticleFeed })));
const MediaFeed = lazy(() => import("./components/media/MediaFeed").then(m => ({ default: m.MediaFeed })));
const AboutView = lazy(() => import("./components/shared/AboutView").then(m => ({ default: m.AboutView })));
const ZapHistoryView = lazy(() => import("./components/zap/ZapHistoryView").then(m => ({ default: m.ZapHistoryView })));
const DMView = lazy(() => import("./components/dm/DMView").then(m => ({ default: m.DMView })));
const NotificationsView = lazy(() => import("./components/notifications/NotificationsView").then(m => ({ default: m.NotificationsView })));
const BookmarkView = lazy(() => import("./components/bookmark/BookmarkView").then(m => ({ default: m.BookmarkView })));
const HashtagFeed = lazy(() => import("./components/feed/HashtagFeed").then(m => ({ default: m.HashtagFeed })));
const PodcastsView = lazy(() => import("./components/podcast/PodcastsView").then(m => ({ default: m.PodcastsView })));
const FollowsView = lazy(() => import("./components/follows/FollowsView").then(m => ({ default: m.FollowsView })));
const V4VView = lazy(() => import("./components/v4v/V4VView").then(m => ({ default: m.V4VView })));
// The kept views as elements made once: App renders on every navigation, and a new element each time
// would render every hidden list (and parse every note in it) on every click.
const SEARCH = <SearchView />;
const ARTICLES = <ArticleFeed />;
const MEDIA = <MediaFeed />;
const ZAPS = <ZapHistoryView />;
const NOTIFICATIONS = <NotificationsView />;
const BOOKMARKS = <BookmarkView />;
const FOLLOWS = <FollowsView />;
const DebugPanel = lazy(() => import("./components/shared/DebugPanel").then(m => ({ default: m.DebugPanel })));
const HelpModal = lazy(() => import("./components/shared/HelpModal").then(m => ({ default: m.HelpModal })));
import { useUIStore, keptViews, keptHashtags, type View } from "./stores/ui";
import { KeptView } from "./components/shared/KeptView";
import { useCanSign } from "./stores/user";
import { getTheme, applyTheme } from "./lib/themes";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";

function ReadOnlyBanner() {
  const canSign = useCanSign();
  if (canSign) return null;
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-1.5 bg-warning/10 border-b border-warning/30 text-caption shrink-0">
      <span className="text-warning">Read-only mode — sign in to post, react, and zap</span>
    </div>
  );
}

function App() {
  const currentView = useUIStore((s) => s.currentView);
  const viewStack = useUIStore((s) => s.viewStack);
  const trip = useUIStore((s) => s.trip);
  const pendingHashtag = useUIStore((s) => s.pendingHashtag);
  // List views Back can lead to stay mounted and hidden, so Back finds them as they were (see "Back keeps your place").
  // Each has its own Suspense boundary: one boundary around everything hid the kept views with an inline
  // display: none while a lazy view's code loaded, before they were told they were hidden.
  const kept = keptViews({ currentView, viewStack });
  const keep = (view: View, element: ReactNode) => kept.has(view) && (
    <KeptView key={`${view}:${trip}`} hidden={currentView !== view}><Suspense fallback={null}>{element}</Suspense></KeptView>
  );
  const hashtags = keptHashtags({ currentView, viewStack, pendingHashtag });
  const articleKey = useUIStore((s) => s.pendingArticleNaddr ?? "");
  const showHelp = useUIStore((s) => s.showHelp);
  const toggleHelp = useUIStore((s) => s.toggleHelp);
  const showDebugPanel = useUIStore((s) => s.showDebugPanel);
  const toggleDebugPanel = useUIStore((s) => s.toggleDebugPanel);
  const fontSize = useUIStore((s) => s.fontSize);
  const easyReadFont = useUIStore((s) => s.easyReadFont);
  const themeId = useUIStore((s) => s.themeId);
  // A pubkey is no longer the only proof onboarding is done — a user who chose
  // "look around first" has no identity and must not be walled again (#34).
  const [onboardingDone, setOnboardingDone] = useState(
    () => !!localStorage.getItem("wrystr_pubkey") || isBrowseOnly()
  );

  useKeyboardShortcuts();

  // The text-size preset is a CSS zoom on the window's root box below (not on <html>: engines differ on
  // what root zoom does to viewport units). Portals at <body> carry it themselves (BodyPortal).
  // `--window-h` is the window's height in layout px under that zoom, for the few sizes that are a share
  // of the window: `vh` means different things per engine inside a zoom (Chromium multiplies it by the
  // zoom, WebKitGTK does not), so a measured number is the one length both agree on.
  useEffect(() => {
    // Clear any old root zoom
    document.documentElement.style.zoom = "";
    // Set CSS custom property for components that need to know the scale
    document.documentElement.style.setProperty("--ui-zoom", `${fontSize / 14}`);
    const measure = () => document.documentElement.style.setProperty("--window-h", `${Math.round(window.innerHeight / (fontSize / 14))}px`);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [fontSize]);

  // Apply color theme
  useEffect(() => {
    const theme = getTheme(themeId);
    if (theme) applyTheme(theme);
  }, [themeId]);

  // Land signed-out browsers on Trending. feedTab is not persisted, so it would
  // otherwise reset to Global — the firehose — on every launch (#34).
  useEffect(() => {
    if (isBrowseOnly() && !localStorage.getItem("wrystr_pubkey")) {
      useUIStore.getState().setFeedTab("trending", { remember: false });
    }
  }, []);

  // Apply easy-read font class on <html>
  useEffect(() => {
    document.documentElement.classList.toggle("font-readable", easyReadFont);
  }, [easyReadFont]);

  // Intercept external link clicks and open in system browser via Tauri opener
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      // Only intercept external http(s) links
      if (href.startsWith("http://") || href.startsWith("https://")) {
        e.preventDefault();
        e.stopPropagation();
        openUrl(href).catch(() => {});
      }
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, []);

  if (!onboardingDone) {
    // Toasts here too. Onboarding is where a secret key is first copied and
    // first saved: a copy that failed, or a keychain that refused the key,
    // was raised into a stack that nothing on this screen drew.
    return (
      <>
        <OnboardingFlow onComplete={() => setOnboardingDone(true)} />
        <ToastContainer />
      </>
    );
  }

  return (
    // Sized by its edges, not in vh/vw: inside a zoom, Chromium makes 100vh the viewport times the
    // zoom (WebKitGTK does not), so the window's root box would overflow by the factor at Large and
    // Extra Large on Windows. The zoom is here, on everything (the sidebar, the banners, the player
    // bar), not on <main> alone: the people who pick Extra Large are the ones who could not read the
    // sidebar's 13px labels, which stayed 13px.
    <div className="fixed inset-0 flex flex-col bg-bg" style={{ zoom: `${fontSize / 14}` }}>
      <UpdateBanner />
      <ReleaseNoticeBanner />
      <ReadOnlyBanner />
      <div className="flex flex-1 min-h-0">
      <Sidebar />
      <main className="flex-1 min-w-0 h-full overflow-hidden">
        <div className={currentView === "feed" ? "contents" : "hidden"}>
          <Feed />
        </div>
        {keep("search", SEARCH)}
        {currentView === "relays" && <Suspense fallback={null}><RelaysView /></Suspense>}
        {currentView === "settings" && <Suspense fallback={null}><SettingsView /></Suspense>}
        {currentView === "profile" && <Suspense fallback={null}><ProfileView /></Suspense>}
        {currentView === "thread" && <Suspense fallback={null}><ThreadView /></Suspense>}
        {keep("articles", ARTICLES)}
        {keep("media", MEDIA)}
        {currentView === "article-editor" && <Suspense fallback={null}><ArticleEditor /></Suspense>}
        {/* Keyed by the article: a comment or a like still on its way for the last one must not land on this one. */}
        {currentView === "article" && <Suspense fallback={null}><ArticleView key={articleKey} /></Suspense>}
        {currentView === "about" && <Suspense fallback={null}><AboutView /></Suspense>}
        {keep("zaps", ZAPS)}
        {currentView === "dm" && <Suspense fallback={null}><DMView /></Suspense>}
        {keep("notifications", NOTIFICATIONS)}
        {keep("bookmarks", BOOKMARKS)}
        {/* One page per tag, so Back to #vega finds #vega's rows at #vega's scroll. */}
        {hashtags.map((tag) => (
          <KeptView key={`hashtag:${tag}:${trip}`} hidden={!(currentView === "hashtag" && pendingHashtag === tag)}>
            <Suspense fallback={null}><HashtagFeed tag={tag} /></Suspense>
          </KeptView>
        ))}
        {currentView === "podcasts" && <Suspense fallback={null}><PodcastsView /></Suspense>}
        {keep("follows", FOLLOWS)}
        {currentView === "v4v" && <Suspense fallback={null}><V4VView /></Suspense>}
      </main>
      </div>
      <PodcastPlayerBar />
      <ToastContainer />
      {showDebugPanel && <DebugPanel onClose={toggleDebugPanel} />}
      {showHelp && <HelpModal onClose={toggleHelp} />}
    </div>
  );
}

export default App;
