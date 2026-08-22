import type { NDKNip46Signer, NDKRpcResponse, NDKUser } from "@nostr-dev-kit/ndk";
import { debug } from "../debug";

// Scratch slot for the NIP-46 *client* key of an in-flight bunker login. This is
// not the user's nsec — it only identifies Vega to the bunker. Retrying a failed
// login must reuse it: bunkers bind the one-shot bunker:// secret to the first
// client pubkey that presents it and answer every later one with "Unknown client".
// Keyed by URI so a freshly issued bunker:// URI still gets a fresh identity —
// reusing a client key whose connection was revoked is rejected just as hard.
export const NIP46_PENDING_CLIENT_KEY = "wrystr_nip46_pending_client_key";

const HEX_PRIVATE_KEY = /^[0-9a-f]{64}$/i;

// rpc objects already carrying the secret-echo hook, so re-hooking is a no-op.
const patchedRpcs = new WeakSet<object>();

/**
 * A bunker that is offline, unreachable, or simply never answers leaves
 * `blockUntilReady()` pending forever — it neither resolves nor rejects. Login
 * has always raced it against a timeout; restore and account-switch did not,
 * so an unreachable bunker hung the switch with no error and no way back.
 */
export const NIP46_CONNECT_TIMEOUT_MS = 15000;

/** How many times to send the `connect` request before giving up. See #51. */
export const NIP46_CONNECT_ATTEMPTS = 2;

/** Marks our own timeout, so a retry can tell it apart from the signer saying no. */
const TIMED_OUT = Symbol("nip46-timeout");

function connectOnce(signer: NDKNip46Signer, timeoutMs: number): Promise<NDKUser> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    signer.blockUntilReady(),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(
          `Remote signer didn't respond within ${Math.round(timeoutMs / 1000)} seconds. Check your connection.`,
        );
        (err as Error & { [TIMED_OUT]?: boolean })[TIMED_OUT] = true;
        reject(err);
      }, timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer)) as Promise<NDKUser>;
}

/**
 * Connect to a remote signer, re-sending the request once if it goes unanswered.
 *
 * A `connect` request can be missed through nobody's fault: the signer's own
 * subscription to its relay drops and re-subscribes periodically, and anything
 * published into that window is simply never seen. Observed against a
 * self-hosted Bunker46 re-subscribing every 60 seconds — the same login hung
 * once and succeeded moments later with no code change in between. See #51.
 *
 * `blockUntilReady()` ends in a fresh `sendRequest(..., "connect", ...)` on
 * every call, so a second attempt genuinely re-sends rather than waiting on the
 * first. `startListening()` is guarded internally, so the subscription is not
 * duplicated.
 *
 * Only a timeout is retried. An explicit rejection — an expired link, a refused
 * permission — will fail exactly the same way the second time, and retrying it
 * would double the wait before telling the user something they could act on.
 */
export function connectWithTimeout(
  signer: NDKNip46Signer,
  timeoutMs = NIP46_CONNECT_TIMEOUT_MS,
  attempts = NIP46_CONNECT_ATTEMPTS,
): Promise<NDKUser> {
  const attempt = async (n: number): Promise<NDKUser> => {
    try {
      return await connectOnce(signer, timeoutMs);
    } catch (err) {
      const timedOut = !!(err as Error & { [TIMED_OUT]?: boolean })?.[TIMED_OUT];
      if (!timedOut || n >= attempts) throw err;
      debug.warn(`[NIP-46] connect attempt ${n} timed out — re-sending`);
      return attempt(n + 1);
    }
  };
  return attempt(1);
}

/**
 * Turn a bunker's connect rejection into something a user can act on.
 *
 * "Unknown client" is the one that matters, because it has at least three
 * entirely innocent causes and the raw message suggests none of them. Measured
 * against Bunker46 on 2026-08-20:
 *
 * - the secret is **single-use** — `consumePendingSecret` deletes it on read,
 *   so pasting the same link a second time (another device, or a fresh install)
 *   always fails
 * - it **expires after 10 minutes**
 * - pending secrets live in an in-memory `Map`, so they **do not survive a
 *   restart of the signer**
 *
 * All three present identically. We hit every one of them in a single afternoon
 * of testing, which is a fair indication of how often users will.
 */
export function explainBunkerConnectError(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";

  if (/unknown client/i.test(raw)) {
    return "This bunker link is no longer valid. These links are usually single-use and expire after a few minutes, and they stop working if the signer restarts. Generate a fresh bunker:// link in your signer and paste it again.";
  }
  if (/didn't respond|did not respond|timed out|timeout/i.test(raw)) {
    return raw;
  }
  if (/permission|denied|not allowed|unauthoriz/i.test(raw)) {
    return `Your signer refused the connection: ${raw}`;
  }
  return `Remote signer login failed: ${raw || "the signer rejected the connection"}`;
}

export function pendingClientKeyFor(bunkerUri: string): string | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(NIP46_PENDING_CLIENT_KEY) ?? "null");
    if (saved?.uri !== bunkerUri) return undefined;
    // A malformed key would throw inside NDKPrivateKeySigner and wedge every
    // future attempt at this URI — fall back to a fresh identity instead.
    return HEX_PRIVATE_KEY.test(saved.privateKey) ? saved.privateKey : undefined;
  } catch {
    return undefined;
  }
}

export function rememberPendingClientKey(bunkerUri: string, privateKey: string): void {
  localStorage.setItem(NIP46_PENDING_CLIENT_KEY, JSON.stringify({ uri: bunkerUri, privateKey }));
}

export function forgetPendingClientKey(): void {
  localStorage.removeItem(NIP46_PENDING_CLIENT_KEY);
}

/**
 * NIP-46 lets a bunker answer `connect` with either `"ack"` **or the secret**
 * from the bunker:// URI. NDK only accepts `"ack"` and rejects anything else —
 * and it rejects with `response.error`, which is undefined on a *successful*
 * secret echo, so the failure surfaces as "login failed: undefined" even though
 * the bunker connected us. Normalize the echo to "ack" before NDK sees it.
 *
 * Hooks `rpc.parseEvent`, which decrypts every inbound NIP-46 message and runs
 * before the response is dispatched to the waiting request handler.
 * See https://github.com/hoornet/vega/issues/17.
 *
 * **Every path that produces a signer must call this, not just fresh login.**
 * `toPayload()` persists the bunker:// secret and NDK re-sends it with `connect`
 * on *every* `blockUntilReady()`, so a restored session hits the same echo on
 * each reconnect. Hooking only the login path left restart broken while login
 * looked fine — https://github.com/hoornet/vega/issues/47.
 */
export function acceptSecretEchoAsAck(signer: NDKNip46Signer): void {
  const secret = signer.secret;
  const rpc = signer.rpc;
  if (!secret || typeof rpc?.parseEvent !== "function") return;
  // Restore and switch can both reach the same cached signer; wrapping twice
  // would work but stacks a closure per call for the life of the session.
  if (patchedRpcs.has(rpc)) return;
  patchedRpcs.add(rpc);

  const parseEvent = rpc.parseEvent.bind(rpc);
  rpc.parseEvent = async (event) => {
    const parsed = await parseEvent(event);
    // Requests carry `method`; anything else is a response to something we sent.
    if (!("method" in parsed)) {
      const response = parsed as NDKRpcResponse;
      if (response.result === secret) {
        debug.log("[nip46] bunker acked connect by echoing the secret");
        response.result = "ack";
      }
    }
    return parsed;
  };
}
