import { useEffect, useMemo, useState } from "react";
import { NDKEvent, nip19 } from "@nostr-dev-kit/ndk";
import { useUIStore } from "../../stores/ui";
import { useUserStore, useCanSign } from "../../stores/user";
import { useMuteStore } from "../../stores/mute";
import { useProfile } from "../../hooks/useProfile";
import { useReputation } from "../../hooks/useReputation";
import { fetchUserNotesNIP65, fetchAuthorArticles } from "../../lib/nostr";
import { shortenPubkey, profileName } from "../../lib/utils";
import { NoteCard } from "../feed/NoteCard";
import { ArticleCard } from "../article/ArticleCard";
import { ZapModal } from "../zap/ZapModal";
import { ImageLightbox } from "../shared/ImageLightbox";
import { EditProfileForm } from "./EditProfileForm";
import { parseContent } from "../../lib/parsing";
import { tryHandleUrlInternally, tryOpenNostrEntity } from "../feed/TextSegments";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ProfileMediaGallery } from "./ProfileMediaGallery";
import { ViewHeader } from "../shared/ViewHeader";
import { Tabs, tabPanelProps } from "../shared/Tabs";
import { Button } from "../shared/Button";
import { FollowButton } from "../shared/FollowButton";
import { Mail, VolumeX, Zap } from "lucide-react";

function TopFollowerAvatar({ pubkey }: { pubkey: string }) {
  const profile = useProfile(pubkey);
  const { openProfile } = useUIStore();
  const name = profileName(profile, pubkey.slice(0, 8) + "…");

  return (
    <button
      onClick={() => openProfile(pubkey)}
      className="flex items-center gap-1.5 shrink-0 hover:opacity-80 transition-opacity"
      title={name}
    >
      {profile?.picture ? (
        <img
          src={profile.picture}
          alt={`${name}'s avatar`}
          className="w-5 h-5 rounded-full object-cover bg-bg-raised"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      ) : (
        <div className="w-5 h-5 rounded-full bg-bg-raised border border-border flex items-center justify-center text-[8px] text-text-dim">
          {name.charAt(0).toUpperCase()}
        </div>
      )}
      <span className="text-caption text-text-dim">{name}</span>
    </button>
  );
}

