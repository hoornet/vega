import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ActiveProvider } from "./settings";

/**
 * Talking to the model, through Rust (`src-tauri/src/assistant.rs`): Rust holds the keys, sends the
 * request and streams the answer back as `assistant-chunk` events. Nothing here sees a key.
 */

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AskOptions {
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  /** Each piece of the answer as it arrives. */
  onText?: (text: string) => void;
}

export interface AskHandle {
  /** The whole answer once it ends, or the reason it failed, as a sentence. */
  done: Promise<string>;
  /** Stops the answer; `done` resolves with what arrived. */
  cancel: () => void;
}

let counter = 0;

function newId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}

/** Asks the model. The answer streams to `onText`; `done` resolves with all of it. */
export function askAssistant(provider: ActiveProvider, options: AskOptions): AskHandle {
  const id = newId();
  let cancelled = false;
  const done = (async () => {
    const stop = await listen<{ id: string; text: string }>("assistant-chunk", (event) => {
      if (event.payload.id === id) options.onText?.(event.payload.text);
    });
    try {
      if (cancelled) return "";
      return await invoke<string>("assistant_ask", {
        request: {
          id,
          slot: provider.keySlot ?? provider.preset,
          kind: provider.kind,
          baseUrl: provider.baseUrl,
          model: provider.model,
          maxTokens: options.maxTokens ?? 1024,
          system: options.system,
          messages: options.messages,
        },
      });
    } finally {
      stop();
    }
  })();
  return {
    done,
    cancel: () => {
      cancelled = true;
      invoke("assistant_cancel", { id }).catch(() => {});
    },
  };
}

/** Saves an API key for a slot, to be sent to `baseUrl` and nowhere else. */
export function saveAssistantKey(slot: string, baseUrl: string, key: string): Promise<void> {
  return invoke("assistant_save_key", { slot, baseUrl, key });
}

/** The address a slot's key is saved for, or null. Never the key. */
export function assistantKeyStatus(slot: string): Promise<string | null> {
  return invoke<string | null>("assistant_key_status", { slot });
}

export function forgetAssistantKey(slot: string): Promise<void> {
  return invoke("assistant_forget_key", { slot });
}

/** The models the provider offers, by name. */
export function listAssistantModels(provider: ActiveProvider): Promise<string[]> {
  return invoke<string[]>("assistant_models", {
    slot: provider.keySlot ?? provider.preset,
    kind: provider.kind,
    baseUrl: provider.baseUrl,
  });
}

/** One tiny request: whether the provider answers, with this address, model and key. */
export async function testAssistant(provider: ActiveProvider): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await askAssistant(provider, {
      system: "You are a connection test. Reply with the single word OK.",
      messages: [{ role: "user", content: "Are you there?" }],
      maxTokens: 8,
    }).done;
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err) };
  }
}
