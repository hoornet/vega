import { useState } from "react";
import { Sidebar } from "./components/sidebar/Sidebar";
import { Feed } from "./components/feed/Feed";
import { SearchView } from "./components/search/SearchView";
import { RelaysView } from "./components/shared/RelaysView";
import { SettingsView } from "./components/shared/SettingsView";
import { ProfileView } from "./components/profile/ProfileView";
import { ThreadView } from "./components/thread/ThreadView";
import { ArticleEditor } from "./components/article/ArticleEditor";
import { ArticleView } from "./components/article/ArticleView";
import { OnboardingFlow } from "./components/onboarding/OnboardingFlow";
import { AboutView } from "./components/shared/AboutView";
import { ZapHistoryView } from "./components/zap/ZapHistoryView";
import { DMView } from "./components/dm/DMView";
import { useUIStore } from "./stores/ui";
import { useUpdater } from "./hooks/useUpdater";

function UpdateBanner() {
  const { available, version, installing, error, install, dismiss } = useUpdater();
  if (!available) return null;
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-accent/10 border-b border-accent/30 text-[12px] shrink-0">
      <span className="text-text">
        Wrystr {version} is available.{" "}
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
        <button onClick={dismiss} className="text-text-dim hover:text-text transition-colors">×</button>
      </div>
    </div>
  );
}

function App() {
  const currentView = useUIStore((s) => s.currentView);
  const [onboardingDone, setOnboardingDone] = useState(
    () => !!localStorage.getItem("wrystr_pubkey")
  );

  if (!onboardingDone) {
    return <OnboardingFlow onComplete={() => setOnboardingDone(true)} />;
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-bg">
      <UpdateBanner />
      <div className="flex flex-1 min-h-0">
      <Sidebar />
      <main className="flex-1 min-w-0">
        {currentView === "feed" && <Feed />}
        {currentView === "search" && <SearchView />}
        {currentView === "relays" && <RelaysView />}
        {currentView === "settings" && <SettingsView />}
        {currentView === "profile" && <ProfileView />}
        {currentView === "thread" && <ThreadView />}
        {currentView === "article-editor" && <ArticleEditor />}
        {currentView === "article" && <ArticleView />}
        {currentView === "about" && <AboutView />}
        {currentView === "zaps" && <ZapHistoryView />}
        {currentView === "dm" && <DMView />}
      </main>
      </div>
    </div>
  );
}

export default App;
