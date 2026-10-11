import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ImageLightbox } from "./ImageLightbox";
import { Dialog } from "./Dialog";

afterEach(() => { cleanup(); document.body.innerHTML = ""; });

const IMAGES = ["a.jpg", "b.jpg", "c.jpg"];

describe("ImageLightbox", () => {
  it("closes on Escape, and the press goes no further", () => {
    const onClose = vi.fn();
    const app = vi.fn();
    window.addEventListener("keydown", app);
    render(<ImageLightbox images={IMAGES} index={0} onClose={onClose} onNavigate={() => {}} />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    window.removeEventListener("keydown", app);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(app).not.toHaveBeenCalled();
  });

  it("closes on a click anywhere: the picture or the dark around it", () => {
    const onClose = vi.fn();
    render(<ImageLightbox images={IMAGES} index={0} onClose={onClose} onNavigate={() => {}} />);
    fireEvent.click(screen.getByRole("dialog"));
    fireEvent.click(screen.getByRole("img"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("does not close when moving to the next image", () => {
    const onClose = vi.fn();
    const onNavigate = vi.fn();
    render(<ImageLightbox images={IMAGES} index={0} onClose={onClose} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "Next image" }));
    expect(onNavigate).toHaveBeenCalledWith(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  // This is what keeps app-wide shortcuts quiet behind it.
  it("is a modal dialog", () => {
    render(<ImageLightbox images={IMAGES} index={0} onClose={() => {}} onNavigate={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Image viewer" }).getAttribute("aria-modal")).toBe("true");
  });

  // Inside the text-size zoom, 90vw was wider than the window.
  it("sizes the picture as a share of the viewer, not of the viewport", () => {
    render(<ImageLightbox images={IMAGES} index={0} onClose={() => {}} onNavigate={() => {}} />);
    expect(screen.getByRole("img").className).not.toMatch(/\d+v[hw]/);
    expect(` ${screen.getByRole("img").className} `).toContain(" max-h-[90%] ");
  });

  it("moves between images with the arrow keys, and stops at the ends", () => {
    const onNavigate = vi.fn();
    const { rerender } = render(<ImageLightbox images={IMAGES} index={1} onClose={() => {}} onNavigate={onNavigate} />);
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(onNavigate).toHaveBeenLastCalledWith(2);
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    expect(onNavigate).toHaveBeenLastCalledWith(0);
    onNavigate.mockClear();
    rerender(<ImageLightbox images={IMAGES} index={2} onClose={() => {}} onNavigate={onNavigate} />);
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  // Tab used to walk from the viewer into the page behind it.
  it("takes focus when it opens and gives it back when it closes", () => {
    function Gallery() {
      const [open, setOpen] = useState(false);
      return (<><button onClick={() => setOpen(true)}>thumbnail</button>{open && <ImageLightbox images={IMAGES} index={0} onClose={() => setOpen(false)} onNavigate={() => {}} />}</>);
    }
    render(<Gallery />);
    const thumb = screen.getByRole("button", { name: "thumbnail" });
    thumb.focus();
    fireEvent.click(thumb);
    expect(screen.getByRole("dialog", { name: "Image viewer" }).contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(thumb);
  });

  it("keeps Tab inside", () => {
    render(<ImageLightbox images={IMAGES} index={1} onClose={() => {}} onNavigate={() => {}} />);
    const close = screen.getByRole("button", { name: "Close image viewer" });
    const next = screen.getByRole("button", { name: "Next image" });
    next.focus();
    fireEvent.keyDown(next, { key: "Tab" });
    expect(document.activeElement).toBe(close);
  });

  // Clicking Next onto the last image removes the Next button that had focus.
  it("brings Tab back in after the focused arrow has gone", () => {
    const { rerender } = render(<ImageLightbox images={IMAGES} index={1} onClose={() => {}} onNavigate={() => {}} />);
    screen.getByRole("button", { name: "Next image" }).focus();
    rerender(<ImageLightbox images={IMAGES} index={2} onClose={() => {}} onNavigate={() => {}} />);
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document.body, { key: "Tab" });
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(document.body);
  });

  // The viewer and a dialog share one rule for Escape: the one on top goes first.
  it("closes before a dialog that is under it", () => {
    const closeDialog = vi.fn();
    const closeViewer = vi.fn();
    render(<><Dialog title="Under" onClose={closeDialog}>x</Dialog><ImageLightbox images={IMAGES} index={0} onClose={closeViewer} onNavigate={() => {}} /></>);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(closeViewer).toHaveBeenCalledTimes(1);
    expect(closeDialog).not.toHaveBeenCalled();
  });
});
