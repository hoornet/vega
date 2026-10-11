import { describe, it, expect, vi, afterEach } from "vitest";
import { pushLayer, tabStops } from "./layers";

const removers: Array<() => void> = [];
const push = (layer: Parameters<typeof pushLayer>[0]) => { const remove = pushLayer(layer); removers.push(remove); return remove; };
afterEach(() => { removers.splice(0).forEach((r) => r()); document.body.innerHTML = ""; });

const key = (k: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
  (document.activeElement ?? document.body).dispatchEvent(e);
  return e;
};

function box(html: string): HTMLElement {
  const el = document.createElement("div");
  el.tabIndex = -1;
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

describe("Escape", () => {
  // Listeners on one node run in the order they were added. With one each,
  // Escape closed whatever had opened first: the menu under the dialog.
  it("goes to whatever opened last", () => {
    const menu = vi.fn();
    const dialog = vi.fn();
    push({ onEscape: menu });
    push({ onEscape: dialog });
    key("Escape");
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(menu).not.toHaveBeenCalled();
  });

  it("goes to the next one down once the top one is gone", () => {
    const under = vi.fn();
    const over = vi.fn();
    push({ onEscape: under });
    const removeOver = push({ onEscape: over });
    removeOver();
    key("Escape");
    expect(under).toHaveBeenCalledTimes(1);
    expect(over).not.toHaveBeenCalled();
  });

  // The lower dialog can close first: signing in from the zap dialog, then the zap dialog closing itself.
  it("keeps the right one on top when a lower layer is removed first", () => {
    const a = vi.fn();
    const b = vi.fn();
    const removeA = push({ onEscape: a });
    push({ onEscape: b });
    removeA();
    key("Escape");
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
  });

  it("is harmless to remove a layer twice", () => {
    const a = vi.fn();
    const b = vi.fn();
    push({ onEscape: a });
    const removeB = push({ onEscape: b });
    removeB();
    removeB();
    key("Escape");
    expect(a).toHaveBeenCalledTimes(1);
  });

  it("stops there: the app-wide handler on window never sees it", () => {
    const app = vi.fn();
    window.addEventListener("keydown", app);
    push({ onEscape: () => {} });
    key("Escape");
    window.removeEventListener("keydown", app);
    expect(app).not.toHaveBeenCalled();
  });

  it("is left alone when nothing is floating", () => {
    const app = vi.fn();
    window.addEventListener("keydown", app);
    key("Escape");
    window.removeEventListener("keydown", app);
    expect(app).toHaveBeenCalledTimes(1);
  });

  // Escape cancels an input method's conversion. Closing the dialog on that press would lose the text.
  it("is not taken while an input method is composing", () => {
    const onEscape = vi.fn();
    push({ onEscape });
    key("Escape", { isComposing: true });
    expect(onEscape).not.toHaveBeenCalled();
    key("Escape", { keyCode: 229 });
    expect(onEscape).not.toHaveBeenCalled();
    key("Escape");
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("lets other keys through", () => {
    const onEscape = vi.fn();
    const app = vi.fn();
    window.addEventListener("keydown", app);
    push({ onEscape });
    key("j");
    window.removeEventListener("keydown", app);
    expect(onEscape).not.toHaveBeenCalled();
    expect(app).toHaveBeenCalledTimes(1);
  });
});

describe("Tab", () => {
  it("is left alone when no modal is open", () => {
    push({ onEscape: () => {} });
    expect(key("Tab").defaultPrevented).toBe(false);
  });

  it("wraps from the last stop to the first, and back", () => {
    const el = box(`<button id="a">a</button><input id="b"><button id="c">c</button>`);
    push({ onEscape: () => {}, trap: () => el });
    const [a, , c] = [...el.querySelectorAll<HTMLElement>("button, input")];
    c.focus();
    expect(key("Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(a);
    expect(key("Tab", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(c);
  });

  it("moves normally between stops in the middle", () => {
    const el = box(`<button>a</button><input><button>c</button>`);
    push({ onEscape: () => {}, trap: () => el });
    el.querySelector("input")!.focus();
    expect(key("Tab").defaultPrevented).toBe(false);
  });

  // The focused control unmounts (the Zap button once it is pressed) and focus
  // falls to <body>. A trap that listens on the dialog never hears the next Tab.
  it("brings focus back in when it has fallen to the page", () => {
    const behind = document.createElement("button");
    behind.textContent = "Settings";
    document.body.appendChild(behind);
    const el = box(`<button id="a">a</button><button id="c">c</button>`);
    push({ onEscape: () => {}, trap: () => el });
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    expect(key("Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(el.querySelector("#a"));

    behind.focus();
    expect(key("Tab", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(el.querySelector("#c"));
  });

  it("moves Shift+Tab from the container itself to the last stop", () => {
    const el = box(`<button id="a">a</button><button id="c">c</button>`);
    push({ onEscape: () => {}, trap: () => el });
    el.focus();
    key("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(el.querySelector("#c"));
  });

  it("keeps focus on the container when there is nothing to stop at", () => {
    const el = box(`<p>Sending 21 sats…</p>`);
    push({ onEscape: () => {}, trap: () => el });
    expect(key("Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(el);
  });

  // A popover opened inside a dialog is the newest layer, and has no trap of its own.
  it("stays inside the modal while a popover is open over it", () => {
    const el = box(`<button id="a">a</button><button id="c">c</button>`);
    push({ onEscape: () => {}, trap: () => el });
    push({ onEscape: () => {} });
    (el.querySelector("#c") as HTMLElement).focus();
    key("Tab");
    expect(document.activeElement).toBe(el.querySelector("#a"));
  });

  it("belongs to the modal on top when two are open", () => {
    const under = box(`<button id="u">under</button>`);
    const over = box(`<button id="o1">one</button><button id="o2">two</button>`);
    push({ onEscape: () => {}, trap: () => under });
    push({ onEscape: () => {}, trap: () => over });
    (under.querySelector("#u") as HTMLElement).focus();
    key("Tab");
    expect(document.activeElement).toBe(over.querySelector("#o1"));
  });
});

describe("tabStops", () => {
  // The unselected tabs of a tab list are buttons with tabindex -1: focusable, but Tab skips them.
  it("leaves out what Tab skips, and what is disabled", () => {
    const el = box(`<button tabindex="-1">Read-only</button><button disabled>Log in</button><input id="key"><a href="#x" id="link">help</a><span tabindex="0" id="chip">chip</span><a>no href</a>`);
    expect(tabStops(el).map((n) => n.id)).toEqual(["key", "link", "chip"]);
  });
});
