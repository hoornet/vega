/**
 * The assistant's settings (Settings → Assistant), and what `@vega` means. A leaf: the publish
 * path reads `assistantEnabled` and `isAssistantInvocation` from here without pulling in a store.
 *
 * The API keys are not here: they live in the OS keychain, handled by Rust
 * (`src-tauri/src/assistant.rs`), and never reach the webview.
 */

import type { ActiveProvider, AssistantSettings, Preset, PresetId } from "../../types/assistant";

export const PRESETS: Record<PresetId, Preset> = {
  ollama: {
    id: "ollama",
    label: "Ollama on this computer",
    kind: "openai",
    keySlot: null,
    defaultBaseUrl: "http://localhost:11434/v1",
    baseUrlEditable: true,
    defaultModel: "",
  },
  claude: {
    id: "claude",
    label: "Claude",
    kind: "anthropic",
    keySlot: "claude",
    defaultBaseUrl: "https://api.anthropic.com",
    baseUrlEditable: false,
    defaultModel: "claude-sonnet-5-5",
  },
  custom: {
    id: "custom",
    label: "Another server",
    kind: "openai",
    keySlot: "custom",
    defaultBaseUrl: "",
    baseUrlEditable: true,
    defaultModel: "",
  },
};

export const PRESET_ORDER: PresetId[] = ["ollama", "claude", "custom"];

export const DEFAULT_ASSISTANT_SETTINGS: AssistantSettings = {
  enabled: false,
  preset: "ollama",
  baseUrl: {},
  model: {},
  useMyNotes: true,
  askBeforeCloud: true,
  trustedProviders: [],
};

const STORAGE_KEY = "wrystr_assistant";

function isPreset(value: unknown): value is PresetId {
  return value === "ollama" || value === "claude" || value === "custom";
}

function stringMap(value: unknown): Partial<Record<PresetId, string>> {
  const out: Partial<Record<PresetId, string>> = {};
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (isPreset(key) && typeof entry === "string") out[key] = entry.slice(0, 500);
    }
  }
  return out;
}

/** Settings that could not be saved, which hold until the next save works. */
let unsaved: AssistantSettings | null = null;

/** The saved settings, or the defaults for anything missing or malformed. */
export function readAssistantSettings(): AssistantSettings {
  if (unsaved) return unsaved;
  let raw: unknown = null;
  try {
    raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== "object") return { ...DEFAULT_ASSISTANT_SETTINGS };
  const r = raw as Record<string, unknown>;
  return {
    enabled: r.enabled === true,
    preset: isPreset(r.preset) ? r.preset : DEFAULT_ASSISTANT_SETTINGS.preset,
    baseUrl: stringMap(r.baseUrl),
    model: stringMap(r.model),
    useMyNotes: r.useMyNotes !== false,
    askBeforeCloud: r.askBeforeCloud !== false,
    trustedProviders: Array.isArray(r.trustedProviders)
      ? r.trustedProviders.filter((p): p is string => typeof p === "string").slice(0, 20)
      : [],
  };
}

export function writeAssistantSettings(settings: AssistantSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    unsaved = null;
  } catch {
    // A full or blocked storage: these settings hold for this session, for everything that reads
    // them, the publish guard included. A switch shown on must never read as off there.
    unsaved = settings;
  }
}

/** Whether the assistant is switched on. */
export function assistantEnabled(): boolean {
  return readAssistantSettings().enabled;
}

/**
 * Whether text asks the assistant instead of being a note: it starts with `@vega`, as a word of its
 * own (`@vegatron` and `@vega_fan` are ordinary text).
 */
export function isAssistantInvocation(text: string): boolean {
  return /^\s*@vega(?=$|[\s,.:;!?])/i.test(text);
}

/** The question in an invocation: the text after `@vega`. */
export function invocationQuestion(text: string): string {
  return text.replace(/^\s*@vega[,.:;!?]?/i, "").trim();
}

/**
 * Whether an address is on this computer: a model there sees nothing leave it. `localhost`, `::1`,
 * or an IPv4 address in 127.0.0.0/8; a name that merely starts with "127." is somewhere else.
 * `URL` has already written a numeric address in dotted form.
 */
export function isLocalAddress(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return host === "localhost" || host === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
  } catch {
    return false;
  }
}

/**
 * An address as Rust compares it (`normalize_base`): host in lower case, no default port, no
 * trailing slash. Null when it is not an address.
 */
export function normalizeAddress(url: string): string | null {
  try {
    const u = new URL(url.trim());
    return `${u.protocol}//${u.host}${u.pathname}`.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function activeProvider(settings: AssistantSettings): ActiveProvider {
  const preset = PRESETS[settings.preset];
  const baseUrl = (preset.baseUrlEditable ? settings.baseUrl[preset.id] : undefined)?.trim() || preset.defaultBaseUrl;
  const model = settings.model[preset.id]?.trim() || preset.defaultModel;
  return {
    preset: preset.id,
    label: preset.label,
    kind: preset.kind,
    baseUrl,
    model,
    keySlot: preset.keySlot,
    local: isLocalAddress(baseUrl),
  };
}
