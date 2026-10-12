import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ListState, emptyOr, stateWithoutRows, followListState } from "./ListState";

afterEach(cleanup);

const EMPTY = "No bookmarked notes.";

describe("ListState", () => {
  it("says it is loading, as a status", () => {
    render(<ListState state="loading" loadingLabel="Loading bookmarks…" empty={EMPTY} />);
    expect(screen.getByRole("status").textContent).toBe("Loading bookmarks…");
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it("can show a skeleton while loading, still named for a screen reader", () => {
    render(<ListState state="loading" loadingLabel="Loading bookmarks…" loading={<div data-testid="skeleton" />} empty={EMPTY} />);
    expect(screen.getByRole("status", { name: "Loading bookmarks…" }).contains(screen.getByTestId("skeleton"))).toBe(true);
  });

  it("shows the empty sentence, its hint and its action when the list is really empty", () => {
    render(<ListState state="empty" empty={EMPTY} emptyHint="Use the bookmark icon on any note." emptyAction={<button>Find people</button>} />);
    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.getByText("Use the bookmark icon on any note.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Find people" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // To someone with a year of bookmarks, "No bookmarked notes." after a failed load reads as data loss.
  for (const state of ["unreachable", "error"] as const) {
    it(`never shows the empty sentence when the list is ${state}`, () => {
      render(<ListState state={state} empty={EMPTY} emptyHint="hint" emptyAction={<button>Find people</button>} what="your bookmarks" error="boom" onRetry={() => {}} />);
      expect(screen.queryByText(EMPTY)).toBeNull();
      expect(screen.queryByText("hint")).toBeNull();
      expect(screen.queryByRole("button", { name: "Find people" })).toBeNull();
    });
  }

  it("says the relays could not be reached, what that means, and offers to try again", () => {
    const onRetry = vi.fn();
    render(<ListState state="unreachable" empty={EMPTY} what="your bookmarks" onRetry={onRetry} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Couldn't reach your relays, so your bookmarks can't be loaded.");
    expect(alert.textContent).toContain("Check your connection, then try again.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("reads well without being told what was loading", () => {
    render(<ListState state="unreachable" empty={EMPTY} />);
    expect(screen.getByRole("alert").textContent).toContain("Couldn't reach your relays.");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows a failure with its reason", () => {
    render(<ListState state="error" empty={EMPTY} what="this thread" error="no signer" onRetry={() => {}} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Couldn't load this thread.");
    expect(alert.textContent).toContain("no signer");
    expect(alert.textContent).not.toContain("Check your connection");
  });
});

describe("emptyOr", () => {
  it("is empty only for a load that finished", () => {
    expect(emptyOr("loaded")).toBe("empty");
    expect(emptyOr("loading")).toBe("loading");
    expect(emptyOr("unreachable")).toBe("unreachable");
    expect(emptyOr("error")).toBe("error");
  });
});

describe("stateWithoutRows", () => {
  it("is loading while loading, whatever the last load did", () => {
    expect(stateWithoutRows(true, 0, "unreachable")).toBe("loading");
    expect(stateWithoutRows(true, 5, "answered")).toBe("loading");
  });

  it("is empty when a relay answered and there is nothing", () => {
    expect(stateWithoutRows(false, 0, "answered")).toBe("empty");
  });

  it("is never empty when the list holds nothing and the load did not get an answer", () => {
    expect(stateWithoutRows(false, 0, "unreachable")).toBe("unreachable");
    expect(stateWithoutRows(false, 0, "error")).toBe("error");
  });

  // Rows are held and the filters removed them all: the list is empty for
  // this user, and a refresh that failed afterwards does not change that.
  it("is empty when rows are held but none is shown, whatever the last refresh did", () => {
    expect(stateWithoutRows(false, 3, "unreachable")).toBe("empty");
    expect(stateWithoutRows(false, 3, "error")).toBe("empty");
    expect(stateWithoutRows(false, 3, "answered")).toBe("empty");
  });
});

describe("followListState", () => {
  it("says the account follows nobody only when the list loaded", () => {
    expect(followListState("loaded")).toBe("empty");
  });

  it("says the relays could not be reached when the list is unknown", () => {
    expect(followListState("unknown")).toBe("unreachable");
  });

  it("is loading before and during the first load", () => {
    expect(followListState("idle")).toBe("loading");
    expect(followListState("loading")).toBe("loading");
  });
});
