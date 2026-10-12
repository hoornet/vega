import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { ToastContainer } from "./ToastContainer";
import { useToastStore } from "../../stores/toast";

const add = (...args: Parameters<ReturnType<typeof useToastStore.getState>["addToast"]>) => act(() => useToastStore.getState().addToast(...args));
const stack = () => document.querySelector("[data-toast-stack]") as HTMLElement;
const polite = () => screen.getByRole("status");
const assertive = () => screen.getByRole("alert");
/** The visible toasts, top to bottom as drawn (the stack is reversed: newest on top). */
const shown = () => [...stack().children].reverse().map((el) => el.querySelector("p")?.textContent ?? "");
const toast = (text: string) => [...stack().children].find((el) => el.textContent?.includes(text)) as HTMLElement;
/** Zero-width space: what makes the same words a change. */
const plain = (text: string | null) => (text ?? "").replace(/​/g, "");

beforeEach(() => {
  vi.useFakeTimers();
  window.dispatchEvent(new Event("focus"));
  useToastStore.getState().releaseAll("pointer");
  for (const t of useToastStore.getState().toasts) useToastStore.getState().removeToast(t.id);
});
afterEach(() => { cleanup(); vi.useRealTimers(); document.body.innerHTML = ""; });

describe("ToastContainer: what a screen reader hears", () => {
  // A node inserted with its text already in it is often not announced. These
  // two are there from the start, and only their text changes.
  it("has both live regions in the page before any toast, empty", () => {
    render(<ToastContainer />);
    expect(polite().getAttribute("aria-live")).toBe("polite");
    expect(assertive().getAttribute("aria-live")).toBe("assertive");
    expect(polite().textContent).toBe("");
    expect(assertive().textContent).toBe("");
  });

  // A failure interrupts. Everything else waits its turn.
  it("puts a failure in the assertive region and everything else in the polite one, with the kind said", () => {
    render(<ToastContainer />);
    add("Following Alice.", "success");
    expect(polite().textContent).toBe("Done: Following Alice.");
    expect(assertive().textContent).toBe("");
    add("Couldn't repost.", "error");
    expect(assertive().textContent).toBe("Error: Couldn't repost.");
    expect(polite().textContent).toBe("Done: Following Alice.");
    add("Connection lost.", "warning");
    expect(polite().textContent).toBe("Warning: Connection lost.");
  });

  // Two warnings from one read of the inbox arrive in one render. Only the second was written.
  it("says every toast raised in one go, not only the last", () => {
    render(<ToastContainer />);
    act(() => {
      useToastStore.getState().addToast("Some messages could not be read.", "warning");
      useToastStore.getState().addToast("A relay refused Vega's sign-in.", "warning");
      useToastStore.getState().addToast("Couldn't repost.", "error", { key: "a" });
      useToastStore.getState().addToast("Couldn't publish.", "error", { key: "b" });
    });
    expect(polite().textContent).toBe("Warning: Some messages could not be read. Warning: A relay refused Vega's sign-in.");
    expect(assertive().textContent).toBe("Error: Couldn't repost. Error: Couldn't publish.");
  });

  // Worked out from what was left on screen, the region changed back to the
  // older toast when a newer one went, and the older one was read out again.
  it("does not say an older toast again when a newer one goes away", () => {
    render(<ToastContainer />);
    add("Following Alice.", "success", 60000);
    add("Link copied.", "success", 60000);
    add("Couldn't repost.", "error", 60000);
    add("Couldn't publish.", "error", 60000);
    const politeBefore = polite().textContent;
    const assertiveBefore = assertive().textContent;
    expect(politeBefore).toBe("Done: Link copied.");
    expect(assertiveBefore).toBe("Error: Couldn't publish.");
    act(() => { useToastStore.getState().removeToast(useToastStore.getState().toasts[3].id); });
    act(() => { useToastStore.getState().removeToast(useToastStore.getState().toasts[1].id); });
    expect(shown()).toEqual(["Error: Couldn't repost.", "Done: Following Alice."]);
    expect(polite().textContent).toBe(politeBefore);
    expect(assertive().textContent).toBe(assertiveBefore);
  });

  it("does not say anything again when the last toast goes", () => {
    render(<ToastContainer />);
    add("Link copied.", "success");
    act(() => { vi.advanceTimersByTime(4000); });
    expect(stack().children).toHaveLength(0);
    expect(polite().textContent).toBe("Done: Link copied.");
  });

  // The same words twice are no change to a live region, and so are not read.
  it("says the same words again when they are raised a second time, as a change", () => {
    render(<ToastContainer />);
    add("Link copied.", "success");
    const first = polite().textContent;
    act(() => { vi.advanceTimersByTime(4000); });
    add("Link copied.", "success");
    const second = polite().textContent;
    expect(plain(second)).toBe("Done: Link copied.");
    expect(second).not.toBe(first);
    act(() => { vi.advanceTimersByTime(4000); });
    add("Link copied.", "success");
    expect(plain(polite().textContent)).toBe("Done: Link copied.");
    expect(polite().textContent).not.toBe(second);
  });

  it("says a toast again when it is raised again while still showing", () => {
    render(<ToastContainer />);
    add("Connection lost.", "warning");
    const first = polite().textContent;
    add("Connection lost.", "warning");
    expect(plain(polite().textContent)).toBe("Warning: Connection lost.");
    expect(polite().textContent).not.toBe(first);
    expect(stack().children).toHaveLength(1);
  });

  it("says the newer words of a toast that changed under one key", () => {
    render(<ToastContainer />);
    add("Following Alice.", "success", { key: "follow:alice" });
    add("Unfollowed Alice.", "success", { key: "follow:alice" });
    expect(polite().textContent).toBe("Done: Unfollowed Alice.");
  });

  // "Undo" and "Dismiss" read out as part of the message is noise.
  it("keeps the buttons out of what is read out, and the visible toasts out of the live regions", () => {
    render(<ToastContainer />);
    add("Muted Alice.", "success", { action: { label: "Undo", run: () => {} } });
    expect(polite().querySelector("button")).toBeNull();
    expect(polite().textContent).not.toContain("Undo");
    expect(stack().querySelector("[role=status], [role=alert], [aria-live]")).toBeNull();
  });

  it("says the kind in the visible toast too, for someone who cannot see the colour", () => {
    render(<ToastContainer />);
    add("Couldn't repost.", "error");
    expect(toast("Couldn't repost.").querySelector("p")?.textContent).toBe("Error: Couldn't repost.");
    expect(toast("Couldn't repost.").querySelector("p .sr-only")?.textContent).toBe("Error: ");
  });

  it("ties each button to its own toast's message", () => {
    render(<ToastContainer />);
    add("Muted Alice.", "success", { action: { label: "Undo", run: () => {} } });
    const message = toast("Muted Alice.").querySelector("p");
    for (const button of toast("Muted Alice.").querySelectorAll("button")) {
      expect(button.getAttribute("aria-describedby")).toBe(message?.id);
    }
  });

  // An empty landmark is one more stop on the way through the page, to nothing.
  it("is a named region only while there is a toast in it", () => {
    render(<ToastContainer />);
    expect(screen.queryByRole("region", { name: "Messages from Vega" })).toBeNull();
    expect(stack().hasAttribute("role")).toBe(false);
    add("Link copied.", "success");
    expect(screen.getByRole("region", { name: "Messages from Vega" })).toBe(stack());
    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.queryByRole("region", { name: "Messages from Vega" })).toBeNull();
    expect(stack().hasAttribute("aria-label")).toBe(false);
    expect(stack().hasAttribute("role")).toBe(false);
  });
});

