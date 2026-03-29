import { useEffect, useState } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useUIStore } from "../../stores/ui";
import { useUserStore } from "../../stores/user";
import { useMuteStore } from "../../stores/mute";
import { useProfile } from "../../hooks/useProfile";
import { useReputation } from "../../hooks/useReputation";
import { fetchUserNotesNIP65, fetchAuthorArticles, getNDK } from "../../lib/nostr";
import { shortenPubkey } from "../../lib/utils";
import { NoteCard } from "../feed/NoteCard";
import { ArticleCard } from "../article/ArticleCard";
import { ZapModal } from "../zap/ZapModal";
import { ImageLightbox } from "../shared/ImageLightbox";
import { EditProfileForm } from "./EditProfileForm";
import { ProfileMediaGallery } from "./ProfileMediaGallery";

function TopFollowerAvatar({ pubkey }: { pubkey: string }) {
  const profile = useProfile(pubkey);
  const { openProfile } = useUIStore();
  const name = profile?.displayName || profile?.name || pubkey.slice(0, 8) + "…";

  return (
    <button
      onClick={() => openProfile(pubkey)}
      className="flex items-center gap-1.5 shrink-0 hover:opacity-80 transition-opacity"
      title={name}
    >
      {profile?.picture ? (
        <img
          src={profile.picture}
          alt=""
          className="w-5 h-5 rounded-sm object-cover bg-bg-raised"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      ) : (
        <div className="w-5 h-5 rounded-sm bg-bg-raised border border-border flex items-center justify-center text-[8px] text-text-dim">
          {name.charAt(0).toUpperCase()}
        </div>
      )}
      <span className="text-[10px] text-text-dim">{name}</span>
    </button>
  );
}

