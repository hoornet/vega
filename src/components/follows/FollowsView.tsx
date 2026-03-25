import { useEffect, useState } from "react";
import { useUIStore } from "../../stores/ui";
import { useUserStore } from "../../stores/user";
import { useNotificationsStore } from "../../stores/notifications";
import { useProfile } from "../../hooks/useProfile";
import { useNip05Verified } from "../../hooks/useNip05Verified";
import { fetchFollowers, ensureConnected } from "../../lib/nostr";
import { shortenPubkey } from "../../lib/utils";

function FollowRow({
  pubkey,
  followsYou,
}: {
  pubkey: string;
  followsYou?: boolean;
}) {
  const profile = useProfile(pubkey);
  const name = profile?.displayName || profile?.name || shortenPubkey(pubkey);
  const avatar = profile?.picture;
  const nip05 = profile?.nip05;
  const verified = useNip05Verified(pubkey, nip05);

  const { follows, follow, unfollow, pubkey: ownPubkey } = useUserStore();
  const { openProfile } = useUIStore();
  const isFollowing = follows.includes(pubkey);
  const isSelf = pubkey === ownPubkey;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg-hover transition-colors">
      <button className="shrink-0" onClick={() => openProfile(pubkey)}>
        {avatar ? (
          <img
            src={avatar}
            alt=""
            className="w-9 h-9 rounded-sm object-cover bg-bg-raised hover:opacity-80 transition-opacity"
            loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="w-9 h-9 rounded-sm bg-bg-raised border border-border flex items-center justify-center text-text-dim text-xs hover:border-accent/40 transition-colors">
            {name.charAt(0).toUpperCase()}
          </div>
        )}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <button
            onClick={() => openProfile(pubkey)}
            className="text-text font-medium truncate text-[13px] hover:text-accent transition-colors text-left"
          >
            {name}
          </button>
          {nip05 && (
            <span className={`text-[10px] truncate max-w-40 ${verified === "valid" ? "text-success" : "text-text-dim"}`}>
              {verified === "valid" ? "✓ " : ""}{nip05}
            </span>
          )}
          {followsYou && (
            <span className="text-[9px] text-text-dim bg-bg-raised px-1.5 py-0.5 rounded-sm">follows you</span>
          )}
        </div>
      </div>

      {!isSelf && (
        <button
          onClick={() => isFollowing ? unfollow(pubkey) : follow(pubkey)}
          className={`shrink-0 px-3 py-1 text-[11px] transition-colors ${
            isFollowing
              ? "text-text-dim border border-border hover:text-danger hover:border-danger"
              : "bg-accent hover:bg-accent-hover text-white"
          }`}
        >
          {isFollowing ? "unfollow" : "follow"}
        </button>
      )}
    </div>
  );
}

export function FollowsView() {
  const { followsTab, setFollowsTab } = useUIStore();
  const { pubkey, follows } = useUserStore();
  const { clearNewFollowers } = useNotificationsStore();

  const [followers, setFollowers] = useState<string[]>([]);
  const [followersLoading, setFollowersLoading] = useState(false);
  const [followersError, setFollowersError] = useState<string | null>(null);
  const [followersFetched, setFollowersFetched] = useState(false);

  // Clear badge when view opens
  useEffect(() => {
    clearNewFollowers();
  }, []);

  // Fetch followers when tab is selected
  useEffect(() => {
    if (followsTab !== "followers" || !pubkey || followersFetched) return;
    let cancelled = false;
    setFollowersLoading(true);
    setFollowersError(null);

    (async () => {
      try {
        await ensureConnected();
        const result = await fetchFollowers(pubkey);
        if (!cancelled) {
          setFollowers(result);
          setFollowersFetched(true);
        }
      } catch (err) {
        if (!cancelled) setFollowersError(`Failed to load followers: ${err}`);
      } finally {
        if (!cancelled) setFollowersLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [followsTab, pubkey]);

  // Build followers set for "follows you" badge on Following tab
  const followersSet = new Set(followers);

  const tabs: Array<{ id: "followers" | "following"; label: string; count?: number }> = [
    { id: "followers", label: "followers", count: followersFetched ? followers.length : undefined },
    { id: "following", label: "following", count: follows.length },
  ];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b border-border px-4 py-2.5 flex items-center gap-4 shrink-0">
        <span className="text-text font-medium text-[13px]">follows</span>
        <div className="flex gap-3 ml-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setFollowsTab(t.id)}
              className={`text-[12px] transition-colors flex items-center gap-1 ${
                followsTab === t.id
                  ? "text-accent border-b border-accent pb-0.5"
                  : "text-text-dim hover:text-text"
              }`}
            >
              {t.label}
              {t.count !== undefined && (
                <span className="text-[10px] text-text-dim">({t.count})</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {followsTab === "followers" && (
          <>
            {followersLoading && (
              <div className="px-4 py-8 text-center text-text-dim text-[12px]">
                <span className="inline-flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  Loading followers…
                </span>
              </div>
            )}
            {followersError && (
              <p className="px-4 py-4 text-danger text-[12px]">{followersError}</p>
            )}
            {!followersLoading && !followersError && followers.length === 0 && followersFetched && (
              <p className="px-4 py-8 text-text-dim text-[12px] text-center">No followers found yet.</p>
            )}
            {followers.map((pk) => (
              <FollowRow key={pk} pubkey={pk} />
            ))}
          </>
        )}

        {followsTab === "following" && (
          <>
            {follows.length === 0 && (
              <p className="px-4 py-8 text-text-dim text-[12px] text-center">Not following anyone yet.</p>
            )}
            {follows.map((pk) => (
              <FollowRow key={pk} pubkey={pk} followsYou={followersSet.has(pk)} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
