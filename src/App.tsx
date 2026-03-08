import { Sidebar } from "./components/sidebar/Sidebar";
import { Feed } from "./components/feed/Feed";
import { RelaysView } from "./components/shared/RelaysView";
import { SettingsView } from "./components/shared/SettingsView";
import { ProfileView } from "./components/profile/ProfileView";
import { useUIStore } from "./stores/ui";

function App() {
  const currentView = useUIStore((s) => s.currentView);

  return (
    <div className="flex h-screen w-screen bg-bg">
      <Sidebar />
      <main className="flex-1 min-w-0">
        {currentView === "feed" && <Feed />}
        {currentView === "relays" && <RelaysView />}
        {currentView === "settings" && <SettingsView />}
        {currentView === "profile" && <ProfileView />}
      </main>
    </div>
  );
}

export default App;
