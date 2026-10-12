import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { useLoadedList } from "./useLoadedList";
import { recordFetchOutcome } from "../lib/nostr/fetchTotals";

/** Every render, as it happened: what the list was for, and what the hook said. */
const renders: { tag: string; status: string; items: string }[] = [];

function List({ tag, fetch, enabled }: { tag: string; fetch: (tag: string) => Promise<string[]>; enabled?: boolean }) {
  const list = useLoadedList(() => fetch(tag), [tag], { enabled });
  renders.push({ tag, status: list.status, items: list.items.join(",") });
  return (<div><span data-testid="status">{list.status}</span><span data-testid="items">{list.items.join(",")}</span><span data-testid="message">{list.message ?? ""}</span><button onClick={list.reload}>again</button></div>);
}
const status = () => screen.getByTestId("status").textContent;
const items = () => screen.getByTestId("items").textContent;

beforeEach(() => { renders.length = 0; });
afterEach(cleanup);

describe("useLoadedList", () => {
  it("is loading, then loaded with what was found", async () => {
    render(<List tag="nostr" fetch={async () => { recordFetchOutcome(true); return ["a", "b"]; }} />);
    expect(status()).toBe("loading");
    await waitFor(() => expect(status()).toBe("loaded"));
    expect(items()).toBe("a,b");
  });

  it("is unreachable when nobody answered, and loads on trying again", async () => {
    let online = false;
    const fetch = vi.fn(async () => { if (online) { recordFetchOutcome(true); return ["a"]; } recordFetchOutcome(false); return []; });
    render(<List tag="nostr" fetch={fetch} />);
    await waitFor(() => expect(status()).toBe("unreachable"));
    online = true;
    fireEvent.click(screen.getByRole("button", { name: "again" }));
    expect(status()).toBe("loading");
    await waitFor(() => expect(status()).toBe("loaded"));
    expect(items()).toBe("a");
  });

  it("carries a failure's message", async () => {
    render(<List tag="nostr" fetch={async () => { throw new Error("no signer"); }} />);
    await waitFor(() => expect(status()).toBe("error"));
    expect(screen.getByTestId("message").textContent).toBe("no signer");
  });

  it("loads again when what it depends on changes, and drops the old rows at once", async () => {
    const fetch = vi.fn(async (tag: string) => { recordFetchOutcome(true); return [tag]; });
    const { rerender } = render(<List tag="nostr" fetch={fetch} />);
    await waitFor(() => expect(items()).toBe("nostr"));
    rerender(<List tag="bitcoin" fetch={fetch} />);
    expect(status()).toBe("loading");
    expect(items()).toBe("");
    await waitFor(() => expect(items()).toBe("bitcoin"));
  });

  // Not just "soon after": in no render at all. Clearing the rows from an
  // effect leaves one render with the new subject and the old rows, which
  // `rerender` hides because it runs effects before it returns.
  it("never shows one subject's rows in a render for another", async () => {
    const fetch = vi.fn(async (tag: string) => { recordFetchOutcome(true); return [tag]; });
    const { rerender } = render(<List tag="nostr" fetch={fetch} />);
    await waitFor(() => expect(items()).toBe("nostr"));
    rerender(<List tag="bitcoin" fetch={fetch} />);
    await waitFor(() => expect(items()).toBe("bitcoin"));
    rerender(<List tag="nostr" fetch={fetch} />);
    await waitFor(() => expect(items()).toBe("nostr"));
    expect(renders.filter((r) => r.items !== "" && r.items !== r.tag)).toEqual([]);
    expect(renders.filter((r) => r.status === "loaded" && r.items !== r.tag)).toEqual([]);
  });

  it("drops the rows when it is switched off, and asks again when switched back on", async () => {
    const fetch = vi.fn(async () => { recordFetchOutcome(true); return ["a"]; });
    const { rerender } = render(<List tag="nostr" fetch={fetch} enabled />);
    await waitFor(() => expect(items()).toBe("a"));
    rerender(<List tag="nostr" fetch={fetch} enabled={false} />);
    expect(status()).toBe("loading");
    expect(items()).toBe("");
    rerender(<List tag="nostr" fetch={fetch} enabled />);
    await waitFor(() => expect(items()).toBe("a"));
  });

  it("keeps the same answer across renders that change nothing it depends on", async () => {
    const fetch = vi.fn(async (tag: string) => { recordFetchOutcome(true); return [tag]; });
    const { rerender } = render(<List tag="nostr" fetch={fetch} />);
    await waitFor(() => expect(items()).toBe("nostr"));
    rerender(<List tag="nostr" fetch={fetch} />);
    rerender(<List tag="nostr" fetch={fetch} />);
    expect(status()).toBe("loaded");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  // A slow answer for the hashtag just left must not land in the one now showing.
  it("ignores an answer that arrives after it has moved on", async () => {
    let finishFirst: (rows: string[]) => void = () => {};
    const fetch = vi.fn((tag: string) => tag === "slow" ? new Promise<string[]>((resolve) => { finishFirst = resolve; }) : Promise.resolve(["fast"]).then((r) => { recordFetchOutcome(true); return r; }));
    const { rerender } = render(<List tag="slow" fetch={fetch} />);
    rerender(<List tag="fast" fetch={fetch} />);
    await waitFor(() => expect(items()).toBe("fast"));
    recordFetchOutcome(true);
    finishFirst(["stale"]);
    await new Promise((r) => setTimeout(r, 0));
    expect(items()).toBe("fast");
  });

  it("holds off while it is not enabled", async () => {
    const fetch = vi.fn(async () => { recordFetchOutcome(true); return ["a"]; });
    const { rerender } = render(<List tag="nostr" fetch={fetch} enabled={false} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).not.toHaveBeenCalled();
    rerender(<List tag="nostr" fetch={fetch} enabled />);
    await waitFor(() => expect(items()).toBe("a"));
  });
});
