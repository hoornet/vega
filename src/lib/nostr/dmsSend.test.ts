import { describe, it, expect, vi, beforeEach } from "vitest";

// A message is two events: a wrap for the recipient and a wrap for the
// sender, so that what was sent shows in the sender's own conversation.
// The message is sent when the recipient's wrap is out.

const ME = "aa".repeat(32);
const THEM = "bb".repeat(32);
const NO_RELAYS = new Error("Not enough relays received the event (0 published, 1 required)");

const addToast = vi.fn();
const publishToNetwork = vi.hoisted(() => vi.fn());
const ndk = vi.hoisted(() => ({
  signer: { user: async () => ({ pubkey: "aa".repeat(32) }) } as { user: () => Promise<{ pubkey: string }> } | undefined,
  getUser: ({ pubkey }: { pubkey: string }) => ({ pubkey }),
}));
vi.mock("./core", () => ({
  getNDK: () => ndk,
  fetchWithTimeout: async () => new Set(),
  getStoredRelayUrls: () => ["wss://mine.example.invalid"],
  isLocalRelayUrl: (url: string) => /^ws:\/\/(127\.0\.0\.1|localhost):/.test(url),
  isOutboxRelaysEnabled: () => reach.on,
  stopSubscription: vi.fn(),
  withTimeout: async <T,>(p: Promise<T>) => p,
  publishToNetwork,
  FEED_TIMEOUT: 8000,
  SINGLE_TIMEOUT: 5000,
}));
// Relay reach, and the message relays each person has published.
const reach = vi.hoisted(() => ({ on: false }));
const dmRelays = vi.hoisted(() => ({ of: {} as Record<string, string[]> }));
vi.mock("./relays", () => ({ fetchUserDMRelayList: async (pubkey: string) => dmRelays.of[pubkey] ?? [] }));
vi.mock("@nostr-dev-kit/ndk", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // The wrap for a person, named after them: the cryptography is not under test.
  giftWrap: vi.fn(async (_rumor: unknown, to: { pubkey: string }) => ({ wrapFor: to.pubkey })),
  // The real one builds relays and connects them. Here a set is the URLs it was made from.
  NDKRelaySet: { fromRelayUrls: (urls: string[]) => ({ relayUrls: urls }) },
}));
vi.mock("../../stores/toast", () => ({
  goToView: (view: string) => () => view,
  useToastStore: { getState: () => ({ addToast }) },
}));

import { sendDM, clearDMRelayListCache } from "./dms";
import { setCurrentAccount } from "../currentAccount";

type Wrap = { wrapFor: string };
/** What each wrap's publish does, by whose wrap it is. */
function relays(outcome: { recipient: "taken" | "refused"; own: "taken" | "refused" }) {
  publishToNetwork.mockImplementation(async (wrap: Wrap) => {
    const taken = wrap.wrapFor === THEM ? outcome.recipient === "taken" : outcome.own === "taken";
    if (!taken) throw NO_RELAYS;
    return new Set(["a relay"]);
  });
}
const published = () => publishToNetwork.mock.calls.map(([wrap]) => (wrap as Wrap).wrapFor);

beforeEach(() => {
  addToast.mockClear();
  publishToNetwork.mockReset();
  ndk.signer = { user: async () => ({ pubkey: ME }) };
  reach.on = false;
  dmRelays.of = {};
  clearDMRelayListCache();
  setCurrentAccount(ME);
});

