import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useToastStore, openView } from "./toast";
import { useUIStore } from "./ui";

const add = useToastStore.getState().addToast;
const { holdToast, releaseToast, holdAll, releaseAll, removeToast, removeByKey, dropAccountToasts } = useToastStore.getState();
const toasts = () => useToastStore.getState().toasts;
const messages = () => toasts().map((t) => t.message);
const ACTION = { label: "View", run: () => {} };
/** As `forThisAccount` makes it: about what one account did. */
const OWN_ACTION = { label: "Undo", run: () => {}, forAccount: true };

/** The window can or cannot be seen at all (another workspace, minimised). */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  // Back at the window and looking at it, whatever the last test left.
  setHidden(false);
  window.dispatchEvent(new Event("focus"));
  releaseAll("pointer");
  for (const t of toasts()) removeToast(t.id);
});
afterEach(() => { vi.useRealTimers(); });

describe("how long a toast stays", () => {
  it("goes away on its own", () => {
    add("Link copied.", "success");
    expect(messages()).toEqual(["Link copied."]);
    vi.advanceTimersByTime(3999);
    expect(messages()).toEqual(["Link copied."]);
    vi.advanceTimersByTime(1);
    expect(messages()).toEqual([]);
  });

  // A failure takes longer to read than a confirmation, and matters more.
  it("keeps a warning longer than a confirmation, and an error longest", () => {
    add("a", "success"); add("b", "info"); add("c", "warning"); add("d", "error");
    expect(toasts().map((t) => t.autoCloseMs)).toEqual([4000, 4000, 6000, 8000]);
  });

  it("stays as long as it is told to, as a number or as an option", () => {
    add("a", "success", 2500);
    add("b", "error", { autoCloseMs: 1000 });
    expect(toasts().map((t) => t.autoCloseMs)).toEqual([2500, 1000]);
  });

  // With something to press there has to be time to read it and get there.
  it("gives a toast with an action at least eight seconds, unless told otherwise", () => {
    add("Following Alice.", "success", { action: ACTION });
    add("Couldn't repost.", "error", { action: ACTION });
    add("Brief.", "success", { autoCloseMs: 3000, action: ACTION });
    expect(toasts().map((t) => t.autoCloseMs)).toEqual([8000, 8000, 3000]);
  });

  it("a sticky toast stays until it is dismissed", () => {
    add("Your key was not saved.", "error", { sticky: true });
    expect(toasts()[0].autoCloseMs).toBeNull();
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(messages()).toEqual(["Your key was not saved."]);
    expect(vi.getTimerCount()).toBe(0);
    removeToast(toasts()[0].id);
    expect(messages()).toEqual([]);
  });

  it("leaves no clock running for a toast that is gone", () => {
    add("Link copied.", "success");
    expect(vi.getTimerCount()).toBe(1);
    removeToast(toasts()[0].id);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("holding one toast", () => {
  it("does not go away while it is held, and starts its time over afterwards", () => {
    add("Couldn't publish.", "error");
    const { id } = toasts()[0];
    vi.advanceTimersByTime(7000);
    holdToast(id, "focus");
    vi.advanceTimersByTime(60000);
    expect(messages()).toEqual(["Couldn't publish."]);
    releaseToast(id, "focus");
    vi.advanceTimersByTime(7999);
    expect(messages()).toEqual(["Couldn't publish."]);
    vi.advanceTimersByTime(1);
    expect(messages()).toEqual([]);
  });

  it("holds that toast and not the others", () => {
    add("held", "info");
    add("free", "info");
    holdToast(toasts()[0].id, "focus");
    vi.advanceTimersByTime(4000);
    expect(messages()).toEqual(["held"]);
  });

  // One flag for both reasons let a toast go with focus still inside it:
  // focus on "Undo", the mouse crosses the toast and leaves, the clock starts.
  it("stays while focus is inside although the pointer has come and gone", () => {
    add("Muted Alice.", "success", { action: ACTION });
    const { id } = toasts()[0];
    holdToast(id, "focus");
    holdAll("pointer");
    releaseAll("pointer");
    vi.advanceTimersByTime(60000);
    expect(messages()).toEqual(["Muted Alice."]);
    releaseToast(id, "focus");
    vi.advanceTimersByTime(8000);
    expect(messages()).toEqual([]);
  });

  it("stays while the pointer is in the stack although focus has come and gone", () => {
    add("Muted Alice.", "success", { action: ACTION });
    const { id } = toasts()[0];
    holdAll("pointer");
    holdToast(id, "focus");
    releaseToast(id, "focus");
    vi.advanceTimersByTime(60000);
    expect(messages()).toEqual(["Muted Alice."]);
  });

  // A second failure with the same words restarted the clock under the pointer.
  it("does not start its clock when it is said again while held", () => {
    add("Couldn't publish your bookmarks.", "error");
    const { id } = toasts()[0];
    holdToast(id, "focus");
    add("Couldn't publish your bookmarks.", "error");
    vi.advanceTimersByTime(60000);
    expect(toasts().map((t) => t.id)).toEqual([id]);
  });

  // The store's contract, whoever calls it: a toast held for two reasons is held until both are over.
  it("is held until every reason it was held for is over", () => {
    add("Muted Alice.", "success", { action: ACTION });
    const { id } = toasts()[0];
    holdToast(id, "focus");
    holdToast(id, "pointer");
    releaseToast(id, "pointer");
    vi.advanceTimersByTime(60000);
    expect(messages()).toEqual(["Muted Alice."]);
    releaseToast(id, "focus");
    vi.advanceTimersByTime(8000);
    expect(messages()).toEqual([]);
  });

  it("holding or releasing a toast that is gone does nothing", () => {
    add("a", "info");
    const { id } = toasts()[0];
    removeToast(id);
    holdToast(id, "focus");
    releaseToast(id, "focus");
    vi.advanceTimersByTime(10000);
    expect(messages()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

// The oldest toast is at the bottom. If it left while the pointer was on
// "Undo" above it, the stack dropped a slot and the press landed elsewhere.
describe("the pointer in the stack", () => {
  it("stops every clock, not only the one under the pointer", () => {
    add("oldest", "info");
    add("Muted Alice.", "success", { action: ACTION });
    holdAll("pointer");
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60000);
    expect(messages()).toEqual(["oldest", "Muted Alice."]);
  });

  it("starts them all over when it leaves", () => {
    add("oldest", "info");
    add("Muted Alice.", "success", { action: ACTION });
    vi.advanceTimersByTime(3000);
    holdAll("pointer");
    vi.advanceTimersByTime(60000);
    releaseAll("pointer");
    vi.advanceTimersByTime(3999);
    expect(messages()).toEqual(["oldest", "Muted Alice."]);
    vi.advanceTimersByTime(1);
    expect(messages()).toEqual(["Muted Alice."]);
    vi.advanceTimersByTime(4000);
    expect(messages()).toEqual([]);
  });

  // Let go twice, or let go without having held: the clocks are not started over.
  it("does nothing when let go without being held", () => {
    add("Link copied.", "success");
    vi.advanceTimersByTime(3000);
    releaseAll("pointer");
    vi.advanceTimersByTime(1000);
    expect(messages()).toEqual([]);
  });

  // One leaving would move the rest under the pointer: what the hold is there to prevent.
  it("pushes nobody out while it is there, and trims the stack when it has left", () => {
    for (let i = 1; i <= 5; i++) add(`toast ${i}`, "info", 60000);
    holdAll("pointer");
    add("toast 6", "info", 60000);
    add("toast 7", "error", 60000);
    expect(messages()).toHaveLength(7);
    releaseAll("pointer");
    expect(messages()).toEqual(["toast 3", "toast 4", "toast 5", "toast 6", "toast 7"]);
    expect(vi.getTimerCount()).toBe(5);
  });

  it("does not start the clock of a toast raised while it is there", () => {
    add("first", "info");
    holdAll("pointer");
    add("second", "info");
    vi.advanceTimersByTime(60000);
    expect(messages()).toEqual(["first", "second"]);
  });

  // No toast is left to report the pointer leaving: the next one must not wait for good.
  it("lets go when the last toast is dismissed with the pointer still there", () => {
    add("only", "info");
    holdAll("pointer");
    removeToast(toasts()[0].id);
    add("next", "info");
    vi.advanceTimersByTime(4000);
    expect(messages()).toEqual([]);
  });

  it("lets go when an account change takes the last toast", () => {
    add("Following Alice.", "success", { action: OWN_ACTION });
    holdAll("pointer");
    dropAccountToasts();
    add("next", "info");
    vi.advanceTimersByTime(4000);
    expect(messages()).toEqual([]);
  });

  it("does not let go while a toast is still there", () => {
    add("first", "info");
    add("second", "info");
    holdAll("pointer");
    removeToast(toasts()[1].id);
    // The pointer is still in the stack: one raised now waits like the rest.
    add("third", "info");
    vi.advanceTimersByTime(60000);
    expect(messages()).toEqual(["first", "third"]);
    releaseAll("pointer");
    vi.advanceTimersByTime(4000);
    expect(messages()).toEqual([]);
  });
});

describe("while nobody is looking", () => {
  // A failure that comes and goes while the user is in another window was never said.
  it("stops a failure's clock when the window loses the keyboard, and starts it over when it is back", () => {
    add("Couldn't publish your bookmarks.", "error");
    vi.advanceTimersByTime(7000);
    window.dispatchEvent(new Event("blur"));
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(messages()).toEqual(["Couldn't publish your bookmarks."]);
    window.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(7999);
    expect(messages()).toEqual(["Couldn't publish your bookmarks."]);
    vi.advanceTimersByTime(1);
    expect(messages()).toEqual([]);
  });

  it("holds one with something to press too", () => {
    add("Muted Alice.", "success", { action: ACTION });
    window.dispatchEvent(new Event("blur"));
    vi.advanceTimersByTime(60000);
    expect(messages()).toEqual(["Muted Alice."]);
  });

  // A window that lost the keyboard may be in full view, a tile beside a
  // terminal. "Link copied." sat there for as long as the user typed elsewhere.
  it("lets a plain confirmation go although another window has the keyboard", () => {
    add("Link copied.", "success");
    add("Connection lost.", "warning");
    window.dispatchEvent(new Event("blur"));
    vi.advanceTimersByTime(4000);
    expect(messages()).toEqual(["Connection lost."]);
    vi.advanceTimersByTime(2000);
    expect(messages()).toEqual([]);
  });

  it("does not start the clock of a failure raised while away", () => {
    window.dispatchEvent(new Event("blur"));
    add("Couldn't publish.", "error");
    vi.advanceTimersByTime(60000);
    expect(messages()).toEqual(["Couldn't publish."]);
    window.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(8000);
    expect(messages()).toEqual([]);
  });

  it("coming back does not start the clock of a toast that is held", () => {
    add("Muted Alice.", "success", { action: ACTION });
    holdToast(toasts()[0].id, "focus");
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(60000);
    expect(messages()).toEqual(["Muted Alice."]);
  });

  // Another workspace, or minimised: nothing can be read at all.
  it("stops every clock while the window cannot be seen, plain confirmations included", () => {
    add("Link copied.", "success");
    add("Couldn't publish.", "error");
    vi.advanceTimersByTime(3000);
    setHidden(true);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(messages()).toEqual(["Link copied.", "Couldn't publish."]);
    setHidden(false);
    vi.advanceTimersByTime(3999);
    expect(messages()).toEqual(["Link copied.", "Couldn't publish."]);
    vi.advanceTimersByTime(1);
    expect(messages()).toEqual(["Couldn't publish."]);
  });

  it("does not start the clock of a toast raised while the window cannot be seen", () => {
    setHidden(true);
    add("Link copied.", "success");
    vi.advanceTimersByTime(60000);
    expect(messages()).toEqual(["Link copied."]);
  });

  // A webview that never reports the keyboard coming back must not leave
  // toasts up for good: anyone pointing or typing here is looking.
  it.each(["pointermove", "pointerdown", "keydown"])("takes a %s in the window as being back", (type) => {
    add("Couldn't publish.", "error");
    window.dispatchEvent(new Event("blur"));
    vi.advanceTimersByTime(60000);
    document.dispatchEvent(new Event(type));
    vi.advanceTimersByTime(8000);
    expect(messages()).toEqual([]);
  });

  it("does not restart the clocks at every move of the pointer once back", () => {
    add("Couldn't publish.", "error");
    window.dispatchEvent(new Event("blur"));
    vi.advanceTimersByTime(60000);
    document.dispatchEvent(new Event("pointermove")); // back: the eight seconds start
    vi.advanceTimersByTime(7000);
    document.dispatchEvent(new Event("pointermove"));
    vi.advanceTimersByTime(1000);
    expect(messages()).toEqual([]);
  });

  // With focus-follows-mouse the keyboard changes window every time the
  // pointer crosses an edge. Every clock was started over each time, and
  // "Link copied." stayed for as long as the pointer kept crossing.
  it("leaves a plain toast's clock alone when the keyboard goes to another window and back", () => {
    add("Link copied.", "success");
    vi.advanceTimersByTime(3000);
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(999);
    expect(messages()).toEqual(["Link copied."]);
    vi.advanceTimersByTime(1);
    expect(messages()).toEqual([]);
  });

  it("starts over only the clocks that had stopped when the keyboard is back", () => {
    add("Link copied.", "success", 10000);
    add("Couldn't publish.", "error");
    vi.advanceTimersByTime(5000);
    window.dispatchEvent(new Event("blur"));
    vi.advanceTimersByTime(1000);
    window.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(4000); // 10 s after the plain one was raised, 4 s after the failure's clock started over
    expect(messages()).toEqual(["Couldn't publish."]);
    vi.advanceTimersByTime(4000);
    expect(messages()).toEqual([]);
  });
});

describe("the same toast again", () => {
  it("is one toast, not two, and its time starts over", () => {
    add("Connection lost.", "warning");
    const first = toasts()[0];
    vi.advanceTimersByTime(5000);
    add("Connection lost.", "warning");
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0].id).toBe(first.id);
    vi.advanceTimersByTime(5000); // 10s after the first, 5s after the second
    expect(messages()).toEqual(["Connection lost."]);
    vi.advanceTimersByTime(1000);
    expect(messages()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  // What gets it read out a second time.
  it("counts how many times it has been said", () => {
    add("Connection lost.", "warning");
    expect(toasts()[0].said).toBe(1);
    add("Connection lost.", "warning");
    add("Connection lost.", "warning");
    expect(toasts()[0].said).toBe(3);
  });

  // "Try again" must retry the newer attempt, not the one from before.
  it("takes the newer action and type", () => {
    const older = vi.fn(); const newer = vi.fn();
    add("Couldn't publish.", "warning", { action: { label: "Try again", run: older } });
    add("Couldn't publish.", "error", { action: { label: "Try again", run: newer } });
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0].type).toBe("error");
    toasts()[0].action?.run();
    expect(newer).toHaveBeenCalledTimes(1);
    expect(older).not.toHaveBeenCalled();
  });

  it("drops an action the newer one does not have", () => {
    add("Saved.", "success", { action: ACTION });
    add("Saved.", "success");
    expect(toasts()[0].action).toBeUndefined();
  });

  // Two failed reposts say the same words. Merged on the words, "Try again" retried only one.
  it("keeps two toasts with the same words apart when they have different keys", () => {
    const first = vi.fn(); const second = vi.fn();
    add("Couldn't repost.", "error", { key: "repost:a", action: { label: "Try again", run: first } });
    add("Couldn't repost.", "error", { key: "repost:b", action: { label: "Try again", run: second } });
    expect(toasts()).toHaveLength(2);
    toasts()[0].action?.run();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("is one toast for one key, with the newer words", () => {
    add("Following Alice.", "success", { key: "follow:alice" });
    add("Unfollowed Alice.", "success", { key: "follow:alice" });
    expect(messages()).toEqual(["Unfollowed Alice."]);
  });
});

describe("too many at once", () => {
  it("keeps the newest five", () => {
    for (let i = 1; i <= 7; i++) add(`toast ${i}`, "info");
    expect(messages()).toEqual(["toast 3", "toast 4", "toast 5", "toast 6", "toast 7"]);
  });

  it("stops the clock of a toast it drops", () => {
    for (let i = 1; i <= 6; i++) add(`toast ${i}`, "info", 60000);
    expect(toasts()).toHaveLength(5);
    expect(vi.getTimerCount()).toBe(5);
  });

  // It is there because it must not be missed. Five ordinary toasts pushed
  // the keychain warning out, and with it the only way left to copy the key.
  it("never drops one that stays until dismissed, however many follow", () => {
    add("Your key was not saved.", "error", { sticky: true });
    for (let i = 1; i <= 12; i++) add(`toast ${i}`, "info", 60000);
    expect(messages()).toEqual(["Your key was not saved.", "toast 9", "toast 10", "toast 11", "toast 12"]);
  });

  it("lets the stack grow when nothing in it may go", () => {
    for (let i = 1; i <= 5; i++) add(`key ${i}`, "error", { sticky: true });
    add("a sixth", "error", { sticky: true });
    add("Link copied.", "success");
    expect(toasts()).toHaveLength(7);
    add("Link copied again.", "success");
    expect(messages()).toEqual(["key 1", "key 2", "key 3", "key 4", "key 5", "a sixth", "Link copied again."]);
  });

  // A failure, or one with a button, is the last to be pushed out by chatter.
  it("drops a plain message before a failure or one with a button", () => {
    add("Couldn't repost.", "error", 60000);
    add("Muted Alice.", "success", { action: ACTION, autoCloseMs: 60000 });
    add("plain 1", "info", 60000);
    add("plain 2", "info", 60000);
    add("plain 3", "info", 60000);
    add("plain 4", "info", 60000);
    expect(messages()).toEqual(["Couldn't repost.", "Muted Alice.", "plain 2", "plain 3", "plain 4"]);
  });

  it("drops the oldest that matters when they all do", () => {
    for (let i = 1; i <= 6; i++) add(`failure ${i}`, "error", 60000);
    expect(messages()).toEqual(["failure 2", "failure 3", "failure 4", "failure 5", "failure 6"]);
  });

  it("drops a free one before one somebody is reading", () => {
    add("held", "info", 60000);
    holdToast(toasts()[0].id, "focus");
    for (let i = 1; i <= 5; i++) add(`toast ${i}`, "info", 60000);
    expect(messages()).toEqual(["held", "toast 2", "toast 3", "toast 4", "toast 5"]);
  });

  // Being read outranks mattering: nothing is taken from under someone's eyes while a free one can go.
  it("drops a free failure before a plain one somebody is reading", () => {
    add("held", "info", 60000);
    holdToast(toasts()[0].id, "focus");
    for (let i = 1; i <= 5; i++) add(`failure ${i}`, "error", 60000);
    expect(messages()).toEqual(["held", "failure 2", "failure 3", "failure 4", "failure 5"]);
  });

  // The store's contract, whoever holds them: with every one being read, a plain one still goes before a failure.
  it("drops a plain one first even when every one of them is held", () => {
    add("failure 1", "error", 60000);
    add("plain 1", "info", 60000);
    add("plain 2", "info", 60000);
    add("failure 2", "error", 60000);
    add("failure 3", "error", 60000);
    for (const t of toasts()) holdToast(t.id, "focus");
    add("failure 4", "error", 60000);
    expect(messages()).toEqual(["failure 1", "plain 2", "failure 2", "failure 3", "failure 4"]);
  });

  it("never drops the one just raised", () => {
    for (let i = 1; i <= 5; i++) add(`failure ${i}`, "error", 60000);
    add("Link copied.", "success");
    expect(messages()).toEqual(["failure 2", "failure 3", "failure 4", "failure 5", "Link copied."]);
  });
});

describe("when the account changes", () => {
  // "Undo" and "Try again" were about what the other account did.
  it("drops the toasts whose action was about that account and keeps the rest", () => {
    add("Following Alice.", "success", { action: OWN_ACTION });
    add("Connection lost.", "warning");
    add("Couldn't repost.", "error", { action: { ...OWN_ACTION, label: "Try again" } });
    dropAccountToasts();
    expect(messages()).toEqual(["Connection lost."]);
    expect(vi.getTimerCount()).toBe(1);
  });

  // "Relays" on a sign-in notice, "View" on a note: about no account in particular.
  it("keeps a toast whose action is about no account", () => {
    add("A relay refused Vega's sign-in.", "warning", { action: { label: "Relays", run: () => {} } });
    dropAccountToasts();
    expect(messages()).toEqual(["A relay refused Vega's sign-in."]);
  });

  // That one is there because it must not be missed: the key still has to be saved.
  it("keeps the sticky key warning", () => {
    add("Your key was not saved.", "error", { sticky: true, action: { label: "Copy key", run: () => {}, keepOpen: true } });
    dropAccountToasts();
    expect(messages()).toEqual(["Your key was not saved."]);
  });
});

// What a toast said can stop being true: the list went out after all, the key was saved, the account is gone.
describe("taking a toast down by its key", () => {
  it("removes the toast with that key, and its clock", () => {
    add("Couldn't publish your mute list.", "error", { key: "publish:mutes" });
    add("Link copied.", "success");
    removeByKey("publish:mutes");
    expect(messages()).toEqual(["Link copied."]);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("takes down one that stays until dismissed", () => {
    add("Your key was not saved.", "error", { sticky: true, key: "keychain:alice" });
    removeByKey("keychain:alice");
    expect(messages()).toEqual([]);
  });

  it("does nothing when no toast has that key", () => {
    add("Link copied.", "success");
    removeByKey("publish:mutes");
    expect(messages()).toEqual(["Link copied."]);
  });
});

describe("openView", () => {
  it("is an action that goes to a view", () => {
    useUIStore.setState({ currentView: "feed" });
    openView("relays")();
    expect(useUIStore.getState().currentView).toBe("relays");
  });
});
