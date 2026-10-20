import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";

// user.ts reaches into most of the app on every login path; none of that is
// under test here, so stub it all out and keep the assertions on the account
// bookkeeping itself.
vi.mock("../lib/nostr", () => ({
  getNDK: vi.fn(() => ({ signer: undefined, pool: { relays: new Map() } })),
  publishContactList: vi.fn(),
}));
vi.mock("../lib/db", () => ({ dbLoadProfile: vi.fn().mockResolvedValue(null) }));
vi.mock("../lib/notificationPoller", () => ({
  startNotificationPoller: vi.fn(),
  stopNotificationPoller: vi.fn(),
}));
vi.mock("./mute", () => ({ useMuteStore: { getState: () => ({ fetchMuteList: vi.fn() }) } }));
vi.mock("./lightning", () => ({ useLightningStore: { getState: () => ({ loadNwcForAccount: vi.fn(), forgetAccount: vi.fn() }) } }));
vi.mock("./ui", () => ({ useUIStore: { getState: () => ({ setView: vi.fn() }) } }));
vi.mock("./feed", () => ({ useFeedStore: { getState: () => ({ loadFeed: vi.fn() }) } }));
vi.mock("./notifications", () => ({
  useNotificationsStore: { getState: () => ({ fetchNotifications: vi.fn() }) },
}));
const podcasts = vi.hoisted(() => ({ setActiveAccount: vi.fn(), hydrateSubscriptions: vi.fn(), forgetAccount: vi.fn() }));
vi.mock("./podcast", () => ({
  usePodcastStore: { getState: () => podcasts },
}));

import { invoke } from "@tauri-apps/api/core";
import { useUserStore, readSecretKey } from "./user";
import { getNDK } from "../lib/nostr";
import * as relayAuth from "../lib/nostr/relayAuth";
import { useToastStore } from "./toast";

const BUNKER_PUBKEY = "ab".repeat(32);

function seedRemoteSignerAccount() {
  const account = {
    pubkey: BUNKER_PUBKEY,
    npub: "npub1",
    loginType: "remote-signer" as const,
    signerPayload: "{}",
  };
  localStorage.setItem("wrystr_accounts", JSON.stringify([account]));
  localStorage.setItem("wrystr_pubkey", BUNKER_PUBKEY);
  localStorage.setItem("wrystr_login_type", "remote-signer");
  useUserStore.setState({ accounts: [account], pubkey: null, npub: null, loggedIn: false, loginError: null });
}

describe("switchAccount — bunker account whose signer can't be revived", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    // No keychain entry: a remote-signer account never had an nsec to store.
    vi.mocked(invoke).mockResolvedValue(null);
    seedRemoteSignerAccount();
  });

  it("keeps the stored login type as remote-signer", async () => {
    await useUserStore.getState().switchAccount(BUNKER_PUBKEY);

    // Regression guard for #47: this used to be hardcoded to "nsec", which sent
    // the *next* startup down the nsec branch. That branch has no bunker signer
    // to restore, so one failed reconnect made the account permanently
    // read-only until it was re-added from a fresh bunker:// URI.
    expect(localStorage.getItem("wrystr_login_type")).toBe("remote-signer");
  });

  it("lands on the target account, read-only, with a stated reason", async () => {
    await useUserStore.getState().switchAccount(BUNKER_PUBKEY);

    const state = useUserStore.getState();
    expect(state.pubkey).toBe(BUNKER_PUBKEY);
    expect(state.loggedIn).toBe(false);
    // Silent read-only is what made #47 so confusing to diagnose from the UI.
    expect(state.loginError).toMatch(/remote signer/i);
  });
});

describe("switchAccount — nsec account whose keychain entry was lost", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue(null);
    const account = { pubkey: BUNKER_PUBKEY, npub: "npub1", loginType: "nsec" as const };
    localStorage.setItem("wrystr_accounts", JSON.stringify([account]));
    useUserStore.setState({ accounts: [account], pubkey: null, npub: null, loggedIn: false, loginError: null });
  });

  it("still records nsec, and reports no bunker error", async () => {
    await useUserStore.getState().switchAccount(BUNKER_PUBKEY);

    expect(localStorage.getItem("wrystr_login_type")).toBe("nsec");
    expect(useUserStore.getState().loginError).toBeNull();
  });
});

