import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";

const user = vi.hoisted(() => ({
  loginError: null as string | null,
  loggedIn: false,
  loginWithNsec: vi.fn(),
  loginWithPubkey: vi.fn(),
  loginWithRemoteSigner: vi.fn(),
  saveProfile: vi.fn(),
  adoptEmptyContactList: vi.fn(),
}));
vi.mock("../../stores/user", () => {
  const useUserStore = Object.assign(() => user, { getState: () => user, setState: (next: Partial<typeof user>) => Object.assign(user, next) });
  return { useUserStore };
});
// Counted by a mock, answered by a plain function: a promise a mock returns is
// watched by the mock, so a rejection from it is never an unhandled one.
const relays = vi.hoisted(() => ({ ensureConnected: vi.fn(), connect: () => Promise.resolve(true) }));
const ensureConnected = relays.ensureConnected;
vi.mock("../../lib/nostr", () => ({ ensureConnected: () => { relays.ensureConnected(); return relays.connect(); } }));
const copyText = vi.hoisted(() => vi.fn());
vi.mock("../../lib/clipboard", () => ({ copyText: (text: string) => copyText(text) }));

import { OnboardingFlow, discardSignupDraft } from "./OnboardingFlow";
import { useToastStore } from "../../stores/toast";
import { useBackupStore } from "../../stores/backup";
import { isFirstRun, useFirstRunStore } from "../../stores/firstRun";
import { shortNpub } from "../../lib/utils";

/** What the interests step says about the step before it, if anything. */
const notice = () => screen.queryByRole("alert")?.textContent ?? null;

const onComplete = vi.fn();
const toasts = () => useToastStore.getState().toasts;
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const nameField = () => screen.getByLabelText("Name") as HTMLInputElement;
/** The public address on the name step, shortened as shown and in full as its tooltip. */
const address = () => screen.getByText(/^npub1.+…/);

const toNameStep = () => {
  render(<OnboardingFlow onComplete={onComplete} />);
  press("Create my account");
};
const toBackupStep = (name = "") => {
  toNameStep();
  if (name) fireEvent.change(nameField(), { target: { value: name } });
  press(/Next: save your secret key/);
};
/** The way out of the backup step that needs no checkbox. */
const finishBackup = async () => {
  await act(async () => { press("I'll back up my key later"); });
};

