import { useEffect, useState } from "react";
import { useUIStore } from "../../stores/ui";
import { useUserStore } from "../../stores/user";
import { useNotificationsStore } from "../../stores/notifications";
import { useProfile } from "../../hooks/useProfile";
import { useNip05Verified } from "../../hooks/useNip05Verified";
import { fetchFollowers, ensureConnected } from "../../lib/nostr";
import { keepUnfollowedRows } from "../../lib/contacts";
import { dbLoadFollowers, dbSaveFollowers } from "../../lib/db";
import { shortenPubkey, profileName } from "../../lib/utils";
import { ViewHeader } from "../shared/ViewHeader";
import { Tabs, tabPanelProps } from "../shared/Tabs";
import { FollowButton } from "../shared/FollowButton";
import { ListState, followListState } from "../shared/ListState";
import { fetchMark, wentUnanswered } from "../../lib/listLoad";

function FollowRow({
  pubkey,
  followsYou,
  isNew,
}: {
  pubkey: string;
  followsYou?: boolean;
  isNew?: boolean;
}) {
  const profile = useProfile(pubkey);
  const name = profileName(profile, shortenPubkey(pubkey));
  const avatar = typeof profile?.picture === "string" ? profile.picture : undefined;
  const nip05 = typeof profile?.nip05 === "string" ? profile.nip05 : undefined;
  const verified = useNip05Verified(pubkey, nip05);

  const { openProfile } = useUIStore();

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg-hover transition-colors">
      <button className="shrink-0" onClick={() => openProfile(pubkey)}>
        {avatar ? (
          <img
            src={avatar}
            alt={`${name}'s avatar`}
            className="w-9 h-9 rounded-full object-cover bg-bg-raised hover:opacity-80 transition-opacity"
            loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="w-9 h-9 rounded-full bg-bg-raised border border-border flex items-center justify-center text-text-dim text-xs hover:border-accent/40 transition-colors">
            {name.charAt(0).toUpperCase()}
          </div>
        )}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <button
            onClick={() => openProfile(pubkey)}
            className="text-text font-medium truncate text-body hover:text-accent transition-colors text-left"
          >
            {name}
          </button>
          {nip05 && (
            <span className={`text-caption truncate max-w-40 ${verified === "valid" ? "text-success" : "text-text-dim"}`}>
              {verified === "valid" ? "✓ " : ""}{nip05}
            </span>
          )}
          {followsYou && (
            <span className="text-micro text-text-dim bg-bg-raised px-1.5 py-0.5 rounded-sm">follows you</span>
          )}
          {isNew && (
            <span className="text-micro text-accent bg-accent/15 px-1.5 py-0.5 rounded-sm font-medium">new</span>
          )}
        </div>
      </div>

      <FollowButton pubkey={pubkey} />
    </div>
  );
}

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
  const { followsTab, setFollowsTab } = useUIStore();
  const { pubkey, follows, followsStatus, fetchFollows } = useUserStore();
  const { newFollowerPubkeys, clearNewFollowers } = useNotificationsStore();

  const [followers, setFollowers] = useState<string[]>([]);
  const [followersLoading, setFollowersLoading] = useState(false);
  const [followersError, setFollowersError] = useState<string | null>(null);
  const [followersFetched, setFollowersFetched] = useState(false);
  // The network did not answer the followers fetch: with none to show, "no followers" would be a guess.
  const [followersUnanswered, setFollowersUnanswered] = useState(false);
  const [followersReload, setFollowersReload] = useState(0);
  // Snapshot new follower pubkeys on mount, before clearing
  const [newPubkeys] = useState(() => new Set(newFollowerPubkeys));

  // Clear badge when view opens
  useEffect(() => {
    clearNewFollowers();
  }, []);

  // Load followers: DB cache first (instant), then relay fetch to merge new ones
  useEffect(() => {
    if (followsTab !== "followers" || !pubkey || followersFetched) return;
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
      {/* The sidebar calls this view People, so the header does too. */}
      <ViewHeader title="People" />
      <Tabs label="People" panel="people-panel" tabs={tabs} value={followsTab} onChange={setFollowsTab} />

      {/* Content */}
      <div {...tabPanelProps("people-panel", followsTab)} className="flex-1 overflow-y-auto content-column">
        {followsTab === "followers" && (
          <>
            {followers.length === 0 && (followersLoading || followersError !== null || followersFetched) && (
              <ListState
                state={followersLoading ? "loading" : followersError !== null ? "error" : followersUnanswered ? "unreachable" : "empty"}
                loadingLabel="Loading followers…"
                empty="No followers found yet."
                what="your followers"
                error={followersError ?? undefined}
                onRetry={() => { setFollowersFetched(false); setFollowersReload((n) => n + 1); }}
              />
            )}
            {[...followers]
              .sort((a, b) => {
                const aNew = newPubkeys.has(a) ? 1 : 0;
                const bNew = newPubkeys.has(b) ? 1 : 0;
                return bNew - aNew; // new followers first
              })
              .map((pk) => (
              <FollowRow key={pk} pubkey={pk} isNew={newPubkeys.has(pk)} />
            ))}
          </>
        )}

        {followsTab === "following" && (
          <>
            {follows.length === 0 && (
              <ListState
                state={followListState(followsStatus)}
                loadingLabel="Loading the people you follow…"
                empty="Not following anyone yet."
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
