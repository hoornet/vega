import { NDKEvent, NDKFilter, NDKKind } from "@nostr-dev-kit/ndk";
import { getNDK, fetchWithTimeout, SINGLE_TIMEOUT, publishToNetwork } from "./core";

export interface PollVotes {
  /** option index → vote count */
  votes: Map<number, number>;
  /** which option the current user voted for (null if not voted) */
  myVote: number | null;
  /** total votes across all options */
  total: number;
}

export async function publishPoll(question: string, options: string[]): Promise<NDKEvent> {
  const instance = getNDK();
  if (!instance.signer) throw new Error("Not logged in");
  const event = new NDKEvent(instance);
  event.kind = 1068 as NDKKind;
  event.content = question;
  event.tags = options.map((opt, i) => ["option", String(i), opt]);
  await publishToNetwork(event);
  return event;
}

export async function publishPollResponse(pollId: string, pollPubkey: string, optionIndex: number): Promise<NDKEvent> {
  const instance = getNDK();
  if (!instance.signer) throw new Error("Not logged in");
  const event = new NDKEvent(instance);
  event.kind = 1018 as NDKKind;
  event.content = String(optionIndex);
  event.tags = [["e", pollId], ["p", pollPubkey]];
  await publishToNetwork(event);
  return event;
}

export async function fetchPollResponses(pollId: string, myPubkey?: string): Promise<PollVotes> {
  const instance = getNDK();
  const filter: NDKFilter = { kinds: [1018 as NDKKind], "#e": [pollId] };
  const events = await fetchWithTimeout(instance, filter, SINGLE_TIMEOUT);

  // Deduplicate by pubkey — keep latest response per voter
  const byPubkey = new Map<string, NDKEvent>();
  for (const e of events) {
    const existing = byPubkey.get(e.pubkey);
    if (!existing || (e.created_at ?? 0) > (existing.created_at ?? 0)) {
      byPubkey.set(e.pubkey, e);
    }
  }

  const votes = new Map<number, number>();
  let myVote: number | null = null;
  let total = 0;

  for (const [pubkey, event] of byPubkey) {
    const idx = parseInt(event.content, 10);
    if (isNaN(idx)) continue;
    votes.set(idx, (votes.get(idx) ?? 0) + 1);
    total++;
    if (myPubkey && pubkey === myPubkey) {
      myVote = idx;
    }
  }

  return { votes, myVote, total };
}
