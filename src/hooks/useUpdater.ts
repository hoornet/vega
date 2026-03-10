import { useEffect, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

interface UpdateState {
  available: boolean;
  version: string | null;
  body: string | null;
  installing: boolean;
  error: string | null;
  install: () => Promise<void>;
  dismiss: () => void;
}

export function useUpdater(): UpdateState {
  const [available, setAvailable] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check for updates ~5 s after startup (non-blocking)
    const t = setTimeout(async () => {
      try {
        const update = await check();
        if (update?.available) {
          setAvailable(true);
          setVersion(update.version);
          setBody(update.body ?? null);
        }
      } catch {
        // Update check failure is silent — network may be unavailable
      }
    }, 5000);
    return () => clearTimeout(t);
  }, []);

  const install = async () => {
    setInstalling(true);
    setError(null);
    try {
      const update = await check();
      if (update?.available) {
        await update.downloadAndInstall();
        await relaunch();
      }
    } catch (err) {
      setError(String(err));
      setInstalling(false);
    }
  };

  return {
    available: available && !dismissed,
    version,
    body,
    installing,
    error,
    install,
    dismiss: () => setDismissed(true),
  };
}
