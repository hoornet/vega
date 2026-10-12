import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The account's own profile: what is shown for it, and what happens to that
// when a profile is saved, when the relays are read, and when they say nothing.

const publishProfile = vi.hoisted(() => vi.fn());
const fetchProfileFromEachRelay = vi.hoisted(() => vi.fn());
// One instance, as in the app: signing in puts the key on it, and a switch reads it back.
const ndk = vi.hoisted(() => ({ signer: undefined as unknown, pool: { relays: new Map() } }));
vi.mock("../lib/nostr", () => ({
  getNDK: () => ndk,
  publishContactList: vi.fn(),
  fetchContactList: vi.fn().mockResolvedValue({ status: "unknown" }),
  publishProfile,
  fetchProfileFromEachRelay,
}));
const dbLoadProfile = vi.hoisted(() => vi.fn());
vi.mock("../lib/db", () => ({ dbLoadProfile }));
const primeProfileCache = vi.hoisted(() => vi.fn());
vi.mock("../hooks/useProfile", () => ({ primeProfileCache }));
vi.mock("../lib/notificationPoller", () => ({ startNotificationPoller: vi.fn(), stopNotificationPoller: vi.fn() }));
vi.mock("./mute", () => ({ useMuteStore: { getState: () => ({ fetchMuteList: vi.fn() }) } }));
vi.mock("./lightning", () => ({ useLightningStore: { getState: () => ({ loadNwcForAccount: vi.fn() }) } }));
vi.mock("./ui", () => ({ useUIStore: { getState: () => ({ setView: vi.fn() }) } }));
vi.mock("./feed", () => ({ useFeedStore: { getState: () => ({ loadFeed: vi.fn() }) } }));
vi.mock("./notifications", () => ({ useNotificationsStore: { getState: () => ({ fetchNotifications: vi.fn() }) } }));
vi.mock("./podcast", () => ({ usePodcastStore: { getState: () => ({ setActiveAccount: vi.fn(), hydrateSubscriptions: vi.fn(), forgetAccount: vi.fn() }) } }));

import { NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";
import { invoke } from "@tauri-apps/api/core";
import { useUserStore, type SavedAccount } from "./user";
import userSource from "./user.ts?raw";

const ANA = "aa".repeat(32);
const BO = "bb".repeat(32);
const account = (pubkey: string, more: Partial<SavedAccount> = {}): SavedAccount => ({ pubkey, npub: `npub-of-${pubkey.slice(0, 2)}`, loginType: "nsec", ...more });
const saved = (pubkey: string) => useUserStore.getState().accounts.find((a) => a.pubkey === pubkey);
const stored = (pubkey: string) => (JSON.parse(localStorage.getItem("wrystr_accounts") ?? "[]") as SavedAccount[]).find((a) => a.pubkey === pubkey);
const shown = () => useUserStore.getState().profile;
const signedInAs = (pubkey: string, profile: unknown = null, accounts = [account(ANA), account(BO)]) =>
  useUserStore.setState({ pubkey, npub: `npub-of-${pubkey.slice(0, 2)}`, loggedIn: true, profile, accounts });
/** A promise and the way to settle it, for a publish or a read that is still out. */
function pending<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
/** What the relays say when each is asked for the account's profile. */
const relaysHold = (profile: unknown, fromNetwork = true) => fetchProfileFromEachRelay.mockResolvedValue({ status: "found", profile, fromNetwork });
const relaysHoldNone = () => fetchProfileFromEachRelay.mockResolvedValue({ status: "none" });
const relaysCannotTell = () => fetchProfileFromEachRelay.mockResolvedValue({ status: "unknown" });

beforeEach(() => {
  vi.clearAllMocks();
  primeProfileCache.mockReset();
  ndk.signer = undefined;
  localStorage.clear();
  relaysCannotTell();
  dbLoadProfile.mockResolvedValue(null);
  signedInAs(ANA);
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("saveProfile", () => {
  const PUBLISHED = { name: "ana", displayName: "Ana K.", picture: "https://example.com/ana.png", created_at: 100 };

  it("publishes the profile as the account it is for", async () => {
    publishProfile.mockResolvedValue(PUBLISHED);
    await useUserStore.getState().saveProfile({ name: "ana", display_name: "Ana K." }, ANA);
    expect(publishProfile).toHaveBeenCalledWith({ name: "ana", display_name: "Ana K." }, ANA);
  });

  it("shows what was published, without asking the relays for it", async () => {
    publishProfile.mockResolvedValue(PUBLISHED);
    await useUserStore.getState().saveProfile({ name: "ana" }, ANA);
    expect(shown()).toEqual(PUBLISHED);
    expect(fetchProfileFromEachRelay).not.toHaveBeenCalled();
  });

  it("gives it to every card of this account's notes, as the newest there is", async () => {
    publishProfile.mockResolvedValue(PUBLISHED);
    await useUserStore.getState().saveProfile({ name: "ana" }, ANA);
    expect(primeProfileCache).toHaveBeenCalledWith(ANA, PUBLISHED, "published");
  });

  it("keeps the name and picture with the saved account, for the sidebar and the next launch", async () => {
    publishProfile.mockResolvedValue(PUBLISHED);
    await useUserStore.getState().saveProfile({ name: "ana" }, ANA);
    expect(saved(ANA)).toMatchObject({ name: "Ana K.", picture: "https://example.com/ana.png", npub: "npub-of-aa", loginType: "nsec" });
    expect(stored(ANA)).toMatchObject({ name: "Ana K.", picture: "https://example.com/ana.png" });
    expect(saved(BO)?.name).toBeUndefined();
  });

  it("takes the name off the saved account when the profile no longer has one", async () => {
    signedInAs(ANA, { name: "ana" }, [account(ANA, { name: "ana", picture: "https://example.com/old.png" })]);
    publishProfile.mockResolvedValue({ about: "no name any more", created_at: 100 });
    await useUserStore.getState().saveProfile({ about: "no name any more" }, ANA);
    expect(saved(ANA)?.name).toBeUndefined();
    expect(saved(ANA)?.picture).toBeUndefined();
  });

  it("does not keep a picture that is not text", async () => {
    publishProfile.mockResolvedValue({ name: "ana", picture: { url: "x" }, created_at: 100 });
    await useUserStore.getState().saveProfile({ name: "ana" }, ANA);
    expect(saved(ANA)?.picture).toBeUndefined();
  });

  it("fails, and leaves everything as it was, when no relay took it", async () => {
    signedInAs(ANA, { name: "before" }, [account(ANA, { name: "before" })]);
    publishProfile.mockRejectedValue(new Error("Not enough relays received the event (0 published, 1 required)"));
    await expect(useUserStore.getState().saveProfile({ name: "after" }, ANA)).rejects.toThrow(/Not enough relays/);
    expect(shown()).toEqual({ name: "before" });
    expect(saved(ANA)?.name).toBe("before");
    expect(primeProfileCache).not.toHaveBeenCalled();
  });

  it("publishes nothing when nobody is signed in", async () => {
    useUserStore.setState({ pubkey: null, npub: null, loggedIn: false });
    await expect(useUserStore.getState().saveProfile({ name: "ana" }, ANA)).rejects.toThrow("Not logged in");
    expect(publishProfile).not.toHaveBeenCalled();
  });

  // The form was opened for one account, and another is signed in by the
  // time Save is pressed: a signer that came back late does this.
  it("publishes nothing when the account signed in is not the one the form was for", async () => {
    signedInAs(BO);
    await expect(useUserStore.getState().saveProfile({ name: "ana" }, ANA)).rejects.toThrow("Not logged in");
    expect(publishProfile).not.toHaveBeenCalled();
  });

  // Once a relay has it, nothing may turn that into "Couldn't publish".
  it("does not fail because the saved account could not be written to storage", async () => {
    publishProfile.mockResolvedValue(PUBLISHED);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
    await expect(useUserStore.getState().saveProfile({ name: "ana" }, ANA)).resolves.toBeUndefined();
    // Shown for this session all the same.
    expect(shown()).toEqual(PUBLISHED);
    expect(saved(ANA)?.name).toBe("Ana K.");
  });

  it("does not fail because the shared cache could not take it", async () => {
    publishProfile.mockResolvedValue(PUBLISHED);
    primeProfileCache.mockImplementation(() => { throw new Error("database is locked"); });
    await expect(useUserStore.getState().saveProfile({ name: "ana" }, ANA)).resolves.toBeUndefined();
    // And it is on screen and in the sidebar all the same.
    expect(shown()).toEqual(PUBLISHED);
    expect(saved(ANA)?.name).toBe("Ana K.");
  });

  // The account can change while the publish is out.
  it("does not put one account's profile on screen for another", async () => {
    const out = pending<unknown>();
    publishProfile.mockReturnValue(out.promise);
    const saving = useUserStore.getState().saveProfile({ name: "ana" }, ANA);
    signedInAs(BO, { name: "bo" });
    out.resolve(PUBLISHED);
    await saving;
    expect(shown()).toEqual({ name: "bo" });
    // It still was published, as Ana: her saved account has the name.
    expect(saved(ANA)).toMatchObject({ name: "Ana K.", npub: "npub-of-aa" });
    expect(saved(BO)?.name).toBeUndefined();
    expect(primeProfileCache).toHaveBeenCalledWith(ANA, PUBLISHED, "published");
  });
});

describe("fetchOwnProfile", () => {
  const ON_RELAYS = { name: "ana", picture: "https://example.com/ana.png", created_at: 100 };

  it("asks each relay on its own for the account's profile", async () => {
    relaysHold(ON_RELAYS);
    await useUserStore.getState().fetchOwnProfile();
    expect(fetchProfileFromEachRelay).toHaveBeenCalledWith(ANA, { onFound: expect.any(Function) });
  });

  it("shows the profile the relays hold", async () => {
    relaysHold(ON_RELAYS);
    await useUserStore.getState().fetchOwnProfile();
    expect(shown()).toEqual(ON_RELAYS);
    expect(saved(ANA)).toMatchObject({ name: "ana", picture: "https://example.com/ana.png" });
    expect(stored(ANA)?.name).toBe("ana");
  });

  it("gives it to the cards and to the copy on this computer", async () => {
    relaysHold(ON_RELAYS);
    await useUserStore.getState().fetchOwnProfile();
    expect(primeProfileCache).toHaveBeenCalledWith(ANA, ON_RELAYS);
  });

  it("is shown, and kept with the saved account for this session, even when storage is full", async () => {
    vi.useFakeTimers();
    relaysHold(ON_RELAYS);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
    await useUserStore.getState().fetchOwnProfile();
    expect(shown()).toEqual(ON_RELAYS);
    expect(saved(ANA)?.name).toBe("ana");
    // The relays answered: a failure to write storage is no reason to ask them again.
    await vi.advanceTimersByTimeAsync(600_000);
    expect(fetchProfileFromEachRelay).toHaveBeenCalledTimes(1);
  });

  it("shows it even when that copy could not be written", async () => {
    relaysHold(ON_RELAYS);
    primeProfileCache.mockImplementation(() => { throw new Error("database is locked"); });
    await useUserStore.getState().fetchOwnProfile();
    expect(shown()).toEqual(ON_RELAYS);
    expect(saved(ANA)?.name).toBe("ana");
  });

  // A slow relay, or one that did not answer, far more often than an account
  // with no profile. This used to blank the profile and the sidebar's name.
  for (const [what, say] of [["could not tell", relaysCannotTell], ["hold none", relaysHoldNone]] as const) {
    it(`keeps what is shown when the relays ${what}`, async () => {
      signedInAs(ANA, { name: "ana" }, [account(ANA, { name: "ana", picture: "https://example.com/ana.png" })]);
      say();
      await useUserStore.getState().fetchOwnProfile();
      expect(shown()).toEqual({ name: "ana" });
      expect(saved(ANA)).toMatchObject({ name: "ana", picture: "https://example.com/ana.png" });
      expect(primeProfileCache).not.toHaveBeenCalled();
    });
  }

  it("keeps what is shown when the read failed", async () => {
    signedInAs(ANA, { name: "ana" }, [account(ANA, { name: "ana" })]);
    fetchProfileFromEachRelay.mockRejectedValue(new Error("offline"));
    await useUserStore.getState().fetchOwnProfile();
    expect(shown()).toEqual({ name: "ana" });
    expect(saved(ANA)?.name).toBe("ana");
  });

  // A relay that has not caught up, or a read begun before a save and
  // finished after it. The edit form opens on what is shown, so taking the
  // older one would have the next save republish it.
  it("does not put an older profile over the one shown", async () => {
    signedInAs(ANA, { name: "ana, renamed", created_at: 200 }, [account(ANA, { name: "ana, renamed" })]);
    relaysHold({ name: "ana", created_at: 100 });
    await useUserStore.getState().fetchOwnProfile();
    expect(shown()).toEqual({ name: "ana, renamed", created_at: 200 });
    expect(saved(ANA)?.name).toBe("ana, renamed");
    expect(stored(ANA)).toBeUndefined();
    expect(primeProfileCache).not.toHaveBeenCalled();
  });

  it("does not put an older profile over one saved while the read was out", async () => {
    const out = pending<unknown>();
    fetchProfileFromEachRelay.mockReturnValue(out.promise);
    const reading = useUserStore.getState().fetchOwnProfile();
    await vi.waitFor(() => expect(fetchProfileFromEachRelay).toHaveBeenCalled());
    publishProfile.mockResolvedValue({ name: "ana, renamed", created_at: 200 });
    await useUserStore.getState().saveProfile({ name: "ana, renamed" }, ANA);
    out.resolve({ status: "found", profile: { name: "ana", created_at: 100 } });
    await reading;
    expect(shown()).toEqual({ name: "ana, renamed", created_at: 200 });
    expect(saved(ANA)?.name).toBe("ana, renamed");
  });

  it("takes a newer profile over the one shown", async () => {
    signedInAs(ANA, { name: "ana", created_at: 100 });
    relaysHold({ name: "ana, from another device", created_at: 300 });
    await useUserStore.getState().fetchOwnProfile();
    expect(shown()).toEqual({ name: "ana, from another device", created_at: 300 });
  });

  it("takes one of the same moment: it is what the relays hold", async () => {
    signedInAs(ANA, { name: "ana", created_at: 100 });
    relaysHold({ name: "ana", about: "as the relays hold it", created_at: 100 });
    await useUserStore.getState().fetchOwnProfile();
    expect(shown()).toEqual({ name: "ana", about: "as the relays hold it", created_at: 100 });
  });

  // One relay that never answers is given six seconds. The profile must not
  // wait for it: on a computer with no copy, the page says "No bio yet" and
  // the edit form opens empty until it is shown.
  describe("as each relay answers", () => {
    /** A read that says what each relay holds as it answers, and ends when told to. */
    function readInSteps() {
      let say: (profile: unknown) => void = () => {};
      const out = pending<unknown>();
      fetchProfileFromEachRelay.mockImplementation((_pubkey: string, opts: { onFound: (profile: unknown) => void }) => { say = opts.onFound; return out.promise; });
      return { say: (profile: unknown) => say(profile), end: (result: unknown) => out.resolve(result) };
    }

    it("shows the first profile a relay sends, while the others are still out", async () => {
      const read = readInSteps();
      const reading = useUserStore.getState().fetchOwnProfile();
      await vi.waitFor(() => expect(fetchProfileFromEachRelay).toHaveBeenCalled());
      read.say(ON_RELAYS);
      expect(shown()).toEqual(ON_RELAYS);
      expect(saved(ANA)?.name).toBe("ana");
      expect(primeProfileCache).toHaveBeenCalledWith(ANA, ON_RELAYS);
      read.end({ status: "found", profile: ON_RELAYS });
      await reading;
      // Said again at the end, as the newest of all: taken once.
      expect(primeProfileCache).toHaveBeenCalledTimes(1);
    });

    it("takes a newer one from a slower relay over it", async () => {
      const read = readInSteps();
      const reading = useUserStore.getState().fetchOwnProfile();
      await vi.waitFor(() => expect(fetchProfileFromEachRelay).toHaveBeenCalled());
      read.say(ON_RELAYS);
      const newer = { name: "ana, renamed", created_at: 200 };
      read.say(newer);
      expect(shown()).toEqual(newer);
      read.end({ status: "found", profile: newer });
      await reading;
      expect(shown()).toEqual(newer);
      expect(saved(ANA)?.name).toBe("ana, renamed");
    });

    it("does not show what a relay sends for an account that is no longer on screen", async () => {
      const read = readInSteps();
      const reading = useUserStore.getState().fetchOwnProfile();
      await vi.waitFor(() => expect(fetchProfileFromEachRelay).toHaveBeenCalled());
      signedInAs(BO, { name: "bo" });
      read.say(ON_RELAYS);
      expect(shown()).toEqual({ name: "bo" });
      expect(saved(ANA)?.name).toBeUndefined();
      read.end({ status: "found", profile: ON_RELAYS });
      await reading;
      expect(shown()).toEqual({ name: "bo" });
    });

    it("does not show an older one a relay sends after a save", async () => {
      const read = readInSteps();
      const reading = useUserStore.getState().fetchOwnProfile();
      await vi.waitFor(() => expect(fetchProfileFromEachRelay).toHaveBeenCalled());
      publishProfile.mockResolvedValue({ name: "ana, renamed", created_at: 200 });
      await useUserStore.getState().saveProfile({ name: "ana, renamed" }, ANA);
      read.say(ON_RELAYS);
      expect(shown()).toEqual({ name: "ana, renamed", created_at: 200 });
      read.end({ status: "found", profile: ON_RELAYS });
      await reading;
      expect(shown()).toEqual({ name: "ana, renamed", created_at: 200 });
    });
  });

  // No relay was up yet, or one never answered. Without asking again, a slow
  // start left the profile unread for the whole session.
  describe("when the relays could not say", () => {
    const asks = () => fetchProfileFromEachRelay.mock.calls.length;

    it("asks again after four, ten and thirty seconds, and then lets it be", async () => {
      vi.useFakeTimers();
      await useUserStore.getState().fetchOwnProfile();
      expect(asks()).toBe(1);
      await vi.advanceTimersByTimeAsync(3999);
      expect(asks()).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(asks()).toBe(2);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(asks()).toBe(3);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(asks()).toBe(4);
      await vi.advanceTimersByTimeAsync(600_000);
      expect(asks()).toBe(4);
    });

    it("shows the profile when a later try finds it, and stops asking", async () => {
      vi.useFakeTimers();
      await useUserStore.getState().fetchOwnProfile();
      relaysHold(ON_RELAYS);
      await vi.advanceTimersByTimeAsync(4000);
      expect(shown()).toEqual(ON_RELAYS);
      await vi.advanceTimersByTimeAsync(600_000);
      expect(asks()).toBe(2);
    });

    // The built-in relay answers at once with this device's own last copy.
    // Shown, but a newer profile made elsewhere would never be seen.
    it("shows what the built-in relay alone holds, and still asks the network again", async () => {
      vi.useFakeTimers();
      relaysHold(ON_RELAYS, false);
      await useUserStore.getState().fetchOwnProfile();
      expect(shown()).toEqual(ON_RELAYS);
      const newer = { name: "ana, from another device", created_at: 300 };
      relaysHold(newer);
      await vi.advanceTimersByTimeAsync(4000);
      expect(asks()).toBe(2);
      expect(shown()).toEqual(newer);
      await vi.advanceTimersByTimeAsync(600_000);
      expect(asks()).toBe(2);
    });

    it("stops after three tries when only the built-in relay ever answers", async () => {
      vi.useFakeTimers();
      relaysHold(ON_RELAYS, false);
      await useUserStore.getState().fetchOwnProfile();
      await vi.advanceTimersByTimeAsync(600_000);
      expect(asks()).toBe(4);
    });

    // Two reads that overlapped each set a timer; the first to fire forgot
    // the other's handle, and an account change could no longer cancel it.
    it("keeps one timer for two reads that overlapped, which a change of account cancels", async () => {
      vi.useFakeTimers();
      const first = useUserStore.getState().fetchOwnProfile();
      const second = useUserStore.getState().fetchOwnProfile();
      await first; await second;
      expect(asks()).toBe(2);
      // One ladder, not two: 4, then 10, then 30 seconds after each other.
      await vi.advanceTimersByTimeAsync(4000);
      expect(asks()).toBe(3);
      await vi.advanceTimersByTimeAsync(9999);
      expect(asks()).toBe(3);
      await vi.advanceTimersByTimeAsync(1);
      expect(asks()).toBe(4);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(asks()).toBe(5);
      signedInAs(BO);
      useUserStore.setState({ profile: null });
      // What a change of account does with a waiting try.
      await useUserStore.getState().loginWithPubkey(ANA);
      await vi.advanceTimersByTimeAsync(0);
      const after = asks();
      await vi.advanceTimersByTimeAsync(600_000);
      // Only the new sign-in's own tries, never one left over.
      expect(fetchProfileFromEachRelay.mock.calls.slice(after).every(([who]) => who === ANA)).toBe(true);
    });

    it("counts a read that failed as one that could not say", async () => {
      vi.useFakeTimers();
      fetchProfileFromEachRelay.mockRejectedValue(new Error("offline"));
      await useUserStore.getState().fetchOwnProfile();
      await vi.advanceTimersByTimeAsync(4000);
      expect(asks()).toBe(2);
    });

    it("does not ask again when every relay said there is none", async () => {
      vi.useFakeTimers();
      relaysHoldNone();
      await useUserStore.getState().fetchOwnProfile();
      await vi.advanceTimersByTimeAsync(600_000);
      expect(asks()).toBe(1);
    });

    it("starts the count again after a read that found it", async () => {
      vi.useFakeTimers();
      await useUserStore.getState().fetchOwnProfile();
      await vi.advanceTimersByTimeAsync(4000);
      relaysHold(ON_RELAYS);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(asks()).toBe(3);
      relaysCannotTell();
      await useUserStore.getState().fetchOwnProfile();
      await vi.advanceTimersByTimeAsync(4000);
      expect(asks()).toBe(5);
    });

    it("does not ask twice for one wait when the profile is asked for again meanwhile", async () => {
      vi.useFakeTimers();
      await useUserStore.getState().fetchOwnProfile();
      await useUserStore.getState().fetchOwnProfile();
      expect(asks()).toBe(2);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(asks()).toBe(3);
    });

    it("does not ask again for an account that is no longer on screen", async () => {
      vi.useFakeTimers();
      await useUserStore.getState().fetchOwnProfile();
      signedInAs(BO);
      await vi.advanceTimersByTimeAsync(600_000);
      expect(asks()).toBe(1);
    });

    // Switched away and back while a try was waiting: the try was the earlier
    // sign-in's, and must not fire for, or stand in the way of, the new one.
    it("forgets a waiting try when the account changes, even back to the same one", async () => {
      vi.useFakeTimers();
      vi.mocked(invoke).mockResolvedValue(null);
      await useUserStore.getState().fetchOwnProfile();
      await vi.advanceTimersByTimeAsync(1000);
      await useUserStore.getState().loginWithPubkey(BO);
      await vi.advanceTimersByTimeAsync(1000);
      await useUserStore.getState().loginWithPubkey(ANA);
      await vi.advanceTimersByTimeAsync(0);
      const afterSignIn = asks();
      // Nothing before the new sign-in's own first try, four seconds on.
      await vi.advanceTimersByTimeAsync(3999);
      expect(asks()).toBe(afterSignIn);
      await vi.advanceTimersByTimeAsync(1);
      expect(asks()).toBe(afterSignIn + 1);
    });

    it("gives the next account its own tries", async () => {
      vi.useFakeTimers();
      vi.mocked(invoke).mockResolvedValue(null);
      await useUserStore.getState().fetchOwnProfile();
      await vi.advanceTimersByTimeAsync(4000 + 10_000);
      expect(asks()).toBe(3);
      await useUserStore.getState().loginWithPubkey(BO);
      await vi.advanceTimersByTimeAsync(0);
      const afterSignIn = asks();
      await vi.advanceTimersByTimeAsync(4000);
      expect(asks()).toBe(afterSignIn + 1);
      for (const [who] of fetchProfileFromEachRelay.mock.calls.slice(3)) expect(who).toBe(BO);
    });
  });

  // No copy on this computer (a lost row, or the dev build): nothing is shown
  // to judge an arrival against. The saved account remembers how old the
  // profile its name came from was.
  describe("the date of the last profile confirmed", () => {
    it("is kept with the saved account", async () => {
      relaysHold(ON_RELAYS);
      await useUserStore.getState().fetchOwnProfile();
      expect(saved(ANA)?.profileAt).toBe(100);
      expect(stored(ANA)?.profileAt).toBe(100);
    });

    it("keeps an older profile from replacing the saved name when nothing is shown", async () => {
      signedInAs(ANA, null, [account(ANA, { name: "ana, renamed", profileAt: 200 })]);
      relaysHold(ON_RELAYS);
      await useUserStore.getState().fetchOwnProfile();
      expect(shown()).toBeNull();
      expect(saved(ANA)).toMatchObject({ name: "ana, renamed", profileAt: 200 });
    });

    it("lets a newer profile through", async () => {
      signedInAs(ANA, null, [account(ANA, { name: "ana", profileAt: 50 })]);
      relaysHold(ON_RELAYS);
      await useUserStore.getState().fetchOwnProfile();
      expect(shown()).toEqual(ON_RELAYS);
      expect(saved(ANA)).toMatchObject({ name: "ana", profileAt: 100 });
    });

    // The copy on this computer can be older than the profile the saved
    // name came from, when its write failed. The newer of the two counts.
    it("still counts when what is shown is older than it", async () => {
      signedInAs(ANA, { name: "ana", created_at: 50 }, [account(ANA, { name: "ana, renamed", profileAt: 200 })]);
      relaysHold(ON_RELAYS);
      await useUserStore.getState().fetchOwnProfile();
      expect(shown()).toEqual({ name: "ana", created_at: 50 });
      expect(saved(ANA)).toMatchObject({ name: "ana, renamed", profileAt: 200 });
    });

    it("gives way to what is shown when that is newer", async () => {
      signedInAs(ANA, { name: "ana", created_at: 250 }, [account(ANA, { name: "ana, renamed", profileAt: 200 })]);
      relaysHold({ name: "between", created_at: 220 });
      await useUserStore.getState().fetchOwnProfile();
      expect(shown()).toEqual({ name: "ana", created_at: 250 });
    });

    it("keeps a stale copy on this computer from filling in a name over a newer one", async () => {
      signedInAs(ANA, null, [account(ANA, { profileAt: 200 })]);
      dbLoadProfile.mockResolvedValue(JSON.stringify({ name: "ana, stale", created_at: 50 }));
      await useUserStore.getState().fetchOwnProfile();
      expect(shown()).toEqual({ name: "ana, stale", created_at: 50 });
      expect(saved(ANA)?.name).toBeUndefined();
    });
  });

  describe("the copy on this computer", () => {
    it("is shown at once, before any relay answers", async () => {
      dbLoadProfile.mockResolvedValue(JSON.stringify({ name: "ana from disk", created_at: 50 }));
      const out = pending<unknown>();
      fetchProfileFromEachRelay.mockReturnValue(out.promise);
      const reading = useUserStore.getState().fetchOwnProfile();
      await vi.waitFor(() => expect(shown()).toEqual({ name: "ana from disk", created_at: 50 }));
      out.resolve({ status: "unknown" });
      await reading;
      // And the relays' silence afterwards does not take it away again.
      expect(shown()).toEqual({ name: "ana from disk", created_at: 50 });
    });

    it("gives way to a newer profile from the relays", async () => {
      dbLoadProfile.mockResolvedValue(JSON.stringify({ name: "ana from disk", created_at: 50 }));
      relaysHold(ON_RELAYS);
      await useUserStore.getState().fetchOwnProfile();
      expect(shown()).toEqual(ON_RELAYS);
    });

    it("stays when the relays send an older one", async () => {
      dbLoadProfile.mockResolvedValue(JSON.stringify({ name: "ana, renamed", created_at: 200 }));
      relaysHold(ON_RELAYS);
      await useUserStore.getState().fetchOwnProfile();
      expect(shown()).toEqual({ name: "ana, renamed", created_at: 200 });
    });

    // The read of the copy takes a moment, and a profile can arrive meanwhile.
    it("does not replace a profile that was shown while it was being read", async () => {
      const reading = pending<string | null>();
      dbLoadProfile.mockReturnValue(reading.promise);
      const fetching = useUserStore.getState().fetchOwnProfile();
      publishProfile.mockResolvedValue({ name: "ana, saved", created_at: 300 });
      await useUserStore.getState().saveProfile({ name: "ana, saved" }, ANA);
      reading.resolve(JSON.stringify({ name: "ana from disk", created_at: 50 }));
      await fetching;
      expect(shown()).toEqual({ name: "ana, saved", created_at: 300 });
    });

    it("is not read when a profile is already shown", async () => {
      signedInAs(ANA, { name: "ana" });
      await useUserStore.getState().fetchOwnProfile();
      expect(dbLoadProfile).not.toHaveBeenCalled();
    });

    // It may be old: the saved account holds what was last confirmed.
    it("does not replace the name or picture the saved account has", async () => {
      signedInAs(ANA, null, [account(ANA, { name: "ana, confirmed", picture: "https://example.com/confirmed.png" })]);
      dbLoadProfile.mockResolvedValue(JSON.stringify({ name: "ana from disk", picture: "https://example.com/disk.png" }));
      await useUserStore.getState().fetchOwnProfile();
      expect(saved(ANA)).toMatchObject({ name: "ana, confirmed", picture: "https://example.com/confirmed.png" });
      expect(stored(ANA)).toBeUndefined();
    });

    it("does not take the saved account's name and picture away when it has none itself", async () => {
      signedInAs(ANA, null, [account(ANA, { name: "ana", picture: "https://example.com/ana.png" })]);
      for (const copy of [{}, { about: "no name here" }, { name: "   " }]) {
        useUserStore.setState({ profile: null });
        dbLoadProfile.mockResolvedValue(JSON.stringify(copy));
        await useUserStore.getState().fetchOwnProfile();
        expect(saved(ANA)).toMatchObject({ name: "ana", picture: "https://example.com/ana.png" });
      }
    });

    it("gives the saved account a name and picture where it has none", async () => {
      dbLoadProfile.mockResolvedValue(JSON.stringify({ name: "ana from disk", picture: "https://example.com/disk.png" }));
      await useUserStore.getState().fetchOwnProfile();
      expect(saved(ANA)).toMatchObject({ name: "ana from disk", picture: "https://example.com/disk.png", npub: "npub-of-aa" });
      expect(stored(ANA)).toMatchObject({ name: "ana from disk" });
      expect(saved(BO)?.name).toBeUndefined();
    });

    it("fills in only what is missing", async () => {
      signedInAs(ANA, null, [account(ANA, { name: "ana, confirmed" })]);
      dbLoadProfile.mockResolvedValue(JSON.stringify({ name: "ana from disk", picture: "https://example.com/disk.png" }));
      await useUserStore.getState().fetchOwnProfile();
      expect(saved(ANA)).toMatchObject({ name: "ana, confirmed", picture: "https://example.com/disk.png" });
    });

    it("is not taken for a profile when it is not one", async () => {
      signedInAs(ANA, null, [account(ANA, { name: "ana" })]);
      for (const copy of ["null", "42", '"ana"']) {
        dbLoadProfile.mockResolvedValue(copy);
        await useUserStore.getState().fetchOwnProfile();
        expect(shown()).toBeNull();
        expect(saved(ANA)?.name).toBe("ana");
      }
    });

    it("does not stop the relays being read when it cannot be read", async () => {
      dbLoadProfile.mockResolvedValue("{not json");
      relaysHold(ON_RELAYS);
      await useUserStore.getState().fetchOwnProfile();
      expect(shown()).toEqual(ON_RELAYS);
    });

    // The account can change while it is being read.
    it("is not shown for the account switched to meanwhile", async () => {
      const reading = pending<string | null>();
      dbLoadProfile.mockReturnValue(reading.promise);
      const fetching = useUserStore.getState().fetchOwnProfile();
      signedInAs(BO);
      reading.resolve(JSON.stringify({ name: "ana from disk" }));
      await fetching;
      expect(shown()).toBeNull();
      expect(saved(ANA)?.name).toBeUndefined();
      expect(saved(BO)?.name).toBeUndefined();
    });
  });

  it("asks for nothing when nobody is signed in", async () => {
    useUserStore.setState({ pubkey: null, npub: null, loggedIn: false });
    await useUserStore.getState().fetchOwnProfile();
    expect(dbLoadProfile).not.toHaveBeenCalled();
    expect(fetchProfileFromEachRelay).not.toHaveBeenCalled();
  });

  // The account can change while the relays are read. What comes back then
  // is dropped: there is nothing to judge its age against, and the account
  // is read again when it is switched back to.
  it("drops what the relays sent for an account that is no longer on screen", async () => {
    signedInAs(ANA, null, [account(ANA, { name: "ana, confirmed" }), account(BO)]);
    const out = pending<unknown>();
    fetchProfileFromEachRelay.mockReturnValue(out.promise);
    const reading = useUserStore.getState().fetchOwnProfile();
    await vi.waitFor(() => expect(fetchProfileFromEachRelay).toHaveBeenCalled());
    signedInAs(BO, { name: "bo" }, [account(ANA, { name: "ana, confirmed" }), account(BO)]);
    out.resolve({ status: "found", profile: ON_RELAYS });
    await reading;
    expect(shown()).toEqual({ name: "bo" });
    expect(saved(ANA)?.name).toBe("ana, confirmed");
    expect(saved(BO)?.name).toBeUndefined();
    expect(primeProfileCache).not.toHaveBeenCalled();
  });

  it("does not bring back an account that was removed while its profile was read", async () => {
    const out = pending<unknown>();
    fetchProfileFromEachRelay.mockReturnValue(out.promise);
    const reading = useUserStore.getState().fetchOwnProfile();
    await vi.waitFor(() => expect(fetchProfileFromEachRelay).toHaveBeenCalled());
    useUserStore.setState({ pubkey: BO, npub: "npub-of-bb", profile: null, accounts: [account(BO)] });
    out.resolve({ status: "found", profile: ON_RELAYS });
    await reading;
    expect(useUserStore.getState().accounts).toEqual([account(BO)]);
    expect(shown()).toBeNull();
  });
});

// The profile on screen is the signed-in account's or nobody's. It used to
// be left as it was until the new account's fetch came back, and was only
// ever cleared because a fetch that found nothing blanked it.
describe("becoming another account", () => {
  const ANAS = { name: "ana", picture: "https://example.com/ana.png" };
  /** A read that has not come back, so what is on screen is what the change of account left there. */
  const readStillOut = () => { const out = pending<unknown>(); fetchProfileFromEachRelay.mockReturnValue(out.promise); return out; };

  beforeEach(() => {
    vi.mocked(invoke).mockResolvedValue(null);
    signedInAs(ANA, ANAS);
  });

  it("signing in read-only as someone else takes the last account's profile off the screen at once", async () => {
    readStillOut();
    await useUserStore.getState().loginWithPubkey(BO);
    expect(useUserStore.getState().pubkey).toBe(BO);
    expect(shown()).toBeNull();
  });

  it("and it stays off when the relays hold no profile for the new account", async () => {
    relaysHoldNone();
    await useUserStore.getState().loginWithPubkey(BO);
    await vi.waitFor(() => expect(fetchProfileFromEachRelay).toHaveBeenCalledWith(BO, expect.anything()));
    await Promise.resolve();
    expect(shown()).toBeNull();
    expect(saved(BO)?.name).toBeUndefined();
  });

  it("signing in with another account's key does the same", async () => {
    readStillOut();
    const key = NDKPrivateKeySigner.generate();
    await useUserStore.getState().loginWithNsec(key.nsec);
    expect(useUserStore.getState().pubkey).toBe(key.pubkey);
    expect(shown()).toBeNull();
  });

  it("switching to an account signed in earlier does the same", async () => {
    readStillOut();
    const first = NDKPrivateKeySigner.generate();
    const second = NDKPrivateKeySigner.generate();
    await useUserStore.getState().loginWithNsec(first.nsec);
    await useUserStore.getState().loginWithNsec(second.nsec);
    useUserStore.setState({ profile: { name: "second" } });
    await useUserStore.getState().switchAccount(first.pubkey);
    expect(useUserStore.getState().pubkey).toBe(first.pubkey);
    expect(shown()).toBeNull();
  });

  it("switching to an account whose key is in the keychain does the same", async () => {
    readStillOut();
    const kept = NDKPrivateKeySigner.generate();
    useUserStore.setState({ accounts: [account(ANA), account(kept.pubkey)] });
    vi.mocked(invoke).mockImplementation(async (cmd: string) => (cmd === "load_nsec" ? kept.nsec : null));
    await useUserStore.getState().switchAccount(kept.pubkey);
    expect(useUserStore.getState().pubkey).toBe(kept.pubkey);
    expect(useUserStore.getState().loggedIn).toBe(true);
    expect(shown()).toBeNull();
  });

  it("switching to an account with no key on this computer does the same", async () => {
    readStillOut();
    await useUserStore.getState().switchAccount(BO);
    expect(useUserStore.getState().pubkey).toBe(BO);
    expect(useUserStore.getState().loggedIn).toBe(false);
    expect(shown()).toBeNull();
  });

  it("signing in again as the account already on screen keeps its profile there", async () => {
    readStillOut();
    const key = NDKPrivateKeySigner.generate();
    await useUserStore.getState().loginWithNsec(key.nsec);
    useUserStore.setState({ profile: { name: "kept" } });
    await useUserStore.getState().loginWithNsec(key.nsec);
    expect(shown()).toEqual({ name: "kept" });
    await useUserStore.getState().switchAccount(key.pubkey);
    expect(shown()).toEqual({ name: "kept" });
  });

  it("signing out takes it off", () => {
    useUserStore.getState().logout();
    expect(shown()).toBeNull();
  });

  // The rule, held to the source, for the paths a test cannot reach without
  // a remote signer: wherever the store is told who is signed in, it is told
  // in the same breath whose profile is shown, by `profileOnBecoming` for
  // that very account, or `profile: null`.
  describe("every change of who is signed in also says what profile is shown", () => {
    /** Each object literal handed to `set(` or `useUserStore.setState(`, with the line it starts on. */
    function stateChanges(source: string): { text: string; at: number }[] {
      const found: { text: string; at: number }[] = [];
      const call = /\b(?:set|useUserStore\.setState)\(\{/g;
      for (let m = call.exec(source); m; m = call.exec(source)) {
        const open = m.index + m[0].length - 1;
        let depth = 0;
        let end = open;
        for (; end < source.length; end++) {
          if (source[end] === "{") depth++;
          else if (source[end] === "}" && --depth === 0) break;
        }
        found.push({ text: source.slice(open, end + 1), at: source.slice(0, m.index).split("\n").length });
      }
      return found;
    }
    /** Who the change signs in: `pubkey` shorthand is the variable `pubkey`, `pubkey: x` is `x`. Null when the change does not say. */
    const signsIn = (change: string): string | null => {
      const named = /[{,]\s*pubkey\s*:\s*([\w.]+)/.exec(change);
      if (named) return named[1];
      return /[{,]\s*pubkey\s*[,}]/.test(change) ? "pubkey" : null;
    };
    const changes = stateChanges(userSource).map((c) => ({ ...c, who: signsIn(c.text) })).filter((c) => c.who !== null);

    it("finds them all, on one line or several", () => {
      // Three ways to sign in, three in restore, three in switch, and the two that sign out.
      expect(changes.length).toBeGreaterThanOrEqual(11);
      expect(changes.some((c) => c.text.includes("\n"))).toBe(true);
      expect(changes.some((c) => c.who === "savedPubkey")).toBe(true);
      expect(changes.some((c) => c.who === "null")).toBe(true);
    });

    it("each one names the profile for that same account, or none", () => {
      const wrong = changes.filter(({ text, who }) => {
        if (/\bprofile:\s*null\b/.test(text)) return false;
        return who === "null" || !text.includes(`profile: profileOnBecoming(${who})`);
      });
      expect(wrong.map(({ text, at }) => `user.ts:${at}: ${text.replace(/\s+/g, " ")}`)).toEqual([]);
    });

    it("would catch one that kept the last account's profile", () => {
      const slip = `set({ pubkey, npub, profile: get().profile, loggedIn: true });`;
      const [change] = stateChanges(slip);
      expect(signsIn(change.text)).toBe("pubkey");
      expect(change.text.includes("profile: profileOnBecoming(pubkey)")).toBe(false);
      const other = stateChanges(`useUserStore.setState({\n  pubkey: savedPubkey,\n  profile: profileOnBecoming(pubkey),\n});`)[0];
      expect(signsIn(other.text)).toBe("savedPubkey");
      expect(other.text.includes("profile: profileOnBecoming(savedPubkey)")).toBe(false);
    });
  });
});
