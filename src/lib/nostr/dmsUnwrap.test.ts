import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A gift wrap that opens cleanly but isn't a NIP-17 chat message used to be
 * dropped in silence — the fetch worked, AUTH worked, decryption worked, and
 * Messages still showed nothing. Reported on #48 by someone testing with a bot
 * of their own. Own file because it needs `giftUnwrap` mocked at the NDK level.
 */

const addToast = vi.fn();
const giftUnwrap = vi.fn();

vi.mock("@nostr-dev-kit/ndk", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  giftUnwrap: (...args: unknown[]) => giftUnwrap(...args),
}));
vi.mock("./core", () => ({
  getNDK: () => ({ signer: {} }),
  fetchWithTimeout: vi.fn(async () => new Set()),
  getStoredRelayUrls: () => [],
  isLocalRelayUrl: () => false,
  stopSubscription: vi.fn(),
  FEED_TIMEOUT: 8000,
}));
vi.mock("../../stores/toast", () => ({
  useToastStore: { getState: () => ({ addToast }) },
}));

import { unwrapGiftWraps } from "./dms";

const wrap = (id: string) => ({ id }) as never;

beforeEach(() => {
  addToast.mockClear();
  giftUnwrap.mockReset();
});

describe("unwrapGiftWraps", () => {
  it("returns NIP-17 chat messages", async () => {
    giftUnwrap.mockResolvedValue({ kind: 14, content: "hello" });
    const out = await unwrapGiftWraps([wrap("a")]);
    expect(out).toHaveLength(1);
    expect(addToast).not.toHaveBeenCalled();
  });

  it("names every unexpected kind when nothing readable came through", async () => {
    // The bot case: wraps open fine, but hold a kind Vega does not render.
    // Naming the kind is the whole point — it tells the sender what to fix and
    // tells us whether Vega should learn to read it.
    giftUnwrap
      .mockResolvedValueOnce({ kind: 4 })
      .mockResolvedValueOnce({ kind: 1 })
      .mockResolvedValueOnce({ kind: 4 });
    const out = await unwrapGiftWraps([wrap("a"), wrap("b"), wrap("c")]);

    expect(out).toHaveLength(0);
    expect(addToast).toHaveBeenCalledTimes(1);
    const [message] = addToast.mock.calls[0];
    expect(message).toContain("kind 1, 4"); // deduped and sorted
    expect(message).toContain("14");
  });

  it("does not repeat the notice later in the same session", async () => {
    // The poller re-runs this every 60s; the same unreadable wraps come back
    // every time. Deliberately module-level state, so this test depends on the
    // one above having already fired.
    giftUnwrap.mockResolvedValue({ kind: 4 });
    await unwrapGiftWraps([wrap("d")]);
    expect(addToast).not.toHaveBeenCalled();
  });

  it("stays quiet when at least one message did come through", async () => {
    // A single odd wrap alongside real messages is not worth interrupting for.
    giftUnwrap
      .mockResolvedValueOnce({ kind: 14, content: "hi" })
      .mockResolvedValueOnce({ kind: 4 });
    const out = await unwrapGiftWraps([wrap("a"), wrap("b")]);
    expect(out).toHaveLength(1);
    expect(addToast).not.toHaveBeenCalled();
  });

  it("distinguishes an unreadable kind from a failed decryption", async () => {
    // Different causes, different fixes: one is the sender's, the other is a
    // missing signer permission.
    giftUnwrap.mockRejectedValue(new Error("no permission"));
    await unwrapGiftWraps([wrap("a")]);
    expect(addToast.mock.calls[0][0]).toMatch(/couldn't decrypt/i);
  });
});