describe("ToastContainer: where it is drawn", () => {
  it("renders at the body, inside the text-size zoom, above dialogs", () => {
    const { container } = render(<ToastContainer />);
    expect(container.contains(stack())).toBe(false);
    expect(stack().parentElement?.parentElement).toBe(document.body);
    expect(stack().parentElement?.style.zoom).toBe("var(--ui-zoom, 1)");
    expect(stack().className).toContain("z-[60]"); // a dialog's backdrop is z-50; measured in the browser, not here
    // Above the player bar, and above a view's own bottom bar: measured in the browser, not here.
    expect(stack().className).toContain("bottom-[calc(1rem+var(--toast-floor,0px))]");
    expect(stack().className).toContain("[body:has([data-player-bar])_&]:bottom-[calc(4.5rem+var(--toast-floor,0px))]");
  });

  it("does not take clicks meant for the page under it, only for the toasts", () => {
    render(<ToastContainer />);
    add("Link copied.", "success");
    expect(stack().className).toContain("pointer-events-none");
    expect(toast("Link copied.").className).toContain("pointer-events-auto");
  });

  // The newest is drawn on top, so the one being reached for does not move.
  it("puts a new toast above the ones already there", () => {
    render(<ToastContainer />);
    add("first", "info");
    add("second", "info");
    expect(stack().className).toContain("flex-col-reverse");
    expect(shown()).toEqual(["Note: second", "Note: first"]);
  });
});

