import { describe, it, expect } from "vitest";
import { widthFromPointer } from "./sidebarWidth";

describe("widthFromPointer", () => {
  it("keeps the edge under the pointer at every text size", () => {
    expect(widthFromPointer(300, 0, 1, 160, 360)).toBe(300);
    // At Extra Large the pointer at 300 screen px is 210 layout px in.
    expect(widthFromPointer(300, 0, 20 / 14, 160, 360)).toBe(210);
    // At Small it is further in than it looks.
    expect(widthFromPointer(200, 0, 12 / 14, 160, 360)).toBe(233);
  });
  it("stays within the bounds, and treats a bad zoom as none", () => {
    expect(widthFromPointer(50, 0, 1, 160, 360)).toBe(160);
    expect(widthFromPointer(900, 0, 1, 160, 360)).toBe(360);
    expect(widthFromPointer(300, 0, 0, 160, 360)).toBe(300);
  });
});
