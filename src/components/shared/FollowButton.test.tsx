import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const ME = "11".repeat(32);
const THEM = "22".repeat(32);

type Status = "idle" | "loading" | "loaded" | "unknown";
interface FakeUser {
  pubkey: string | null;
  follows: string[];
  followsStatus: Status;
  canSign: boolean;
  follow: (pubkey: string) => Promise<void>;
  unfollow: (pubkey: string) => Promise<void>;
}

// A real store, because the real one changes `follows` the moment a button is
// pressed and publishes afterwards. A plain object that never changes would
// keep "Follow" on screen during the publish, and the guard on "Following"
// (the label that is actually there) would go untested.
const { addToast, publish } = vi.hoisted(() => ({
  addToast: vi.fn(),
  publish: { settle: [] as Array<{ resolve: () => void; reject: (e: Error) => void }> },
}));
vi.mock("../../stores/toast", () => ({ useToastStore: { getState: () => ({ addToast }) } }));
vi.mock("../../stores/user", async () => {
  const { create } = await import("zustand");
  const useUserStore = create<FakeUser>(() => ({ pubkey: null, follows: [], followsStatus: "loaded", canSign: true, follow: async () => {}, unfollow: async () => {} }));
  return { useUserStore, useCanSign: () => useUserStore((s) => s.canSign) };
});

import { FollowButton } from "./FollowButton";
import { useUserStore as realImport } from "../../stores/user";

const store = realImport as unknown as { getState(): FakeUser; setState(s: Partial<FakeUser>): void };
const follow = vi.fn();
const unfollow = vi.fn();

/** Like the app's store: the list changes at once, the publish settles later. */
function optimistic(change: (follows: string[], pubkey: string) => string[], spy: (pubkey: string) => void) {
  return (pubkey: string) => {
    spy(pubkey);
    store.setState({ follows: change(store.getState().follows, pubkey) });
    return new Promise<void>((resolve, reject) => publish.settle.push({ resolve, reject }));
  };
}
const settleAll = async (how: "resolve" | "reject" = "resolve") => {
  await act(async () => { for (const p of publish.settle.splice(0)) how === "resolve" ? p.resolve() : p.reject(new Error("unexpected")); });
};

const btn = () => screen.getByRole("button") as HTMLButtonElement;
const classes = () => ` ${btn().className} `;
/** The label a sighted user reads: the one that is not hidden. */
const shown = () => [...btn().querySelectorAll("span span")].filter((s) => !` ${s.className} `.includes(" invisible ")).map((s) => s.textContent).join("|") || btn().textContent;

beforeEach(() => {
  vi.clearAllMocks();
  publish.settle.length = 0;
  store.setState({
    pubkey: ME, follows: [], followsStatus: "loaded", canSign: true,
    follow: optimistic((f, p) => [...f, p], follow),
    unfollow: optimistic((f, p) => f.filter((x) => x !== p), unfollow),
  });
});

