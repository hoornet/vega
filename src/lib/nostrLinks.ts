import { nip19, type NDKEvent } from "@nostr-dev-kit/ndk";
import { fetchLinkedEvent, safeHintRelays, isOutboxRelaysEnabled } from "./nostr";
import { useUIStore } from "../stores/ui";

/** The kind of a long-form article (NIP-23), the one addressable kind Vega opens. */
const ARTICLE_KIND = 30023;

/**
 * What a NIP-19 reference names, as far as Vega opens it: a person, a note, an article. The
 * relays are the hints the reference carries, as written; `safeHintRelays` decides which of
 * them may ever be asked.
 */
export type NostrReference =
  | { kind: "profile"; pubkey: string }
  | { kind: "note"; id: string; author?: string; relays: string[] }
  | { kind: "article"; pubkey: string; identifier: string; naddr: string; relays: string[] };

const HEX64 = /^[0-9a-f]{64}$/;
const OPENABLE = /^(npub1|nprofile1|note1|nevent1|naddr1)[a-z0-9]+$/;

/**
 * Reads a reference from a `nostr:` link (NIP-21) or pasted text, with or without `nostr:` (or
 * the `nostr://` some apps write). Null for anything Vega does not open: a secret key (`nsec`
 * is never decoded here), a reference that does not decode, an address of another kind than an
 * article.
 */
export function readNostrReference(text: string): NostrReference | null {
  const reference = text.trim().replace(/^nostr:(\/\/)?/i, "").toLowerCase();
  if (!OPENABLE.test(reference)) return null;
  try {
    const decoded = nip19.decode(reference);
    switch (decoded.type) {
      case "npub":
        return HEX64.test(decoded.data) ? { kind: "profile", pubkey: decoded.data } : null;
      case "nprofile":
        return HEX64.test(decoded.data.pubkey) ? { kind: "profile", pubkey: decoded.data.pubkey } : null;
      case "note":
        return HEX64.test(decoded.data) ? { kind: "note", id: decoded.data, relays: [] } : null;
      case "nevent": {
        const { id, author, relays } = decoded.data;
        if (!HEX64.test(id)) return null;
        return { kind: "note", id, author: author && HEX64.test(author) ? author : undefined, relays: relays ?? [] };
      }
      case "naddr": {
        const { kind, pubkey, identifier, relays } = decoded.data;
        if (kind !== ARTICLE_KIND || !HEX64.test(pubkey)) return null;
        return { kind: "article", pubkey, identifier, naddr: reference, relays: relays ?? [] };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export type OpenOutcome =
  | { status: "opened" }
  /** No relay asked had it. `hintsUnasked`: the link named relays Relay reach kept Vega from asking. */
  | { status: "not-found"; what: "note" | "article"; hintsUnasked: boolean }
  /** Another request came after this one, and this one opened nothing. */
  | { status: "superseded" };

/**
 * Opens what a reference names: a profile at once, a note or an article once a relay has it
 * (`fetchLinkedEvent`: the user's relays, and the link's hints only with Relay reach on). A note
 * that turns out to be an article opens as one. Opening is all it does: nothing is published,
 * followed or signed, whoever made the reference. `stillWanted` is asked before anything moves,
 * so a slow lookup cannot pull the window away after a newer request.
 */
export async function openNostrReference(
  reference: NostrReference,
  stillWanted: () => boolean = () => true,
): Promise<OpenOutcome> {
  const ui = useUIStore.getState;
  if (reference.kind === "profile") {
    if (!stillWanted()) return { status: "superseded" };
    ui().openProfile(reference.pubkey);
    return { status: "opened" };
  }
  const hints = safeHintRelays(reference.relays);
  const hintsUnasked = hints.length > 0 && !isOutboxRelaysEnabled();
  let event: NDKEvent | null;
  if (reference.kind === "note") {
    event = await fetchLinkedEvent(
      { ids: [reference.id], ...(reference.author ? { authors: [reference.author] } : {}), limit: 1 },
      hints,
    );
  } else {
    event = await fetchLinkedEvent(
      { kinds: [ARTICLE_KIND], authors: [reference.pubkey], "#d": [reference.identifier], limit: 1 },
      hints,
    );
  }
  if (!stillWanted()) return { status: "superseded" };
  if (!event) return { status: "not-found", what: reference.kind, hintsUnasked };
  if (event.kind === ARTICLE_KIND) ui().openArticle(reference.kind === "article" ? reference.naddr : event.encode(), event);
  else ui().openThread(event);
  return { status: "opened" };
}
