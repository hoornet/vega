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
 * Whether a conversation is a request: you neither follow the other person nor wrote to them. "Wrote
 * to them" is your message in what was loaded, or the record of people you answered (`answered`):
 * Messages loads a window of messages, and an old reply can fall outside it. Nothing is a request
 * until the follow list has loaded, so a list that is still loading or could not be read never sorts
 * a friend out; and a conversation with nothing in it is one you started.
 */
export function isRequest(
  conv: ConversationFacts,
  me: string,
  follows: ReadonlySet<string>,
  followsLoaded: boolean,
  answered: ReadonlySet<string> = new Set(),
): boolean {
  if (!followsLoaded) return false;
  if (conv.senders.length === 0) return false;
  if (follows.has(conv.partner) || answered.has(conv.partner)) return false;
  return !conv.senders.includes(me);
}

// ── What is kept per account ─────────────────────────────────────────────────
//
// `answered`: everyone you have written to, recorded when a message to them goes out (whether or not
// Messages is still open) and when your own message is seen in a loaded conversation. It only grows.
//
// `inbox`: the people whose conversations Messages last showed as yours. The notification poller runs
// without Messages and cannot ask the user store (the store imports it), so this, `answered` and the
// cached contact list are how it tells a stranger from a friend.

const ANSWERED_KEY = "wrystr_dm_answered_";
const INBOX_KEY = "wrystr_dm_inbox_";
const CONTACTS_KEY = "wrystr_contact_list_";

function readSet(key: string): Set<string> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? new Set(v.filter((x): x is string => typeof x === "string")) : null;
  } catch {
    return null;
  }
}

function writeSet(key: string, values: Iterable<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...new Set(values)]));
  } catch {
    /* storage full or blocked: the conversation is sorted again from what is loaded */
  }
}

/** The people you have written to, as recorded on this device. */
export function answeredBy(me: string): Set<string> {
  return readSet(ANSWERED_KEY + me) ?? new Set();
}

/** Records that you wrote to these people. */
export function recordAnswered(me: string, partners: Iterable<string>): void {
  const known = answeredBy(me);
  const before = known.size;
  for (const p of partners) known.add(p);
  if (known.size !== before) writeSet(ANSWERED_KEY + me, known);
}

/** Records the people whose conversations are in your messages, as the Messages view last sorted them. */
export function rememberInbox(me: string, partners: Iterable<string>): void {
  writeSet(INBOX_KEY + me, partners);
}

/**
 * Whether a new message from `sender` may raise a desktop notification. Never for someone you mute,
 * followed or not. Otherwise: until the Messages view has sorted the conversations once on this
 * device, or while no follow list is cached, everyone may, as before this existed (not knowing is not
 * a reason to stay quiet about a friend); after that, people you follow, people in your messages and
 * people you have answered.
 */
export function mayAnnounce(me: string, sender: string, muted: ReadonlySet<string> = new Set()): boolean {
  if (muted.has(sender)) return false;
  const inbox = readSet(INBOX_KEY + me);
  let contacts: ReturnType<typeof parseStoredContactList> = null;
  try {
    contacts = parseStoredContactList(localStorage.getItem(CONTACTS_KEY + me));
  } catch {
    contacts = null;
  }
  if (!inbox || !contacts) return true;
  return inbox.has(sender) || answeredBy(me).has(sender) || contactPubkeys(contacts.tags).includes(sender);
}