describe("FollowButton", () => {
  it("offers Follow as the main action for someone not followed", () => {
    render(<FollowButton pubkey={THEM} />);
    expect(screen.getByRole("button", { name: "Follow" })).toBe(btn());
    expect(classes()).toContain(" bg-accent ");
  });

  // A list of people you follow should not be a column of loud buttons.
  it("shows Following quietly for someone followed", () => {
    store.setState({ follows: [THEM] });
    render(<FollowButton pubkey={THEM} />);
    expect(shown()).toBe("Following");
    expect(classes()).not.toContain(" bg-accent ");
    expect(classes()).toContain(" text-text-muted ");
  });

  // The label at rest is the state. The label about to be pressed has to be the action.
  it("offers Unfollow in red under the pointer and the keyboard focus", () => {
    store.setState({ follows: [THEM] });
    render(<FollowButton pubkey={THEM} />);
    const [following, unfollowLabel] = [...btn().querySelectorAll("span span")];
    expect(following.textContent).toBe("Following");
    expect(unfollowLabel.textContent).toBe("Unfollow");
    expect(` ${following.className} `).toContain(" group-hover:invisible ");
    expect(` ${following.className} `).toContain(" group-focus-visible:invisible ");
    expect(` ${unfollowLabel.className} `).toContain(" group-hover:visible ");
    expect(` ${unfollowLabel.className} `).toContain(" group-focus-visible:visible ");
    expect(classes()).toContain(" group ");
    expect(classes()).toContain(" not-disabled:hover:text-danger ");
  });

  it("unfollows when Following is pressed", async () => {
    store.setState({ follows: [THEM] });
    render(<FollowButton pubkey={THEM} />);
    fireEvent.click(btn());
    expect(unfollow).toHaveBeenCalledWith(THEM);
    expect(follow).not.toHaveBeenCalled();
    await settleAll();
  });

  // The bug this component exists to prevent. The list flips at once, so the
  // second press lands on "Following": unguarded, it would unfollow again.
  it("ignores a second press while the first is publishing", async () => {
    render(<FollowButton pubkey={THEM} />);
    const node = btn();
    node.focus();
    fireEvent.click(node);
    expect(shown()).toBe("Following");
    fireEvent.click(btn());
    fireEvent.click(btn());
    expect(follow).toHaveBeenCalledTimes(1);
    expect(unfollow).not.toHaveBeenCalled();
    expect(btn().getAttribute("aria-busy")).toBe("true");
    // the same element, still focused: nothing was unmounted or disabled under the user
    expect(btn()).toBe(node);
    expect(btn().disabled).toBe(false);
    expect(document.activeElement).toBe(node);
    await settleAll();
    expect(btn().hasAttribute("aria-busy")).toBe(false);
    expect(store.getState().follows).toEqual([THEM]);
  });

  it("guards the other direction too", async () => {
    store.setState({ follows: [THEM] });
    render(<FollowButton pubkey={THEM} />);
    fireEvent.click(btn());
    expect(shown()).toBe("Follow");
    fireEvent.click(btn());
    expect(unfollow).toHaveBeenCalledTimes(1);
    expect(follow).not.toHaveBeenCalled();
    await settleAll();
    expect(store.getState().follows).toEqual([]);
  });

  // Straight after following, the pointer is still on the button. "Unfollow"
  // in red there would read as if the press had unfollowed.
  it("does not offer Unfollow until the pointer has left once", async () => {
    render(<FollowButton pubkey={THEM} />);
    fireEvent.click(btn());
    await settleAll();
    const unfollowLabel = () => [...btn().querySelectorAll("span span")][1];
    expect(` ${unfollowLabel().className} `).not.toContain(" group-hover:visible ");
    expect(classes()).not.toContain(" not-disabled:hover:text-danger ");
    fireEvent.pointerLeave(btn());
    expect(` ${unfollowLabel().className} `).toContain(" group-hover:visible ");
    expect(classes()).toContain(" not-disabled:hover:text-danger ");
  });

  it("offers Unfollow again after the keyboard focus has left", async () => {
    render(<FollowButton pubkey={THEM} />);
    fireEvent.click(btn());
    await settleAll();
    fireEvent.blur(btn());
    expect(` ${[...btn().querySelectorAll("span span")][1].className} `).toContain(" group-focus-visible:visible ");
  });

  // The store reports the failures it knows about and resolves. One it did not
  // expect used to end as an unhandled rejection with nothing on screen.
  it("says so when a change fails unexpectedly, and can be pressed again", async () => {
    store.setState({ follow: (pubkey: string) => { follow(pubkey); return new Promise<void>((resolve, reject) => publish.settle.push({ resolve, reject })); } });
    render(<FollowButton pubkey={THEM} />);
    fireEvent.click(btn());
    await settleAll("reject");
    await waitFor(() => expect(btn().hasAttribute("aria-busy")).toBe(false));
    expect(addToast).toHaveBeenCalledTimes(1);
    expect(addToast.mock.calls[0][0]).toMatch(/Couldn't follow/);
    fireEvent.click(btn());
    expect(follow).toHaveBeenCalledTimes(2);
    await settleAll();
  });

  it("raises no toast when it works", async () => {
    render(<FollowButton pubkey={THEM} />);
    fireEvent.click(btn());
    await settleAll();
    expect(addToast).not.toHaveBeenCalled();
  });

  // "Not in the list" proves nothing until the list has loaded.
  it("holds Follow back while the follow list is loading", () => {
    store.setState({ followsStatus: "loading" });
    render(<FollowButton pubkey={THEM} />);
    expect(btn().getAttribute("aria-busy")).toBe("true");
    fireEvent.click(btn());
    expect(follow).not.toHaveBeenCalled();
  });

  // The person may already be followed. Follow stays usable, because the store
  // fetches the list again before it changes anything, but it is not the main action.
  it("offers a quiet Follow when the list could not be loaded", async () => {
    store.setState({ followsStatus: "unknown" });
    render(<FollowButton pubkey={THEM} />);
    expect(classes()).not.toContain(" bg-accent ");
    expect(classes()).toContain(" bg-text/8 ");
    expect(btn().getAttribute("title")).toMatch(/has not loaded/);
    expect(btn().hasAttribute("aria-busy")).toBe(false);
    fireEvent.click(btn());
    expect(follow).toHaveBeenCalledWith(THEM);
    await settleAll();
  });

  it("is absent for a read-only account", () => {
    store.setState({ canSign: false });
    render(<FollowButton pubkey={THEM} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("is absent on yourself", () => {
    render(<FollowButton pubkey={ME} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
