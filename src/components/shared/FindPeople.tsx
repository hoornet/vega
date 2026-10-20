import { useState, useRef, type FormEvent } from "react";
import { nip19, type NDKUserProfile } from "@nostr-dev-kit/ndk";
import { Search } from "lucide-react";
import { searchUsers } from "../../lib/nostr";
import { fetchMark, wentUnanswered } from "../../lib/listLoad";
import { primeProfileCache } from "../../hooks/useProfile";
import { useUIStore } from "../../stores/ui";
import { Button } from "./Button";
import { ListState } from "./ListState";
import { FollowRow } from "../follows/FollowRow";

// Finding someone by name, from People. The people search lived in Search
// alone, and People was where the hand went twice over to look for someone:
// People is where people are. An address (npub, nprofile) opens the profile.

type Outcome = { kind: "idle" } | { kind: "loading" } | { kind: "found"; pubkeys: string[] } | { kind: "unreachable" } | { kind: "error"; message: string };

/** The public key an address stands for, if the text is one. */
function pubkeyOf(text: string): string | null {
  const q = text.trim().replace(/^nostr:/, "");
  if (!/^(npub1|nprofile1)/.test(q)) return null;
  try {
    const decoded = nip19.decode(q);
    if (decoded.type === "npub") return decoded.data;
    if (decoded.type === "nprofile") return decoded.data.pubkey;
  } catch { /* not an address */ }
  return null;
}

export function FindPeople() {
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const asked = useRef(0);

  const find = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = query.trim();
    if (!text) return;
    const direct = pubkeyOf(text);
    if (direct) { useUIStore.getState().openProfile(direct); return; }
    const turn = ++asked.current;
    setOutcome({ kind: "loading" });
    const mark = fetchMark();
    try {
      const events = await searchUsers(text);
      if (turn !== asked.current) return;
      const pubkeys: string[] = [];
      for (const event of events) {
        try {
          // Dated, so that a search relay's older copy cannot replace a newer profile already held.
          const profile = JSON.parse(event.content) as NDKUserProfile;
          if (typeof event.created_at === "number") profile.created_at = event.created_at;
          primeProfileCache(event.pubkey, profile);
        } catch { /* a profile that does not parse is still a person */ }
        pubkeys.push(event.pubkey);
      }
      setOutcome(pubkeys.length === 0 && wentUnanswered(mark) ? { kind: "unreachable" } : { kind: "found", pubkeys });
    } catch (err) {
      if (turn !== asked.current) return;
      setOutcome({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div>
      <form onSubmit={find} className="flex gap-2 px-4 py-3 border-b border-border-subtle">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="A name, or an address (npub1…)"
          aria-label="Find people"
          className="flex-1 min-w-0 bg-bg border border-border-strong px-3 py-1.5 text-text text-ui focus:outline-none focus:border-accent rounded-lg"
        />
        <Button type="submit" variant="primary" disabled={!query.trim()}><Search size={16} />Find</Button>
      </form>
      {outcome.kind === "idle" && (
        <p className="px-4 py-6 text-text-dim text-caption text-center">Search by name, or paste someone's address to open their profile.</p>
      )}
      {outcome.kind === "loading" && <ListState state="loading" loadingLabel="Looking…" empty="" />}
      {outcome.kind === "found" && outcome.pubkeys.length === 0 && (
        <ListState state="empty" empty="Nobody by that name." emptyHint="Try another spelling, or paste their address." />
      )}
      {outcome.kind === "found" && outcome.pubkeys.map((pubkey) => <FollowRow key={pubkey} pubkey={pubkey} />)}
      {outcome.kind === "unreachable" && <ListState state="unreachable" empty="" unreachable="No relay answered this search." onRetry={() => void find()} />}
      {outcome.kind === "error" && <ListState state="error" empty="" what="people" error={outcome.message} onRetry={() => void find()} />}
    </div>
  );
}
