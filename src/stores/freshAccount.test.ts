import { describe, it, expect, vi, beforeEach } from "vitest";

// A key made in the sign-up flow follows nobody. Asked, the relays can only
// confirm that when every one of them answers, and one quiet relay among many
// left a new account with "Couldn't reach your relays" for good. So the flow
// tells the store, and the store holds the empty list as its base.

const publishContactList = vi.hoisted(() => vi.fn(async () => {}));
const fetchContactList = vi.hoisted(() => vi.fn(async () => ({ status: "unknown" as const })));
const ndk = vi.hoisted(() => ({ signer: {} as unknown, pool: { relays: new Map() } }));
vi.mock("../lib/nostr", () => ({
  getNDK: () => ndk,
  publishContactList,
  fetchContactList,
  publishProfile: vi.fn(),
  fetchProfileFromEachRelay: vi.fn(async () => ({ status: "unknown" })),
}));
vi.mock("../lib/db", () => ({ dbLoadProfile: vi.fn() }));
vi.mock("../hooks/useProfile", () => ({ primeProfileCache: vi.fn() }));
vi.mock("../lib/notificationPoller", () => ({ startNotificationPoller: vi.fn(), stopNotificationPoller: vi.fn() }));
vi.mock("./mute", () => ({ useMuteStore: { getState: () => ({ fetchMuteList: vi.fn() }) } }));
vi.mock("./lightning", () => ({ useLightningStore: { getState: () => ({ loadNwcForAccount: vi.fn() }) } }));
vi.mock("./ui", () => ({ useUIStore: { getState: () => ({ setView: vi.fn() }) } }));
vi.mock("./feed", () => ({ useFeedStore: { getState: () => ({ loadFeed: vi.fn() }) } }));
vi.mock("./notifications", () => ({ useNotificationsStore: { getState: () => ({ fetchNotifications: vi.fn() }) } }));
vi.mock("./podcast", () => ({ usePodcastStore: { getState: () => ({ setActiveAccount: vi.fn(), hydrateSubscriptions: vi.fn(), forgetAccount: vi.fn() }) } }));

import { useUserStore } from "./user";
import { useToastStore } from "../stores/toast";

const NEW = "ab".repeat(32);
const OTHER = "cd".repeat(32);
const CAROL = "ef".repeat(32);
const state = () => useUserStore.getState();

beforeEach(() => {
  localStorage.clear();
  publishContactList.mockClear();
  fetchContactList.mockClear();
  useToastStore.setState({ toasts: [] });
  useUserStore.setState({ pubkey: NEW, npub: "npub-new", loggedIn: true, follows: [], followsStatus: "loading", accounts: [{ pubkey: NEW, npub: "npub-new", loginType: "nsec" }] });
});

describe("a key made here", () => {
  it("is known to follow nobody, and the relays' silence cannot unsettle that", async () => {
    state().adoptEmptyContactList(NEW);
    expect(state().followsStatus).toBe("loaded");
    expect(state().follows).toEqual([]);
    // Remembered on this computer, as an empty list and not as "no cache".
    expect(JSON.parse(localStorage.getItem(`wrystr_contact_list_${NEW}`) ?? "null")).toEqual({ tags: [], content: "", createdAt: 0 });

    // The read that sign-in started ends with the relays unable to tell.
    await state().fetchFollows();
    expect(fetchContactList).toHaveBeenCalled();
    expect(state().followsStatus).toBe("loaded");
    expect(state().follows).toEqual([]);
  });

  it("can follow someone at once, publishing a list of one although no relay could say", async () => {
    state().adoptEmptyContactList(NEW);
    const outcome = await state().follow(CAROL);
    expect(outcome).toBe("done");
    expect(publishContactList).toHaveBeenCalledWith([["p", CAROL]], "");
    expect(state().follows).toEqual([CAROL]);
    expect(useToastStore.getState().toasts.filter((t) => t.type === "error")).toEqual([]);
  });

  it("is only ever told about the account that is signed in", () => {
    state().adoptEmptyContactList(OTHER);
    expect(state().followsStatus).toBe("loading");
    expect(localStorage.getItem(`wrystr_contact_list_${OTHER}`)).toBeNull();
  });
});
