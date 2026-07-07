/**
 * Dev-only mock for Tauri's invoke() — lets the frontend run in a plain browser.
 *
 * Provides:
 *   - localStorage-backed keychain (store_nsec / load_nsec / delete_nsec)
 *   - No-op SQLite stubs (db_save_notes / db_load_feed / db_save_profile / db_load_profile)
 *
 * Injected before any invoke() call only when import.meta.env.DEV is true and
 * Tauri internals are not already present (i.e. running in browser, not Tauri window).
 */

if (import.meta.env.DEV && !(window as any).__TAURI_INTERNALS__) {
  const keychainKey = (pubkey: string) => `__dev_nsec_${pubkey}`;
  const proxyKey = "__dev_proxy_settings";

  const mockInvoke = async (cmd: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    switch (cmd) {
      case "store_nsec":
        localStorage.setItem(keychainKey(args.pubkey as string), args.nsec as string);
        return null;
      case "load_nsec":
        return localStorage.getItem(keychainKey(args.pubkey as string)) ?? null;
      case "delete_nsec":
        localStorage.removeItem(keychainKey(args.pubkey as string));
        return null;
      case "get_proxy_settings": {
        const stored = localStorage.getItem(proxyKey);
        return stored ? JSON.parse(stored) : { enabled: false, url: "" };
      }
      case "save_proxy_settings":
        localStorage.setItem(proxyKey, JSON.stringify(args.settings));
        return null;
      case "db_save_notes":
      case "db_save_profile":
        return null;
      case "db_load_feed":
        return [];
      case "db_load_profile":
        return null;
      case "get_proxy_settings":
        return { enabled: false, url: "" };
      case "install_info":
        // Browser dev mode has no real install — mirror useUpdater's default.
        return { can_self_update: true, kind: "updater" };
      default:
        console.warn("[tauri-dev-mock] unhandled invoke:", cmd, args);
        return null;
    }
  };

  (window as any).__TAURI_INTERNALS__ = { invoke: mockInvoke };
  console.info("[tauri-dev-mock] active — using localStorage keychain");
}