beforeEach(() => {
  useFirstRunStore.setState({ accounts: [] });
  vi.clearAllMocks();
  localStorage.clear();
  user.loginError = null;
  user.loginWithNsec.mockResolvedValue(undefined);
  user.saveProfile.mockResolvedValue(undefined);
  relays.connect = () => Promise.resolve(true);
  copyText.mockResolvedValue(true);
  useToastStore.setState({ toasts: [] });
  useBackupStore.setState({ pending: [] });
  discardSignupDraft();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("welcome", () => {
  it("says what Vega is before it asks for anything", () => {
    render(<OnboardingFlow onComplete={onComplete} />);
    expect(screen.getByText(/A desktop home for Nostr, the open social network/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create my account" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "I already have a Nostr key" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Look around first" })).toBeTruthy();
  });

  it("does not connect to any relay", () => {
    render(<OnboardingFlow onComplete={onComplete} />);
    expect(ensureConnected).not.toHaveBeenCalled();
  });
});

// The step used to show a 63-character key and ask for nothing.
describe("the name step", () => {
  it("asks for a name, in a field that has the keyboard", () => {
    toNameStep();
    expect(screen.getByRole("heading", { name: "What should people call you?" })).toBeTruthy();
    expect(document.activeElement).toBe(nameField());
  });

  it("shows the public address shortened, never the whole key as text", () => {
    toNameStep();
    const full = address().getAttribute("title")!;
    expect(full).toMatch(/^npub1[a-z0-9]{58}$/);
    expect(address().textContent).toBe(shortNpub(full));
    expect(document.body.textContent).not.toContain(full);
  });

  it("copies the whole public address", async () => {
    toNameStep();
    const full = address().getAttribute("title")!;
    await act(async () => { press("Copy public address"); });
    expect(copyText).toHaveBeenCalledWith(full);
    expect(screen.getByRole("button", { name: "Copy public address" }).textContent).toBe("Copied");
  });

  it("does not say Copied when the clipboard refused", async () => {
    copyText.mockResolvedValue(false);
    toNameStep();
    await act(async () => { press("Copy public address"); });
    expect(screen.getByRole("button", { name: "Copy public address" }).textContent).toBe("Copy");
  });

  it("starts connecting to relays, so the slower ones are up too when the name is published", () => {
    toNameStep();
    expect(ensureConnected).toHaveBeenCalledTimes(1);
  });

  it("is not stopped by relays that cannot be reached, and leaves no failure unhandled", async () => {
    relays.connect = () => Promise.reject(new Error("offline"));
    toNameStep();
    await act(async () => {});
    press(/Next: save your secret key/);
    expect(screen.getByRole("heading", { name: "Save your secret key." })).toBeTruthy();
  });

  it("does not go on with any other key", () => {
    toNameStep();
    fireEvent.keyDown(nameField(), { key: "a" });
    fireEvent.keyDown(nameField(), { key: "Tab" });
    expect(screen.getByRole("heading", { name: "What should people call you?" })).toBeTruthy();
  });

  it("goes on with Enter", () => {
    toNameStep();
    fireEvent.change(nameField(), { target: { value: "Ana" } });
    fireEvent.keyDown(nameField(), { key: "Enter" });
    expect(screen.getByRole("heading", { name: "Save your secret key." })).toBeTruthy();
  });

  it("does not go on with the Enter that picks a candidate while a name is being composed", () => {
    toNameStep();
    fireEvent.keyDown(nameField(), { key: "Enter", isComposing: true });
    expect(screen.getByRole("heading", { name: "What should people call you?" })).toBeTruthy();
  });

  // WebKit ends the composition before it sends the key, so there the key
  // code is the only thing that tells.
  it("nor with that Enter as WebKit sends it", () => {
    toNameStep();
    fireEvent.keyDown(nameField(), { key: "Enter", keyCode: 229 });
    expect(screen.getByRole("heading", { name: "What should people call you?" })).toBeTruthy();
    fireEvent.keyDown(nameField(), { key: "Enter", keyCode: 13 });
    expect(screen.getByRole("heading", { name: "Save your secret key." })).toBeTruthy();
  });

  it("has a way back", () => {
    toNameStep();
    press("Back");
    expect(screen.getByRole("heading", { name: "Welcome to Vega." })).toBeTruthy();
  });

  it("keeps the same key and the typed name through going back and forward", () => {
    toNameStep();
    const first = address().getAttribute("title");
    fireEvent.change(nameField(), { target: { value: "Ana" } });
    press("Back");
    press("Create my account");
    expect(address().getAttribute("title")).toBe(first);
    expect(nameField().value).toBe("Ana");
  });

  it("cuts a paste of the wrong thing", () => {
    toNameStep();
    expect(nameField().maxLength).toBe(50);
  });
});

describe("the name is published once the account exists", () => {
  it("signs in with the new key first, then publishes the name as the whole first profile", async () => {
    const order: string[] = [];
    let finishLogin!: () => void;
    user.loginWithNsec.mockImplementation(() => new Promise<void>((resolve) => { finishLogin = () => { order.push("signed in"); resolve(); }; }));
    user.saveProfile.mockImplementation(async () => { order.push("published"); });
    toBackupStep("Ana");
    await finishBackup();
    expect(user.loginWithNsec).toHaveBeenCalledWith(expect.stringMatching(/^nsec1/));
    // Not before the account exists: the profile is signed with its key.
    expect(user.saveProfile).not.toHaveBeenCalled();
    await act(async () => { finishLogin(); });
    expect(order).toEqual(["signed in", "published"]);
    expect(user.saveProfile).toHaveBeenCalledWith({ name: "Ana", display_name: "Ana" }, expect.stringMatching(/^[0-9a-f]{64}$/));
    // And the new key is known to follow nobody, without a relay being asked.
    expect(user.adoptEmptyContactList).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{64}$/));
  });

  // The profile is for the key made in this flow, whoever is signed in by then.
  it("publishes it for the key that was just made, and no other", async () => {
    toNameStep();
    const { nip19 } = await import("@nostr-dev-kit/ndk");
    const made = nip19.decode(address().getAttribute("title")!).data as string;
    fireEvent.change(nameField(), { target: { value: "Ana" } });
    press(/Next: save your secret key/);
    await finishBackup();
    expect(user.saveProfile).toHaveBeenCalledWith({ name: "Ana", display_name: "Ana" }, made);
  });

  it("moves on to the next step only when the name is out", async () => {
    let finishPublish!: () => void;
    user.saveProfile.mockImplementation(() => new Promise<void>((resolve) => { finishPublish = resolve; }));
    toBackupStep("Ana");
    await finishBackup();
    expect(screen.getByRole("heading", { name: "Save your secret key." })).toBeTruthy();
    await act(async () => { finishPublish(); });
    expect(screen.getByRole("heading", { name: "What are you into?" })).toBeTruthy();
    expect(notice()).toBeNull();
    expect(toasts()).toEqual([]);
  });

  it("publishes the name without the spaces around it", async () => {
    toBackupStep("  Ana K.  ");
    await finishBackup();
    expect(user.saveProfile).toHaveBeenCalledWith({ name: "Ana K.", display_name: "Ana K." }, expect.any(String));
  });

  it("publishes nothing for an account with no name", async () => {
    toBackupStep();
    await finishBackup();
    expect(user.saveProfile).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "What are you into?" })).toBeTruthy();
  });

  it("publishes nothing for a name of spaces", async () => {
    toBackupStep("   ");
    await finishBackup();
    expect(user.saveProfile).not.toHaveBeenCalled();
  });

  it("publishes it from the checkbox way out too", async () => {
    toBackupStep("Ana");
    fireEvent.click(screen.getByRole("checkbox"));
    await act(async () => { press("Start using Vega"); });
    expect(user.saveProfile).toHaveBeenCalledWith({ name: "Ana", display_name: "Ana" }, expect.any(String));
  });

  it("does nothing from the checkbox way out until the box is ticked", async () => {
    toBackupStep("Ana");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Start using Vega" })); });
    expect(user.loginWithNsec).not.toHaveBeenCalled();
  });

  it("signs in once when the way out is pressed twice", async () => {
    let finishLogin!: () => void;
    user.loginWithNsec.mockImplementation(() => new Promise<void>((resolve) => { finishLogin = resolve; }));
    toBackupStep("Ana");
    await finishBackup();
    await finishBackup();
    await act(async () => { finishLogin(); });
    expect(user.loginWithNsec).toHaveBeenCalledTimes(1);
    expect(user.saveProfile).toHaveBeenCalledTimes(1);
  });
});

