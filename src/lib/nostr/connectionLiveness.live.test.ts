// @vitest-environment node
//
// Must be node, not the suite's default jsdom: a real relay connection uses
// undici's WebSocket, whose Event objects jsdom rejects.
//
// Reproduces issue #65 — "Messages stop loading messages".
//
// The reporter's machine is on a KVM: switching away drops the network port
// and falls back to wifi, so the relay sockets never receive a FIN or RST and
// go half-open. This drives that exact state by freezing the relay process
// with SIGSTOP, which leaves the TCP connection ESTABLISHED while nothing is
// ever answered — no firewall rules, no privileges.
//
//   nak serve --port 10549 &
//   VEGA_LIVENESS_RELAY=ws://localhost:10549 \
//   VEGA_LIVENESS_RELAY_PID=<pid of nak> \
//     npx vitest run connectionLiveness.live
//
// Note the relay URL is on localhost, so `isLocalRelayUrl` treats it as the
// embedded relay. That is deliberate: it exercises the fallback branch, where
// a local-only pool must still count as connected rather than being declared
// permanently offline. The verdict here therefore has to come from silence,
// not from excluding the relay.
import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Avoids a dev-dependency on @types/node just for env + signals.
declare const process: {
  env: Record<string, string | undefined>;
  kill(pid: number, signal: string): void;
};

const RELAY = process.env.VEGA_LIVENESS_RELAY;
const RELAY_PID = Number(process.env.VEGA_LIVENESS_RELAY_PID);
const ready = !!RELAY && Number.isFinite(RELAY_PID) && RELAY_PID > 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!ready)("relay liveness after a silent network drop (#65)", () => {
  beforeAll(() => {
    // Only this relay: no default relay, no embedded local relay. The local
    // relay is opt-in and stays off, so `some(r => r.connected)` has exactly
    // one relay to answer for.
    localStorage.setItem("wrystr_vega_relay_added", "1");
    localStorage.setItem("wrystr_relays", JSON.stringify([RELAY]));
    localStorage.setItem("vega_local_relay_enabled", "false");
  });

  afterAll(() => {
    // Never leave the relay frozen, whatever happened above.
    try { process.kill(RELAY_PID, "SIGCONT"); } catch { /* already gone */ }
  });

  it("reports unreachable once fetches stop being answered", async () => {
    const { getNDK, ensureConnected, fetchWithTimeout, isPoolSilent } = await import("./core");

    const ndk = getNDK();
    await ndk.connect();
    await sleep(1500);

    const relayOf = () =>
      Array.from(ndk.pool?.relays?.values() ?? []).find((r) => r.url.includes("10549"));

    const before = relayOf();
    expect(before, "relay should be in the pool").toBeTruthy();
    expect(before!.connected, "relay should be connected before the freeze").toBe(true);

    // A live fetch proves the socket really is carrying traffic.
    const okBefore = await fetchWithTimeout(ndk, { kinds: [1], limit: 1 }, 3000);
    console.log(`[#65] before freeze: connected=${before!.connected} fetch returned ${okBefore.size} events`);

    // ── Freeze the relay: connection stays ESTABLISHED, nothing is answered ──
    process.kill(RELAY_PID, "SIGSTOP");
    console.log("[#65] relay frozen with SIGSTOP");

    // Longer than the feed store's 15s "connection lost" grace (3 x 5s checks).
    await sleep(20000);

    // Three parallel fetches — what opening Messages issues — so the pool has
    // the same evidence the real failure gives it.
    const results = await Promise.all([
      fetchWithTimeout(ndk, { kinds: [1], limit: 1 }, 3000),
      fetchWithTimeout(ndk, { kinds: [1], limit: 1 }, 3000),
      fetchWithTimeout(ndk, { kinds: [1], limit: 1 }, 3000),
    ]);
    const collected = results.reduce((n, s) => n + s.size, 0);

    const after = relayOf();
    const stillConnected = after?.connected;
    const silent = isPoolSilent();
    const ensured = await ensureConnected();

    console.log(
      `[#65] after 20s frozen: relay.connected=${stillConnected} ` +
      `isPoolSilent()=${silent} ensureConnected()=${ensured} ` +
      `3 fetches returned ${collected} events`,
    );

    // NDK still believes the socket is fine — that part is not ours to fix.
    expect(stillConnected, "relay.connected stays true — NDK has no heartbeat").toBe(true);
    expect(collected, "nothing can actually be fetched").toBe(0);
    // What #65 changed: unanswered fetches, not socket flags, decide the verdict.
    expect(silent, "repeated unanswered fetches mark the pool silent").toBe(true);
    expect(ensured, "so ensureConnected() reports unreachable instead of true").toBe(false);

    process.kill(RELAY_PID, "SIGCONT");
  }, 60000);
});
