import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

export interface ProxySettings {
  enabled: boolean;
  url: string;
}

type TauriFetchInput = Parameters<typeof tauriFetch>[0];
type TauriFetchInit = Parameters<typeof tauriFetch>[1];
type TauriFetchInitWithProxy = NonNullable<TauriFetchInit> & {
  proxy?: {
    all?: string;
  };
};

let proxySettingsPromise: Promise<ProxySettings> | null = null;

/**
 * Upgrade `socks5://` to `socks5h://` for requests that go out through Rust.
 *
 * With plain `socks5`, the client resolves hostnames itself, so a user on Tor
 * still leaks every relay/media hostname to their DNS resolver. `socks5h` hands
 * the hostname to the proxy instead. reqwest — which backs both plugin-http and
 * the updater — supports it; the webview's `proxy_url` only documents `socks5`,
 * so the stored setting stays `socks5://` and this upgrade is applied per call.
 * See https://github.com/hoornet/vega/issues/11.
 */
export function remoteDnsProxyUrl(url: string): string {
  const trimmed = url.trim();
  const socks5 = "socks5://";
  return trimmed.startsWith(socks5) ? `socks5h://${trimmed.slice(socks5.length)}` : trimmed;
}

export function getProxySettings(): Promise<ProxySettings> {
  if (!proxySettingsPromise) {
    proxySettingsPromise = invoke<ProxySettings>("get_proxy_settings")
      .then((settings) => settings ?? { enabled: false, url: "" })
      .catch(() => ({ enabled: false, url: "" }));
  }
  return proxySettingsPromise;
}

export function refreshProxySettingsCache(): void {
  proxySettingsPromise = null;
}

export async function fetchWithProxy(input: TauriFetchInput, init?: TauriFetchInit): Promise<Response> {
  const settings = await getProxySettings();
  if (!settings.enabled || !settings.url.trim()) {
    return tauriFetch(input, init);
  }

  const proxiedInit: TauriFetchInitWithProxy = {
    ...(init ?? {}),
    proxy: { all: remoteDnsProxyUrl(settings.url) },
  };
  return tauriFetch(input, proxiedInit);
}
