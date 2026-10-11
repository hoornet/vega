import { useState, useRef, useEffect, memo } from "react";
import { NDKEvent } from "@nostr-dev-kit/ndk";
import { useProfile } from "../../hooks/useProfile";
import { useNip05Verified } from "../../hooks/useNip05Verified";
import { useInView } from "../../hooks/useInView";
import { useCanSign } from "../../stores/user";
import { useUIStore } from "../../stores/ui";
import { timeAgo, shortenPubkey } from "../../lib/utils";
import { fetchNoteById, ensureConnected } from "../../lib/nostr";
import { getParentEventId } from "../../lib/threadTree";
import { NoteContent } from "./NoteContent";
import { NoteActions, LoggedOutStats } from "./NoteActions";
import { InlineReplyBox } from "./InlineReplyBox";
import { PollWidget } from "../poll/PollWidget";
import { opensThread } from "../../lib/cardClick";
import type { Point } from "../../lib/pointer";

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

  const canSign = useCanSign();
  const openProfile = useUIStore((s) => s.openProfile);
  const openThread = useUIStore((s) => s.openThread);
  const currentView = useUIStore((s) => s.currentView);
  const openThreadNoteId = useUIStore((s) => (s.currentView === "thread" ? s.selectedNote?.id : undefined));

  const parentEventId = getParentEventId(event);
  // The immediate parent author is typically the last p tag (NIP-10 ordering mirrors e tags).
  // First p tag is usually the root author, not who this note directly replies to.
  const pTags = event.tags.filter((t) => t[0] === "p");
  const parentAuthorPubkey = pTags.length > 0 ? pTags[pTags.length - 1][1] : null;

  useEffect(() => {
    if (focused) cardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [focused]);

  const [showReply, setShowReply] = useState(false);
  const pressAt = useRef<Point | null>(null);

  return (
    <article
      ref={cardRef}
      data-note-id={event.id}
      className={`border-b border-border px-4 py-3 hover:bg-bg-hover transition-colors cursor-pointer group/card${focused ? " bg-accent/10 border-l-2 border-l-accent" : ""}`}
      onMouseDown={(e) => { pressAt.current = { x: e.clientX, y: e.clientY }; }}
      onClick={(e) => {
        // Which clicks count as "open this note" is decided in cardClick.ts.
        if (!opensThread({
          card: e.currentTarget,
          target: e.target,
          press: pressAt.current,
          release: { x: e.clientX, y: e.clientY },
          alreadyOpen: openThreadNoteId === event.id,
        })) return;
        openThread(event, currentView as "feed" | "profile");
      }}
    >
      {/* items-start: without it the avatar button stretched to the card's full
          height and centred the picture, so on a tall post the face sat hundreds
          of pixels below the name and the whole strip opened the profile. */}
      <div className="flex gap-3 items-start">
        {/* Avatar */}
        <button className="shrink-0 cursor-pointer" aria-label={`View profile of ${name}`} onClick={() => openProfile(event.pubkey)}>
          {avatar ? (
            <img
              src={avatar}
              alt={`${name}'s avatar`}
              width={36}
              height={36}
              className="w-9 h-9 rounded-md object-cover bg-bg-raised ring-1 ring-transparent hover:ring-accent/40 transition-all"
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <div className="w-9 h-9 rounded-md bg-bg-raised border border-border flex items-center justify-center text-text-dim text-xs hover:border-accent/40 transition-colors">
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
          {/* Media boxes always render (fixed aspect ratio → stable row
              height for the virtualizer), but the heavy <img>/<video> inside
              them only mounts when the card is on screen (mediaInView), so
              off-screen overscan rows stay light and scrolling stays smooth. */}
          <NoteContent content={event.content} mediaOnly mediaInView={inView} />

          {/* Poll options — kind 1068 */}
          {event.kind === 1068 && <PollWidget event={event} />}

          {/* From the action row down, nothing is "the card". The area runs
              out to the card's left, right and bottom edges (the negative
              margins undo the avatar column and the card padding), so a click
              that just misses a button lands here and does nothing. Before,
              the strips beside and below the row belonged to the card: aiming
              at Reply and missing by a few pixels opened the thread. */}
          <div data-no-navigate className="-ml-16 pl-16 -mr-4 pr-4 -mb-3 pb-3 cursor-default">
            {canSign ? (
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
            ) : (
              // Stats visible in read-only mode (logged out or npub-only)
              <LoggedOutStats event={event} enabled={inView} />
            )}

            {/* Inline reply box */}
            {showReply && <InlineReplyBox event={event} name={name} />}
          </div>
        </div>
      </div>
    </article>
  );
});