describe("when signing in failed", () => {
  it("stays on the step and publishes nothing", async () => {
    user.loginWithNsec.mockImplementation(async () => { user.loginError = "Login failed"; });
    toBackupStep("Ana");
    await finishBackup();
    expect(user.saveProfile).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Save your secret key." })).toBeTruthy();
    // Not stuck: the way out can be pressed again.
    expect(screen.getByRole("button", { name: "I'll back up my key later" }).getAttribute("aria-busy")).toBeNull();
  });
});

describe("when no relay took the name", () => {
  it("goes on, and the next step says so and what to do", async () => {
    user.saveProfile.mockRejectedValue(new Error("Not enough relays received the event (0 published, 1 required)"));
    toBackupStep("Ana");
    await finishBackup();
    expect(screen.getByRole("heading", { name: "What are you into?" })).toBeTruthy();
    expect(notice()).toBe(
      "Your name was not published: none of your relays accepted it. Your account works without it, and you can add your name from your profile.",
    );
  });

  // A toast sits in the corner of the window, over this step's buttons, and
  // is gone before a first-time user has read it.
  it("says it on the step, not in a toast", async () => {
    user.saveProfile.mockRejectedValue(new Error("Not enough relays received the event (0 published, 1 required)"));
    toBackupStep("Ana");
    await finishBackup();
    expect(toasts()).toEqual([]);
  });

  // A later retry would replace a fuller profile with a name alone.
  it("offers no retry", async () => {
    user.saveProfile.mockRejectedValue(new Error("Not enough relays received the event (0 published, 1 required)"));
    toBackupStep("Ana");
    await finishBackup();
    expect(screen.queryByRole("button", { name: /try again|retry/i })).toBeNull();
    expect(user.saveProfile).toHaveBeenCalledTimes(1);
  });

  it("gives a relay's own reason, ended as a sentence once", async () => {
    user.saveProfile.mockRejectedValue(new Error("blocked: this relay is invite only."));
    toBackupStep("Ana");
    await finishBackup();
    expect(notice()).toBe(
      "Your name was not published: blocked: this relay is invite only. Your account works without it, and you can add your name from your profile.",
    );
  });

  it("says it without a reason when there is none to give", async () => {
    user.saveProfile.mockRejectedValue({});
    toBackupStep("Ana");
    await finishBackup();
    expect(notice()).toBe("Your name was not published. Your account works without it, and you can add your name from your profile.");
  });
});