describe("loginWithNsec — the keychain will not store the key", () => {
  // On Linux a missing secret service is a normal configuration. The key then
  // lives only in this session, and for someone who created the account here
  // and chose to back up later, that is the only copy.
  const writeText = vi.fn();
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");

  beforeEach(() => {
    localStorage.clear();
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    useToastStore.setState({ toasts: [] });
    useUserStore.setState({ accounts: [], pubkey: null, npub: null, loggedIn: false, loginError: null });
    vi.mocked(invoke).mockReset().mockImplementation(async (cmd: string) => {
      if (cmd === "store_nsec") throw new Error("no secret service");
      return null;
    });
  });
  afterEach(() => {
    if (original) Object.defineProperty(navigator, "clipboard", original);
    else delete (navigator as { clipboard?: unknown }).clipboard;
  });

  const signInWithANewKey = async () => {
    const { nsec } = NDKPrivateKeySigner.generate();
    await useUserStore.getState().loginWithNsec(nsec);
    await vi.waitFor(() => expect(useToastStore.getState().toasts.length).toBeGreaterThan(0));
    return nsec;
  };
  const warning = () => useToastStore.getState().toasts.find((t) => t.key.startsWith("keychain:"));

  it("says so in a toast that stays until it is dismissed", async () => {
    await signInWithANewKey();
    expect(useUserStore.getState().loggedIn).toBe(true);
    expect(warning()?.type).toBe("error");
    expect(warning()?.autoCloseMs).toBeNull();
    expect(warning()?.message).toContain("couldn't save the secret key");
    expect(warning()?.action?.label).toBe("Copy key");
  });

  // It outlives an account switch, so it has to say whose key it is about.
  it("names the account, and is not dropped when the account changes", async () => {
    await signInWithANewKey();
    const npub = useUserStore.getState().npub as string;
    expect(warning()?.message).toContain(`${npub.slice(0, 8)}…${npub.slice(-4)}`);
    expect(warning()?.action?.forAccount).toBeUndefined();
    useUserStore.getState().logout();
    expect(warning()).toBeDefined();
  });

  // It used to say "Copy your key now from Settings", and Settings read only
  // the keychain, which is exactly where the key is not: the row was missing.
  // Closed, the warning left no way to the key at all.
  it("can still be read back in this session, and says it is not stored", async () => {
    const nsec = await signInWithANewKey();
    const pubkey = useUserStore.getState().pubkey as string;
    expect(await readSecretKey(pubkey)).toEqual({ nsec, stored: false });
    expect(warning()?.message).toContain("Settings");
  });

  it("is read from the keychain when it is there", async () => {
    await signInWithANewKey();
    const pubkey = useUserStore.getState().pubkey as string;
    vi.mocked(invoke).mockImplementation(async (cmd: string) => (cmd === "load_nsec" ? "nsec1fromthekeychain" : null));
    expect(await readSecretKey(pubkey)).toEqual({ nsec: "nsec1fromthekeychain", stored: true });
  });

  it("falls back to this session when reading the keychain fails outright", async () => {
    const nsec = await signInWithANewKey();
    const pubkey = useUserStore.getState().pubkey as string;
    vi.mocked(invoke).mockRejectedValue(new Error("no secret service"));
    expect(await readSecretKey(pubkey)).toEqual({ nsec, stored: false });
  });

  it("has no key for an account that holds none here", async () => {
    expect(await readSecretKey("f".repeat(64))).toBeNull();
  });

  // A locked keychain may well hold the key. "Not saved" would be a guess.
  it("does not say a key is not stored when the keychain could only not be read", async () => {
    vi.mocked(invoke).mockResolvedValue(null); // this time the keychain takes it
    const { nsec } = NDKPrivateKeySigner.generate();
    await useUserStore.getState().loginWithNsec(nsec);
    const pubkey = useUserStore.getState().pubkey as string;
    await Promise.resolve();
    expect(warning()).toBeUndefined();
    vi.mocked(invoke).mockRejectedValue(new Error("keychain is locked"));
    expect(await readSecretKey(pubkey)).toEqual({ nsec, stored: null });
  });

  // Saved at sign-in, and gone from the keychain since (deleted from outside
  // Vega). The keychain answered, and its answer was "no entry": that is known.
  it("says a key is not stored when the keychain answers that it has none", async () => {
    vi.mocked(invoke).mockResolvedValue(null); // the keychain takes it, and later has no entry
    const { nsec } = NDKPrivateKeySigner.generate();
    await useUserStore.getState().loginWithNsec(nsec);
    const pubkey = useUserStore.getState().pubkey as string;
    await Promise.resolve();
    expect(await readSecretKey(pubkey)).toEqual({ nsec, stored: false });
  });

  // Signed in again once the keychain was back: the warning is no longer true.
  it("takes the warning down when a later try saves the key", async () => {
    const nsec = await signInWithANewKey();
    expect(warning()).toBeDefined();
    vi.mocked(invoke).mockResolvedValue(null);
    await useUserStore.getState().loginWithNsec(nsec);
    await vi.waitFor(() => expect(warning()).toBeUndefined());
    const pubkey = useUserStore.getState().pubkey as string;
    vi.mocked(invoke).mockRejectedValue(new Error("keychain is locked"));
    expect((await readSecretKey(pubkey))?.stored).toBeNull(); // and it is no longer known to be unsaved
  });

  // "This deletes the secret key stored on this computer" was not true until
  // Vega closed: the signer stayed in memory, and Settings could show the key
  // again once the same account had been added back read-only.
  it("cannot be read back once the account is removed, and the warning goes with it", async () => {
    await signInWithANewKey();
    const pubkey = useUserStore.getState().pubkey as string;
    expect(await readSecretKey(pubkey)).not.toBeNull();
    useUserStore.getState().removeAccount(pubkey);
    expect(await readSecretKey(pubkey)).toBeNull();
    expect(warning()).toBeUndefined();
  });

  it("a removed account cannot be signed for again from what this session remembers", async () => {
    await signInWithANewKey();
    const pubkey = useUserStore.getState().pubkey as string;
    const npub = useUserStore.getState().npub as string;
    useUserStore.getState().removeAccount(pubkey);
    // Added back read-only, then switched to: there must be no signer waiting for it.
    useUserStore.setState({ accounts: [{ pubkey, npub, loginType: "nsec" }] });
    vi.mocked(invoke).mockResolvedValue(null);
    await useUserStore.getState().switchAccount(pubkey);
    expect(useUserStore.getState().loggedIn).toBe(false);
  });

  // The toast does not hold the key: it reads it when the button is pressed.
  it("has nothing to copy from a warning that outlived its key", async () => {
    await signInWithANewKey();
    const pubkey = useUserStore.getState().pubkey as string;
    const copy = warning()?.action;
    useUserStore.getState().removeAccount(pubkey);
    copy?.run();
    await vi.waitFor(() => expect(useToastStore.getState().toasts.map((t) => t.message)).toContain("No key for this account is on this computer."));
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies the key itself, says so, and stays up in case it has to be pressed again", async () => {
    const nsec = await signInWithANewKey();
    expect(warning()?.action?.keepOpen).toBe(true);
    warning()?.action?.run();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(nsec));
    await vi.waitFor(() => expect(useToastStore.getState().toasts.map((t) => t.message)).toContain("Secret key copied."));
    expect(JSON.stringify(useToastStore.getState().toasts)).not.toContain(nsec);
  });

  it("says so when even the copy fails, and the warning is still there", async () => {
    await signInWithANewKey();
    writeText.mockRejectedValue(new Error("NotAllowedError"));
    warning()?.action?.run();
    await vi.waitFor(() => expect(useToastStore.getState().toasts.map((t) => t.message)).toContain("Couldn't copy to the clipboard."));
    expect(warning()).toBeDefined();
  });

  // The warning is about a key that still has to be saved. Unlike "Undo", it must outlive an account change.
  it("survives the account changing", async () => {
    await signInWithANewKey();
    useUserStore.setState({ pubkey: "someone-else" });
    expect(warning()).toBeDefined();
  });

  it("says nothing of the kind when the keychain takes the key", async () => {
    vi.mocked(invoke).mockReset().mockResolvedValue(null);
    const { nsec } = NDKPrivateKeySigner.generate();
    await useUserStore.getState().loginWithNsec(nsec);
    await new Promise((r) => setTimeout(r, 0));
    expect(warning()).toBeUndefined();
  });
});

