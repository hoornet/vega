import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { Switch, SwitchControl } from "./Switch";

function Live({ start = false, disabled = false, busy = false, onToggle = (_: boolean) => {} }) {
  const [on, setOn] = useState(start);
  return <Switch checked={on} onChange={(v) => { onToggle(v); setOn(v); }} label="Use proxy for connections" hint="Applies after restart." disabled={disabled} busy={busy} />;
}
const sw = () => screen.getByRole("switch") as HTMLButtonElement;
const classes = (el: Element) => ` ${el.className} `;

describe("Switch", () => {
  // The hand-built ones were bare buttons: no role and no state.
  it("is a switch with a name and a state", () => {
    render(<Live />);
    expect(sw().getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("switch", { name: "Use proxy for connections" })).toBe(sw());
  });

  // The wrapping <label> would name it anyway, so check the reference itself resolves.
  it("points aria-labelledby at its label text", () => {
    render(<Live />);
    const label = document.getElementById(sw().getAttribute("aria-labelledby")!);
    expect(label?.textContent).toBe("Use proxy for connections");
  });

  it("is described by its hint", () => {
    render(<Live />);
    const hint = document.getElementById(sw().getAttribute("aria-describedby")!);
    expect(hint?.textContent).toBe("Applies after restart.");
  });

  it("has nothing to be described by without a hint", () => {
    render(<Switch checked={false} onChange={() => {}} label="Mentions" />);
    expect(sw().hasAttribute("aria-describedby")).toBe(false);
  });

  it("turns on and off, reporting the new state", () => {
    const onToggle = vi.fn();
    render(<Live onToggle={onToggle} />);
    fireEvent.click(sw());
    expect(onToggle).toHaveBeenLastCalledWith(true);
    expect(sw().getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw());
    expect(onToggle).toHaveBeenLastCalledWith(false);
    expect(sw().getAttribute("aria-checked")).toBe("false");
  });

  it("toggles when its label is clicked", () => {
    const onToggle = vi.fn();
    render(<Live onToggle={onToggle} />);
    fireEvent.click(screen.getByText("Use proxy for connections"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  // A paragraph of explanation should not be a click target.
  it("does not toggle when the hint is clicked", () => {
    const onToggle = vi.fn();
    render(<Live onToggle={onToggle} />);
    fireEvent.click(screen.getByText("Applies after restart."));
    expect(onToggle).not.toHaveBeenCalled();
  });

  // A label as wide as the pane made the empty space beside the text toggle the setting.
  it("keeps its label as wide as its content", () => {
    render(<Live />);
    expect(classes(sw().closest("label")!)).toContain(" w-fit ");
  });

  it("does nothing while disabled", () => {
    const onToggle = vi.fn();
    render(<Live disabled onToggle={onToggle} />);
    expect(sw().disabled).toBe(true);
    fireEvent.click(sw());
    fireEvent.click(screen.getByText("Use proxy for connections"));
    expect(onToggle).not.toHaveBeenCalled();
  });

  // A switch that disables itself while a change is applied drops keyboard focus
  // to the page, and the next Space does nothing.
  it("ignores clicks while busy but stays focusable and says so", () => {
    const onToggle = vi.fn();
    render(<Live busy onToggle={onToggle} />);
    expect(sw().disabled).toBe(false);
    expect(sw().getAttribute("aria-busy")).toBe("true");
    sw().focus();
    fireEvent.click(sw());
    fireEvent.click(screen.getByText("Use proxy for connections"));
    expect(onToggle).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(sw());
  });

  it("is not marked busy otherwise", () => {
    render(<Live />);
    expect(sw().hasAttribute("aria-busy")).toBe(false);
  });

  it("draws off with the field-edge colour and on with the accent", () => {
    render(<Live />);
    expect(classes(sw())).toContain(" bg-border-strong ");
    fireEvent.click(sw());
    expect(classes(sw())).toContain(" bg-accent ");
    expect(classes(sw())).not.toContain(" bg-border-strong ");
  });

  it("moves the knob to the right when on, and hides it from screen readers", () => {
    render(<Live />);
    const knob = () => sw().firstElementChild!;
    expect(knob().getAttribute("aria-hidden")).toBe("true");
    expect(classes(knob())).toContain(" translate-x-0 ");
    fireEvent.click(sw());
    expect(classes(knob())).toContain(" translate-x-4 ");
    expect(classes(knob())).not.toContain(" translate-x-0 ");
  });

  // Inside a form a bare <button> submits it.
  it("is never a submit button", () => {
    render(<Live />);
    expect(sw().getAttribute("type")).toBe("button");
  });

  it("passes layout classes to its wrapper", () => {
    const { container } = render(<Switch checked={false} onChange={() => {}} label="Mentions" className="mb-3" />);
    expect(classes(container.firstElementChild!)).toContain(" mb-3 ");
  });

  it("gives two switches on one screen different ids", () => {
    render(<><Switch checked={false} onChange={() => {}} label="Mentions" /><Switch checked onChange={() => {}} label="Zaps received" /></>);
    const [a, b] = screen.getAllByRole("switch");
    expect(a.getAttribute("aria-labelledby")).not.toBe(b.getAttribute("aria-labelledby"));
    expect(screen.getByRole("switch", { name: "Zaps received" })).toBe(b);
  });
});

// The control alone has no wrapping label, so the reference is its only name.
describe("SwitchControl", () => {
  it("takes its name from an element elsewhere in the row", () => {
    render(<><span id="row-label">Stream sats</span><SwitchControl checked={false} onChange={() => {}} aria-labelledby="row-label" /></>);
    expect(screen.getByRole("switch", { name: "Stream sats" })).toBe(sw());
  });

  it("takes its name from aria-label", () => {
    render(<SwitchControl checked onChange={() => {}} aria-label="Auto-stream" />);
    expect(screen.getByRole("switch", { name: "Auto-stream" })).toBe(sw());
    expect(sw().getAttribute("aria-checked")).toBe("true");
  });

  it("toggles from a label elsewhere in the row through its id", () => {
    const onChange = vi.fn();
    render(<><label htmlFor="row-switch">Stream sats</label><SwitchControl id="row-switch" checked={false} onChange={onChange} aria-label="Stream sats" /></>);
    fireEvent.click(screen.getByText("Stream sats"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("has a smaller size for tight spots", () => {
    render(<><SwitchControl checked={false} onChange={() => {}} aria-label="a" /><SwitchControl size="sm" checked={false} onChange={() => {}} aria-label="b" /></>);
    const [md, sm] = screen.getAllByRole("switch");
    expect(classes(md)).toContain(" h-5 ");
    expect(classes(sm)).toContain(" h-4 ");
    expect(classes(sm.firstElementChild!)).toContain(" w-3 ");
  });

  it("looks unusable when disabled", () => {
    render(<SwitchControl disabled checked={false} onChange={() => {}} aria-label="a" />);
    expect(classes(sw())).toContain(" disabled:opacity-50 ");
  });
});
