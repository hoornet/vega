import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withinTime } from "./timeLimit";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("withinTime", () => {
  it("is the work's own result when it finishes in time, and leaves no clock running", async () => {
    await expect(withinTime(Promise.resolve("sent"), 20000, "too slow")).resolves.toBe("sent");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is the work's own failure when it fails in time, and leaves no clock running", async () => {
    await expect(withinTime(Promise.reject(new Error("no relays")), 20000, "too slow")).rejects.toThrow("no relays");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gives up with the message once the time is over, and not before", async () => {
    let outcome = "waiting";
    withinTime(new Promise(() => {}), 20000, "no answer after 20 seconds").then(
      () => { outcome = "done"; },
      (err: Error) => { outcome = err.message; },
    );
    await vi.advanceTimersByTimeAsync(19999);
    expect(outcome).toBe("waiting");
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toBe("no answer after 20 seconds");
  });

  // The work is not stopped: a signer that answers late still publishes.
  it("does not mind the work finishing, or failing, after it gave up", async () => {
    let finish: (value: string) => void = () => {};
    const limited = withinTime(new Promise<string>((resolve) => { finish = resolve; }), 1000, "too slow");
    const seen = limited.catch((err: Error) => err.message);
    await vi.advanceTimersByTimeAsync(1000);
    finish("late");
    await expect(seen).resolves.toBe("too slow");

    let fail: (err: Error) => void = () => {};
    const second = withinTime(new Promise<string>((_, reject) => { fail = reject; }), 1000, "too slow").catch((err: Error) => err.message);
    await vi.advanceTimersByTimeAsync(1000);
    fail(new Error("late failure"));
    await expect(second).resolves.toBe("too slow");
  });
});
