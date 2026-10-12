import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { copyText } from "./clipboard";
import { useToastStore } from "../stores/toast";

const toasts = () => useToastStore.getState().toasts;
const writeText = vi.fn();
const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  useToastStore.setState({ toasts: [] });
});
afterEach(() => {
  if (original) Object.defineProperty(navigator, "clipboard", original);
  else delete (navigator as { clipboard?: unknown }).clipboard;
});

describe("copyText", () => {
  it("copies, and says so when asked to", async () => {
    expect(await copyText("nostr:naddr1…", "Link copied.")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("nostr:naddr1…");
    expect(toasts().map((t) => [t.type, t.message])).toEqual([["success", "Link copied."]]);
  });

  // The button shows its own "Copied": a toast as well would say it twice.
  it("says nothing on success when the caller shows it", async () => {
    expect(await copyText("npub1…")).toBe(true);
    expect(toasts()).toEqual([]);
  });

  // Three places showed "Copied" without waiting, one of them for a secret key.
  it("says so, and answers false, when the text could not be copied", async () => {
    writeText.mockRejectedValue(new Error("NotAllowedError"));
    expect(await copyText("nsec1…")).toBe(false);
    expect(toasts().map((t) => [t.type, t.message])).toEqual([["error", "Couldn't copy to the clipboard."]]);
  });

  it("does not put what was to be copied into the message", async () => {
    writeText.mockRejectedValue(new Error("NotAllowedError"));
    await copyText("nsec1verysecret", "Key copied.");
    expect(JSON.stringify(toasts())).not.toContain("nsec1verysecret");
  });

  it("answers false without throwing where there is no clipboard at all", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    expect(await copyText("x", "Copied.")).toBe(false);
    expect(toasts()).toHaveLength(1);
  });
});
