import { useState, useEffect, lazy, Suspense } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Sidebar } from "./components/sidebar/Sidebar";
import { Feed } from "./components/feed/Feed";
import { OnboardingFlow } from "./components/onboarding/OnboardingFlow";
import { PodcastPlayerBar } from "./components/podcast/PodcastPlayerBar";
import { ToastContainer } from "./components/shared/ToastContainer";

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
const DebugPanel = lazy(() => import("./components/shared/DebugPanel").then(m => ({ default: m.DebugPanel })));
const HelpModal = lazy(() => import("./components/shared/HelpModal").then(m => ({ default: m.HelpModal })));
import { useUIStore } from "./stores/ui";
import { useUserStore } from "./stores/user";
import { getTheme, applyTheme } from "./lib/themes";
import { useUpdater } from "./hooks/useUpdater";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";

function UpdateBanner() {
  const { available, version, installing, error, install, dismiss } = useUpdater();
  if (!available) return null;
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-accent/10 border-b border-accent/30 text-[12px] shrink-0">
      <span className="text-text">
        Vega {version} is available.{" "}
        {error && <span className="text-danger ml-1">{error}</span>}
      </span>
      <div className="flex items-center gap-3">
        <button
          onClick={install}
          disabled={installing}
          className="text-accent hover:text-accent-hover transition-colors disabled:opacity-50"
        >
          {installing ? "Installing…" : "Update & restart"}
        </button>
        <button onClick={dismiss} aria-label="Dismiss update" className="text-text-dim hover:text-text transition-colors">×</button>
      </div>
    </div>
  );
}

function ReadOnlyBanner() {
  const loggedIn = useUserStore((s) => s.loggedIn);
  if (loggedIn) return null;
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-1.5 bg-warning/10 border-b border-warning/30 text-[11px] shrink-0">
      <span className="text-warning">Read-only mode — sign in to post, react, and zap</span>
    </div>
  );
}

function App() {
  const currentView = useUIStore((s) => s.currentView);
  const showHelp = useUIStore((s) => s.showHelp);
  const toggleHelp = useUIStore((s) => s.toggleHelp);
  const showDebugPanel = useUIStore((s) => s.showDebugPanel);
  const toggleDebugPanel = useUIStore((s) => s.toggleDebugPanel);
  const fontSize = useUIStore((s) => s.fontSize);
  const themeId = useUIStore((s) => s.themeId);
  const [onboardingDone, setOnboardingDone] = useState(
    () => !!localStorage.getItem("wrystr_pubkey")
  );

  useKeyboardShortcuts();

  // Apply zoom to main content area only (sidebar stays fixed size)
  useEffect(() => {
    // Clear any old root zoom
    document.documentElement.style.zoom = "";
    // Set CSS custom property for components that need to know the scale
    document.documentElement.style.setProperty("--ui-zoom", `${fontSize / 14}`);
  }, [fontSize]);

  // Apply color theme
  useEffect(() => {
    const theme = getTheme(themeId);
    if (theme) applyTheme(theme);
  }, [themeId]);

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
    return <OnboardingFlow onComplete={() => setOnboardingDone(true)} />;
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-bg">
      <UpdateBanner />
      <ReadOnlyBanner />
      <div className="flex flex-1 min-h-0">
      <Sidebar />
      <main className="flex-1 min-w-0 h-full overflow-hidden" style={{ zoom: `${fontSize / 14}` }}>
        <div className={currentView === "feed" ? "contents" : "hidden"}>
          <Feed />
        </div>
        <Suspense fallback={null}>
          {currentView === "search" && <SearchView />}
          {currentView === "relays" && <RelaysView />}
          {currentView === "settings" && <SettingsView />}
          {currentView === "profile" && <ProfileView />}
          {currentView === "thread" && <ThreadView />}
          {currentView === "articles" && <ArticleFeed />}
          {currentView === "media" && <MediaFeed />}
          {currentView === "article-editor" && <ArticleEditor />}
          {currentView === "article" && <ArticleView />}
          {currentView === "about" && <AboutView />}
          {currentView === "zaps" && <ZapHistoryView />}
          {currentView === "dm" && <DMView />}
          {currentView === "notifications" && <NotificationsView />}
          {currentView === "bookmarks" && <BookmarkView />}
          {currentView === "hashtag" && <HashtagFeed />}
          {currentView === "podcasts" && <PodcastsView />}
          {currentView === "follows" && <FollowsView />}
          {currentView === "v4v" && <V4VView />}
        </Suspense>
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