export function ProfileView() {
  const { selectedPubkey, goBack, openDM } = useUIStore();
  const canSign = useCanSign();
  const { pubkey: ownPubkey, profile: ownProfile } = useUserStore();
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
  const [showZap, setShowZap] = useState(false);
  const [profileTab, setProfileTab] = useState<"notes" | "articles" | "media">("notes");
  const [bannerLightbox, setBannerLightbox] = useState(false);
  const [bannerLoaded, setBannerLoaded] = useState(false);
  const [bannerError, setBannerError] = useState(false);
  const [wotExpanded, setWotExpanded] = useState(false);
  const [npubCopied, setNpubCopied] = useState(false);

  const { mutedPubkeys, mute, unmute } = useMuteStore();
  const isMuted = mutedPubkeys.includes(pubkey);
  const reputation = useReputation(pubkey);

  const name = profileName(profile, shortenPubkey(pubkey));
  const avatar = typeof profile?.picture === "string" ? profile.picture : undefined;
  const about = typeof profile?.about === "string" ? profile.about : undefined;
  const aboutSegments = useMemo(() => about ? parseContent(about) : [], [about]);
  const nip05 = typeof profile?.nip05 === "string" ? profile.nip05 : undefined;
  const website = typeof profile?.website === "string" ? profile.website : undefined;
  const lud16 = typeof profile?.lud16 === "string" ? profile.lud16 : undefined;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setProfileTab("notes");
    // Someone else's profile opened from inside the edit form (a mention in
    // the notes under it) must not open titled "Edit profile".
    setEditing(false);
    setBannerLoaded(false);
    setBannerError(false);
    setWotExpanded(false);
    fetchUserNotesNIP65(pubkey).then(async (events) => {
      if (cancelled) return;
      if (events.length === 0) {
        // Relays may not be ready yet — retry once after a short delay
        await new Promise((r) => setTimeout(r, 3000));
        if (cancelled) return;
        events = await fetchUserNotesNIP65(pubkey);
      }
      if (!cancelled) {
        setNotes(events);
        setLoading(false);
      }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pubkey]);

  useEffect(() => {
    if (profileTab !== "articles" || articles.length > 0) return;
    let cancelled = false;
    setArticlesLoading(true);
    (async () => {
      let result = await fetchAuthorArticles(pubkey).catch(() => [] as typeof articles);
      if (result.length === 0 && !cancelled) {
        await new Promise((r) => setTimeout(r, 3000));
        if (cancelled) return;
        result = await fetchAuthorArticles(pubkey).catch(() => [] as typeof articles);
      }
      if (!cancelled) {
        setArticles(result);
        setArticlesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [profileTab, pubkey]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <ViewHeader
        title={editing ? "Edit profile" : isOwn ? "Your Profile" : "Profile"}
        onBack={editing ? undefined : goBack}
        meta={isOwn && !canSign ? (
          <span className="border border-border px-2 py-0.5 rounded-sm">read-only</span>
        ) : undefined}
        actions={
          <>
            {editing && (
              <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            )}
            {isOwn && !editing && canSign && (
              <Button onClick={() => setEditing(true)}>Edit profile</Button>
            )}
            {!isOwn && canSign && (
              <>
              {isMuted ? (
                <Button onClick={() => unmute(pubkey)}><VolumeX className="text-danger" />Unmute</Button>
              ) : (
                <Button variant="ghost" tone="danger" onClick={() => mute(pubkey)}>Mute</Button>
              )}
              {(lud16 || profile?.lud06) && (
                <Button onClick={() => setShowZap(true)}><Zap className="text-zap" />Zap</Button>
              )}
              <Button onClick={() => openDM(pubkey)}><Mail />Message</Button>
              <FollowButton pubkey={pubkey} />
              </>
            )}
          </>
        }
      />

      <div className="flex-1 overflow-y-auto content-column">
        {/* Edit form */}
        {editing && (
          <EditProfileForm pubkey={pubkey} onSaved={() => setEditing(false)} />
        )}

        {/* Profile card */}
        {!editing && (
          <div className="border-b border-border-subtle">
            {/* Banner */}
            {profile?.banner && !bannerError ? (
              <div className="relative h-44 bg-bg-raised overflow-hidden">
                {!bannerLoaded && (
                  <div className="absolute inset-0 bg-bg-raised animate-pulse" />
                )}
                <img
                  src={profile.banner}
                  alt={`${name}'s banner`}
                  className="w-full h-full object-cover object-[center_30%] cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => setBannerLightbox(true)}
                  onLoad={() => setBannerLoaded(true)}
                  onError={() => setBannerError(true)}
                />
              </div>
            ) : null}

            {/* Avatar + info */}
            <div className="px-4 py-4 flex gap-4 items-start">
              <div className="shrink-0 w-16 h-16">
                {avatar ? (
                  <img
                    src={avatar}
                    alt={`${name}'s avatar`}
                    className="w-16 h-16 rounded-full object-cover bg-bg-raised"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <div
                    className="w-16 h-16 rounded-full bg-bg-raised border border-border flex items-center justify-center text-text-dim text-lg"
                  >
                    {name.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="text-text font-semibold text-heading">{name}</div>
                {nip05 && <div className="text-text-dim text-caption mt-0.5">{nip05}</div>}
                {lud16 && <div className="text-zap text-caption mt-0.5">⚡ {lud16}</div>}
                {website && (
                  <a href={website} target="_blank" rel="noopener noreferrer" className="text-accent text-caption hover:text-accent-hover mt-0.5 block">
                    {website.replace(/^https?:\/\//, "")}
                  </a>
                )}
                {about && (
                  <p className="text-text text-body mt-2 leading-relaxed whitespace-pre-wrap break-words">
                    {aboutSegments.map((seg, i) => {
                      if (seg.type === "link") return (
                        <a key={i} className="text-accent hover:text-accent-hover underline underline-offset-2 decoration-accent/40"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (!tryHandleUrlInternally(seg.value)) openUrl(seg.value).catch(() => {}); }}>
                          {seg.display || seg.value}
                        </a>
                      );
                      if (seg.type === "mention" || seg.type === "naddr") return (
                        <span key={i} className="text-accent hover:text-accent-hover cursor-pointer"
                          onClick={(e) => { e.stopPropagation(); tryOpenNostrEntity(seg.value); }}>
                          {seg.type === "mention" ? "@" : "🔗 "}{String(seg.display ?? seg.value).slice(0, 20)}…
                        </span>
                      );
                      if (seg.type === "hashtag") return (
                        <span key={i} className="text-accent/80 cursor-pointer hover:text-accent"
                          onClick={(e) => { e.stopPropagation(); useUIStore.getState().openHashtag?.(seg.value); }}>
                          {String(seg.display ?? seg.value)}
                        </span>
                      );
                      return <span key={i}>{seg.value}</span>;
                    })}
                  </p>
                )}
                {isOwn && !about && (
                  <p className="text-text-dim text-body mt-2 italic">No bio yet — click "edit profile" to add one.</p>
                )}
                <button
                  onClick={() => {
                    const npub = nip19.npubEncode(pubkey);
                    navigator.clipboard.writeText(npub);
                    setNpubCopied(true);
                    setTimeout(() => setNpubCopied(false), 2000);
                  }}
                  className="text-text-dim text-caption font-mono mt-2 hover:text-accent transition-colors cursor-pointer"
                  title="Copy npub to clipboard"
                >
                  {npubCopied ? "copied!" : shortenPubkey(pubkey)}
                </button>
              </div>
            </div>

            {/* Web of Trust — powered by Vertex */}
            {(() => {
              const wotFollowers = reputation.data?.topFollowers.filter((f) => f.pubkey !== pubkey) ?? [];
              if (wotFollowers.length === 0) return null;
              return (
                <div className="px-4 pb-3">
                  <div className="text-caption text-text-dim mb-1.5">Followed by people you trust</div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    {(wotExpanded ? wotFollowers : wotFollowers.slice(0, 5)).map((f) => (
                      <TopFollowerAvatar key={f.pubkey} pubkey={f.pubkey} />
                    ))}
                    {wotFollowers.length > 5 && !wotExpanded && (
                      <button
                        onClick={() => setWotExpanded(true)}
                        className="text-caption text-accent hover:text-accent-hover transition-colors"
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
        <Tabs
          label="Profile"
          panel="profile-panel"
          tabs={[
            { id: "notes", label: "Notes" },
            { id: "articles", label: "Articles" },
            { id: "media", label: "Media" },
          ]}
          value={profileTab}
          onChange={setProfileTab}
        />

        <div {...tabPanelProps("profile-panel", profileTab)}>
          {profileTab === "notes" && (
            <>
              {loading && <div className="px-4 py-8 text-text-dim text-body text-center">Loading notes…</div>}
              {!loading && notes.length === 0 && <div className="px-4 py-8 text-text-dim text-body text-center">No notes found.</div>}
              {notes.map((event) => (
                <NoteCard key={event.id} event={event} />
              ))}
            </>
          )}

          {profileTab === "articles" && (
            <>
              {articlesLoading && <div className="px-4 py-8 text-text-dim text-body text-center">Loading articles…</div>}
              {!articlesLoading && articles.length === 0 && <div className="px-4 py-8 text-text-dim text-body text-center">No articles found.</div>}
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
    </div>
  );
}
