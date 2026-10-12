import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { useToastFloor, TOAST_FLOOR } from "./useToastFloor";

const floor = () => document.documentElement.style.getPropertyValue(TOAST_FLOOR);

// jsdom lays nothing out: the bar's height is whatever this says it is.
let height = 0;
let resized: (() => void) | null = null;
const disconnect = vi.fn();
const observed: Element[] = [];

function Bar() {
  const ref = useToastFloor<HTMLDivElement>();
  return <div ref={ref} data-testid="bar" />;
}

beforeEach(() => {
  height = 112;
  resized = null;
  observed.length = 0;
  disconnect.mockClear();
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => height });
  vi.stubGlobal("ResizeObserver", class {
    constructor(changed: () => void) { resized = changed; }
    observe(el: Element) { observed.push(el); }
    disconnect() { disconnect(); }
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
  document.documentElement.style.removeProperty(TOAST_FLOOR);
});

describe("useToastFloor", () => {
  it("publishes the bar's height for the toast stack to start above", () => {
    const view = render(<Bar />);
    expect(floor()).toBe("112px");
    expect(observed).toEqual([view.getByTestId("bar")]);
  });

  // The message box grows as it is typed in.
  it("follows the bar as its height changes", () => {
    render(<Bar />);
    height = 310;
    act(() => { resized?.(); });
    expect(floor()).toBe("310px");
  });

  // Left behind, every other view would have its toasts floating in mid-air.
  it("takes the floor away when the bar is gone, and stops watching", () => {
    const view = render(<Bar />);
    view.unmount();
    expect(floor()).toBe("");
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("publishes the first reading where the size cannot be watched", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    render(<Bar />);
    expect(floor()).toBe("112px");
  });
});
