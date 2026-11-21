/** Types of the assistant (CLAUDE.md, "The assistant"). */

/** Which wire format a provider speaks: Anthropic's Messages API, or OpenAI-compatible chat completions. */
export type ProviderKind = "anthropic" | "openai";

export type PresetId = "ollama" | "claude" | "custom";

export interface Preset {
  id: PresetId;
  label: string;
  kind: ProviderKind;
  /** The keychain slot for this provider's key, or null for one that takes none. */
  keySlot: "claude" | "custom" | null;
  defaultBaseUrl: string;
  /** Claude's address is fixed; the others can be changed. */
  baseUrlEditable: boolean;
  defaultModel: string;
}

export interface AssistantSettings {
  enabled: boolean;
  preset: PresetId;
  /** The address and the model chosen for each preset, kept when switching between them. */
  baseUrl: Partial<Record<PresetId, string>>;
  model: Partial<Record<PresetId, string>>;
  /** Send your own recent notes along when asked to draft "in my tone". */
  useMyNotes: boolean;
  /** Ask once per provider before anything goes to a model that is not on this computer. */
  askBeforeCloud: boolean;
  /** Providers the user said not to be asked about again, by base URL. */
  trustedProviders: string[];
}

/** What a request is sent with: the active preset, its address and model, and its key slot. */
export interface ActiveProvider {
  preset: PresetId;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  keySlot: "claude" | "custom" | null;
  /** On this computer: nothing leaves it. */
  local: boolean;
}

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