// Whoever is on screen, NDK signs with the key it holds. Every way of
// becoming someone else has to let go of the last account's key and of the
// relays that know this connection by its name.
describe("becoming another account", () => {
  const A_KEY = NDKPrivateKeySigner.generate();
  const B = "bb".repeat(32);
  const ndk = { signer: undefined as unknown, pool: { relays: new Map() } };
  let rechallenged: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue(null);
    ndk.signer = undefined;
    vi.mocked(getNDK).mockReturnValue(ndk as never);
    useToastStore.setState({ toasts: [] });
    useUserStore.setState({ accounts: [], pubkey: null, npub: null, loggedIn: false, loginError: null });
    await useUserStore.getState().loginWithNsec(A_KEY.nsec);
    rechallenged = vi.spyOn(relayAuth, "rechallengeRelays").mockImplementation(() => {});
  });
  afterEach(() => {
    rechallenged.mockRestore();
    vi.mocked(getNDK).mockImplementation(() => ({ signer: undefined, pool: { relays: new Map() } }) as never);
  });

  // "Add account", Public key tab, while signed in with a key. The key
  // stayed: the screen said B, read-only, and the podcast, mute and bookmark
  // lists, which ask only whether there is a signer, were published as A.
  it("a read-only sign-in does not go on with the last account's key", async () => {
    expect(ndk.signer).toBeDefined();
    await useUserStore.getState().loginWithPubkey(B);
    expect(useUserStore.getState().pubkey).toBe(B);
    expect(ndk.signer).toBeUndefined();
  });

  // A relay that knows this connection as A goes on serving B as A.
  it("a read-only sign-in drops the relay sessions of the last account", async () => {
    await useUserStore.getState().loginWithPubkey(B);
    expect(rechallenged).toHaveBeenCalledTimes(1);
  });

  it("signing in with another key drops the relay sessions of the last account", async () => {
    await useUserStore.getState().loginWithNsec(NDKPrivateKeySigner.generate().nsec);
    expect(rechallenged).toHaveBeenCalledTimes(1);
  });

  it("signing in again as the same account drops nothing", async () => {
    await useUserStore.getState().loginWithNsec(A_KEY.nsec);
    expect(rechallenged).not.toHaveBeenCalled();
  });

  it("removing the account that is signed in drops its relay sessions, and its podcasts are no longer the list in use", async () => {
    const pubkey = useUserStore.getState().pubkey as string;
    useUserStore.getState().removeAccount(pubkey);
    expect(ndk.signer).toBeUndefined();
    expect(rechallenged).toHaveBeenCalledTimes(1);
    expect(podcasts.forgetAccount).toHaveBeenCalledWith(pubkey);
    expect(podcasts.setActiveAccount).toHaveBeenLastCalledWith(null);
  });

  // The key is let go of when a switch begins. But the wait for the keychain
  // or a signer is long enough for another sign-in to put one in place, and
  // the account the switch then lands on, signed out, has none.
  it("a switch that ends signed out does not leave a key that turned up while it waited", async () => {
    const D = "dd".repeat(32);
    useUserStore.setState({ accounts: [...useUserStore.getState().accounts, { pubkey: D, npub: "npub1d", loginType: "nsec" }] });
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "load_nsec") ndk.signer = { someone: "else" }; // another sign-in, while the keychain is asked
      return null; // and the keychain has no key for D
    });
    await useUserStore.getState().switchAccount(D);
    expect(useUserStore.getState().pubkey).toBe(D);
    expect(useUserStore.getState().loggedIn).toBe(false);
    expect(ndk.signer).toBeUndefined();
    expect(rechallenged).toHaveBeenCalledTimes(2); // when it began, and when it ended
  });

  // What is subscribed to after signing out went into that account's list,
  // and was published under its name at the next sign-in.
  it("signing out tells the podcast list that nobody is signed in", () => {
    useUserStore.getState().logout();
    expect(podcasts.setActiveAccount).toHaveBeenLastCalledWith(null);
  });
});

