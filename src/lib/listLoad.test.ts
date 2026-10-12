import { describe, it, expect, vi } from "vitest";
import { loadList } from "./listLoad";
import { recordFetchOutcome } from "./nostr/fetchTotals";

// The real totals, played by hand: `recordFetchOutcome(true)` is a fetch the
// network answered, `(false)` one that ended with nobody answering.

/** A fetch that resolves with `items` and records how the relays behaved while it ran. */
const answering = <T,>(items: T[]) => vi.fn(async () => { recordFetchOutcome(true); return items; });
const timingOut = <T,>() => vi.fn(async () => { recordFetchOutcome(false); return [] as T[]; });

describe("loadList", () => {
  it("returns what was found", async () => {
    expect(await loadList(answering(["a", "b"]))).toEqual({ status: "loaded", items: ["a", "b"] });
  });

  // The whole point: these two used to be the same empty list.
  it("is loaded and empty when a relay answered with nothing", async () => {
    expect(await loadList(answering<string>([]))).toEqual({ status: "loaded", items: [] });
  });

  it("is unreachable when nothing came back and nobody answered", async () => {
    expect(await loadList(timingOut<string>())).toEqual({ status: "unreachable" });
  });

  // Nothing was asked through a counted fetch, so nothing is known about the
  // network. It is not this function's place to guess "unreachable".
  it("takes an empty result at its word when no fetch ended at all", async () => {
    expect(await loadList(vi.fn(async () => [] as string[]))).toEqual({ status: "loaded", items: [] });
  });

  it("is not thrown by what happened before it began", async () => {
    recordFetchOutcome(false);
    recordFetchOutcome(false);
    recordFetchOutcome(false);
    expect(await loadList(answering<string>([]))).toEqual({ status: "loaded", items: [] });
  });

  // Another part of the app heard from a relay in the same moment: relays are
  // reachable, so an empty result is taken at its word.
  it("takes an empty result at its word when anything was answered meanwhile", async () => {
    const fetch = vi.fn(async () => { recordFetchOutcome(false); recordFetchOutcome(true); return [] as string[]; });
    expect(await loadList(fetch)).toEqual({ status: "loaded", items: [] });
  });

  // The built-in relay had rows and no remote relay answered: the rows are shown.
  it("does not call a result with rows unreachable, even when nobody on the network answered", async () => {
    expect(await loadList(vi.fn(async () => { recordFetchOutcome(false); return ["cached"]; }))).toEqual({ status: "loaded", items: ["cached"] });
  });

  it("reports a fetch that throws, with its message", async () => {
    expect(await loadList(vi.fn(async () => { throw new Error("no signer"); }))).toEqual({ status: "error", message: "no signer" });
    expect(await loadList(vi.fn(async () => { throw "plain"; }))).toEqual({ status: "error", message: "plain" });
  });

  describe("asking twice", () => {
    it("asks again after a pause when the first answer is empty, and uses the second", async () => {
      vi.useFakeTimers();
      const fetch = vi.fn<() => Promise<string[]>>().mockImplementationOnce(async () => { recordFetchOutcome(true); return []; }).mockImplementationOnce(async () => { recordFetchOutcome(true); return ["late"]; });
      const pending = loadList(fetch, { retryEmptyAfterMs: 3000 });
      await vi.advanceTimersByTimeAsync(3000);
      expect(await pending).toEqual({ status: "loaded", items: ["late"] });
      expect(fetch).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });

    it("does not ask again when the first answer has rows", async () => {
      const fetch = answering(["a"]);
      await loadList(fetch, { retryEmptyAfterMs: 3000 });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("is unreachable when both tries went unanswered", async () => {
      vi.useFakeTimers();
      const fetch = timingOut<string>();
      const pending = loadList(fetch, { retryEmptyAfterMs: 3000 });
      await vi.advanceTimersByTimeAsync(3000);
      expect(await pending).toEqual({ status: "unreachable" });
      expect(fetch).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });

    it("does not ask again when the view moves on during the pause", async () => {
      vi.useFakeTimers();
      let gone = false;
      const fetch = answering<string>([]);
      const pending = loadList(fetch, { retryEmptyAfterMs: 3000, cancelled: () => gone });
      await vi.advanceTimersByTimeAsync(1000);
      expect(fetch).toHaveBeenCalledTimes(1); // the first answer is in, and the pause has begun
      gone = true;
      await vi.advanceTimersByTimeAsync(3000);
      await pending;
      expect(fetch).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it("does not ask again once the view has moved on", async () => {
      vi.useFakeTimers();
      let gone = false;
      const fetch = answering<string>([]);
      const pending = loadList(fetch, { retryEmptyAfterMs: 3000, cancelled: () => gone });
      gone = true;
      await vi.advanceTimersByTimeAsync(3000);
      await pending;
      expect(fetch).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });
  });
});