// The backup step: the one thing it is for is a Copy button, and the box
// may only be ticked once the key has been copied or seen.
describe("the backup step", () => {
  const KEY_BOX = () => screen.getByRole("checkbox") as HTMLInputElement;

  it("copies the secret key with one button, and says so", async () => {
    toBackupStep();
    await act(async () => { press("Copy secret key"); });
    expect(copyText).toHaveBeenCalledWith(expect.stringMatching(/^nsec1/));
    expect(screen.getByRole("button", { name: "Copy secret key" }).textContent).toContain("Copied");
  });

  it("does not let the box be ticked before the key was copied or revealed", () => {
    toBackupStep();
    expect(KEY_BOX().disabled).toBe(true);
    expect(screen.getByText("Copy or reveal the key first.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "reveal" }));
    expect(KEY_BOX().disabled).toBe(false);
  });

  it("lets the box be ticked once the key was copied, and keeps it so after Copied fades", async () => {
    vi.useFakeTimers();
    toBackupStep();
    await act(async () => { press("Copy secret key"); });
    expect(KEY_BOX().disabled).toBe(false);
    expect(screen.queryByText("Copy or reveal the key first.")).toBeNull();
    act(() => { vi.advanceTimersByTime(3100); });
    expect(screen.getByRole("button", { name: "Copy secret key" }).textContent).toBe("Copy secret key");
    expect(KEY_BOX().disabled).toBe(false);
  });

  it("unticks a box that was ticked on a revealed key once the key is hidden again", () => {
    toBackupStep();
    fireEvent.click(screen.getByRole("button", { name: "reveal" }));
    fireEvent.click(KEY_BOX());
    expect(KEY_BOX().checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "hide" }));
    expect(KEY_BOX().checked).toBe(false);
    expect(KEY_BOX().disabled).toBe(true);
  });

  it("shows two step dots over the app, three on a first launch", () => {
    toBackupStep();
    expect(document.querySelectorAll(".rounded-full.transition-all").length).toBe(3);
    cleanup();
    render(<OnboardingFlow onComplete={onComplete} start="create" onCancel={vi.fn()} />);
    expect(document.querySelectorAll(".rounded-full.transition-all").length).toBe(2);
  });

  it("does not count a copy the clipboard refused", async () => {
    copyText.mockResolvedValue(false);
    toBackupStep();
    await act(async () => { press("Copy secret key"); });
    expect(KEY_BOX().disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Copy secret key" }).textContent).not.toContain("Copied");
  });

  it("remembers an account that chose later, without the key copied", async () => {
    toBackupStep();
    await finishBackup();
    const { NDKPrivateKeySigner } = await import("@nostr-dev-kit/ndk");
    const made = new NDKPrivateKeySigner(user.loginWithNsec.mock.calls[0][0] as string).pubkey;
    expect(useBackupStore.getState().pending).toEqual([made]);
    // And it gets the "start here" card on the feed.
    expect(isFirstRun(made)).toBe(true);
  });

  // "Later" is still signing in, and the user copies the key meanwhile.
  it("does not remember one that copied the key while later was still signing in", async () => {
    let finishLogin!: () => void;
    user.loginWithNsec.mockImplementation(() => new Promise<void>((resolve) => { finishLogin = resolve; }));
    toBackupStep();
    await finishBackup();
    await act(async () => { press("Copy secret key"); });
    await act(async () => { finishLogin(); });
    expect(useBackupStore.getState().pending).toEqual([]);
  });

  it("does not remember an account whose sign-in failed, and gives it no card", async () => {
    user.loginWithNsec.mockImplementation(async () => { user.loginError = "Login failed"; });
    toBackupStep();
    await finishBackup();
    expect(useBackupStore.getState().pending).toEqual([]);
    expect(useFirstRunStore.getState().accounts).toEqual([]);
  });

  it("does not remember one that copied the key and then chose later", async () => {
    toBackupStep();
    await act(async () => { press("Copy secret key"); });
    await finishBackup();
    expect(useBackupStore.getState().pending).toEqual([]);
  });

  it("does not remember one that ticked the box", async () => {
    toBackupStep();
    fireEvent.click(screen.getByRole("button", { name: "reveal" }));
    fireEvent.click(KEY_BOX());
    await act(async () => { press("Start using Vega"); });
    expect(useBackupStore.getState().pending).toEqual([]);
  });
});

// The same flow opened over the running app, from a banner or the account menu.
describe("opened over the app", () => {
  it("starts at the name step, with a way out instead of Back to the welcome screen", () => {
    const onCancel = vi.fn();
    render(<OnboardingFlow onComplete={onComplete} start="create" onCancel={onCancel} />);
    expect(screen.getByRole("heading", { name: "What should people call you?" })).toBeTruthy();
    press("Back");
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("heading", { name: "Welcome to Vega." })).toBeNull();
  });

  it("starts at the sign-in step when the user has a key", () => {
    const onCancel = vi.fn();
    render(<OnboardingFlow onComplete={onComplete} start="login" onCancel={onCancel} />);
    expect(screen.getByRole("heading", { name: "Sign in with your key." })).toBeTruthy();
    press("Back");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  // Closed at the backup step, the key may already be in a password manager.
  // The next "Create account" must come back with the same key.
  it("comes back with the same key and name after being closed", () => {
    const onCancel = vi.fn();
    const { unmount } = render(<OnboardingFlow onComplete={onComplete} start="create" onCancel={onCancel} />);
    const first = address().getAttribute("title");
    fireEvent.change(nameField(), { target: { value: "Ana" } });
    press(/Next: save your secret key/);
    unmount();
    render(<OnboardingFlow onComplete={onComplete} start="create" onCancel={onCancel} />);
    expect(address().getAttribute("title")).toBe(first);
    expect(nameField().value).toBe("Ana");
  });

  it("lets the key go once the account is made", async () => {
    const { unmount } = render(<OnboardingFlow onComplete={onComplete} start="create" onCancel={vi.fn()} />);
    const first = address().getAttribute("title");
    press(/Next: save your secret key/);
    await finishBackup();
    expect(onComplete).toHaveBeenCalledTimes(1);
    unmount();
    render(<OnboardingFlow onComplete={onComplete} start="create" onCancel={vi.fn()} />);
    expect(address().getAttribute("title")).not.toBe(first);
  });

  it("says in a toast when the name could not be published, since there is no next step", async () => {
    user.saveProfile.mockRejectedValue(new Error("Not enough relays received the event (0 published, 1 required)"));
    render(<OnboardingFlow onComplete={onComplete} start="create" onCancel={vi.fn()} />);
    fireEvent.change(nameField(), { target: { value: "Ana" } });
    press(/Next: save your secret key/);
    await finishBackup();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(toasts().map((t) => `${t.type}: ${t.message}`)).toEqual([
      "error: Your name was not published: none of your relays accepted it. Your account works without it, and you can add your name from your profile.",
    ]);
  });

  // A failed sign-in, or a remote signer that did not answer at startup.
  it("does not show an earlier sign-in error on the new account's backup step", () => {
    user.loginError = "That doesn't look like a secret key.";
    render(<OnboardingFlow onComplete={onComplete} start="create" onCancel={vi.fn()} />);
    press(/Next: save your secret key/);
    expect(screen.queryByText("That doesn't look like a secret key.")).toBeNull();
    expect(user.loginError).toBeNull();
  });

  it("skips the interests step, which belongs to the first launch", async () => {
    render(<OnboardingFlow onComplete={onComplete} start="create" onCancel={vi.fn()} />);
    fireEvent.change(nameField(), { target: { value: "Ana" } });
    press(/Next: save your secret key/);
    await finishBackup();
    expect(screen.queryByRole("heading", { name: "What are you into?" })).toBeNull();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(user.saveProfile).toHaveBeenCalledWith({ name: "Ana", display_name: "Ana" }, expect.any(String));
  });
});

describe("the rest of the flow", () => {
  it("finishes onboarding from the interests step, keeping the topics for this account", async () => {
    toBackupStep("Ana");
    await finishBackup();
    const { NDKPrivateKeySigner } = await import("@nostr-dev-kit/ndk");
    const made = new NDKPrivateKeySigner(user.loginWithNsec.mock.calls[0][0] as string).pubkey;
    Object.assign(user, { pubkey: made });
    press(/Art/);
    press(/Get started/);
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(JSON.parse(localStorage.getItem(`wrystr_interests_${made}`)!)).toEqual(["art"]);
  });

  it("still leads someone with a key to the sign-in step and back", () => {
    render(<OnboardingFlow onComplete={onComplete} />);
    press("I already have a Nostr key");
    expect(screen.getByRole("heading", { name: "Sign in with your key." })).toBeTruthy();
    press("Back");
    expect(screen.getByRole("heading", { name: "Welcome to Vega." })).toBeTruthy();
  });

  // It was drawn above the buttons of the backup step, before anything was pressed.
  it("does not carry a failed sign-in over to a new account", () => {
    render(<OnboardingFlow onComplete={onComplete} />);
    press("I already have a Nostr key");
    user.loginError = "That doesn't look like a secret key.";
    press("Back");
    expect(user.loginError).toBeNull();
    press("Create my account");
    press(/Next: save your secret key/);
    expect(screen.queryByText("That doesn't look like a secret key.")).toBeNull();
  });

  it("lets someone look around without making a key", () => {
    render(<OnboardingFlow onComplete={onComplete} />);
    press("Look around first");
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("wrystr_browse_only")).toBe("1");
    expect(user.loginWithNsec).not.toHaveBeenCalled();
  });
});
