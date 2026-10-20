import { useEffect, useState, type ReactNode } from "react";
import { useStartingPeople } from "../../hooks/useStartingPeople";
import { useDismissedSuggestionsStore } from "../../stores/dismissedSuggestions";
import { useCanSign, useUserStore } from "../../stores/user";
import { useMuteStore } from "../../stores/mute";
import { FollowRow } from "../follows/FollowRow";

// The list an account that follows nobody is offered, in the Following tab,
// in People and under Search's "Discover people". Whom it holds is decided
// in `useStartingPeople`.

export function PeopleToStartWith({ heading = true, fallback = null }: { heading?: boolean; fallback?: ReactNode }) {
  const canSign = useCanSign();
  const { pubkeys, status } = useStartingPeople();
  const dismiss = useDismissedSuggestionsStore((s) => s.dismiss);
  // Someone followed from the list keeps their row, now reading "Following":
  // a row that vanished on a press put the next person's Follow button under
  // the pointer. Someone dismissed goes at once, as asked.
  const [shown, setShown] = useState<string[]>([]);
  const offered = pubkeys.join(",");
  useEffect(() => {
    setShown((prev) => prev.concat(pubkeys.filter((pk) => !prev.includes(pk))));
  }, [offered]);
  const dismissed = useDismissedSuggestionsStore((s) => s.dismissedPubkeys);
  const muted = useMuteStore((s) => s.mutedPubkeys);
  const own = useUserStore((s) => s.pubkey);
  // Worked out here, not from `shown` alone: the first render with people has
  // not run the effect yet, and would paint the heading over nothing.
  const rows = shown.concat(pubkeys.filter((pk) => !shown.includes(pk))).filter((pk) => !dismissed.includes(pk) && !muted.includes(pk) && pk !== own);
  // Read-only accounts cannot follow, so there is nothing to offer them.
  if (!canSign) return null;
  // Nobody to offer: the list around this one has already said what it can.
  if (status === "none" && rows.length === 0) return <>{fallback}</>;
  return (
    <section aria-label="People to start with" className="w-full text-left">
      {heading && (
        <div className="px-4 py-2.5 border-b border-border-subtle">
          <h2 className="text-text text-body font-medium">People to start with</h2>
          <p className="text-text-dim text-caption mt-0.5">Posting lately. Follow a few and your Following feed fills up.</p>
        </div>
      )}
      {status === "loading" && rows.length === 0 && (
        <p role="status" className="px-4 py-6 text-text-muted text-caption text-center">Finding people…</p>
      )}
      {rows.map((pubkey) => (
        <FollowRow key={pubkey} pubkey={pubkey} onDismiss={() => dismiss(pubkey)} />
      ))}
    </section>
  );
}
