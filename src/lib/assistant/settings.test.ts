import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import {
  normalizeAddress,
  activeProvider,
  assistantEnabled,
  invocationQuestion,
  isAssistantInvocation,
  isLocalAddress,
  readAssistantSettings,
  writeAssistantSettings,
  DEFAULT_ASSISTANT_SETTINGS,
} from "./settings";

// What `@vega` means, what the settings hold, and which provider a request goes to.

beforeEach(() => localStorage.clear());

describe("@vega", () => {
  it("asks the assistant only as a word of its own at the start", () => {
    for (const text of ["@vega what is this?", "  @Vega, summarise", "@vega", "@VEGA: hi", "@vega\nmore"]) {
      expect(isAssistantInvocation(text), text).toBe(true);
    }
    for (const text of ["@vegatron hi", "@vega_fan hi", "hello @vega", "vega what", "", "@veg"]) {
      expect(isAssistantInvocation(text), text).toBe(false);
    }
  });

  it("the question is what follows @vega", () => {
    expect(invocationQuestion("@vega what is this thread about?")).toBe("what is this thread about?");
    expect(invocationQuestion("  @Vega, make this shorter ")).toBe("make this shorter");
    expect(invocationQuestion("@vega")).toBe("");
  });
});

describe("the settings", () => {
  it("are off, with Ollama, until changed", () => {
    expect(readAssistantSettings()).toEqual(DEFAULT_ASSISTANT_SETTINGS);
    expect(assistantEnabled()).toBe(false);
  });

  it("read back what was written, and survive a damaged copy", () => {
    writeAssistantSettings({ ...DEFAULT_ASSISTANT_SETTINGS, enabled: true, preset: "claude", model: { claude: "claude-haiku-5-5" } });
    expect(assistantEnabled()).toBe(true);
    expect(readAssistantSettings().model.claude).toBe("claude-haiku-5-5");
    localStorage.setItem("wrystr_assistant", "{broken");
    expect(readAssistantSettings()).toEqual(DEFAULT_ASSISTANT_SETTINGS);
    localStorage.setItem("wrystr_assistant", JSON.stringify({ enabled: "yes", preset: "evil", model: { claude: 7, ollama: "llama3.2" } }));
    expect(readAssistantSettings()).toMatchObject({ enabled: false, preset: "ollama", model: { ollama: "llama3.2" } });
  });
});

describe("the active provider", () => {
  it("Ollama runs on this computer, at its usual address unless changed", () => {
    const ollama = activeProvider({ ...DEFAULT_ASSISTANT_SETTINGS, model: { ollama: "llama3.2" } });
    expect(ollama).toMatchObject({ kind: "openai", baseUrl: "http://localhost:11434/v1", model: "llama3.2", keySlot: null, local: true });
    const elsewhere = activeProvider({ ...DEFAULT_ASSISTANT_SETTINGS, baseUrl: { ollama: "http://192.168.1.5:11434/v1" } });
    expect(elsewhere.local).toBe(false);
  });

  it("Claude has a fixed address and Sonnet 5.5 by default", () => {
    const claude = activeProvider({ ...DEFAULT_ASSISTANT_SETTINGS, preset: "claude", baseUrl: { claude: "https://evil.example" } });
    expect(claude).toMatchObject({ kind: "anthropic", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-5-5", keySlot: "claude", local: false });
  });

  it("another server is whatever address was given", () => {
    const custom = activeProvider({ ...DEFAULT_ASSISTANT_SETTINGS, preset: "custom", baseUrl: { custom: " https://api.x.ai/v1 " }, model: { custom: "grok-4" } });
    expect(custom).toMatchObject({ kind: "openai", baseUrl: "https://api.x.ai/v1", model: "grok-4", keySlot: "custom" });
  });

  it("knows what is on this computer", () => {
    for (const url of ["http://localhost:11434/v1", "http://127.0.0.1:1234", "http://[::1]:8080"]) expect(isLocalAddress(url), url).toBe(true);
    for (const url of ["https://api.anthropic.com", "http://192.168.1.5", "http://localhost.example", "nonsense"]) expect(isLocalAddress(url), url).toBe(false);
  });
});

describe("review fixes", () => {
  it("a name that starts with 127. is not this computer, but a short loopback address is", () => {
    expect(isLocalAddress("https://127.models.example/v1")).toBe(false);
    expect(isLocalAddress("http://127.1:11434/v1")).toBe(true);
  });

  it("compares addresses as Rust saves them", () => {
    expect(normalizeAddress("https://API.Example.com:443/v1/")).toBe("https://api.example.com/v1");
    expect(normalizeAddress("http://localhost:11434/v1")).toBe("http://localhost:11434/v1");
    expect(normalizeAddress("not an address")).toBeNull();
  });

  it("settings that could not be saved still hold, so the publish guard sees the switch as shown", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      writeAssistantSettings({ ...DEFAULT_ASSISTANT_SETTINGS, enabled: true });
      expect(assistantEnabled()).toBe(true);
    } finally {
      setItem.mockRestore();
    }
    writeAssistantSettings({ ...DEFAULT_ASSISTANT_SETTINGS });
    expect(assistantEnabled()).toBe(false);
  });
});

