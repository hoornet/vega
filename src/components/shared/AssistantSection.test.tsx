import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

// Settings → Assistant: off until switched on; a provider, an address, a model; a key that goes to
// the keychain and is never shown again; a Test that says what happened.

const client = vi.hoisted(() => ({
  assistantKeyStatus: vi.fn(),
  saveAssistantKey: vi.fn(),
  forgetAssistantKey: vi.fn(),
  listAssistantModels: vi.fn(),
  testAssistant: vi.fn(),
}));
vi.mock("../../lib/assistant/client", () => client);

import { AssistantSection } from "./AssistantSection";
import { useAssistantStore } from "../../stores/assistant";
import { DEFAULT_ASSISTANT_SETTINGS, readAssistantSettings } from "../../lib/assistant/settings";

const settings = (change = {}) => useAssistantStore.setState({ settings: { ...DEFAULT_ASSISTANT_SETTINGS, ...change } });
const sw = () => screen.getByRole("switch", { name: "Use an assistant to read and draft" });
const presetButton = (name: string) => screen.getByRole("button", { name });

beforeEach(() => {
  localStorage.clear();
  for (const fn of Object.values(client)) fn.mockReset();
  client.assistantKeyStatus.mockResolvedValue(null);
  settings();
});
afterEach(cleanup);

