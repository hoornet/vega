import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NDKEvent } from "@nostr-dev-kit/ndk";
import { publishToNetwork } from "../nostr/core";
import { writeAssistantSettings, DEFAULT_ASSISTANT_SETTINGS } from "./settings";

// With the assistant on, a note that starts with @vega is a question to the assistant: it is never
// signed or published, whatever the box did. With it off, @vega is ordinary text.

function note(content: string) {
  const sign = vi.fn(async () => { throw new Error("signed"); });
  return { event: { content, kind: 1, sig: undefined, sign, ndk: undefined } as unknown as NDKEvent, sign };
}

beforeEach(() => localStorage.clear());

describe("the publish guard", () => {
  it("refuses @vega text before anything is signed while the assistant is on", async () => {
    writeAssistantSettings({ ...DEFAULT_ASSISTANT_SETTINGS, enabled: true });
    const { event, sign } = note("@vega what is this thread about?");
    await expect(publishToNetwork(event)).rejects.toThrow("it starts with @vega, which asks the assistant instead of posting");
    expect(sign).not.toHaveBeenCalled();
  });

  it("lets @vega through as text while the assistant is off, and other text through either way", async () => {
    const off = note("@vega is a star");
    await expect(publishToNetwork(off.event)).rejects.toThrow("signed");
    expect(off.sign).toHaveBeenCalled();
    writeAssistantSettings({ ...DEFAULT_ASSISTANT_SETTINGS, enabled: true });
    const other = note("I like @vegatron");
    await expect(publishToNetwork(other.event)).rejects.toThrow("signed");
  });
});
