import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const feed = vi.hoisted(() => ({ connected: true }));
vi.mock("../../stores/feed", () => ({ useFeedStore: <T,>(pick: (s: typeof feed) => T) => pick(feed) }));
vi.mock("../../hooks/useRelayStatus", () => ({
  useRelayStatus: () => ({
    connectedCount: 2, totalCount: 3, discoveredCount: 1,
    relays: [
      { url: "wss://relay.one/", connected: true, origin: "configured" },
      { url: "wss://relay.two/", connected: true, origin: "configured" },
      { url: "wss://relay.three/", connected: false, origin: "configured" },
      { url: "wss://found.example/", connected: true, origin: "discovered" },
    ],
  }),
}));

import { RelayStatusBadge } from "./RelayStatusBadge";

// jsdom does not know which focus came from the keyboard. Say so for it.
const realMatches = Element.prototype.matches;
function focusIs(kind: "keyboard" | "pointer") {
  Element.prototype.matches = function (this: Element, selector: string) {
    return selector === ":focus-visible" ? kind === "keyboard" : realMatches.call(this, selector);
  };
}
function tabTo(el: HTMLElement) { focusIs("keyboard"); el.focus(); fireEvent.focus(el); }

afterEach(() => { Element.prototype.matches = realMatches; cleanup(); });

const badge = () => screen.getByText(/2\/3 relays/).closest("[tabindex]") as HTMLElement;

describe("RelayStatusBadge", () => {
  it("shows the count, and the extra reach apart from it", () => {
    render(<RelayStatusBadge />);
    expect(badge().textContent).toContain("2/3 relays");
    expect(badge().textContent).toContain("+1");
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("lists the relays under the pointer", () => {
    render(<RelayStatusBadge />);
    fireEvent.mouseEnter(badge());
    expect(screen.getByRole("tooltip").textContent).toContain("relay.three");
    fireEvent.mouseLeave(badge());
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  // It was hover-only: there was no way to read the list without a mouse.
  it("can be reached with the keyboard, and lists the relays when it is", () => {
    render(<RelayStatusBadge />);
    expect(badge().getAttribute("tabindex")).toBe("0");
    tabTo(badge());
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toContain("found.example");
    fireEvent.blur(badge());
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  // The description is in the page before focus arrives, so a screen reader has it to read.
  it("is always described by its list, shown or not", () => {
    render(<RelayStatusBadge />);
    const tip = document.getElementById(badge().getAttribute("aria-describedby")!)!;
    expect(tip.getAttribute("role")).toBe("tooltip");
    expect(tip.hidden).toBe(true);
    expect(tip.textContent).toContain("relay.one");
    fireEvent.mouseEnter(badge());
    expect(tip.hidden).toBe(false);
  });

  // A click focuses it too. That focus must not pin the list open after the pointer has gone.
  it("does not stay open after a click and the pointer leaving", () => {
    // a click: focused, but not the kind of focus that draws a ring
    focusIs("pointer");
    render(<RelayStatusBadge />);
    fireEvent.mouseEnter(badge());
    badge().focus();
    fireEvent.focus(badge());
    fireEvent.mouseLeave(badge());
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("hides the list on Escape, and the press goes no further", () => {
    const app = vi.fn();
    window.addEventListener("keydown", app);
    render(<RelayStatusBadge />);
    tabTo(badge());
    expect(screen.getByRole("tooltip")).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Escape" });
    window.removeEventListener("keydown", app);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(app).not.toHaveBeenCalled();
  });

  it("hides it on Escape when it is only under the pointer, too", () => {
    render(<RelayStatusBadge />);
    fireEvent.mouseEnter(badge());
    expect(screen.getByRole("tooltip")).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("leaves Escape alone when there is nothing to hide", () => {
    const app = vi.fn();
    window.addEventListener("keydown", app);
    render(<RelayStatusBadge />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    window.removeEventListener("keydown", app);
    expect(app).toHaveBeenCalledTimes(1);
  });
});

// A network that went without closing its sockets left `relay.connected`
// true, and the badge green, for as long as the app ran (#65).
describe("RelayStatusBadge: when nothing answers", () => {
  it("says so in red, whatever the sockets say, and says it in the list", () => {
    feed.connected = false;
    try {
      render(<RelayStatusBadge />);
      const badge = screen.getByText(/relays, not answering/);
      expect(badge.textContent).toContain("relays, not answering");
      expect(badge.className).toContain("text-danger");
      expect(screen.getByRole("tooltip", { hidden: true }).textContent).toContain("Nothing has answered for a while");
    } finally { feed.connected = true; }
  });
});