describe("Settings → Assistant", () => {
  it("is off until switched on, and saves the switch", () => {
    render(<AssistantSection />);
    expect(sw().getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByText("Model name")).toBeNull();
    fireEvent.click(sw());
    expect(readAssistantSettings().enabled).toBe(true);
    expect(screen.getByText("Model name")).toBeTruthy();
  });

  it("starts on Ollama, which says nothing leaves the computer and needs no key", () => {
    settings({ enabled: true });
    render(<AssistantSection />);
    expect(presetButton("Ollama on this computer").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/stays here/)).toBeTruthy();
    expect((screen.getByLabelText("Address") as HTMLInputElement).value).toBe("http://localhost:11434/v1");
    expect(screen.queryByLabelText("API key")).toBeNull();
    expect(client.assistantKeyStatus).not.toHaveBeenCalled();
  });

  it("fills in a model from what the server lists", async () => {
    settings({ enabled: true });
    client.listAssistantModels.mockResolvedValue(["llama3.2:3b", "qwen2.5:7b"]);
    render(<AssistantSection />);
    fireEvent.click(screen.getByRole("button", { name: "Find models" }));
    await waitFor(() => expect((screen.getByLabelText("Model name") as HTMLInputElement).value).toBe("llama3.2:3b"));
    expect(readAssistantSettings().model.ollama).toBe("llama3.2:3b");
  });

  it("Claude asks for a key, saves it for its own address, and then only says it is saved", async () => {
    settings({ enabled: true, preset: "claude" });
    client.saveAssistantKey.mockResolvedValue(undefined);
    render(<AssistantSection />);
    await waitFor(() => expect(client.assistantKeyStatus).toHaveBeenCalledWith("claude"));
    expect(screen.getByText(/sent to Anthropic/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Test" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Save an API key first.")).toBeTruthy();

    client.assistantKeyStatus.mockResolvedValue("https://api.anthropic.com");
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-ant-test" } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    await waitFor(() => expect(screen.getByText("Saved in your keychain.")).toBeTruthy());
    expect(client.saveAssistantKey).toHaveBeenCalledWith("claude", "https://api.anthropic.com", "sk-ant-test");
    expect(screen.queryByLabelText("API key")).toBeNull();
    expect(screen.queryByDisplayValue("sk-ant-test")).toBeNull();
  });

  it("says when the saved key belongs to another address, and that it is not sent here", async () => {
    settings({ enabled: true, preset: "custom", baseUrl: { custom: "https://api.x.ai/v1" }, model: { custom: "grok-4" } });
    client.assistantKeyStatus.mockResolvedValue("https://openrouter.ai/api/v1");
    render(<AssistantSection />);
    await waitFor(() => expect(screen.getByText(/A key is saved for https:\/\/openrouter.ai\/api\/v1, which is not this address/)).toBeTruthy());
    expect(screen.getByLabelText("API key")).toBeTruthy();
  });

  it("removes a saved key", async () => {
    settings({ enabled: true, preset: "claude" });
    client.assistantKeyStatus.mockResolvedValue("https://api.anthropic.com");
    client.forgetAssistantKey.mockResolvedValue(undefined);
    render(<AssistantSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.getByLabelText("API key")).toBeTruthy());
    expect(client.forgetAssistantKey).toHaveBeenCalledWith("claude");
  });

  it("Test says it connected, or why not", async () => {
    settings({ enabled: true, model: { ollama: "llama3.2" } });
    client.testAssistant.mockResolvedValue({ ok: true });
    render(<AssistantSection />);
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    expect(await screen.findByText("Connected: llama3.2 answered.")).toBeTruthy();

    client.testAssistant.mockResolvedValue({ ok: false, reason: "The model server could not be reached. Is it running, and is the address right?" });
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The model server could not be reached. Is it running, and is the address right?");
  });

  it("switching provider keeps each one's own model", () => {
    settings({ enabled: true, model: { ollama: "llama3.2" } });
    render(<AssistantSection />);
    fireEvent.click(presetButton("Claude"));
    expect((screen.getByLabelText("Model name") as HTMLInputElement).value).toBe("claude-sonnet-5-5");
    fireEvent.click(presetButton("Ollama on this computer"));
    expect((screen.getByLabelText("Model name") as HTMLInputElement).value).toBe("llama3.2");
  });

  it("never saves a key typed for one provider for another", async () => {
    settings({ enabled: true, preset: "claude" });
    client.saveAssistantKey.mockResolvedValue(undefined);
    render(<AssistantSection />);
    fireEvent.change(await screen.findByLabelText("API key"), { target: { value: "sk-ant-secret" } });
    fireEvent.click(presetButton("Another server"));
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "https://other.example/v1" } });
    expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: "Save key" }).hasAttribute("disabled")).toBe(true);
    expect(client.saveAssistantKey).not.toHaveBeenCalled();
  });

  it("drops a Test result that arrives after the provider changed", async () => {
    settings({ enabled: true, model: { ollama: "llama3.2" } });
    let finish!: (r: unknown) => void;
    client.testAssistant.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<AssistantSection />);
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    fireEvent.click(presetButton("Claude"));
    finish({ ok: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(/Connected/)).toBeNull();
  });

  it("shows a key as saved however its address was written", async () => {
    settings({ enabled: true, preset: "custom", baseUrl: { custom: "https://API.Example.com:443/v1/" }, model: { custom: "m" } });
    client.assistantKeyStatus.mockResolvedValue("https://api.example.com/v1");
    render(<AssistantSection />);
    expect(await screen.findByText("Saved in your keychain.")).toBeTruthy();
  });

  it("does not save on the Enter that confirms an input method's text", async () => {
    settings({ enabled: true, preset: "claude" });
    client.saveAssistantKey.mockResolvedValue(undefined);
    render(<AssistantSection />);
    const field = await screen.findByLabelText("API key");
    fireEvent.change(field, { target: { value: "sk-ant-x" } });
    fireEvent.keyDown(field, { key: "Enter", keyCode: 229 });
    fireEvent.keyDown(field, { key: "Enter", isComposing: true });
    expect(client.saveAssistantKey).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(client.saveAssistantKey).toHaveBeenCalledWith("claude", "https://api.anthropic.com", "sk-ant-x"));
  });

  it("a model edited while the key saves does not undo the save", async () => {
    settings({ enabled: true, preset: "claude" });
    let finish!: () => void;
    client.saveAssistantKey.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    render(<AssistantSection />);
    fireEvent.change(await screen.findByLabelText("API key"), { target: { value: "sk-ant-x" } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    fireEvent.change(screen.getByLabelText("Model name"), { target: { value: "claude-haiku-5-5" } });
    client.assistantKeyStatus.mockResolvedValue("https://api.anthropic.com");
    finish();
    expect(await screen.findByText("Saved in your keychain.")).toBeTruthy();
  });

  it("shows the providers it will not ask about again, and Ask again forgets them", () => {
    settings({ enabled: true, trustedProviders: ["https://api.anthropic.com", "https://openrouter.ai/api/v1"] });
    render(<AssistantSection />);
    expect(screen.getByText("Not asking again about: Anthropic, openrouter.ai")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ask again" }));
    expect(readAssistantSettings().trustedProviders).toEqual([]);
    expect(screen.queryByText(/Not asking again/)).toBeNull();
  });
});