// The reminder to back up a key ends when the key is copied out, or the
// account and its key are gone.
describe("the backup reminder and the key", () => {
  const ME = "cd".repeat(32);
  const writeText = vi.fn();
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    useToastStore.setState({ toasts: [] });
    const { useBackupStore } = await import("./backup");
    useBackupStore.setState({ pending: [ME] });
    vi.mocked(invoke).mockImplementation(async (cmd: string) => (cmd === "load_nsec" ? "nsec1fromkeychain" : null));
  });
  afterEach(() => { if (original) Object.defineProperty(navigator, "clipboard", original); });

  it("ends when the key is copied", async () => {
    const { copySecretKey } = await import("./user");
    const { useBackupStore } = await import("./backup");
    expect(await copySecretKey(ME)).toBe(true);
    expect(writeText).toHaveBeenCalledWith("nsec1fromkeychain");
    expect(useBackupStore.getState().pending).toEqual([]);
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(["Secret key copied."]);
  });

  it("says nothing of its own when asked to be quiet", async () => {
    const { copySecretKey } = await import("./user");
    expect(await copySecretKey(ME, { quiet: true })).toBe(true);
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("does not end when the clipboard refused", async () => {
    writeText.mockRejectedValue(new Error("no clipboard"));
    const { copySecretKey } = await import("./user");
    const { useBackupStore } = await import("./backup");
    expect(await copySecretKey(ME)).toBe(false);
    expect(useBackupStore.getState().pending).toEqual([ME]);
  });

  it("does not end when there is no key here to copy", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    const { copySecretKey } = await import("./user");
    const { useBackupStore } = await import("./backup");
    expect(await copySecretKey(ME)).toBe(false);
    expect(useBackupStore.getState().pending).toEqual([ME]);
    expect(useToastStore.getState().toasts.map((t) => t.type)).toEqual(["error"]);
  });

  it("ends when the account is removed from this computer", async () => {
    const { useBackupStore } = await import("./backup");
    useUserStore.setState({ accounts: [{ pubkey: ME, npub: "npub1me", loginType: "nsec" }], pubkey: null, npub: null, loggedIn: false });
    useUserStore.getState().removeAccount(ME);
    expect(useBackupStore.getState().pending).toEqual([]);
  });
});

