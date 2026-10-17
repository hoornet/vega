import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";

// The Relays view after the October 2026 UI review: your relays apart from the
// ones Vega reached on its own, nothing removed without a word and a way back,
// one status word, and sharing the list that says what it does.

const pool = vi.hoisted(() => ({ relays: [] as { url: string; connected: boolean }[], stored: [] as string[] }));
const nostr = vi.hoisted(() => ({ addRelay: vi.fn(), removeRelay: vi.fn(), publishRelayList: vi.fn(async () => {}), fetchRelayRecommendations: vi.fn(async () => []), resetNDK: vi.fn(async () => {}), outbox: true }));
vi.mock("../../lib/nostr", () => ({
  getNDK: () => ({ pool: { relays: new Map(pool.relays.map((r) => [r.url, r])) } }),
  getStoredRelayUrls: () => pool.stored,
  normalizeRelayUrl: (u: string) => u.replace(/\/+$/, ""),
  isLocalRelayUrl: (u: string) => /127\.0\.0\.1|localhost/.test(u),
  addRelay: nostr.addRelay, removeRelay: nostr.removeRelay, publishRelayList: nostr.publishRelayList,
  fetchRelayRecommendations: nostr.fetchRelayRecommendations,
  isOutboxRelaysEnabled: () => nostr.outbox, setOutboxRelaysEnabled: (v: boolean) => { nostr.outbox = v; }, resetNDK: nostr.resetNDK,
}));
vi.mock("../../lib/nostr/relayAuth", () => ({ getRelayAuthScope: () => "configured", setRelayAuthScope: vi.fn(), rechallengeRelays: vi.fn(), authenticatedRelayUrls: () => [], getPendingAuthRelays: () => ({ declined: [] }) }));
const user = vi.hoisted(() => ({ loggedIn: true, follows: ["a"] as string[], followsStatus: "loaded" as "idle" | "loading" | "loaded" | "unknown" }));
vi.mock("../../stores/user", () => ({ useUserStore: () => user, useCanSign: () => true }));
// The connection monitor's verdict (see "Relay liveness"). The view never offers removals while it says the network is gone.
const feed = vi.hoisted(() => ({ connected: true }));
vi.mock("../../stores/feed", () => ({ useFeedStore: <T,>(pick: (s: typeof feed) => T) => pick(feed) }));
vi.mock("../../lib/publishFeedback", () => ({ tellPublish: async (run: () => Promise<unknown>) => { try { await run(); return { ok: true }; } catch { return { ok: false }; } } }));

import { RelaysView } from "./RelaysView";
import { useRelayHealthStore } from "../../stores/relayHealth";
import { useToastStore } from "../../stores/toast";
import { useRelayListShare } from "../../stores/relayListShare";
import type { RelayHealthResult } from "../../lib/nostr/relayHealth";

const result = (url: string, status: RelayHealthResult["status"], name?: string): RelayHealthResult =>
  ({ url, status, latencyMs: status === "offline" ? null : 120, checkedAt: 1_700_000_000_000, nip11: name ? { name } : null, error: null }) as unknown as RelayHealthResult;

const section = (name: string) => screen.getByRole("region", { name });

beforeEach(() => {
  localStorage.clear();
  Object.values(nostr).forEach((v) => { if (typeof v === "function" && "mockClear" in v) (v as ReturnType<typeof vi.fn>).mockClear(); });
  pool.stored = ["wss://a.example", "wss://b.example", "wss://c.example"];
  pool.relays = [
    { url: "wss://a.example/", connected: true },
    { url: "wss://b.example/", connected: false },
    { url: "wss://c.example/", connected: true },
    { url: "wss://extra.example/", connected: true },
    { url: "ws://127.0.0.1:4869/", connected: true },
  ];
  useRelayHealthStore.setState({ results: [result("wss://a.example", "online", "Relay A"), result("wss://b.example", "offline"), result("wss://c.example", "offline", "Relay C")], checking: false, lastChecked: 1_700_000_000_000, checkAll: vi.fn(async () => {}) });
  useToastStore.setState({ toasts: [] });
  useRelayListShare.setState({ unshared: false });
  user.follows = ["a"];
  user.followsStatus = "loaded";
  feed.connected = true;
});
afterEach(cleanup);

