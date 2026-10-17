import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { KeptView } from "./KeptView";

// jsdom has no layout: scrollTop is a stored number here, which is all the component reads and writes.
afterEach(cleanup);

const List = () => <div className="overflow-y-auto" data-testid="list"><p>rows</p></div>;

describe("KeptView", () => {
  it("hides with display none and keeps the children mounted", () => {
    const { container, rerender } = render(<KeptView hidden={false}><List /></KeptView>);
    expect(container.firstElementChild!.className).toBe("contents");
    rerender(<KeptView hidden><List /></KeptView>);
    expect(container.firstElementChild!.className).toBe("hidden");
    expect(container.textContent).toBe("rows");
  });

  it("puts the scroll position back when the view is shown again", () => {
    const { container, rerender } = render(<KeptView hidden={false}><List /></KeptView>);
    const list = container.querySelector("[data-testid=list]") as HTMLElement;
    list.scrollTop = 480;
    fireEvent.scroll(list);
    rerender(<KeptView hidden><List /></KeptView>);
    // What Chromium does to a hidden scroll container: the offset goes, and a scroll event says so.
    list.scrollTop = 0;
    fireEvent.scroll(list);
    rerender(<KeptView hidden={false}><List /></KeptView>);
    expect(list.scrollTop).toBe(480);
  });

  it("records nothing while something above the list is display none, whoever hid it", () => {
    const { container, rerender } = render(<KeptView hidden={false}><div data-testid="boundary"><List /></div></KeptView>);
    const list = container.querySelector("[data-testid=list]") as HTMLElement;
    list.scrollTop = 480;
    fireEvent.scroll(list);
    // What a Suspense boundary does to its children while a lazy view's code loads.
    (container.querySelector("[data-testid=boundary]") as HTMLElement).style.display = "none";
    list.scrollTop = 0;
    fireEvent.scroll(list);
    (container.querySelector("[data-testid=boundary]") as HTMLElement).style.display = "";
    rerender(<KeptView hidden><div data-testid="boundary"><List /></div></KeptView>);
    rerender(<KeptView hidden={false}><div data-testid="boundary"><List /></div></KeptView>);
    expect(list.scrollTop).toBe(480);
  });

  it("lets go of focus held inside it when hidden", () => {
    const { container, rerender } = render(<KeptView hidden={false}><input aria-label="query" /></KeptView>);
    const input = container.querySelector("input") as HTMLInputElement;
    input.focus();
    expect(document.activeElement).toBe(input);
    rerender(<KeptView hidden><input aria-label="query" /></KeptView>);
    expect(document.activeElement).not.toBe(input);
  });

  it("does not move a view that was never scrolled", () => {
    const { container, rerender } = render(<KeptView hidden={false}><List /></KeptView>);
    const list = container.querySelector("[data-testid=list]") as HTMLElement;
    rerender(<KeptView hidden><List /></KeptView>);
    list.scrollTop = 0;
    rerender(<KeptView hidden={false}><List /></KeptView>);
    expect(list.scrollTop).toBe(0);
  });
});
