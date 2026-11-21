import { NDKRelaySet, type NDKEvent, type NDKFilter } from "@nostr-dev-kit/ndk";
import {
  ensureConnected,
  fetchFromRelay,
  fetchWithTimeout,
  getNDK,
  isOutboxRelaysEnabled,
  normalizeRelayUrl,
  SINGLE_TIMEOUT,
} from "./core";

/** The most relays a link's hints may add to a lookup. */
export const MAX_HINT_RELAYS = 3;

/**
 * Whether a host may be asked as a link's relay hint: a name with a dot that is not a local or
 * private one, or a public IPv4 address. A link can come from any web page, and a hint is a
 * place it asks Vega to connect to, so nothing on this computer or its network is one: not
 * `localhost` or a bare name, not `.local`, not a private, loopback, link-local or shared IPv4
 * range, not an IPv6 literal (all the local ones are literals). `host` is as `URL` reads it, which
 * has turned an IPv4 address written short, as one number or in hex into dotted form. A public
 * name that resolves to a private address is not caught: that would need the DNS answer, which a
 * webview cannot see.
 */
function publicHost(host: string): boolean {
  if (host.startsWith("[") || !host.includes(".")) return false;
  if (/\.(local|localhost|internal|lan|home\.arpa)$/.test(host)) return false;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    ) return false;
  }
  return true;
}

/**
 * The relay hints of a link that may be asked: `wss://` on a public host, with no user name or
 * password in it, each once, at most `MAX_HINT_RELAYS`. Whether they are asked at all is
 * `fetchLinkedEvent`'s question (Relay reach).
 */
export function safeHintRelays(relays: readonly string[] | undefined): string[] {
  const kept: string[] = [];
  for (const raw of relays ?? []) {
    if (kept.length >= MAX_HINT_RELAYS) break;
    let url: URL;
    try {
      url = new URL(raw.trim());
    } catch {
      continue;
    }
    if (url.protocol !== "wss:" || url.username || url.password) continue;
    // A trailing dot is the same host to DNS, and `URL` keeps it (`localhost.`); with empty labels
    // it does not read the host as an address at all (`127.1..`), and without the dots the same
    // host is one (`127.1` is 127.0.0.1). So the dots go, the address is read again, and the host
    // is judged as that second reading has it, which is how the relay connection will read it too.
    let final: URL;
    try {
      final = new URL(`wss://${url.hostname.replace(/\.+$/, "")}${url.port ? `:${url.port}` : ""}${url.pathname}`);
    } catch {
      continue;
    }
    if (!publicHost(final.hostname)) continue;
    const relay = normalizeRelayUrl(`wss://${final.host}${final.pathname}`);
    if (!kept.includes(relay)) kept.push(relay);
  }
  return kept;
}

/**
 * The event a `nostr:` link names, newest first when several answer (a replaced article), or
 * null when none of the relays asked has it. Asked of the user's own relays always, and of the
 * link's hint relays (`safeHintRelays`) only while Relay reach is on: that switch is the user's
 * word on connecting to servers they did not choose, and a hint was chosen by whoever made the
 * link. `NDKRelaySet.fromRelayUrls` connects past `relayConnectionFilter`, hence the explicit
 * check, as in `fetchUserNotesNIP65`.
 *
 * Each hint relay is asked on its own (`fetchFromRelay`), which stays silent on a timeout: a dead
 * relay named by a stranger's link must not count towards calling the user's pool silent.
 */
export async function fetchLinkedEvent(filter: NDKFilter, hints: readonly string[]): Promise<NDKEvent | null> {
  await ensureConnected();
  const instance = getNDK();
  const own = fetchWithTimeout(instance, filter, SINGLE_TIMEOUT).then((events) => Array.from(events));
  const extra = isOutboxRelaysEnabled() && hints.length > 0
    ? Promise.all(
        Array.from(NDKRelaySet.fromRelayUrls([...hints], instance).relays).map((relay) =>
          fetchFromRelay(instance, relay, filter, SINGLE_TIMEOUT).then((result) => result.events),
        ),
      ).then((lists) => lists.flat())
    : Promise.resolve([] as NDKEvent[]);
  const events = (await Promise.all([own, extra])).flat();
  events.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
  return events[0] ?? null;
}
