import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { NDKEvent } from "@nostr-dev-kit/ndk";


vi.mock("../../lib/nostr", () => ({
  fetchZapsReceived: vi.fn(),
  fetchZapsSent: vi.fn(),
  fetchNoteById: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../stores/user", () => ({ useUserStore: () => ({ pubkey: "me", loggedIn: true }) }));
vi.mock("../../hooks/useProfile", () => ({ useProfile: () => null }));

import { ZapHistoryView } from "./ZapHistoryView";
import { fetchZapsReceived, fetchZapsSent } from "../../lib/nostr";
import { recordFetchOutcome } from "../../lib/nostr/fetchTotals";

/** A receipt for a 21 sat zap. The amount is in millisats, inside the zap request the receipt carries. */
const receipt = (id: string) => ({
  id, created_at: 1000, kind: 9735, pubkey: "wallet", content: "",
  tags: [["P", "sender"], ["p", "me"], ["description", JSON.stringify({ pubkey: "sender", content: "", tags: [["amount", "21000"]] })]],
}) as unknown as NDKEvent;
const answering = (events: NDKEvent[]) => async () => { recordFetchOutcome(true); return events; };
const timingOut = async () => { recordFetchOutcome(false); return [] as NDKEvent[]; };

beforeEach(() => {
    vi.mocked(fetchZapsReceived).mockReset();
  vi.mocked(fetchZapsSent).mockReset();
});
afterEach(cleanup);

describe("ZapHistoryView", () => {
  it("says it is loading until the relays have been asked", async () => {
    vi.mocked(fetchZapsReceived).mockImplementation(answering([]));
    vi.mocked(fetchZapsSent).mockImplementation(answering([]));
    render(<ZapHistoryView />);
    expect(screen.getByRole("status").textContent).toBe("Loading zap history…");
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("says there are no zaps when a relay answered with none", async () => {
    vi.mocked(fetchZapsReceived).mockImplementation(answering([]));
    vi.mocked(fetchZapsSent).mockImplementation(answering([]));
    render(<ZapHistoryView />);
    expect(await screen.findByText("No zaps received yet.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // The whole point: this used to read "No zaps received yet."
  it("says the relays could not be reached when nobody answered, and never that there are none", async () => {
    vi.mocked(fetchZapsReceived).mockImplementation(timingOut);
    vi.mocked(fetchZapsSent).mockImplementation(timingOut);
    render(<ZapHistoryView />);
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't reach your relays, so your zap history can't be loaded.");
    expect(screen.queryByText("No zaps received yet.")).toBeNull();
  });

  it("shows a failure with its reason, not as an empty list", async () => {
    vi.mocked(fetchZapsReceived).mockRejectedValue(new Error("relay said no"));
    vi.mocked(fetchZapsSent).mockImplementation(answering([]));
    render(<ZapHistoryView />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't load your zap history.");
    expect(alert.textContent).toContain("relay said no");
    expect(screen.queryByText("No zaps received yet.")).toBeNull();
  });

  it("asks again on Try again, and shows what comes back", async () => {
    vi.mocked(fetchZapsReceived).mockImplementationOnce(timingOut).mockImplementation(answering([receipt("z1")]));
    vi.mocked(fetchZapsSent).mockImplementationOnce(timingOut).mockImplementation(answering([]));
    render(<ZapHistoryView />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(vi.mocked(fetchZapsReceived)).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("No zaps received yet.")).toBeNull();
    expect(screen.getByText(/21 sats/)).toBeTruthy();
  });

  // "0 in, 0 out" in the header, beside a history that could not be read.
  it("shows the totals only once they are known", async () => {
    vi.mocked(fetchZapsReceived).mockImplementationOnce(timingOut).mockImplementation(answering([receipt("z1")]));
    vi.mocked(fetchZapsSent).mockImplementationOnce(timingOut).mockImplementation(answering([]));
    render(<ZapHistoryView />);
    expect(screen.queryByText(/ in$/)).toBeNull(); // loading
    await screen.findByRole("alert");
    expect(screen.queryByText(/ in$/)).toBeNull(); // unreachable
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect((await screen.findByText(/ in$/)).textContent).toBe("⚡ 21 in");
    expect(screen.getByText(/ out$/).textContent).toBe("⚡ 0 out");
  });

  it("shows no totals beside a failure", async () => {
    vi.mocked(fetchZapsReceived).mockRejectedValue(new Error("relay said no"));
    vi.mocked(fetchZapsSent).mockImplementation(answering([]));
    render(<ZapHistoryView />);
    await screen.findByRole("alert");
    expect(screen.queryByText(/ in$/)).toBeNull();
  });

  // One side was answered by the network: relays are reachable, so the other side is really empty.
  it("takes an empty tab at its word when the network answered for the other tab", async () => {
    vi.mocked(fetchZapsReceived).mockImplementation(answering([receipt("z1")]));
    vi.mocked(fetchZapsSent).mockImplementation(timingOut);
    render(<ZapHistoryView />);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    fireEvent.click(screen.getByRole("tab", { name: /Sent/ }));
    expect(screen.getByText("No zaps sent yet.")).toBeTruthy();
  });

  // Zaps on one tab that came from the built-in relay alone say nothing
  // about the other tab: the network did not answer for either.
  it("does not call the other tab empty when what came back did not come from the network", async () => {
    vi.mocked(fetchZapsReceived).mockImplementation(async () => { recordFetchOutcome(false); return [receipt("z1")]; });
    vi.mocked(fetchZapsSent).mockImplementation(timingOut);
    render(<ZapHistoryView />);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(screen.getByText(/21 sats/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    // What it does have is still totalled.
    expect(screen.getByText(/ in$/).textContent).toBe("⚡ 21 in");
    fireEvent.click(screen.getByRole("tab", { name: /Sent/ }));
    expect(screen.getByRole("alert").textContent).toContain("so your zap history can't be loaded");
    expect(screen.queryByText("No zaps sent yet.")).toBeNull();
  });
});
