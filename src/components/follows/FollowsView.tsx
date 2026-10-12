import { useEffect, useState } from "react";
import { useUIStore } from "../../stores/ui";
import { useUserStore } from "../../stores/user";
import { useNotificationsStore } from "../../stores/notifications";
import { fetchFollowers, ensureConnected } from "../../lib/nostr";
import { keepUnfollowedRows } from "../../lib/contacts";
import { dbLoadFollowers, dbSaveFollowers } from "../../lib/db";
import { ViewHeader } from "../shared/ViewHeader";
import { Tabs, tabPanelProps } from "../shared/Tabs";
import { FollowRow } from "./FollowRow";
import { ListState, followListState } from "../shared/ListState";
import { fetchMark, wentUnanswered } from "../../lib/listLoad";

/**
 * The people you follow. Someone unfollowed here keeps their row, now with a
 * Follow button, until the view is left. See `keepUnfollowedRows`.
 */
function FollowingRows({ follows, followers }: { follows: string[]; followers: Set<string> }) {
  const [rows, setRows] = useState(follows);
  useEffect(() => {
    setRows((shown) => keepUnfollowedRows(shown, follows));
  }, [follows]);
  return (
    <>
      {rows.map((pk) => (
        <FollowRow key={pk} pubkey={pk} followsYou={followers.has(pk)} />
      ))}
    </>
  );
}

export function FollowsView() {
  const { followsTab, setFollowsTab , viewStack, goBack } = useUIStore();
  const { pubkey, follows, followsStatus, fetchFollows } = useUserStore();
  // "New" is live: Notifications clears it once its Followers have been looked at. This view used to
  // clear it on mount from a snapshot, which a kept view (see "Back keeps your place") never takes again.
  const newFollowerPubkeys = useNotificationsStore((s) => s.newFollowerPubkeys);

  const [followers, setFollowers] = useState<string[]>([]);
  const [followersLoading, setFollowersLoading] = useState(false);
  const [followersError, setFollowersError] = useState<string | null>(null);
  const [followersFetched, setFollowersFetched] = useState(false);
  // The network did not answer the followers fetch: with none to show, "no followers" would be a guess.
  const [followersUnanswered, setFollowersUnanswered] = useState(false);
  const [followersReload, setFollowersReload] = useState(0);
  // Load followers: DB cache first (instant), then relay fetch to merge new ones
  useEffect(() => {
    if (!pubkey || followersFetched) return;
    let cancelled = false;
    setFollowersLoading(true);
    setFollowersError(null);
    setFollowersUnanswered(false);

    (async () => {
      try {
        // 1) Instant: load from SQLite cache
        const cached = await dbLoadFollowers(pubkey);
        if (!cancelled && cached.length > 0) {
          setFollowers(cached);
          setFollowersLoading(false); // show cached immediately
        }

        // 2) Background: fetch from relays and merge
        await ensureConnected();
        const mark = fetchMark();
        let result = await fetchFollowers(pubkey);
        if (result.length === 0 && !cancelled) {
          await new Promise((r) => setTimeout(r, 3000));
          if (cancelled) return;
          result = await fetchFollowers(pubkey);
        }
        if (!cancelled) {
          // Merge: union of cached + relay results (relay may return partial set)
          const merged = Array.from(new Set([...result, ...cached]));
          setFollowers(merged);
          setFollowersFetched(true);
          // Only read when there are no followers to show.
          setFollowersUnanswered(wentUnanswered(mark));
          // Persist merged set to DB
          if (result.length > 0) {
            dbSaveFollowers(merged, pubkey);
          }
        }
      } catch (err) {
        if (!cancelled && followers.length === 0) {
          setFollowersError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setFollowersLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [followsTab, pubkey, followersReload]);

  // Build followers set for "follows you" badge on Following tab
  const followersSet = new Set(followers);

  const tabs: Array<{ id: "followers" | "following"; label: string; count?: number }> = [
    // No "0" beside a list that could not be read.
    { id: "followers", label: "Followers", count: followersFetched && !(followers.length === 0 && followersUnanswered) ? followers.length : undefined },
    // An empty list that has not loaded proves nothing: no "0" until it has.
    { id: "following", label: "Following", count: followsStatus === "loaded" ? follows.length : undefined },
  ];

  return (
    <div className="h-full flex flex-col">
      {/* The account menu calls this view People, so the header does too; Back only when there is a way back. */}
      <ViewHeader title="People" onBack={viewStack.length > 0 ? goBack : undefined} />
      <Tabs label="People" panel="people-panel" tabs={tabs} value={followsTab} onChange={setFollowsTab} />

      {/* Content */}
      <div {...tabPanelProps("people-panel", followsTab)} className="flex-1 overflow-y-auto content-column">
        {followsTab === "followers" && (
          <>
            {followers.length === 0 && (followersLoading || followersError !== null || followersFetched) && (
              <ListState
                state={followersLoading ? "loading" : followersError !== null ? "error" : followersUnanswered ? "unreachable" : "empty"}
                loadingLabel="Loading followers…"
                empty="No followers yet."
                emptyHint="They'll appear here as people find you."
                what="your followers"
                error={followersError ?? undefined}
                onRetry={() => { setFollowersFetched(false); setFollowersReload((n) => n + 1); }}
              />
            )}
            {[...followers]
              .sort((a, b) => {
                const aNew = newFollowerPubkeys.has(a) ? 1 : 0;
                const bNew = newFollowerPubkeys.has(b) ? 1 : 0;
                return bNew - aNew; // new followers first
              })
              .map((pk) => (
              <FollowRow key={pk} pubkey={pk} isNew={newFollowerPubkeys.has(pk)} />
            ))}
          </>
        )}

        {followsTab === "following" && (
          <>
            {follows.length === 0 && (
              <ListState
                state={followListState(followsStatus)}
                loadingLabel="Loading the people you follow…"
                empty="You're not following anyone yet."
                emptyHint="Follow a few people and their notes make up your Following feed."
                what="the list of people you follow"
                onRetry={() => void fetchFollows()}
              />
            )}
            {/* Keyed by account: one account's kept rows must not outlive a switch or a sign-out. */}
            <FollowingRows key={pubkey ?? ""} follows={follows} followers={followersSet} />
          </>
        )}
      </div>
    </div>
  );
}
