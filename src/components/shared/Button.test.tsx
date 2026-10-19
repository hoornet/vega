import { describe, it, expect, vi } from "vitest";
import { createRef } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button, buttonClass, SECONDARY_TINT } from "./Button";

const btn = () => screen.getByRole("button") as HTMLButtonElement;
const classes = () => ` ${btn().className} `;

describe("Button", () => {
  it("is a button with its label as its name", () => {
    render(<Button>Publish</Button>);
    expect(screen.getByRole("button", { name: "Publish" })).toBe(btn());
  });

  // 210 of the 212 hand-written buttons had no type. Inside a form that submits it.
  it("does not submit a form unless asked to", () => {
    const onSubmit = vi.fn((e: { preventDefault(): void }) => e.preventDefault());
    const { rerender } = render(<form onSubmit={onSubmit}><Button>Cancel</Button></form>);
    expect(btn().getAttribute("type")).toBe("button");
    fireEvent.click(btn());
    expect(onSubmit).not.toHaveBeenCalled();
    rerender(<form onSubmit={onSubmit}><Button type="submit">Save</Button></form>);
    expect(btn().getAttribute("type")).toBe("submit");
  });

  it("calls onClick", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Add</Button>);
    fireEvent.click(btn());
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does nothing while disabled", () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Add</Button>);
    expect(btn().disabled).toBe(true);
    fireEvent.click(btn());
    expect(onClick).not.toHaveBeenCalled();
  });

  describe("levels", () => {
    it("is a quiet fill by default", () => {
      render(<Button>Message</Button>);
      expect(classes()).toContain(" bg-text/8 ");
      expect(classes()).toContain(" text-text ");
      expect(classes()).not.toContain(" bg-accent ");
    });

    it("is filled with the accent as primary", () => {
      render(<Button variant="primary">Follow</Button>);
      expect(classes()).toContain(" bg-accent ");
      expect(classes()).toContain(" text-accent-text ");
      expect(classes()).toContain(" not-disabled:hover:bg-accent-hover ");
      expect(classes()).not.toContain(" bg-text/8 ");
    });

    it("has no box as ghost", () => {
      render(<Button variant="ghost">Cancel</Button>);
      expect(classes()).toContain(" text-text-muted ");
      expect(classes()).not.toMatch(/ bg-(text\/8|accent|danger|zap) /);
      expect(classes()).toContain(" not-disabled:hover:bg-text/8 ");
    });

    // Never white, and never the accent's label: each fill has its own.
    it("pairs each solid fill with its own label and its own hover", () => {
      const { rerender } = render(<Button variant="primary" tone="danger">Remove account</Button>);
      expect(classes()).toContain(" bg-danger ");
      expect(classes()).toContain(" text-danger-text ");
      expect(classes()).toContain(" not-disabled:hover:bg-danger-hover ");
      rerender(<Button variant="primary" tone="zap">Zap</Button>);
      expect(classes()).toContain(" bg-zap ");
      expect(classes()).toContain(" text-zap-text ");
      expect(classes()).toContain(" not-disabled:hover:bg-zap-hover ");
      expect(classes()).not.toContain(" bg-danger ");
    });

    // Red text is only held at 4.5:1 on a bare surface, so no fill comes with it.
    it("turns a danger ghost red under the pointer, without a fill", () => {
      render(<Button variant="ghost" tone="danger">Mute</Button>);
      expect(classes()).toContain(" text-text-muted ");
      expect(classes()).toContain(" not-disabled:hover:text-danger ");
      expect(classes()).toContain(" focus-visible:text-danger ");
      expect(classes()).not.toMatch(/hover:bg-/);
    });
  });

  describe("sizes", () => {
    it("is 32px tall by default, 28 small and 40 large", () => {
      const { rerender } = render(<Button>a</Button>);
      expect(classes()).toContain(" min-h-8 ");
      expect(classes()).toContain(" text-ui ");
      rerender(<Button size="sm">a</Button>);
      expect(classes()).toContain(" min-h-7 ");
      expect(classes()).toContain(" text-caption ");
      expect(classes()).not.toContain(" min-h-8 ");
      rerender(<Button size="lg">a</Button>);
      expect(classes()).toContain(" min-h-10 ");
    });

    it("is a square of its height when it is only an icon, and carries its name", () => {
      const { rerender } = render(<Button square aria-label="Save"><svg /></Button>);
      expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
      expect(classes()).toContain(" w-8 ");
      expect(classes()).not.toContain(" px-3 ");
      rerender(<Button square size="sm" aria-label="Save"><svg /></Button>);
      expect(classes()).toContain(" w-7 ");
      rerender(<Button square size="lg" aria-label="Save"><svg /></Button>);
      expect(classes()).toContain(" w-10 ");
      rerender(<Button>a</Button>);
      expect(classes()).toContain(" px-3 ");
      expect(classes()).not.toContain(" w-8 ");
    });

    // "Look around first" under two large buttons is the quiet way out. In medium weight it read as a bold link.
    it("gives weight to a large primary only", () => {
      const { rerender } = render(<Button variant="primary" size="lg">Create a new identity</Button>);
      expect(classes()).toContain(" font-medium ");
      rerender(<Button variant="ghost" size="lg">Look around first</Button>);
      expect(classes()).not.toContain(" font-medium ");
      rerender(<Button size="lg">I already have a key</Button>);
      expect(classes()).not.toContain(" font-medium ");
      rerender(<Button variant="primary">Post</Button>);
      expect(classes()).not.toContain(" font-medium ");
    });

    // A fixed height left the button 2px short of the field beside it.
    it("sets a minimum height, so it can match a taller neighbour in a stretching row", () => {
      render(<Button>Add</Button>);
      expect(classes()).not.toMatch(/ h-\d+ /);
    });
  });

  // "Couldn't read the key. Copy it from Settings." does not fit a 192px sidebar on one line.
  describe("a long label", () => {
    it("stays on one line by default", () => {
      render(<Button>Publish</Button>);
      expect(classes()).toContain(" whitespace-nowrap ");
      expect(classes()).not.toContain(" py-1.5 ");
    });

    it("wraps and grows when asked to, at no less than the usual height", () => {
      render(<Button wrap>Copied. Paste it somewhere safe.</Button>);
      expect(classes()).toContain(" whitespace-normal ");
      expect(classes()).toContain(" min-h-8 ");
      expect(classes()).toContain(" py-1.5 ");
      expect(classes()).not.toContain(" whitespace-nowrap ");
    });
  });

  describe("a toggle", () => {
    it("is not a toggle unless given a pressed state", () => {
      render(<Button>Copy link</Button>);
      expect(btn().hasAttribute("aria-pressed")).toBe(false);
    });

    it("says whether it is pressed and draws the on state in the accent", () => {
      const { rerender } = render(<Button pressed={false}>Save</Button>);
      expect(btn().getAttribute("aria-pressed")).toBe("false");
      expect(classes()).toContain(" bg-text/8 ");
      rerender(<Button pressed>Save</Button>);
      expect(btn().getAttribute("aria-pressed")).toBe("true");
      expect(classes()).toContain(" bg-accent/10 ");
      expect(classes()).toContain(" text-accent ");
      expect(classes()).not.toContain(" bg-text/8 ");
    });

    // A ghost toggle can sit on a row that hovers, where the accent tint is not held at 4.5:1.
    it("marks the current place with the pressed look and aria-current, not as a toggle", () => {
      render(<Button variant="ghost" current>Settings</Button>);
      expect(btn().getAttribute("aria-current")).toBe("page");
      expect(btn().getAttribute("aria-pressed")).toBeNull();
      expect(classes()).toContain(" text-accent ");
    });

    it("draws a pressed ghost in accent text, with no fill", () => {
      render(<Button variant="ghost" pressed>Meta</Button>);
      expect(btn().getAttribute("aria-pressed")).toBe("true");
      expect(classes()).toContain(" text-accent ");
      expect(classes()).not.toContain(" bg-accent/10 ");
      expect(classes()).not.toContain(" text-text-muted ");
    });

    it("leaves a primary filled when pressed", () => {
      render(<Button variant="primary" pressed>Follow</Button>);
      expect(btn().getAttribute("aria-pressed")).toBe("true");
      expect(classes()).toContain(" bg-accent ");
      expect(classes()).toContain(" text-accent-text ");
    });
  });

  // A button that disables itself when pressed drops keyboard focus to the page.
  describe("while busy", () => {
    it("ignores clicks, keeps focus and says so", () => {
      const onClick = vi.fn();
      render(<Button busy onClick={onClick}>Follow</Button>);
      expect(btn().disabled).toBe(false);
      expect(btn().getAttribute("aria-busy")).toBe("true");
      expect(btn().getAttribute("aria-disabled")).toBe("true");
      btn().focus();
      fireEvent.click(btn());
      expect(onClick).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(btn());
    });

    it("does not submit a form", () => {
      const onSubmit = vi.fn((e: { preventDefault(): void }) => e.preventDefault());
      render(<form onSubmit={onSubmit}><Button type="submit" busy>Save</Button></form>);
      fireEvent.click(btn());
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("shows no hover", () => {
      render(<Button variant="primary" busy>Follow</Button>);
      expect(classes()).not.toMatch(/hover:/);
      expect(classes()).toContain(" cursor-progress ");
    });

    // "Publishing…" at 60% opacity was 2.8 to 3.8:1. The label keeps its contrast and a spinner says it is working.
    it("shows a spinner and does not dim the label", () => {
      render(<Button variant="primary" busy>Publishing…</Button>);
      expect(classes()).not.toMatch(/ opacity-\d+ /);
      const spinner = btn().querySelector("span[aria-hidden]")!;
      expect(` ${spinner.className} `).toContain(" animate-spin ");
      expect(` ${spinner.className} `).toContain(" border-current ");
      expect(btn().textContent).toBe("Publishing…");
    });

    // The spinner takes the icon's place and its size, so a button with an icon keeps its width.
    it("hides the icon and gives the spinner the icon's size", () => {
      const { rerender } = render(<Button busy><svg data-testid="icon" />Refresh</Button>);
      expect(classes()).toContain(" [&>svg]:hidden ");
      expect(classes()).toContain(" [&>svg]:size-4 ");
      expect(` ${btn().querySelector("span[aria-hidden]")!.className} `).toContain(" size-4 ");
      rerender(<Button busy size="sm"><svg />Boost</Button>);
      expect(classes()).toContain(" [&>svg]:size-3.5 ");
      expect(` ${btn().querySelector("span[aria-hidden]")!.className} `).toContain(" size-3.5 ");
    });

    it("has no spinner and shows its icon otherwise", () => {
      render(<Button><svg />Refresh</Button>);
      expect(btn().querySelector("span[aria-hidden]")).toBeNull();
      expect(classes()).not.toContain(" [&>svg]:hidden ");
    });

    it("cannot be told by its caller that it is not busy", () => {
      render(<Button busy {...({ "aria-busy": "false", "aria-disabled": "false" } as object)}>Follow</Button>);
      expect(btn().getAttribute("aria-busy")).toBe("true");
      expect(btn().getAttribute("aria-disabled")).toBe("true");
    });

    it("is not marked busy or disabled otherwise", () => {
      render(<Button>Follow</Button>);
      expect(btn().hasAttribute("aria-busy")).toBe(false);
      expect(btn().hasAttribute("aria-disabled")).toBe(false);
    });
  });

  describe("under the pointer", () => {
    const LOOKS = [
      ["secondary", <Button key="1">a</Button>, " not-disabled:hover:bg-text/14 "],
      ["primary", <Button key="2" variant="primary">a</Button>, " not-disabled:hover:bg-accent-hover "],
      ["ghost", <Button key="3" variant="ghost">a</Button>, " not-disabled:hover:text-text "],
      ["danger ghost", <Button key="4" variant="ghost" tone="danger">a</Button>, " not-disabled:hover:text-danger "],
      ["pressed ghost", <Button key="5" variant="ghost" pressed>a</Button>, " not-disabled:hover:bg-text/8 "],
    ] as const;

    for (const [name, element, hover] of LOOKS) {
      // A bare `hover:` reacts on a disabled button. `enabled:` never matches a link.
      it(`${name}: changes, and only when it can be pressed`, () => {
        render(element);
        expect(classes()).toContain(hover);
        const hovers = btn().className.split(/\s+/).filter((c) => c.includes("hover:"));
        expect(hovers.length).toBeGreaterThan(0);
        expect(hovers.filter((c) => !c.startsWith("not-disabled:hover:"))).toEqual([]);
      });
    }
  });

  // The theme tests compute their contrast rules from these numbers.
  it("draws the secondary fill at the tints the theme tests check", () => {
    render(<Button>Message</Button>);
    expect(classes()).toContain(` bg-text/${SECONDARY_TINT.rest} `);
    expect(classes()).toContain(` not-disabled:hover:bg-text/${SECONDARY_TINT.hover} `);
    expect(buttonClass({ variant: "ghost" })).toContain(`not-disabled:hover:bg-text/${SECONDARY_TINT.rest}`);
  });

  it("looks unusable when disabled", () => {
    render(<Button variant="primary" disabled>Publish</Button>);
    expect(classes()).toContain(" disabled:opacity-50 ");
    expect(classes()).toContain(" disabled:cursor-not-allowed ");
  });

  it("sizes and thins its icons, and keeps its shape", () => {
    const { rerender } = render(<Button><svg />Zap</Button>);
    for (const c of ["[&>svg]:size-4", "[&>svg]:stroke-[1.75]", "[&>svg]:shrink-0", "rounded-sm", "inline-flex", "items-center", "justify-center", "shrink-0", "gap-1.5", "px-3"]) expect(classes()).toContain(` ${c} `);
    rerender(<Button size="sm"><svg />Zap</Button>);
    for (const c of ["[&>svg]:size-3.5", "px-2"]) expect(classes()).toContain(` ${c} `);
    rerender(<Button size="lg">Log in</Button>);
    expect(classes()).toContain(" px-4 ");
  });

  it("grows a wrapping button from the padding of its size", () => {
    const { rerender } = render(<Button wrap size="sm">a</Button>);
    expect(classes()).toContain(" py-1 ");
    rerender(<Button wrap size="lg">a</Button>);
    expect(classes()).toContain(" py-2.5 ");
  });

  it("takes layout classes and other attributes", () => {
    render(<Button className="w-full" title="Why" aria-label="Add relay">Add</Button>);
    expect(classes()).toContain(" w-full ");
    expect(btn().getAttribute("title")).toBe("Why");
    expect(screen.getByRole("button", { name: "Add relay" })).toBe(btn());
  });

  // A menu returns focus to the button that opened it.
  it("hands its element to a ref", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>More</Button>);
    expect(ref.current).toBe(btn());
  });

  // An external "open" beside "connect" is a link, and has to look like the button next to it.
  it("lends its look to a link through buttonClass", () => {
    render(<Button variant="ghost" size="sm">connect</Button>);
    expect(buttonClass({ variant: "ghost", size: "sm" }).split(/\s+/).sort()).toEqual(btn().className.split(/\s+/).filter(Boolean).sort());
  });

  // `enabled:` would never match a link, so a link drawn this way would have no hover.
  it("writes hover so that it also applies to a link", () => {
    expect(buttonClass({ variant: "ghost" })).toContain("not-disabled:hover:bg-text/8");
    expect(buttonClass({ variant: "ghost" })).not.toMatch(/(^|\s)enabled:/);
  });

  it("draws focus with an outline, which is right on any surface", () => {
    render(<Button>a</Button>);
    expect(classes()).toContain(" focus-visible:outline-2 ");
    expect(classes()).toContain(" focus-visible:outline-offset-2 ");
    expect(classes()).toContain(" focus-visible:outline-accent ");
  });
});
