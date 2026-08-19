import { describe, it, expect, vi, beforeEach } from "vitest";

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
vi.mock("./lightning", () => ({ useLightningStore: { getState: () => ({ loadNwcForAccount: vi.fn() }) } }));
vi.mock("./ui", () => ({ useUIStore: { getState: () => ({ setView: vi.fn() }) } }));
vi.mock("./feed", () => ({ useFeedStore: { getState: () => ({ loadFeed: vi.fn() }) } }));
vi.mock("./notifications", () => ({
  useNotificationsStore: { getState: () => ({ fetchNotifications: vi.fn() }) },
}));
vi.mock("./podcast", () => ({
  usePodcastStore: { getState: () => ({ setActiveAccount: vi.fn(), hydrateSubscriptions: vi.fn() }) },
}));

import { invoke } from "@tauri-apps/api/core";
import { useUserStore } from "./user";

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
