import { describe, it, expect, afterEach } from "vitest";
import { measureRoom, pickSide } from "./popoverPlacement";

const rect = (top: number, left: number, width: number, height: number) =>
  ({ top, left, width, height, bottom: top + height, right: left + width, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

function mount(opts: { scroller?: DOMRect; trigger: DOMRect; layoutHeight?: number }) {
  document.body.innerHTML = `<div id="s" class="${opts.scroller ? "overflow-y-auto" : ""}"><button id="t"></button></div>`;
  const s = document.getElementById("s") as HTMLElement;
  const t = document.getElementById("t") as HTMLElement;
  if (opts.scroller) s.getBoundingClientRect = () => opts.scroller as DOMRect;
  t.getBoundingClientRect = () => opts.trigger;
  if (opts.layoutHeight !== undefined) Object.defineProperty(t, "offsetHeight", { value: opts.layoutHeight, configurable: true });
  return t;
}

afterEach(() => { document.body.innerHTML = ""; });

describe("pickSide", () => {
  it("opens upward when the popover fits above", () => {
    expect(pickSide({ above: 200, below: 500 }, 150)).toBe("up");
    expect(pickSide({ above: 150, below: 0 }, 150)).toBe("up");
  });

  // The first note under the compose box: an upward menu was cut off.
  it("opens downward when it does not fit above but fits below", () => {
    expect(pickSide({ above: 88, below: 500 }, 150)).toBe("down");
  });

  it("takes the roomier side when it fits on neither", () => {
    expect(pickSide({ above: 120, below: 60 }, 150)).toBe("up");
    expect(pickSide({ above: 60, below: 120 }, 150)).toBe("down");
  });

  it("depends on how much the popover needs", () => {
    const room = { above: 88, below: 500 };
    expect(pickSide(room, 50)).toBe("up");
    expect(pickSide(room, 150)).toBe("down");
  });
});

describe("measureRoom", () => {
  it("measures from the scroll area, not from the window", () => {
    // Scroll area occupies 100..700 vertically and 200..1000 horizontally.
    const t = mount({ scroller: rect(100, 200, 800, 600), trigger: rect(250, 300, 32, 32), layoutHeight: 32 });
    expect(measureRoom(t)).toEqual({ above: 150, below: 418, right: 700 });
  });

  it("falls back to the window when nothing scrolls around the trigger", () => {
    const t = mount({ trigger: rect(250, 300, 32, 32), layoutHeight: 32 });
    const room = measureRoom(t);
    expect(room.above).toBe(250);
    expect(room.below).toBe(window.innerHeight - 282);
    expect(room.right).toBe(window.innerWidth - 300);
  });

  // Extra Large text: an engine that reports zoomed rects shows a 32px button
  // as 40px tall. The room has to come back in layout px, the unit the
  // popover's own size is known in.
  it("converts zoomed rects back to layout px", () => {
    const t = mount({ scroller: rect(100, 0, 1000, 600), trigger: rect(300, 500, 40, 40), layoutHeight: 32 });
    const room = measureRoom(t);
    expect(room.above).toBeCloseTo(160);
    expect(room.below).toBeCloseTo(288);
    expect(room.right).toBeCloseTo(400);
  });

  it("assumes no zoom when the trigger has no layout height to compare with", () => {
    const t = mount({ scroller: rect(100, 0, 1000, 600), trigger: rect(300, 500, 40, 40), layoutHeight: 0 });
    expect(measureRoom(t).above).toBe(200);
  });
});
