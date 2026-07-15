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
    proxy: { all: settings.url.trim() },
  };
  return tauriFetch(input, proxiedInit);
}
