import { describe, it, expect } from "vitest";
import { DRAG_SLOP, isDrag, afterPointerRelease } from "./pointer";

describe("isDrag", () => {
  it("treats a press and release on the same spot as a click", () => {
    expect(isDrag({ x: 100, y: 100 }, { x: 100, y: 100 })).toBe(false);
  });

  it("forgives the few pixels a hand moves during a click", () => {
    expect(isDrag({ x: 100, y: 100 }, { x: 103, y: 102 })).toBe(false);
    expect(isDrag({ x: 100, y: 100 }, { x: 100 + DRAG_SLOP, y: 100 })).toBe(false);
  });

  it("treats selecting a word as a drag", () => {
    expect(isDrag({ x: 100, y: 100 }, { x: 160, y: 100 })).toBe(true);
  });

  it("counts vertical and diagonal travel too", () => {
    expect(isDrag({ x: 100, y: 100 }, { x: 100, y: 130 })).toBe(true);
    expect(isDrag({ x: 100, y: 100 }, { x: 104, y: 104 })).toBe(true);
  });

  // A click that arrives with no press on record (keyboard activation, or a
  // press that started outside the card) is still a click.
  it("is not a drag when no press was recorded", () => {
    expect(isDrag(null, { x: 500, y: 500 })).toBe(false);
  });
});

describe("afterPointerRelease", () => {
  it("runs at once with no pointer down, and after the release with one", () => {
    const ran: string[] = [];
    afterPointerRelease(() => ran.push("now"));
    expect(ran).toEqual(["now"]);
    window.dispatchEvent(new Event("pointerdown"));
    afterPointerRelease(() => ran.push("later"));
    expect(ran).toEqual(["now"]);
    window.dispatchEvent(new Event("pointerup"));
    expect(ran).toEqual(["now", "later"]);
    // A cancelled press is a release too.
    window.dispatchEvent(new Event("pointerdown"));
    afterPointerRelease(() => ran.push("cancelled"));
    window.dispatchEvent(new Event("pointercancel"));
    expect(ran).toEqual(["now", "later", "cancelled"]);
  });
});
