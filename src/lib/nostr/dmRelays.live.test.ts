// @vitest-environment node
//
// Must be node, not the suite's default jsdom: a real relay connection uses
// undici's WebSocket, whose Event objects jsdom rejects.
//
// Drives issue #49 end to end against real relays, through the same `getNDK()`
// the app uses: a gift wrap that exists ONLY on a DM relay — published in the
// user's kind 10050 but absent from the stored relay list — must still be
// found. Unit tests cannot see this: the interesting behaviour is NDK actually
// connecting `NDKRelaySet.fromRelayUrls` relays and merging their answers.
//
//   nak serve --port 10561 &   # the configured "pool" relay
//   nak serve --port 10562 &   # the dedicated DM relay — never in the list
//   VEGA_DM_POOL_RELAY=ws://localhost:10561 VEGA_DM_RELAY=ws://localhost:10562 \
//     npx vitest run dmRelays.live
import { describe, it, expect, beforeAll } from "vitest";
import { NDKEvent, NDKPrivateKeySigner, NDKRelaySet } from "@nostr-dev-kit/ndk";

// Avoids a dev-dependency on @types/node just for one env lookup.
declare const process: { env: Record<string, string | undefined> };

const POOL_RELAY = process.env.VEGA_DM_POOL_RELAY;
const DM_RELAY = process.env.VEGA_DM_RELAY;

describe.skipIf(!POOL_RELAY || !DM_RELAY)("NIP-17 DM relay routing against live relays (#49)", () => {
  beforeAll(() => {
    // Seed before the first getNDK(): NDK reads explicitRelayUrls once, at
    // construction. Only the pool relay is configured — the DM relay being
    // reachable *despite* that is the whole point.
    localStorage.setItem("wrystr_vega_relay_added", "1");
    localStorage.setItem("wrystr_relays", JSON.stringify([POOL_RELAY]));
    localStorage.removeItem("wrystr_use_author_relays");
  });

  it("finds a gift wrap that only the 10050-published DM relay holds", async () => {
    const { getNDK, isOutboxRelaysEnabled } = await import("./core");
    const { fetchGiftWraps, clearDMRelayListCache } = await import("./dms");

    // Relay reach on is the precondition for DM relay routing.
    expect(isOutboxRelaysEnabled()).toBe(true);

    const ndk = getNDK();
    const me = NDKPrivateKeySigner.generate();
    ndk.signer = me;
    const myPubkey = (await me.user()).pubkey;
    await ndk.connect();
    await new Promise((r) => setTimeout(r, 500));

    // The user's published DM relay list, on the pool relay like any 10050.
    const dmRelayList = new NDKEvent(ndk);
    dmRelayList.kind = 10050;
    dmRelayList.tags = [["relay", DM_RELAY!]];
    await dmRelayList.publish();

    // A gift wrap addressed to us, held ONLY by the DM relay. Signed by a
    // different key, as NIP-59 wraps are; the content need not decrypt —
    // fetchGiftWraps collects, unwrapping is a separate concern.
    const sender = NDKPrivateKeySigner.generate();
    const wrap = new NDKEvent(ndk);
    wrap.kind = 1059;
    wrap.content = "not-a-real-ciphertext";
    wrap.tags = [["p", myPubkey]];
    await wrap.sign(sender);
    await wrap.publish(NDKRelaySet.fromRelayUrls([DM_RELAY!], ndk));

    clearDMRelayListCache();
    const wraps = await fetchGiftWraps(myPubkey, 20, 8000);

    // Before #49 this came back empty: the subscription went to the pool
    // alone, and the pool relay has never seen the wrap.
    expect(wraps.map((w) => w.id)).toContain(wrap.id);
  }, 40000);
});