describe("ToastContainer: its buttons", () => {
  it("can be dismissed", () => {
    render(<ToastContainer />);
    add("Link copied.", "success");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Link copied.")).toBeNull();
  });

  it("runs its action once and goes away", () => {
    const undo = vi.fn();
    render(<ToastContainer />);
    add("Muted Alice.", "success", { action: { label: "Undo", run: undo } });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(stack().children).toHaveLength(0);
  });

  // The action may raise a toast with the same key (a retry that fails
  // again). That one must stay: the old toast is removed before the action runs.
  it("keeps a toast its own action raises with the same message", () => {
    render(<ToastContainer />);
    const retry = () => useToastStore.getState().addToast("Couldn't publish.", "error", { action: { label: "Try again", run: retry } });
    add("Couldn't publish.", "error", { action: { label: "Try again", run: retry } });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(stack().children).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  // The keychain warning: a copy that failed must be possible to try again.
  it("stays up after an action that asks to be kept open", () => {
    const copy = vi.fn();
    render(<ToastContainer />);
    add("Your key was not saved.", "error", { sticky: true, action: { label: "Copy key", run: copy, keepOpen: true } });
    fireEvent.click(screen.getByRole("button", { name: "Copy key" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy key" }));
    expect(copy).toHaveBeenCalledTimes(2);
    expect(stack().children).toHaveLength(1);
  });

  it("has no action button without an action", () => {
    render(<ToastContainer />);
    add("Link copied.", "success");
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Dismiss"]);
  });
});

describe("ToastContainer: the pointer", () => {
  it("stays while the pointer is over it, and goes once it has left", () => {
    render(<ToastContainer />);
    add("Couldn't publish.", "error");
    fireEvent.pointerEnter(toast("Couldn't publish."));
    act(() => { vi.advanceTimersByTime(60000); });
    expect(stack().children).toHaveLength(1);
    // Leaving to nowhere: React reports the window, which is not a node.
    fireEvent.pointerLeave(toast("Couldn't publish."));
    act(() => { vi.advanceTimersByTime(8000); });
    expect(stack().children).toHaveLength(0);
  });

  // The oldest is at the bottom. When it left, the ones above dropped a slot
  // under the pointer, and the press meant for "Undo" landed on a neighbour.
  it("holds every toast while the pointer is over any of them", () => {
    render(<ToastContainer />);
    add("oldest", "info");
    add("Muted Alice.", "success", { action: { label: "Undo", run: () => {} } });
    fireEvent.pointerEnter(toast("Muted Alice."));
    act(() => { vi.advanceTimersByTime(60000); });
    expect(shown()).toEqual(["Done: Muted Alice.", "Note: oldest"]);
  });

  it("goes on holding when the pointer moves from one toast to the next", () => {
    render(<ToastContainer />);
    add("oldest", "info");
    add("newest", "info");
    fireEvent.pointerEnter(toast("oldest"));
    fireEvent.pointerLeave(toast("oldest"), { relatedTarget: toast("newest") });
    fireEvent.pointerEnter(toast("newest"));
    act(() => { vi.advanceTimersByTime(60000); });
    expect(stack().children).toHaveLength(2);
  });

  // An element removed under the pointer sends no "leave".
  it("lets go when a toast is dismissed under the pointer and the pointer is next seen elsewhere", () => {
    render(<><p>the page</p><ToastContainer /></>);
    add("stays", "info");
    add("Link copied.", "success");
    fireEvent.pointerEnter(toast("Link copied."));
    fireEvent.click(toast("Link copied.").querySelector('[aria-label="Dismiss"]') as Element);
    act(() => { vi.advanceTimersByTime(60000); });
    expect(shown()).toEqual(["Note: stays"]); // still held: the pointer has not been seen anywhere else
    fireEvent.pointerMove(screen.getByText("the page"));
    act(() => { vi.advanceTimersByTime(4000); });
    expect(stack().children).toHaveLength(0);
  });

  // All a touch screen reports after a tap on "Dismiss" is the next tap.
  it("lets go when the next press is outside the stack", () => {
    render(<><p>the page</p><ToastContainer /></>);
    add("stays", "info");
    add("Link copied.", "success");
    fireEvent.pointerEnter(toast("Link copied."));
    fireEvent.click(toast("Link copied.").querySelector('[aria-label="Dismiss"]') as Element);
    fireEvent.pointerDown(screen.getByText("the page"));
    act(() => { vi.advanceTimersByTime(4000); });
    expect(stack().children).toHaveLength(0);
  });

  it("does not let go while the pointer moves about inside the stack", () => {
    render(<ToastContainer />);
    add("stays", "info");
    fireEvent.pointerEnter(toast("stays"));
    fireEvent.pointerMove(toast("stays").querySelector("p") as Element);
    act(() => { vi.advanceTimersByTime(60000); });
    expect(stack().children).toHaveLength(1);
  });

  // Seen entering and leaving before React has drawn again, the pointer
  // never shows up as state. A hold taken in one place and let go in
  // another was then kept for good.
  it("lets go when the pointer has come and gone before anything was drawn", () => {
    render(<ToastContainer />);
    add("Link copied.", "success");
    act(() => {
      fireEvent.pointerEnter(toast("Link copied."));
      fireEvent.pointerLeave(toast("Link copied."));
    });
    act(() => { vi.advanceTimersByTime(4000); });
    expect(stack().children).toHaveLength(0);
  });

  it("lets go when it is taken off the page with the pointer inside", () => {
    const view = render(<ToastContainer />);
    add("Link copied.", "success");
    fireEvent.pointerEnter(toast("Link copied."));
    view.unmount();
    act(() => { vi.advanceTimersByTime(4000); });
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  // The store lets go by itself when the last toast leaves. The next one may
  // appear under a pointer this component still believes is inside.
  it("holds a toast that appears under a pointer that never left", () => {
    render(<ToastContainer />);
    add("first", "info");
    fireEvent.pointerEnter(toast("first"));
    fireEvent.click(toast("first").querySelector('[aria-label="Dismiss"]') as Element);
    add("second", "info");
    fireEvent.pointerEnter(toast("second"));
    act(() => { vi.advanceTimersByTime(60000); });
    expect(shown()).toEqual(["Note: second"]);
  });
});

describe("ToastContainer: focus", () => {
  // Focus on "Undo", the mouse crosses the toast and leaves: it used to go, with focus inside.
  it("stays while focus is inside it, whatever the pointer does", () => {
    render(<ToastContainer />);
    add("Muted Alice.", "success", { action: { label: "Undo", run: () => {} } });
    act(() => { screen.getByRole("button", { name: "Undo" }).focus(); });
    fireEvent.pointerEnter(toast("Muted Alice."));
    fireEvent.pointerLeave(toast("Muted Alice."));
    act(() => { vi.advanceTimersByTime(60000); });
    expect(stack().children).toHaveLength(1);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Undo" }));
  });

  it("holds the toast focus is in and not the others", () => {
    render(<ToastContainer />);
    add("other", "info");
    add("Muted Alice.", "success", { action: { label: "Undo", run: () => {} } });
    act(() => { screen.getByRole("button", { name: "Undo" }).focus(); });
    act(() => { vi.advanceTimersByTime(4000); });
    expect(shown()).toEqual(["Done: Muted Alice."]);
  });

  it("does not start its clock when focus moves between its own two buttons", () => {
    render(<ToastContainer />);
    add("Muted Alice.", "success", { action: { label: "Undo", run: () => {} } });
    act(() => { screen.getByRole("button", { name: "Undo" }).focus(); });
    act(() => { toast("Muted Alice.").querySelector<HTMLElement>('[aria-label="Dismiss"]')?.focus(); });
    act(() => { vi.advanceTimersByTime(60000); });
    expect(stack().children).toHaveLength(1);
  });

  it("goes once focus has left it", () => {
    render(<><button>elsewhere</button><ToastContainer /></>);
    add("Muted Alice.", "success", { action: { label: "Undo", run: () => {} } });
    act(() => { screen.getByRole("button", { name: "Undo" }).focus(); });
    act(() => { screen.getByRole("button", { name: "elsewhere" }).focus(); });
    act(() => { vi.advanceTimersByTime(8000); });
    expect(stack().children).toHaveLength(0);
  });
});

describe("ToastContainer: the keyboard", () => {
  const withOpener = () => {
    render(<><button>More actions</button><ToastContainer /></>);
    const opener = screen.getByRole("button", { name: "More actions" });
    act(() => { opener.focus(); });
    return opener;
  };
  /** Listens where the app's own Escape handling does: after everything on `document`. */
  const appWide = () => {
    const heard = vi.fn();
    window.addEventListener("keydown", heard);
    return { heard, stop: () => window.removeEventListener("keydown", heard) };
  };

  // Focus used to fall to the page, and the user's place in it was lost.
  it("gives focus back to where it came from when its action is used", () => {
    const opener = withOpener();
    add("Muted Alice.", "success", { action: { label: "Undo", run: () => {} } });
    act(() => { screen.getByRole("button", { name: "Undo" }).focus(); });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(document.activeElement).toBe(opener);
  });

  it("gives focus back when it is dismissed from the keyboard", () => {
    const opener = withOpener();
    add("Link copied.", "success");
    act(() => { screen.getByRole("button", { name: "Dismiss" }).focus(); });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(document.activeElement).toBe(opener);
  });

  it("does not move focus when a toast is dismissed with the pointer from elsewhere", () => {
    const opener = withOpener();
    add("Link copied.", "success");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(document.activeElement).toBe(opener);
  });

  // Focus was in a toast once and has moved on. Dismissing another toast
  // with the pointer must not pull it back to where it was before that.
  it("does not pull focus back when a toast is dismissed while focus is somewhere else", () => {
    render(<><button>More actions</button><button>elsewhere</button><ToastContainer /></>);
    act(() => { screen.getByRole("button", { name: "More actions" }).focus(); });
    add("Muted Alice.", "success", { action: { label: "Undo", run: () => {} }, autoCloseMs: 60000 });
    add("Link copied.", "success", 60000);
    act(() => { screen.getByRole("button", { name: "Undo" }).focus(); });
    const elsewhere = screen.getByRole("button", { name: "elsewhere" });
    act(() => { elsewhere.focus(); });
    fireEvent.click(toast("Link copied.").querySelector('[aria-label="Dismiss"]') as Element);
    expect(document.activeElement).toBe(elsewhere);
  });

  // Moving between two toasts must not make the first toast "where focus came from".
  it("gives focus back to the page, not to another toast, after moving between toasts", () => {
    const opener = withOpener();
    add("first", "info", { action: { label: "View", run: () => {} } });
    add("second", "info", { action: { label: "Undo", run: () => {} } });
    act(() => { screen.getByRole("button", { name: "View" }).focus(); });
    act(() => { screen.getByRole("button", { name: "Undo" }).focus(); });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(document.activeElement).toBe(opener);
  });

  // F6 with nothing focused: focus comes from nowhere. Where it came from
  // on an earlier visit is not where it came from now, and going "back"
  // there scrolled the page to a button the user had long left.
  it("does not send focus to where it came from on an earlier visit", () => {
    const opener = withOpener();
    add("first", "info", { action: { label: "View", run: () => {} } });
    act(() => { screen.getByRole("button", { name: "View" }).focus(); });
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    expect(document.activeElement).toBe(opener);

    act(() => { opener.blur(); });
    add("Muted Alice.", "success", { action: { label: "Undo", run: () => {} } });
    act(() => { screen.getByRole("button", { name: "Undo" }).focus(); });
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(stack().children).toHaveLength(0);
    expect(document.activeElement).toBe(document.body);
  });

  // To another window and back with focus in a toast. A window reports no
  // "where from" on the way back, and that used to wipe the place to return to.
  it("still gives focus back to where it came from after a trip to another window", () => {
    const opener = withOpener();
    add("Muted Alice.", "success", { action: { label: "Undo", run: () => {} } });
    const undo = screen.getByRole("button", { name: "Undo" });
    act(() => { undo.focus(); });
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    act(() => { undo.blur(); }); // the window loses the keyboard
    hasFocus.mockReturnValue(true);
    act(() => { undo.focus(); }); // and gets it back
    fireEvent.click(undo);
    expect(document.activeElement).toBe(opener);
    hasFocus.mockRestore();
  });

  // The toast focus was in ran out while the user was in the other window.
  // Coming into a different toast later is not coming back to that one.
  it("does not take a visit to another toast for the way back from another window", () => {
    const opener = withOpener();
    add("Link copied.", "success", { key: "first" });
    const first = screen.getByRole("button", { name: "Dismiss" });
    act(() => { first.focus(); });
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    act(() => { first.blur(); }); // to another window
    hasFocus.mockReturnValue(true);
    act(() => { vi.advanceTimersByTime(4000); }); // it runs out meanwhile
    add("Muted Alice.", "success", { action: { label: "Undo", run: () => {} } });
    act(() => { screen.getByRole("button", { name: "Undo" }).focus(); });
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(document.activeElement).not.toBe(opener);
    hasFocus.mockRestore();
  });

  it("forgets the trip once it is over: the next visit from nowhere is from nowhere", () => {
    const opener = withOpener();
    add("Muted Alice.", "success", { action: { label: "Undo", run: () => {} } });
    const undo = screen.getByRole("button", { name: "Undo" });
    act(() => { undo.focus(); });
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    act(() => { undo.blur(); });
    hasFocus.mockReturnValue(true);
    act(() => { undo.focus(); }); // back from the other window
    act(() => { opener.focus(); }); // and on to somewhere else in this one
    act(() => { opener.blur(); });
    act(() => { undo.focus(); }); // a new visit, from nowhere
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(document.activeElement).toBe(document.body);
    hasFocus.mockRestore();
  });

  // Focus left the toast for somewhere in this window that takes no focus (a
  // click on the page). Coming in again later is a new visit, from nowhere.
  it("does not take a click away on the page for a trip to another window", () => {
    const opener = withOpener();
    add("Muted Alice.", "success", { action: { label: "Undo", run: () => {} } });
    const undo = screen.getByRole("button", { name: "Undo" });
    act(() => { undo.focus(); });
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    act(() => { undo.blur(); });
    act(() => { undo.focus(); });
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(document.activeElement).not.toBe(opener);
    expect(document.activeElement).toBe(document.body);
    hasFocus.mockRestore();
  });

  // With nowhere to go back to, focus must still leave the toast: left on its
  // button, the next Escape was the app's, with focus showing in the toast.
  it("Escape in a sticky toast takes focus out of it even with nowhere to give it back to", () => {
    const app = appWide();
    render(<ToastContainer />);
    add("Your key was not saved.", "error", { sticky: true, action: { label: "Copy key", run: () => {}, keepOpen: true } });
    act(() => { screen.getByRole("button", { name: "Copy key" }).focus(); });
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(shown()).toEqual(["Error: Your key was not saved."]);
    expect(document.activeElement).toBe(document.body);
    expect(app.heard).not.toHaveBeenCalled();
    app.stop();
  });

  // Without this the press went on to the app and navigated back.
  it("Escape with focus in a toast dismisses that toast, and nothing else hears it", () => {
    const app = appWide();
    const opener = withOpener();
    add("first", "info");
    add("Muted Alice.", "success", { action: { label: "Undo", run: () => {} } });
    act(() => { screen.getByRole("button", { name: "Undo" }).focus(); });
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(shown()).toEqual(["Note: first"]);
    expect(document.activeElement).toBe(opener);
    expect(app.heard).not.toHaveBeenCalled();
    app.stop();
  });

  it("Escape is not taken when focus is not in a toast", () => {
    const app = appWide();
    withOpener();
    add("Link copied.", "success");
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(stack().children).toHaveLength(1);
    expect(app.heard).toHaveBeenCalledTimes(1);
    app.stop();
  });

  // A stray Escape must not put away the key warning: it only leaves it.
  it("Escape in a toast that stays until dismissed gives focus back and leaves the toast", () => {
    const app = appWide();
    const opener = withOpener();
    add("Your key was not saved.", "error", { sticky: true, action: { label: "Copy key", run: () => {}, keepOpen: true } });
    act(() => { screen.getByRole("button", { name: "Copy key" }).focus(); });
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(shown()).toEqual(["Error: Your key was not saved."]);
    expect(document.activeElement).toBe(opener);
    expect(app.heard).not.toHaveBeenCalled();
    // Out of the toast now: the next Escape is the app's again.
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(app.heard).toHaveBeenCalledTimes(1);
    expect(shown()).toEqual(["Error: Your key was not saved."]);
    app.stop();
  });

  // A toast taken away by the store with focus inside it (an account change)
  // left its Escape layer behind, and every later Escape was swallowed.
  it("gives Escape back to the app when the toast focus was in is taken away", () => {
    const app = appWide();
    withOpener();
    add("Following Alice.", "success", { action: { label: "Undo", run: () => {}, forAccount: true } });
    act(() => { screen.getByRole("button", { name: "Undo" }).focus(); });
    act(() => { useToastStore.getState().dropAccountToasts(); });
    expect(stack().children).toHaveLength(0);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(app.heard).toHaveBeenCalledTimes(1);
    app.stop();
  });

  it("gives Escape back to the app when the toast focus was in runs out of time elsewhere", () => {
    const app = appWide();
    withOpener();
    add("Muted Alice.", "success", { action: { label: "Undo", run: () => {} } });
    act(() => { screen.getByRole("button", { name: "Undo" }).focus(); });
    act(() => { useToastStore.getState().removeToast(useToastStore.getState().toasts[0].id); });
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(app.heard).toHaveBeenCalledTimes(1);
    app.stop();
  });
});
