import { parseStoredContactList, contactPubkeys } from "./contacts";

/**
 * Message requests (CLAUDE.md, "Messages"): a conversation with someone you do not follow and have
 * never written to is kept apart from your messages, collapsed, uncounted and unannounced. It is
 * where spam from fresh keys lands, and where a genuine stranger waits until you answer.
 */

/** What `isRequest` needs to know about one conversation. */
export interface ConversationFacts {
  partner: string;
  /** Who sent each message in it (the rumor's author for a gift-wrapped one). */
  senders: string[];
}

/**
 * Whether a conversation is a request: you neither follow the other person nor wrote to them in
 * it. Nothing is a request until the follow list has loaded, so a list that is still loading or
 * could not be read never sorts a friend out; and a conversation with nothing in it is one you
 * started.
 */
export function isRequest(conv: ConversationFacts, me: string, follows: ReadonlySet<string>, followsLoaded: boolean): boolean {
  if (!followsLoaded) return false;
  if (conv.senders.length === 0) return false;
  if (follows.has(conv.partner)) return false;
  return !conv.senders.includes(me);
}

// ── Who has been let in, for the notification poller ─────────────────────────
//
// The poller runs without the Messages view and cannot ask the user store (the store imports it).
// What it needs is "may this sender's message raise a desktop notification": a person you follow
// (read from the cached contact list, which the user store keeps) or one whose conversation was
// last seen in your messages, not in requests (written here by the Messages view).

const INBOX_KEY = "wrystr_dm_inbox_";
const CONTACTS_KEY = "wrystr_contact_list_";

/** Records the people whose conversations are in your messages, as the Messages view last sorted them. */
export function rememberInbox(me: string, partners: Iterable<string>): void {
  try {
    localStorage.setItem(INBOX_KEY + me, JSON.stringify([...new Set(partners)]));
  } catch {
    /* the poller then announces as it did before */
  }
}

/** Adds one person to your messages: you just wrote to them. */
export function letIn(me: string, partner: string): void {
  const known = readInbox(me);
  if (known && known.has(partner)) return;
  rememberInbox(me, [...(known ?? []), partner]);
}

function readInbox(me: string): Set<string> | null {
  try {
    const raw = localStorage.getItem(INBOX_KEY + me);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? new Set(v.filter((x): x is string => typeof x === "string")) : null;
  } catch {
    return null;
  }
}

/**
 * Whether a new message from `sender` may raise a desktop notification. Until the Messages view has
 * sorted the conversations once on this device, or while no follow list is cached, everyone may,
 * as before this existed: not knowing is not a reason to stay quiet about a friend.
 */
export function mayAnnounce(me: string, sender: string): boolean {
  const inbox = readInbox(me);
  let contacts: ReturnType<typeof parseStoredContactList> = null;
  try {
    contacts = parseStoredContactList(localStorage.getItem(CONTACTS_KEY + me));
  } catch {
    contacts = null;
  }
  if (!inbox || !contacts) return true;
  return inbox.has(sender) || contactPubkeys(contacts.tags).includes(sender);
}
