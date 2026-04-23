import { useState, useRef, useEffect, memo } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useProfile } from "../../hooks/useProfile";
import { useNip05Verified } from "../../hooks/useNip05Verified";
import { useInView } from "../../hooks/useInView";
import { useUserStore } from "../../stores/user";
import { useMuteStore } from "../../stores/mute";
import { useUIStore } from "../../stores/ui";
import { timeAgo, shortenPubkey } from "../../lib/utils";
import { getNDK, fetchNoteById, ensureConnected } from "../../lib/nostr";
import { getParentEventId } from "../../lib/threadTree";
import { NoteContent } from "./NoteContent";
import { NoteActions, LoggedOutStats } from "./NoteActions";
import { InlineReplyBox } from "./InlineReplyBox";
import { PollWidget } from "../poll/PollWidget";

interface NoteCardProps {
  event: NDKEvent;
  focused?: boolean;
  onReplyInThread?: (event: NDKEvent) => void;
}

function ParentAuthorName({ pubkey }: { pubkey: string }) {
  const profile = useProfile(pubkey);
  const raw = profile?.displayName || profile?.name;
  const name = (typeof raw === "string" ? raw : null) || pubkey.slice(0, 8) + "…";
  return <span className="text-accent">@{name}</span>;
}

export const NoteCard = memo(function NoteCard({ event, focused, onReplyInThread }: NoteCardProps) {
  const cardRef = useRef<HTMLElement>(null);
  const inView = useInView(cardRef);

  const profile = useProfile(event.pubkey);
  const rawName = profile?.displayName || profile?.name;
  const name = (typeof rawName === "string" ? rawName : null) || shortenPubkey(event.pubkey);
  const avatar = profile?.picture;
  const nip05 = typeof profile?.nip05 === "string" ? profile.nip05 : null;
  const verified = useNip05Verified(event.pubkey, nip05, inView);
  const time = event.created_at ? timeAgo(event.created_at) : "";

  const loggedIn = useUserStore((s) => s.loggedIn);
  const ownPubkey = useUserStore((s) => s.pubkey);
  const follows = useUserStore((s) => s.follows);
  const follow = useUserStore((s) => s.follow);
  const unfollow = useUserStore((s) => s.unfollow);
  const mutedPubkeys = useMuteStore((s) => s.mutedPubkeys);
  const mute = useMuteStore((s) => s.mute);
  const unmute = useMuteStore((s) => s.unmute);
  const isMuted = mutedPubkeys.includes(event.pubkey);
  const openProfile = useUIStore((s) => s.openProfile);
  const openThread = useUIStore((s) => s.openThread);
  const currentView = useUIStore((s) => s.currentView);

  const parentEventId = getParentEventId(event);
  // The immediate parent author is typically the last p tag (NIP-10 ordering mirrors e tags).
  // First p tag is usually the root author, not who this note directly replies to.
  const pTags = event.tags.filter((t) => t[0] === "p");
  const parentAuthorPubkey = pTags.length > 0 ? pTags[pTags.length - 1][1] : null;

  useEffect(() => {
    if (focused) cardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [focused]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [showReply, setShowReply] = useState(false);

  return (
    <article
      ref={cardRef}
      data-note-id={event.id}
      className={`border-b border-border px-4 py-3 hover:bg-bg-hover transition-colors cursor-pointer group/card${focused ? " bg-accent/10 border-l-2 border-l-accent" : ""}`}
      onClick={(e) => {
        // Don't navigate if clicking on interactive elements
        const target = e.target as HTMLElement;
        if (target.closest("button, a, input, textarea, [data-no-navigate]")) return;
        openThread(event, currentView as "feed" | "profile");
      }}
    >
      <div className="flex gap-3">
        {/* Avatar */}
        <button className="shrink-0 cursor-pointer" aria-label={`View profile of ${name}`} onClick={() => openProfile(event.pubkey)}>
          {avatar ? (
            <img
              src={avatar}
              alt={`${name}'s avatar`}
              width={36}
              height={36}
              className="w-9 h-9 rounded-sm object-cover bg-bg-raised ring-1 ring-transparent hover:ring-accent/40 transition-all"
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <div className="w-9 h-9 rounded-sm bg-bg-raised border border-border flex items-center justify-center text-text-dim text-xs hover:border-accent/40 transition-colors">
              {name.charAt(0).toUpperCase()}
            </div>
          )}
        </button>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mb-0.5">
            <button
              className="text-text font-medium truncate text-[13px] cursor-pointer hover:text-accent transition-colors text-left"
              onClick={() => openProfile(event.pubkey)}
              title={name}
            >{name}</button>
            {nip05 && (
              <span title={nip05} className={`text-[10px] truncate max-w-40 ${verified === "valid" ? "text-success" : "text-text-dim"}`}>
                {verified === "valid" ? "✓ " : ""}{nip05}
              </span>
            )}
            <span className="text-text-dim text-[11px] shrink-0">{time}</span>
            {/* Context menu — hidden until card hover, not shown for own notes */}
            {loggedIn && event.pubkey !== ownPubkey && (
              <div className="relative ml-auto">
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-label="More actions"
                  aria-expanded={menuOpen}
                  className="text-text-dim hover:text-text text-[14px] px-1 leading-none opacity-0 group-hover/card:opacity-100 transition-opacity"
                >
                  ⋯
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-[9]" role="presentation" onClick={() => setMenuOpen(false)} />
                    <div role="menu" className="absolute right-0 top-5 bg-bg-raised border border-border rounded-sm shadow-lg z-10 w-32">
                      <button
                        onClick={() => { setMenuOpen(false); follows.includes(event.pubkey) ? unfollow(event.pubkey) : follow(event.pubkey); }}
                        className="w-full text-left px-3 py-2 text-[11px] text-text-muted hover:text-accent hover:bg-bg-hover transition-colors"
                      >
                        {follows.includes(event.pubkey) ? "Unfollow" : "Follow"}
                      </button>
                      <button
                        onClick={() => { setMenuOpen(false); isMuted ? unmute(event.pubkey) : mute(event.pubkey); }}
                        className="w-full text-left px-3 py-2 text-[11px] text-text-muted hover:text-danger hover:bg-bg-hover transition-colors"
                      >
                        {isMuted ? "Unmute" : "Mute"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {parentEventId && parentAuthorPubkey && (
            <div className="text-text-dim text-[11px] mb-1.5 flex items-center gap-1">
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  // If already in thread view, try scrolling to parent first
                  if (currentView === "thread") {
                    const el = document.querySelector(`[data-note-id="${parentEventId}"]`);
                    if (el) {
                      el.scrollIntoView({ behavior: "smooth", block: "center" });
                      return;
                    }
                  }
                  await ensureConnected();
                  const parent = await fetchNoteById(parentEventId);
                  if (parent) openThread(parent);
                }}
                className="hover:text-accent transition-colors"
              >
                ↩ replying to
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openProfile(parentAuthorPubkey);
                }}
                className="hover:text-accent transition-colors"
              >
                <ParentAuthorName pubkey={parentAuthorPubkey} />
              </button>
            </div>
          )}

          <div>
            <NoteContent content={event.content} inline />
          </div>
          {inView && <NoteContent content={event.content} mediaOnly />}

          {/* Poll options — kind 1068 */}
          {event.kind === 1068 && <PollWidget event={event} />}

          {/* Actions */}
          {loggedIn && !!getNDK().signer && (
            <NoteActions
              event={event}
              onReplyToggle={() => {
                if (onReplyInThread) {
                  onReplyInThread(event);
                } else {
                  setShowReply((v) => !v);
                }
              }}
              showReply={showReply && !onReplyInThread}
              enabled={inView}
            />
          )}

          {/* Stats visible when logged out */}
          {!loggedIn && <LoggedOutStats event={event} enabled={inView} />}

          {/* Inline reply box */}
          {showReply && <InlineReplyBox event={event} name={name} />}
        </div>
      </div>
    </article>
  );
});
