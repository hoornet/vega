import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { NDKEvent } from "@nostr-dev-kit/ndk";

vi.mock("../../lib/nostr", () => ({ searchUsers: vi.fn() }));
vi.mock("../../hooks/useProfile", () => ({ useProfile: (pubkey: string) => ({ name: `Name of ${pubkey.slice(0, 3)}` }), primeProfileCache: vi.fn() }));
vi.mock("../../hooks/useNip05Verified", () => ({ useNip05Verified: () => "unknown" }));
vi.mock("./FollowButton", () => ({ FollowButton: ({ pubkey }: { pubkey: string }) => <button>Follow {pubkey.slice(0, 3)}</button> }));

import { FindPeople } from "./FindPeople";
import { searchUsers } from "../../lib/nostr";
import { primeProfileCache } from "../../hooks/useProfile";
import { useUIStore } from "../../stores/ui";
import { recordFetchOutcome } from "../../lib/nostr/fetchTotals";

const person = (pubkey: string, name: string) => ({ pubkey, content: JSON.stringify({ name }), kind: 0, tags: [], created_at: 1700000000 }) as unknown as NDKEvent;
const answering = (events: NDKEvent[]) => async () => { recordFetchOutcome(true); return events; };
const timingOut = async () => { recordFetchOutcome(false); return [] as NDKEvent[]; };
const field = () => screen.getByRole("searchbox", { name: "Find people" });
const find = (text: string) => { fireEvent.change(field(), { target: { value: text } }); fireEvent.submit(field().closest("form")!); };

beforeEach(() => {
  vi.mocked(searchUsers).mockReset();
  vi.mocked(primeProfileCache).mockReset();
  useUIStore.setState({ currentView: "follows", viewStack: [], selectedPubkey: null });
});
afterEach(cleanup);

describe("FindPeople", () => {
  it("finds people by name, with their profiles kept for the rows and a Follow button each", async () => {
    vi.mocked(searchUsers).mockImplementation(answering([person("aaa1", "Ana"), person("bbb2", "Bine")]));
    render(<FindPeople />);
    find("an");
    expect(await screen.findByText("Name of aaa")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Follow bbb" })).toBeTruthy();
    expect(searchUsers).toHaveBeenCalledWith("an");
    // Dated with the event's time, so the cache can tell an older copy from a newer one.
    expect(primeProfileCache).toHaveBeenCalledWith("aaa1", { name: "Ana", created_at: 1700000000 });
  });

  it("opens the profile straight away for an address", async () => {
    const { nip19 } = await import("@nostr-dev-kit/ndk");
    render(<FindPeople />);
    find(nip19.npubEncode("c".repeat(64)));
    expect(useUIStore.getState().currentView).toBe("profile");
    expect(useUIStore.getState().selectedPubkey).toBe("c".repeat(64));
    expect(searchUsers).not.toHaveBeenCalled();
  });

  it("says nobody was found only when a relay answered, and that no relay answered otherwise", async () => {
    vi.mocked(searchUsers).mockImplementation(answering([]));
    render(<FindPeople />);
    find("zzz");
    expect(await screen.findByText("Nobody by that name.")).toBeTruthy();
    vi.mocked(searchUsers).mockImplementation(timingOut);
    find("zzz");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("No relay answered this search."));
  });

  it("shows the newest search, not one still on its way", async () => {
    let answer: (events: NDKEvent[]) => void = () => {};
    vi.mocked(searchUsers).mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    vi.mocked(searchUsers).mockImplementation(answering([person("ddd4", "Dora")]));
    render(<FindPeople />);
    find("first");
    find("second");
    expect(await screen.findByText("Name of ddd")).toBeTruthy();
    answer([person("eee5", "Eva")]);
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByText("Name of eee")).toBeNull();
  });

  it("does nothing with an empty field", () => {
    render(<FindPeople />);
    find("   ");
    expect(searchUsers).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Find/ }).hasAttribute("disabled")).toBe(true);
  });
});