describe("RelaysView", () => {
  it("says what a relay is, and lists yours apart from the ones reached automatically", () => {
    render(<RelaysView />);
    expect(screen.getByText(/Relays are the servers Vega gets posts from/)).toBeTruthy();
    const mine = section("Your relays");
    expect(within(mine).getByText("Relay A")).toBeTruthy();
    expect(within(mine).getByText("a.example")).toBeTruthy();
    expect(within(mine).queryByText("extra.example")).toBeNull();
    const extra = section("Extra reach, found automatically");
    expect(within(extra).getByText("1")).toBeTruthy();
    fireEvent.click(within(extra).getByRole("button", { name: /Extra reach/ }));
    expect(within(extra).getByText("extra.example")).toBeTruthy();
    // Not in the list, so not removable. The built-in relay is in neither list.
    expect(within(extra).queryByRole("button", { name: /^Remove/ })).toBeNull();
    expect(screen.queryByText(/127\.0\.0\.1/)).toBeNull();
  });

  it("uses one word for a relay's state, and claims nothing it has no evidence for", () => {
    render(<RelaysView />);
    const mine = section("Your relays");
    // a answered. b did not and has no connection. c did not answer the probe, but the pool holds a connection to it.
    expect(within(mine).getAllByText("connected")).toHaveLength(1);
    expect(within(mine).getAllByText("not answering")).toHaveLength(1);
    expect(within(mine).getByText("connected, didn't answer the check")).toBeTruthy();
    expect(screen.queryByText(/online|offline/)).toBeNull();
    // The header counts what the rows say: c is connected, and only b would be offered.
    expect(screen.getByText("2 connected")).toBeTruthy();
    expect(screen.getByText("1 not answering")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check now" })).toBeTruthy();
  });

  it("lists a relay of yours that has not been checked yet as that, whether or not it reached the pool", () => {
    pool.stored = [...pool.stored, "wss://d.example"];
    render(<RelaysView />);
    const mine = section("Your relays");
    expect(within(mine).getByText("d.example")).toBeTruthy();
    expect(within(mine).getByText("not checked yet")).toBeTruthy();
    fireEvent.click(within(mine).getByRole("button", { name: "Remove wss://d.example" }));
    expect(nostr.removeRelay).toHaveBeenCalledWith("wss://d.example");
  });

  it("draws nothing from a check result for a relay no longer in the list", () => {
    pool.stored = ["wss://a.example", "wss://c.example"];
    render(<RelaysView />);
    const mine = section("Your relays");
    expect(within(mine).queryByText("b.example")).toBeNull();
    expect(screen.queryByText(/not answering/)).toBeNull();
  });

  it("removes one relay on its own button, and the toast's Undo puts it back", () => {
    render(<RelaysView />);
    fireEvent.click(screen.getByRole("button", { name: "Remove wss://a.example" }));
    expect(nostr.removeRelay).toHaveBeenCalledWith("wss://a.example");
    const toast = useToastStore.getState().toasts.find((t) => /Removed a\.example/.test(t.message));
    expect(toast?.action?.label).toBe("Undo");
    // Undo may run after the view is gone: it marks the list through the store.
    useRelayListShare.getState().mark(false);
    toast!.action!.run();
    expect(nostr.addRelay).toHaveBeenCalledWith("wss://a.example");
    expect(useRelayListShare.getState().unshared).toBe(true);
    expect(screen.getByText("not shared yet")).toBeTruthy();
  });

  it("offers to remove the relays that did not answer, by name, after a confirmation, and not one the pool is connected to", async () => {
    render(<RelaysView />);
    // b and c did not answer the check, but c is connected right now: only b is offered.
    const offer = screen.getByRole("button", { name: "Remove 1 relay not answering…" });
    fireEvent.click(offer);
    expect(nostr.removeRelay).not.toHaveBeenCalled();
    const ask = screen.getByRole("alertdialog");
    expect(ask.textContent).toContain("Remove b.example from your list?");
    // Keep has focus, so a stray Enter keeps; Escape keeps too, and focus goes back to the offer.
    expect(document.activeElement).toBe(within(ask).getByRole("button", { name: "Keep" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Remove 1 relay not answering…" })));
    fireEvent.click(screen.getByRole("button", { name: "Remove 1 relay not answering…" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Keep" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(nostr.removeRelay).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove 1 relay not answering…" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove" }));
    expect(nostr.removeRelay).toHaveBeenCalledTimes(1);
    expect(nostr.removeRelay).toHaveBeenCalledWith("wss://b.example");
  });

  it("offers no removal while the network is down, and never the whole list", () => {
    // Every probe failed and no relay of yours is connected: the network is gone, not the relays.
    useRelayHealthStore.setState({ results: [result("wss://a.example", "offline"), result("wss://b.example", "offline"), result("wss://c.example", "offline")] });
    pool.relays = pool.relays.map((r) => ({ ...r, connected: /127\.0\.0\.1/.test(r.url) }));
    render(<RelaysView />);
    expect(screen.queryByRole("button", { name: /not answering…/ })).toBeNull();
    expect(screen.getByText(/Vega couldn't reach any relay/)).toBeTruthy();
    cleanup();
    // The connection monitor's word alone is enough: one dead relay, but the monitor says the network is gone.
    useRelayHealthStore.setState({ results: [result("wss://a.example", "online"), result("wss://b.example", "offline")] });
    pool.relays = [{ url: "wss://a.example/", connected: true }, { url: "wss://b.example/", connected: false }];
    feed.connected = false;
    render(<RelaysView />);
    expect(screen.queryByRole("button", { name: /not answering…/ })).toBeNull();
  });

  it("shares the list under a name that says what it does, and marks it unshared after a change", async () => {
    render(<RelaysView />);
    expect(screen.getByText(/Tells other apps and people where to find your posts/)).toBeTruthy();
    expect(screen.queryByText("not shared yet")).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Relay address" }), { target: { value: "wss://new.example" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(nostr.addRelay).toHaveBeenCalledWith("wss://new.example");
    // The marker stands beside the button and describes it, not on the button's fill.
    const share = screen.getByRole("button", { name: "Share my relay list" });
    const marker = screen.getByText("not shared yet");
    expect(share.contains(marker)).toBe(false);
    expect(share.getAttribute("aria-describedby")).toBe(marker.id);
    fireEvent.click(share);
    await vi.waitFor(() => expect(nostr.publishRelayList).toHaveBeenCalled());
    await vi.waitFor(() => expect(screen.queryByText("not shared yet")).toBeNull());
    expect(localStorage.getItem("wrystr_relay_list_unshared")).toBeNull();
  });

  it("says why Discover is unavailable, true to the follow list's state", () => {
    user.follows = [];
    render(<RelaysView />);
    expect((screen.getByRole("button", { name: "Discover relays" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Follow a few people first/)).toBeTruthy();
    cleanup();
    user.followsStatus = "loading";
    render(<RelaysView />);
    expect(screen.getByText(/Loading the people you follow/)).toBeTruthy();
    expect(screen.queryByText(/Follow a few people first/)).toBeNull();
    cleanup();
    user.followsStatus = "unknown";
    render(<RelaysView />);
    expect(screen.getByText(/could not be loaded/)).toBeTruthy();
  });

  it("words the reach switch and the identity choice in the user's terms", () => {
    render(<RelaysView />);
    expect(screen.getByRole("switch", { name: "Also look on the relays that people I follow use" })).toBeTruthy();
    expect(screen.getByText(/each one can see your IP address/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Only my relays" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText(/NIP-65|NIP-42/)).toBeNull();
  });
});
