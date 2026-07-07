import { useEffect, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";
import { getProxySettings } from "../lib/proxy";

interface InstallInfo {
  can_self_update: boolean;
  kind: string;
}

interface UpdateState {
  available: boolean;
  version: string | null;
  body: string | null;
  installing: boolean;
  error: string | null;
  canSelfUpdate: boolean;
  kind: string;
  install: () => Promise<void>;
  dismiss: () => void;
}

async function checkForUpdate() {
  const settings = await getProxySettings();
  const proxy = settings.enabled ? settings.url.trim() : "";
  return check(proxy ? { proxy } : undefined);
}

export function useUpdater(): UpdateState {
  const [available, setAvailable] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  // Optimistic default: assume the updater works until the backend says otherwise.
  const [installInfo, setInstallInfo] = useState<InstallInfo>({ can_self_update: true, kind: "updater" });

  useEffect(() => {
    invoke<InstallInfo>("install_info")
      // Guard: a null/garbage response must not blow away the optimistic
      // default — installInfo is dereferenced unconditionally in the return.
      .then((info) => { if (info) setInstallInfo(info); })
      .catch(() => { /* keep optimistic default */ });
  }, []);

  useEffect(() => {
    // Check for updates ~5 s after startup (non-blocking)
    const t = setTimeout(async () => {
      try {
        const update = await checkForUpdate();
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
      const update = await checkForUpdate();
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
    canSelfUpdate: installInfo.can_self_update,
    kind: installInfo.kind,
    install,
    dismiss: () => setDismissed(true),
  };
}
