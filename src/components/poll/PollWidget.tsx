import { memo } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { usePollVotes, usePendingVote, beginVote, endVote, takesTheVote } from "../../hooks/usePollVotes";
import { useUserStore, useCanSign } from "../../stores/user";
import { publishPollResponse } from "../../lib/nostr";
import { tellPublish } from "../../lib/publishFeedback";
import { withinTime } from "../../lib/timeLimit";
import { currentAccount, stillAccount } from "../../lib/currentAccount";

/** How long a vote may be on its way before it is given up on. */
const VOTE_LIMIT_MS = 20000;

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
  const canSign = useCanSign();
  const myPubkey = useUserStore((s) => s.pubkey);
  // Every hook is above this line. A hook below an early return throws
  // ("rendered more hooks") the first time the same card goes from a note
  // with no options to one with some.
  const pending = usePendingVote(event.id!);

  if (options.length === 0) return null;

  const closedAt = getPollClosedAt(event);
  const now = Math.floor(Date.now() / 1000);
  const isExpired = closedAt !== null && closedAt <= now;
  const isAuthor = myPubkey === event.pubkey;
  const hasVoted = pollData?.myVote !== null && pollData?.myVote !== undefined;
  const showResults = hasVoted || isExpired || isAuthor || !canSign;
  const total = pollData?.total ?? 0;

  const handleVote = async (optionIndex: number) => {
    if (showResults || !canSign) return;
    const pollId = event.id!;
    const turn = beginVote(pollId, optionIndex);
    if (turn === null) return;
    const me = currentAccount();
    const sent = publishPollResponse(pollId, event.pubkey, optionIndex);
    // Counted on screen once it has gone out, not before. The vote used to be
    // shown as cast at once and stayed that way when no relay took it: the
    // poll then showed results, so it could not even be tried again. While it
    // is on its way the chosen option says so. A signer that never answers
    // must not leave the poll dead: after twenty seconds it is given up on.
    const told = await tellPublish(
      () => withinTime(sent, VOTE_LIMIT_MS, "no answer after 20 seconds"),
      { kept: "Your vote was not counted.", verb: "send your vote" },
    );
    endVote(pollId);
    // Under another account by now, it is not that account's vote to show.
    // And not if a vote cast after this one is showing: the relays count the
    // newest, whichever of the two went out first.
    const count = () => { if (stillAccount(me) && takesTheVote(pollId, turn)) addVote(optionIndex); };
    if (told.ok) count();
    // Given up on, and it went out after all (a remote signer approved late):
    // the relays have the vote, so the poll must not go on offering it.
    else sent.then(count, () => {});
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
            // Not `disabled` while a vote is on its way: that drops keyboard focus to the page.
            aria-disabled={pending !== null || undefined}
            aria-busy={pending === opt.index || undefined}
            className={`
              ${pending !== null && pending !== opt.index ? "opacity-50" : ""}
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
              <span className="text-text text-body flex items-center gap-1.5">
                {showResults && isMyVote && (
                  <span className="text-accent text-[10px]" title="Your vote">&#10003;</span>
                )}
                {opt.label}
              </span>
              {showResults && (
                <span className="text-text-dim text-caption shrink-0 tabular-nums">
                  {pct}% <span className="text-caption">({count})</span>
                </span>
              )}
              {pending === opt.index && <span className="text-text-muted text-caption shrink-0">Sending…</span>}
            </div>
          </button>
        );
      })}

      {/* Footer: vote count + expiry */}
      <div className="flex items-center gap-2 text-text-dim text-caption pt-0.5">
        {pollData ? (
          <span>{total} {total === 1 ? "vote" : "votes"}</span>
        ) : (
          <span className="animate-pulse">loading votes…</span>
        )}
        {isExpired && <span>&#183; Poll ended</span>}
        {closedAt && !isExpired && (
          <span>&#183; Ends {new Date(closedAt * 1000).toLocaleDateString()}</span>
        )}
        {!hasVoted && !isExpired && !isAuthor && canSign && total === 0 && pollData && (
          <span>&#183; Be the first to vote</span>
        )}
      </div>
    </div>
  );
});