// Who is signed in is not known while the saved session is restored.
describe("restoring the saved session", () => {
  it("says so while it runs, and not afterwards", async () => {
    localStorage.clear();
    vi.mocked(invoke).mockResolvedValue(null);
    localStorage.setItem("wrystr_accounts", JSON.stringify([{ pubkey: BUNKER_PUBKEY, npub: "npub1", loginType: "nsec" }]));
    localStorage.setItem("wrystr_pubkey", BUNKER_PUBKEY);
    localStorage.setItem("wrystr_login_type", "nsec");
    useUserStore.setState({ accounts: [{ pubkey: BUNKER_PUBKEY, npub: "npub1", loginType: "nsec" }], pubkey: null, loggedIn: false, restoring: false });
    const restoring = useUserStore.getState().restoreSession();
    expect(useUserStore.getState().restoring).toBe(true);
    await restoring;
    expect(useUserStore.getState().restoring).toBe(false);
  });

  it("is over even when the restore throws", async () => {
    localStorage.clear();
    localStorage.setItem("wrystr_accounts", "{not json");
    vi.mocked(invoke).mockRejectedValue(new Error("keychain locked"));
    useUserStore.setState({ accounts: [{ pubkey: BUNKER_PUBKEY, npub: "npub1", loginType: "nsec" }], pubkey: null, loggedIn: false, restoring: false });
    await useUserStore.getState().restoreSession().catch(() => {});
    expect(useUserStore.getState().restoring).toBe(false);
  });
});
