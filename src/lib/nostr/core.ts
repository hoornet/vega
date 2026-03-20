import NDK, { NDKRelay } from "@nostr-dev-kit/ndk";

export const RELAY_STORAGE_KEY = "wrystr_relays";

export const FALLBACK_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.snort.social",
];

export function getStoredRelayUrls(): string[] {
  try {
    const stored = localStorage.getItem(RELAY_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return FALLBACK_RELAYS;
}

export function saveRelayUrls(urls: string[]) {
  localStorage.setItem(RELAY_STORAGE_KEY, JSON.stringify(urls));
}

let ndk: NDK | null = null;

export function getNDK(): NDK {
  if (!ndk) {
    ndk = new NDK({
      explicitRelayUrls: getStoredRelayUrls(),
    });
  }
  return ndk;
}

export function addRelay(url: string): void {
  const instance = getNDK();
  const urls = getStoredRelayUrls();
  if (!urls.includes(url)) {
    saveRelayUrls([...urls, url]);
  }
  if (!instance.pool?.relays.has(url)) {
    const relay = new NDKRelay(url, undefined, instance);
    instance.pool?.addRelay(relay, true);
  }
}

export function removeRelay(url: string): void {
  const instance = getNDK();
  const relay = instance.pool?.relays.get(url);
  if (relay) {
    relay.disconnect();
    instance.pool?.relays.delete(url);
  }
  saveRelayUrls(getStoredRelayUrls().filter((u) => u !== url));
}

function waitForConnectedRelay(instance: NDK, timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, _reject) => {
    const timer = setTimeout(() => {
      // Even on timeout, continue — some relays may connect later
      console.warn("Relay connection timeout, continuing anyway");
      resolve();
    }, timeoutMs);

    const check = () => {
      const relays = Array.from(instance.pool?.relays?.values() ?? []);
      const hasConnected = relays.some((r) => r.connected);
      if (hasConnected) {
        clearTimeout(timer);
        resolve();
      } else {
        setTimeout(check, 300);
      }
    };
    check();
  });
}

export async function connectToRelays(): Promise<void> {
  const instance = getNDK();
  await instance.connect();
  await waitForConnectedRelay(instance);
}
