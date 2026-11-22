import { describe, it, expect, vi, beforeEach } from "vitest";

// Test is "Connected" only when the model said something: a wrong address that answers with a page,
// or a model that returns nothing, is not a connection.

const tauri = vi.hoisted(() => ({ answer: "" as string | Error }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd !== "assistant_ask") return undefined;
    if (tauri.answer instanceof Error) throw tauri.answer.message;
    return tauri.answer;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { testAssistant } from "./client";
import type { ActiveProvider } from "../../types/assistant";

const provider: ActiveProvider = {
  preset: "ollama", label: "Ollama", kind: "openai", baseUrl: "http://localhost:11434/v1", model: "llama3.2", keySlot: null, local: true,
};

beforeEach(() => { tauri.answer = ""; });

describe("testAssistant", () => {
  it("is connected when the model answers", async () => {
    tauri.answer = "OK";
    expect(await testAssistant(provider)).toEqual({ ok: true });
  });

  it("is not connected when the model says nothing", async () => {
    tauri.answer = "  ";
    expect(await testAssistant(provider)).toEqual({ ok: false, reason: "The server answered, but the model said nothing. Check the model name." });
  });

  it("passes on Rust's reason", async () => {
    tauri.answer = new Error("The server answered, but not with a model's reply. Check the address and the model.");
    expect(await testAssistant(provider)).toEqual({ ok: false, reason: "The server answered, but not with a model's reply. Check the address and the model." });
  });
});
