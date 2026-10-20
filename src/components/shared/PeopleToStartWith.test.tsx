import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const people = vi.hoisted(() => ({ pubkeys: [] as string[], status: "none" as "loading" | "ready" | "none" }));
const signer = vi.hoisted(() => ({ can: true }));
const me = vi.hoisted(() => ({ pubkey: "me" as string | null }));
const mute = vi.hoisted(() => ({ mutedPubkeys: [] as string[] }));
vi.mock("../../stores/user", () => ({ useCanSign: () => signer.can, useUserStore: <T,>(pick: (s: typeof me) => T) => pick(me) }));
vi.mock("../../stores/mute", () => ({ useMuteStore: <T,>(pick: (s: typeof mute) => T) => pick(mute) }));
vi.mock("../../hooks/useStartingPeople", () => ({ useStartingPeople: () => people }));
vi.mock("../../hooks/useProfile", () => ({ useProfile: (pubkey: string) => ({ name: `Name of ${pubkey}` }) }));
vi.mock("../../hooks/useNip05Verified", () => ({ useNip05Verified: () => "unknown" }));
vi.mock("./FollowButton", () => ({ FollowButton: ({ pubkey }: { pubkey: string }) => <button>Follow {pubkey}</button> }));

import { PeopleToStartWith } from "./PeopleToStartWith";
import { useDismissedSuggestionsStore } from "../../stores/dismissedSuggestions";

beforeEach(() => {
  localStorage.clear();
  useDismissedSuggestionsStore.setState({ dismissedPubkeys: [] });
  people.pubkeys = [];
  people.status = "none";
  signer.can = true;
  me.pubkey = "me";
  mute.mutedPubkeys = [];
});
afterEach(cleanup);

describe("PeopleToStartWith", () => {
  it("shows nothing, or what it was given, when there is nobody to offer", () => {
    render(<PeopleToStartWith fallback={<p>nobody today</p>} />);
    expect(screen.queryByText("People to start with")).toBeNull();
    expect(screen.getByText("nobody today")).toBeTruthy();
  });

  it("offers nothing to an account that cannot follow", () => {
    people.pubkeys = ["a"];
    people.status = "ready";
    signer.can = false;
    render(<PeopleToStartWith />);
    expect(screen.queryByText("Name of a")).toBeNull();
  });

  // A row that vanished on a press put the next person's Follow button under the pointer.
  it("shows the rows in the same frame as the heading, and no 'finding' beside them", () => {
    people.pubkeys = ["a"];
    people.status = "loading";
    render(<PeopleToStartWith />);
    expect(screen.getByText("Name of a")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("drops a kept row for someone muted since, or for the account itself", () => {
    people.pubkeys = ["a", "b"];
    people.status = "ready";
    const { rerender } = render(<PeopleToStartWith />);
    people.pubkeys = [];
    mute.mutedPubkeys = ["a"];
    me.pubkey = "b";
    rerender(<PeopleToStartWith />);
    expect(screen.queryByText("Name of a")).toBeNull();
    expect(screen.queryByText("Name of b")).toBeNull();
  });

  it("keeps the row of someone no longer offered, unless they were dismissed", () => {
    people.pubkeys = ["a", "b"];
    people.status = "ready";
    const { rerender } = render(<PeopleToStartWith />);
    expect(screen.getByText("Name of a")).toBeTruthy();
    people.pubkeys = ["b"];
    rerender(<PeopleToStartWith />);
    expect(screen.getByText("Name of a")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Don't suggest Name of a again" }));
    expect(screen.queryByText("Name of a")).toBeNull();
    expect(screen.getByText("Name of b")).toBeTruthy();
  });

  it("says it is looking while it is", () => {
    people.status = "loading";
    render(<PeopleToStartWith />);
    expect(screen.getByText("People to start with")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Finding people…");
  });

  it("lists each person with a Follow button and a way to not be offered them again", () => {
    people.pubkeys = ["a", "b"];
    people.status = "ready";
    render(<PeopleToStartWith />);
    expect(screen.getByText("Name of a")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Follow b" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Don't suggest Name of a again" }));
    expect(useDismissedSuggestionsStore.getState().dismissedPubkeys).toEqual(["a"]);
  });

  it("can go without its heading, under another one", () => {
    people.pubkeys = ["a"];
    people.status = "ready";
    render(<PeopleToStartWith heading={false} />);
    expect(screen.queryByText("People to start with")).toBeNull();
    expect(screen.getByText("Name of a")).toBeTruthy();
  });
});