describe("sendDM", () => {
  it("publishes a wrap for the recipient and one for the sender, each through the rule and with the long time limit", async () => {
    relays({ recipient: "taken", own: "taken" });
    await sendDM(THEM, "hello");
    expect(published().sort()).toEqual([ME, THEM]);
    for (const call of publishToNetwork.mock.calls) expect(call[2]).toBeGreaterThanOrEqual(10000);
    expect(addToast).not.toHaveBeenCalled();
  });

  it("fails when the recipient's wrap reached no relay, with NDK's own error for the caller to word", async () => {
    relays({ recipient: "refused", own: "taken" });
    await expect(sendDM(THEM, "hello")).rejects.toBe(NO_RELAYS);
    expect(addToast).not.toHaveBeenCalled();
  });

  // The recipient has it. Reported as a failure, the box kept the text, and
  // a second press sent the message a second time.
  it("is sent when the recipient's wrap went out although the sender's own copy did not, and says what that costs", async () => {
    relays({ recipient: "taken", own: "refused" });
    await expect(sendDM(THEM, "hello")).resolves.toBeUndefined();
    expect(addToast).toHaveBeenCalledTimes(1);
    const [message, type, options] = addToast.mock.calls[0] as [string, string, { key: string; action: { label: string } }];
    expect(type).toBe("warning");
    expect(message).toBe("Sent. Your own copy of the message could not be saved to a relay, so it will not show in this conversation.");
    expect(options.key).toBe("dm:own-copy");
    expect(options.action.label).toBe("Relays");
  });

  it("fails when neither went out", async () => {
    relays({ recipient: "refused", own: "refused" });
    await expect(sendDM(THEM, "hello")).rejects.toBe(NO_RELAYS);
    expect(addToast).not.toHaveBeenCalled();
  });

  // The sender's copy can take its full fifteen seconds. A message that did not go out says so at once.
  it("does not wait for the sender's copy before failing on the recipient's", async () => {
    publishToNetwork.mockImplementation((wrap: Wrap) => (wrap.wrapFor === THEM ? Promise.reject(NO_RELAYS) : new Promise(() => {})));
    await expect(sendDM(THEM, "hello")).rejects.toBe(NO_RELAYS);
  });

  it("waits for the sender's copy before calling the message sent, so that it can say what became of it", async () => {
    let failOwn: (err: Error) => void = () => {};
    publishToNetwork.mockImplementation((wrap: Wrap) => (wrap.wrapFor === THEM ? Promise.resolve(new Set(["a relay"])) : new Promise((_, reject) => { failOwn = reject; })));
    let done = false;
    const sending = sendDM(THEM, "hello").then(() => { done = true; });
    await vi.waitFor(() => expect(publishToNetwork).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(done).toBe(false);
    failOwn(NO_RELAYS);
    await sending;
    expect(addToast).toHaveBeenCalledTimes(1);
  });

  // Each wrap goes to the relays of the person it is for.
  it("sends each wrap to its own person's message relays, with the sender's list", async () => {
    reach.on = true;
    dmRelays.of = { [THEM]: ["wss://theirs.example.invalid"], [ME]: ["wss://my-inbox.example.invalid"] };
    relays({ recipient: "taken", own: "taken" });
    await sendDM(THEM, "hello");
    const setFor = (pubkey: string) => (publishToNetwork.mock.calls.find(([wrap]) => (wrap as Wrap).wrapFor === pubkey)?.[1] as { relayUrls: string[] }).relayUrls;
    expect(setFor(THEM)).toEqual(["wss://theirs.example.invalid", "wss://mine.example.invalid"]);
    expect(setFor(ME)).toEqual(["wss://my-inbox.example.invalid", "wss://mine.example.invalid"]);
  });

  // The copy can take its full fifteen seconds. Signed out or switched
  // meanwhile, the warning is not the next account's to hear.
  it("does not tell the next account that the sender's copy is missing", async () => {
    let failOwn: (err: Error) => void = () => {};
    publishToNetwork.mockImplementation((wrap: Wrap) => (wrap.wrapFor === THEM ? Promise.resolve(new Set(["a relay"])) : new Promise((_, reject) => { failOwn = reject; })));
    const sending = sendDM(THEM, "hello");
    await vi.waitFor(() => expect(publishToNetwork).toHaveBeenCalledTimes(2));
    setCurrentAccount("cc".repeat(32));
    failOwn(NO_RELAYS);
    await sending;
    expect(addToast).not.toHaveBeenCalled();
  });

  it("refuses without a key to sign with", async () => {
    ndk.signer = undefined;
    await expect(sendDM(THEM, "hello")).rejects.toThrow("Not logged in");
    expect(publishToNetwork).not.toHaveBeenCalled();
  });
});
