import { memo } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { usePollVotes } from "../../hooks/usePollVotes";
import { useUserStore } from "../../stores/user";
import { publishPollResponse } from "../../lib/nostr";

interface PollOption {
  index: number;
  label: string;
}

function parsePollOptions(event: NDKEvent): PollOption[] {
  return event.tags
    .filter((t) => t[0] === "option" && t.length >= 3)
    .map((t) => ({ index: parseInt(t[1], 10), label: t[2] }))
    .filter((o) => !isNaN(o.index));
}

function getPollClosedAt(event: NDKEvent): number | null {
  const tag = event.tags.find((t) => t[0] === "closed_at");
  if (!tag?.[1]) return null;
  const ts = parseInt(tag[1], 10);
  return isNaN(ts) ? null : ts;
}

export const PollWidget = memo(function PollWidget({ event }: { event: NDKEvent }) {
  const options = parsePollOptions(event);
  const [pollData, addVote] = usePollVotes(event.id!);
  const loggedIn = useUserStore((s) => s.loggedIn);
  const myPubkey = useUserStore((s) => s.pubkey);

  if (options.length === 0) return null;

  const closedAt = getPollClosedAt(event);
  const now = Math.floor(Date.now() / 1000);
  const isExpired = closedAt !== null && closedAt <= now;
  const isAuthor = myPubkey === event.pubkey;
  const hasVoted = pollData?.myVote !== null && pollData?.myVote !== undefined;
  const showResults = hasVoted || isExpired || isAuthor || !loggedIn;
  const total = pollData?.total ?? 0;

  const handleVote = async (optionIndex: number) => {
    if (showResults || !loggedIn) return;
    addVote(optionIndex);
    try {
      await publishPollResponse(event.id!, event.pubkey, optionIndex);
    } catch {
      // Optimistic update already applied — relay failure is non-fatal
    }
  };

  return (
    <div className="mt-2 space-y-1.5" data-no-navigate>
      {options.map((opt) => {
        const count = pollData?.votes.get(opt.index) ?? 0;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const isMyVote = pollData?.myVote === opt.index;

        return (
          <button
            key={opt.index}
            onClick={() => handleVote(opt.index)}
            disabled={showResults}
            className={`
              relative w-full text-left px-3 py-2 rounded-sm overflow-hidden
              transition-colors duration-200
              ${showResults
                ? isMyVote
                  ? "border border-accent/60"
                  : "border border-border"
                : "border border-border hover:border-accent/50 cursor-pointer hover:bg-accent/5"
              }
              ${isExpired ? "opacity-60" : ""}
              disabled:cursor-default
            `}
          >
            {/* Fill bar — only shown in results mode */}
            {showResults && (
              <div
                className={`absolute inset-y-0 left-0 transition-all duration-500 ease-out ${
                  isMyVote ? "bg-accent/25" : "bg-accent/10"
                }`}
                style={{ width: `${pct}%` }}
              />
            )}

            <div className="relative flex items-center justify-between gap-2">
              <span className="text-text text-[12px] flex items-center gap-1.5">
                {showResults && isMyVote && (
                  <span className="text-accent text-[10px]" title="Your vote">&#10003;</span>
                )}
                {opt.label}
              </span>
              {showResults && (
                <span className="text-text-dim text-[11px] shrink-0 tabular-nums">
                  {pct}% <span className="text-[10px]">({count})</span>
                </span>
              )}
            </div>
          </button>
        );
      })}

      {/* Footer: vote count + expiry */}
      <div className="flex items-center gap-2 text-text-dim text-[10px] pt-0.5">
        {pollData ? (
          <span>{total} {total === 1 ? "vote" : "votes"}</span>
        ) : (
          <span className="animate-pulse">loading votes…</span>
        )}
        {isExpired && <span>&#183; Poll ended</span>}
        {closedAt && !isExpired && (
          <span>&#183; Ends {new Date(closedAt * 1000).toLocaleDateString()}</span>
        )}
        {!hasVoted && !isExpired && !isAuthor && loggedIn && total === 0 && pollData && (
          <span>&#183; Be the first to vote</span>
        )}
      </div>
    </div>
  );
});