export function ProfileView() {
  const { selectedPubkey, goBack, openDM } = useUIStore();
  const { pubkey: ownPubkey, profile: ownProfile, loggedIn, follows, follow, unfollow } = useUserStore();
  const pubkey = selectedPubkey!;
  const isOwn = pubkey === ownPubkey;

  // For own profile, use the user store directly — it's updated immediately
  // after save. useProfile() only re-fetches when pubkey changes, so it would
  // show stale data until the user navigates away and back.
  const fetchedProfile = useProfile(pubkey);
  const profile = isOwn ? ownProfile : fetchedProfile;
  const [notes, setNotes] = useState<NDKEvent[]>([]);
  const [articles, setArticles] = useState<NDKEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [articlesLoading, setArticlesLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [followPending, setFollowPending] = useState(false);
  const [showZap, setShowZap] = useState(false);
  const [profileTab, setProfileTab] = useState<"notes" | "articles" | "media">("notes");
  const [bannerLightbox, setBannerLightbox] = useState(false);
  const [bannerLoaded, setBannerLoaded] = useState(false);
  const [bannerError, setBannerError] = useState(false);
  const [wotExpanded, setWotExpanded] = useState(false);

  const isFollowing = follows.includes(pubkey);
  const { mutedPubkeys, mute, unmute } = useMuteStore();
  const isMuted = mutedPubkeys.includes(pubkey);
  const reputation = useReputation(pubkey);

  const handleFollowToggle = async () => {
    setFollowPending(true);
    try {
      if (isFollowing) {
        await unfollow(pubkey);
      } else {
        await follow(pubkey);
      }
    } finally {
      setFollowPending(false);
    }
  };

  const name = profile?.displayName || profile?.name || shortenPubkey(pubkey);
  const avatar = profile?.picture;
  const about = profile?.about;
  const nip05 = profile?.nip05;
  const website = profile?.website;
  const lud16 = profile?.lud16;

  useEffect(() => {
    setLoading(true);
    setProfileTab("notes");
    setBannerLoaded(false);
    setBannerError(false);
    setWotExpanded(false);
    fetchUserNotesNIP65(pubkey).then((events) => {
      setNotes(events);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [pubkey]);

  useEffect(() => {
    if (profileTab !== "articles" || articles.length > 0) return;
    setArticlesLoading(true);
    fetchAuthorArticles(pubkey).then(setArticles).catch(() => setArticles([])).finally(() => setArticlesLoading(false));
  }, [profileTab, pubkey]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-4 py-2.5 flex flex-wrap items-center justify-between gap-y-1 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={editing ? () => setEditing(false) : goBack}
            className="text-text-dim hover:text-text text-[11px] transition-colors"
          >
            ← {editing ? "cancel" : "back"}
          </button>
          <h1 className="text-text text-sm font-medium">{isOwn ? "Your Profile" : "Profile"}</h1>
          {isOwn && !getNDK().signer && (
            <span className="text-text-dim text-[10px] border border-border px-2 py-0.5">
              read-only
            </span>
          )}
        </div>
        {isOwn && !editing && !!getNDK().signer && (
          <button
            onClick={() => setEditing(true)}
            className="text-[11px] px-3 py-1 border border-border text-text-muted hover:text-accent hover:border-accent/40 transition-colors"
          >
            edit profile
          </button>
        )}
        {!isOwn && loggedIn && (
          <div className="flex flex-wrap items-center gap-2">
            {(lud16 || profile?.lud06) && (
              <button
                onClick={() => setShowZap(true)}
                className="text-[11px] px-3 py-1 border border-border text-zap hover:border-zap/40 hover:bg-zap/5 transition-colors"
              >
                ⚡ zap
              </button>
            )}
            <button
              onClick={handleFollowToggle}
              disabled={followPending}
              className={`text-[11px] px-3 py-1 border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                isFollowing
                  ? "border-border text-text-muted hover:text-danger hover:border-danger/40"
                  : "border-accent/60 text-accent hover:bg-accent hover:text-white"
              }`}
            >
              {followPending ? "…" : isFollowing ? "unfollow" : "follow"}
            </button>
            <button
              onClick={() => isMuted ? unmute(pubkey) : mute(pubkey)}
              className={`text-[11px] px-3 py-1 border transition-colors ${
                isMuted
                  ? "border-danger/40 text-danger hover:bg-danger/5"
                  : "border-border text-text-dim hover:text-danger hover:border-danger/40"
              }`}
            >
              {isMuted ? "unmute" : "mute"}
            </button>
            <button
              onClick={() => openDM(pubkey)}
              className="text-[11px] px-3 py-1 border border-border text-text-muted hover:text-accent hover:border-accent/40 transition-colors"
            >
              ✉ message
            </button>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        {/* Edit form */}
        {editing && (
          <EditProfileForm pubkey={pubkey} onSaved={() => setEditing(false)} />
        )}

        {/* Profile card */}
        {!editing && (
          <div className="border-b border-border">
            {/* Banner */}
            {profile?.banner && !bannerError ? (
              <div className="relative h-44 bg-bg-raised overflow-hidden">
                {!bannerLoaded && (
                  <div className="absolute inset-0 bg-bg-raised animate-pulse" />
                )}
                <img
                  src={profile.banner}
                  alt=""
                  className="w-full h-full object-cover object-[center_30%] cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => setBannerLightbox(true)}
                  onLoad={() => setBannerLoaded(true)}
                  onError={() => setBannerError(true)}
                />
              </div>
            ) : null}

            {/* Avatar + info */}
            <div className="px-4 py-4 flex gap-4 items-start">
              <div className="shrink-0" style={{ width: 64, height: 64 }}>
                {avatar ? (
                  <img
                    src={avatar}
                    alt=""
                    style={{ width: 64, height: 64 }}
                    className="rounded-sm object-cover bg-bg-raised"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <div
                    style={{ width: 64, height: 64 }}
                    className="rounded-sm bg-bg-raised border border-border flex items-center justify-center text-text-dim text-lg"
                  >
                    {name.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="text-text font-medium text-[15px]">{name}</div>
                {nip05 && <div className="text-text-dim text-[11px] mt-0.5">{nip05}</div>}
                {lud16 && <div className="text-zap text-[11px] mt-0.5">⚡ {lud16}</div>}
                {website && (
                  <a href={website} target="_blank" rel="noopener noreferrer" className="text-accent text-[11px] hover:text-accent-hover mt-0.5 block">
                    {website.replace(/^https?:\/\//, "")}
                  </a>
                )}
                {about && <p className="text-text text-[12px] mt-2 leading-relaxed whitespace-pre-wrap">{about}</p>}
                {isOwn && !about && (
                  <p className="text-text-dim text-[12px] mt-2 italic">No bio yet — click "edit profile" to add one.</p>
                )}
                <div className="text-text-dim text-[10px] font-mono mt-2">{shortenPubkey(pubkey)}</div>
              </div>
            </div>

            {/* Web of Trust — powered by Vertex */}
            {(() => {
              const wotFollowers = reputation.data?.topFollowers.filter((f) => f.pubkey !== pubkey) ?? [];
              if (wotFollowers.length === 0) return null;
              return (
                <div className="px-4 pb-3">
                  <div className="text-[10px] text-text-dim mb-1.5">Followed by people you trust</div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    {(wotExpanded ? wotFollowers : wotFollowers.slice(0, 5)).map((f) => (
                      <TopFollowerAvatar key={f.pubkey} pubkey={f.pubkey} />
                    ))}
                    {wotFollowers.length > 5 && !wotExpanded && (
                      <button
                        onClick={() => setWotExpanded(true)}
                        className="text-[10px] text-accent hover:text-accent-hover transition-colors"
                      >
                        +{wotFollowers.length - 5} more
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}
            {reputation.loading && (
              <div className="px-4 pb-3">
                <div className="h-3 w-32 bg-bg-raised animate-pulse rounded-sm" />
              </div>
            )}
          </div>
        )}

        {bannerLightbox && profile?.banner && (
          <ImageLightbox
            images={[profile.banner]}
            index={0}
            onClose={() => setBannerLightbox(false)}
            onNavigate={() => {}}
          />
        )}

        {showZap && (
          <ZapModal
            target={{ type: "profile", pubkey }}
            recipientName={name}
            onClose={() => setShowZap(false)}
          />
        )}

        {/* Notes / Articles / Media tabs */}
        <div className="border-b border-border flex shrink-0">
          {(["notes", "articles", "media"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setProfileTab(t)}
              className={`px-4 py-2 text-[11px] border-b-2 transition-colors ${
                profileTab === t
                  ? "border-accent text-accent"
                  : "border-transparent text-text-dim hover:text-text"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {profileTab === "notes" && (
          <>
            {loading && <div className="px-4 py-8 text-text-dim text-[12px] text-center">Loading notes…</div>}
            {!loading && notes.length === 0 && <div className="px-4 py-8 text-text-dim text-[12px] text-center">No notes found.</div>}
            {notes.map((event) => (
              <NoteCard key={event.id} event={event} />
            ))}
          </>
        )}

        {profileTab === "articles" && (
          <>
            {articlesLoading && <div className="px-4 py-8 text-text-dim text-[12px] text-center">Loading articles…</div>}
            {!articlesLoading && articles.length === 0 && <div className="px-4 py-8 text-text-dim text-[12px] text-center">No articles found.</div>}
            {articles.map((event) => (
              <ArticleCard key={event.id} event={event} />
            ))}
          </>
        )}

        {profileTab === "media" && (
          <ProfileMediaGallery notes={notes} loading={loading} />
        )}
      </div>
    </div>
  );
}
