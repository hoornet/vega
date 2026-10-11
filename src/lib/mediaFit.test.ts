import { describe, it, expect } from "vitest";
import { soloImageFit } from "./mediaFit";

describe("soloImageFit", () => {
  it("fills the frame with a picture of about the frame's shape", () => {
    expect(soloImageFit(4000, 3000)).toBe("cover"); // 4:3 camera photo
    expect(soloImageFit(3000, 2000)).toBe("cover"); // 3:2 camera photo, ~11% cropped
    expect(soloImageFit(1280, 1024)).toBe("cover"); // 5:4
  });

  it("shows the whole picture when it is clearly wider or taller", () => {
    expect(soloImageFit(1920, 1080)).toBe("contain"); // 16:9 screenshot
    expect(soloImageFit(1080, 1920)).toBe("contain"); // phone screenshot
    expect(soloImageFit(1000, 1000)).toBe("contain"); // square meme
    expect(soloImageFit(2400, 800)).toBe("contain");  // panorama
  });

  it("shows the whole picture when its size is unknown", () => {
    expect(soloImageFit(0, 0)).toBe("contain");
    expect(soloImageFit(NaN, 100)).toBe("contain");
    expect(soloImageFit(100, 0)).toBe("contain");
  });
});
