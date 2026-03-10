import { useState } from "react";
import { Sidebar } from "./components/sidebar/Sidebar";
import { Feed } from "./components/feed/Feed";
import { SearchView } from "./components/search/SearchView";
import { RelaysView } from "./components/shared/RelaysView";
import { SettingsView } from "./components/shared/SettingsView";
import { ProfileView } from "./components/profile/ProfileView";
import { ThreadView } from "./components/thread/ThreadView";
import { ArticleEditor } from "./components/article/ArticleEditor";
import { OnboardingFlow } from "./components/onboarding/OnboardingFlow";
import { AboutView } from "./components/shared/AboutView";
import { ZapHistoryView } from "./components/zap/ZapHistoryView";
import { DMView } from "./components/dm/DMView";
import { useUIStore } from "./stores/ui";

function App() {
  const currentView = useUIStore((s) => s.currentView);
  const [onboardingDone, setOnboardingDone] = useState(
    () => !!localStorage.getItem("wrystr_pubkey")
  );

  if (!onboardingDone) {
    return <OnboardingFlow onComplete={() => setOnboardingDone(true)} />;
  }

  return (
    <div className="flex h-screen w-screen bg-bg">
      <Sidebar />
      <main className="flex-1 min-w-0">
        {currentView === "feed" && <Feed />}
        {currentView === "search" && <SearchView />}
        {currentView === "relays" && <RelaysView />}
        {currentView === "settings" && <SettingsView />}
        {currentView === "profile" && <ProfileView />}
        {currentView === "thread" && <ThreadView />}
        {currentView === "article-editor" && <ArticleEditor />}
        {currentView === "about" && <AboutView />}
        {currentView === "zaps" && <ZapHistoryView />}
        {currentView === "dm" && <DMView />}
      </main>
    </div>
  );
}

export default App;
