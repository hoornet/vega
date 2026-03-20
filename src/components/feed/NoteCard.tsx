import { useState, useRef, useEffect } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useProfile } from "../../hooks/useProfile";
import { useNip05Verified } from "../../hooks/useNip05Verified";
import { useUserStore } from "../../stores/user";
import { useMuteStore } from "../../stores/mute";
import { useUIStore } from "../../stores/ui";
import { timeAgo, shortenPubkey } from "../../lib/utils";
import { getNDK, fetchNoteById } from "../../lib/nostr";
import { NoteContent } from "./NoteContent";
import { NoteActions, LoggedOutStats } from "./NoteActions";
import { InlineReplyBox } from "./InlineReplyBox";

interface NoteCardProps {
  event: NDKEvent;
  focused?: boolean;
}

function getParentEventId(event: NDKEvent): string | null {
  const eTags = event.tags.filter((t) => t[0] === "e");
  if (eTags.length === 0) return null;
  return eTags.find((t) => t[3] === "reply")?.[1]
    ?? eTags.find((t) => t[3] === "root")?.[1]
    ?? eTags[eTags.length - 1][1];
}

function ParentAuthorName({ pubkey }: { pubkey: string }) {
  const profile = useProfile(pubkey);
  const name = profile?.displayName || profile?.name || pubkey.slice(0, 8) + "…";
  return <span className="text-accent">@{name}</span>;
}

export function NoteCard({ event, focused }: NoteCardProps) {
  const profile = useProfile(event.pubkey);
  const name = profile?.displayName || profile?.name || shortenPubkey(event.pubkey);
  const avatar = profile?.picture;
  const nip05 = profile?.nip05;
  const verified = useNip05Verified(event.pubkey, nip05);
  const time = event.created_at ? timeAgo(event.created_at) : "";

  const { loggedIn, pubkey: ownPubkey, follows, follow, unfollow } = useUserStore();
  const { mutedPubkeys, mute, unmute } = useMuteStore();
  const isMuted = mutedPubkeys.includes(event.pubkey);
  const { openProfile, openThread, currentView } = useUIStore();

  const parentEventId = getParentEventId(event);
  const parentAuthorPubkey = event.tags.find((t) => t[0] === "p")?.[1] ?? null;

  const cardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focused) cardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [focused]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [showReply, setShowReply] = useState(false);

  return (
    <article
      ref={cardRef}
      className={`border-b border-border px-4 py-3 hover:bg-bg-hover transition-colors duration-100 group/card${focused ? " ring-1 ring-inset ring-accent/30" : ""}`}
    >
      <div className="flex gap-3">
        {/* Avatar */}
        <div className="shrink-0 cursor-pointer" onClick={() => openProfile(event.pubkey)}>
          {avatar ? (
            <img
              src={avatar}
              alt=""
              className="w-9 h-9 rounded-sm object-cover bg-bg-raised hover:opacity-80 transition-opacity"
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
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 mb-0.5">
            <span
              className="text-text font-medium truncate text-[13px] cursor-pointer hover:text-accent transition-colors"
              onClick={() => openProfile(event.pubkey)}
            >{name}</span>
            {nip05 && (
              <span className={`text-[10px] truncate max-w-40 ${verified === "valid" ? "text-success" : "text-text-dim"}`}>
                {verified === "valid" ? "✓ " : ""}{nip05}
              </span>
            )}
            <span className="text-text-dim text-[11px] shrink-0">{time}</span>
            {/* Context menu — hidden until card hover, not shown for own notes */}
            {loggedIn && event.pubkey !== ownPubkey && (
              <div className="relative ml-auto">
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  className="text-text-dim hover:text-text text-[14px] px-1 leading-none opacity-0 group-hover/card:opacity-100 transition-opacity"
                >
                  ⋯
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-[9]" onClick={() => setMenuOpen(false)} />
                    <div className="absolute right-0 top-5 bg-bg-raised border border-border shadow-lg z-10 w-32">
                      <button
                        onClick={() => { setMenuOpen(false); follows.includes(event.pubkey) ? unfollow(event.pubkey) : follow(event.pubkey); }}
                        className="w-full text-left px-3 py-2 text-[11px] text-text-muted hover:text-accent hover:bg-bg-hover transition-colors"
                      >
                        {follows.includes(event.pubkey) ? `unfollow` : `follow`}
                      </button>
                      <button
                        onClick={() => { setMenuOpen(false); isMuted ? unmute(event.pubkey) : mute(event.pubkey); }}
                        className="w-full text-left px-3 py-2 text-[11px] text-text-muted hover:text-danger hover:bg-bg-hover transition-colors"
                      >
                        {isMuted ? `unmute` : `mute`}
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
                  const parent = await fetchNoteById(parentEventId);
                  if (parent) openThread(parent, currentView as "feed" | "profile");
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

          <div
            className="cursor-pointer"
            onClick={() => openThread(event, currentView as "feed" | "profile")}
          >
            <NoteContent content={event.content} inline />
          </div>
          <NoteContent content={event.content} mediaOnly />

          {/* Actions */}
          {loggedIn && !!getNDK().signer && (
            <NoteActions
              event={event}
              onReplyToggle={() => setShowReply((v) => !v)}
              showReply={showReply}
            />
          )}

          {/* Stats visible when logged out */}
          {!loggedIn && <LoggedOutStats event={event} />}

          {/* Inline reply box */}
          {showReply && <InlineReplyBox event={event} name={name} />}
        </div>
      </div>
    </article>
  );
}
