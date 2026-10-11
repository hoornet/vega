import { describe, it, expect } from "vitest";
import { DRAG_SLOP, isDrag } from "./pointer";

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
