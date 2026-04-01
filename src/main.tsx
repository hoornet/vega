import "./lib/tauri-dev-mock"; // must be first — mocks Tauri invoke() in browser dev mode
import { StrictMode, Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { useUserStore } from "./stores/user";

// Error boundary to catch React error #31 and show details instead of blank screen
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[Vega] React error boundary caught:", error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 20, color: "#ff6b6b", fontFamily: "monospace", fontSize: 13 }}>
          <h2>Vega crashed</h2>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {this.state.error.message}
          </pre>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", color: "#aaa", marginTop: 10 }}>
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// Restore session — pubkey (read-only) or nsec via OS keychain
useUserStore.getState().restoreSession();

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
