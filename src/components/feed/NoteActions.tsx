import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { NDKEvent, nip19 } from "@nostr-dev-kit/ndk";
import { Bookmark, Copy, Ellipsis, Link2, MessageCircle, Quote, Repeat2, SmilePlus, UserMinus, UserPlus, VolumeX, Zap } from "lucide-react";
import { useProfile } from "../../hooks/useProfile";
import { useReactions } from "../../hooks/useReactions";
import { useReplyCount } from "../../hooks/useReplyCount";
import { useZapCount } from "../../hooks/useZapCount";
import { usePopoverDismiss, type DismissReason } from "../../hooks/usePopoverDismiss";
import { useCanSign, useUserStore } from "../../stores/user";
import { useBookmarkStore } from "../../stores/bookmark";
import { useMuteStore } from "../../stores/mute";
import { repostKey, useRepostedStore } from "../../stores/reposted";
import { useToastStore } from "../../stores/toast";
import { publishReaction } from "../../lib/nostr";
import { nameOf } from "../../lib/utils";
import { explainPublishError } from "../../lib/publishErrors";
import { measureRoom, pickSide, type Side } from "../../lib/popoverPlacement";
import { ZapModal } from "../zap/ZapModal";
import { QuoteModal } from "./QuoteModal";
import { setFollowing, setMuted } from "../../lib/socialToasts";
import { copyText } from "../../lib/clipboard";
import { repostNote } from "../../lib/repost";
import { currentAccount, stillAccount } from "../../lib/currentAccount";

const REACTION_EMOJIS = ["❤️", "🤙", "🔥", "😂", "🫡", "👀", "⚡"];

// The action row, rebuilt after the October 2026 UI review.
//
// It was seven Unicode glyphs, drawn by whatever fallback font the machine
// had, in targets 8 to 22px wide (Repost was 8x22), separated by dots and gaps
// that all opened the thread. Users aimed at Reply, missed by a few pixels and
// landed in the thread view. Nothing had a stable position, because reaction
// pills and a conditional Zap were inserted mid-row.
//
// Now: 16px icons in 32px buttons, in a fixed order, inside a full-width band
// marked `data-no-navigate`, so a near miss does nothing. It must not snap to
// the nearest action either, because the neighbour may publish. Repost and
// Quote share one menu, which also removes the one-click repost. Reaction
// pills come after the fixed actions, so they never move them.
const ICON = { size: 16, strokeWidth: 1.75 } as const;
const ACTION =
  "h-8 min-w-8 px-2 inline-flex items-center justify-center gap-1.5 rounded-sm text-ui tabular-nums transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";
const QUIET = "text-text-muted hover:bg-accent/10 hover:text-accent";
const ACTIVE = "text-accent bg-accent/10";
const MENU = "absolute z-20 bg-bg-raised border border-border rounded-lg shadow-lg py-1 overflow-hidden";
const MENU_ITEM =
  "w-full h-8 px-3 flex items-center gap-2 text-left text-ui text-text-muted hover:bg-text/8 transition-colors " +
  "focus-visible:outline-none focus-visible:bg-text/8 focus-visible:text-text focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/60 " +
  "disabled:opacity-50 disabled:cursor-default disabled:hover:bg-transparent";

type Popover = "repost" | "react" | "more";

// Layout px each popover needs beside its trigger: its own height, the 4px gap
// to the trigger, and a little air. Used to choose the side it opens on.
const NEED: Record<Popover, number> = { repost: 82, react: 50, more: 156 };
/** The reaction picker in one row, and the room it needs to the right of its trigger. */
const PICKER_WIDTH = 254;
/** The picker wrapped into two rows, for a pane too narrow for one. */
const NEED_PICKER_WRAPPED = 86;

function MenuItem({ icon, children, onClick, danger, disabled }: { icon: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={`${MENU_ITEM} ${disabled ? "" : danger ? "hover:text-danger" : "hover:text-text"}`}
    >
      <span className="shrink-0 opacity-80">{icon}</span>
      <span className="truncate">{children}</span>
    </button>
  );
}

function noteReference(event: NDKEvent): string {
  return "nostr:" + nip19.neventEncode({ id: event.id!, author: event.pubkey });
}

interface NoteActionsProps {
  event: NDKEvent;
  onReplyToggle: () => void;
  showReply: boolean;
  enabled?: boolean;
}

export function NoteActions({ event, onReplyToggle, showReply, enabled = true }: NoteActionsProps) {
  const profile = useProfile(event.pubkey);
  const name = nameOf(profile, event.pubkey);
  const canSign = useCanSign();
  // Selectors that return a boolean: a row re-renders when *its* answer
  // changes, not whenever any follow, mute or bookmark does.
  const ownPubkey = useUserStore((s) => s.pubkey);
  const isFollowing = useUserStore((s) => s.follows.includes(event.pubkey));
  const followsLoaded = useUserStore((s) => s.followsStatus === "loaded");
  const isMuted = useMuteStore((s) => s.mutedPubkeys.includes(event.pubkey));
  const isBookmarked = useBookmarkStore((s) => s.bookmarkedIds.includes(event.id!));
  const addBookmark = useBookmarkStore((s) => s.addBookmark);
  const removeBookmark = useBookmarkStore((s) => s.removeBookmark);
  const repostState = useRepostedStore((s) => s.byKey[repostKey(ownPubkey, event.id!)]);
  const reposted = repostState === "done";
  const reposting = repostState === "pending";
  const addToast = useToastStore((s) => s.addToast);

  const [reactionsData, addReaction] = useReactions(event.id, enabled);
  const [reacting, setReacting] = useState(false);
  const [replyCount] = useReplyCount(event.id, enabled);
  const zapData = useZapCount(event.id, enabled);
  const [showZap, setShowZap] = useState(false);
  const [showQuote, setShowQuote] = useState(false);

  // One popover at a time: the repost menu, the reaction picker, or More.
  // The whole row counts as "inside", so going from one menu straight to
  // another action is one click; only a click outside the row is swallowed.
  const [openPopover, setOpenPopover] = useState<Popover | null>(null);
  const [side, setSide] = useState<Side>("up");
  const [pickerWrapped, setPickerWrapped] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const focusFirstItem = useRef(false);

  // Closing by keyboard or by choosing an item puts focus back on the button
  // that opened the popover. Without it focus fell to <body> when the focused
  // item unmounted, and the next Tab started from the top of the window.
  const closePopover = useCallback((restoreFocus = false) => {
    setOpenPopover(null);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);
  const onDismiss = useCallback((reason: DismissReason) => closePopover(reason === "escape"), [closePopover]);
  usePopoverDismiss(rowRef, openPopover !== null, onDismiss);

  const isOwn = event.pubkey === ownPubkey;

  const toggle = (which: Popover, e: MouseEvent<HTMLElement>) => {
    const trigger = e.currentTarget;
    triggerRef.current = trigger;
    if (openPopover === which) {
      setOpenPopover(null);
      return;
    }
    const room = measureRoom(trigger);
    const wrapped = which === "react" && room.right < PICKER_WIDTH;
    const need = which === "react" && wrapped ? NEED_PICKER_WRAPPED : which === "more" && isOwn ? NEED.repost : NEED[which];
    setPickerWrapped(wrapped);
    setSide(pickSide(room, need));
    // A click event with no pointer behind it (Enter or Space on the button)
    // reports detail 0. Opened that way, the first item takes focus.
    focusFirstItem.current = e.detail === 0;
    setOpenPopover(which);
  };
  const sideClass = side === "up" ? "bottom-9" : "top-9";

  const popoverItems = () =>
    Array.from(rowRef.current?.querySelectorAll<HTMLButtonElement>("[data-popover] [role='menuitem']:not(:disabled)") ?? []);

  useEffect(() => {
    if (openPopover === null || !focusFirstItem.current) return;
    focusFirstItem.current = false;
    popoverItems()[0]?.focus();
  }, [openPopover]);

  // Arrow keys move through the open popover, as `role="menu"` promises, and
  // Tab closes it on the way out: left open, its dismiss listener would eat the
  // next Enter or click on whatever Tab reached.
  const onRowKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (openPopover === null) return;
    if (e.key === "Tab") {
      closePopover();
      return;
    }
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (step === 0 && e.key !== "Home" && e.key !== "End") return;
    const items = popoverItems();
    if (items.length === 0) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === "Home" ? 0
      : e.key === "End" ? items.length - 1
      : at < 0 ? (step > 0 ? 0 : items.length - 1)
      : (at + step + items.length) % items.length;
    items[next].focus();
  };

  const myReactions = reactionsData?.myReactions ?? new Set<string>();

  const handleReact = async (emoji: string, fromPicker = false) => {
    if (fromPicker) closePopover(true);
    else closePopover();
    if (!canSign || reacting || myReactions.has(emoji)) return;
    setReacting(true);
    const me = currentAccount(); // before the await: see `forThisAccount`
    try {
      await publishReaction(event.id, event.pubkey, emoji);
      if (stillAccount(me)) addReaction(emoji);
    } catch (err) {
      // It used to fail in silence: the picker closed and nothing changed.
      // No "Try again" here: the emoji is one press away on the row, and a
      // retry from the toast would run this render's idea of what has been
      // reacted with, and send the reaction twice. Nothing at all if the
      // account changed meanwhile: it is not the new account's to hear.
      if (stillAccount(me)) addToast(explainPublishError(err, "Your reaction was not sent."), "error");
    } finally {
      setReacting(false);
    }
  };

  const handleRepost = () => {
    closePopover(true);
    // The claim is in a store, not in this row's state: a row scrolled out of
    // the virtual list and back is a new component, and it must still know a
    // repost of this note is on its way. See `lib/repost.ts`.
    if (ownPubkey) void repostNote(ownPubkey, event);
  };

  const copy = (text: string, done: string) => {
    closePopover(true);
    void copyText(text, done);
  };

  // Sort emoji groups: most popular first
  const sortedGroups = reactionsData
    ? Array.from(reactionsData.groups.entries()).sort((a, b) => b[1] - a[1])
    : [];
  const zapSats = zapData?.totalSats ?? 0;
  const canZap = !!(profile?.lud16 || profile?.lud06);
  const replies = replyCount ?? 0;

  return (
    <>
      <div
        ref={rowRef}
        data-no-navigate
        data-popover-open={openPopover !== null ? "" : undefined}
        onKeyDown={onRowKeyDown}
        onClick={(e) => {
          // A click on the row's own blank space, with a popover open, closes it.
          if (openPopover !== null && !(e.target as Element).closest("button, [data-popover]")) closePopover();
        }}
        className="-mx-2 mt-1 py-1 flex flex-wrap items-center gap-x-1 gap-y-1 cursor-default"
      >
        {/* Reply: first, widest, and the same width with or without a count */}
        <button
          onClick={() => { closePopover(); onReplyToggle(); }}
          title="Reply"
          aria-label={replies > 0 ? `Reply. ${replies} ${replies === 1 ? "reply" : "replies"}` : "Reply"}
          aria-expanded={showReply}
          className={`${ACTION} min-w-14 justify-start ${showReply ? ACTIVE : QUIET}`}
        >
          <MessageCircle {...ICON} />
          {replies > 0 && <span>{replies}</span>}
        </button>

        {/* Repost and Quote share one menu: no publishing on a single click */}
        <div className="relative">
          <button
            onClick={(e) => toggle("repost", e)}
            title={reposted ? "Reposted" : "Repost or quote"}
            aria-label={reposted ? "Reposted. Repost or quote" : "Repost or quote"}
            aria-haspopup="menu"
            aria-expanded={openPopover === "repost"}
            aria-busy={reposting}
            className={`${ACTION} ${reposting ? "opacity-50" : ""} ${reposted ? "text-success hover:bg-success/10" : openPopover === "repost" ? ACTIVE : QUIET}`}
          >
            <Repeat2 {...ICON} />
          </button>
          {openPopover === "repost" && (
            <div role="menu" data-popover className={`${MENU} ${sideClass} left-0 w-40`}>
              <MenuItem icon={<Repeat2 size={14} />} onClick={handleRepost} disabled={reposted || reposting}>
                {reposted ? "Reposted" : reposting ? "Reposting…" : "Repost"}
              </MenuItem>
              <MenuItem icon={<Quote size={14} />} onClick={() => { closePopover(); setShowQuote(true); }}>
                Quote…
              </MenuItem>
            </div>
          )}
        </div>

        {/* React */}
        <div className="relative">
          <button
            onClick={(e) => toggle("react", e)}
            title="React with emoji"
            aria-label="React with emoji"
            aria-haspopup="menu"
            aria-expanded={openPopover === "react"}
            aria-busy={reacting}
            className={`${ACTION} ${reacting ? "opacity-50" : ""} ${openPopover === "react" ? ACTIVE : QUIET}`}
          >
            <SmilePlus {...ICON} />
          </button>
          {openPopover === "react" && (
            <div
              role="menu"
              aria-label="Reactions"
              data-popover
              className={`${MENU} ${sideClass} left-0 flex gap-0.5 px-1 ${pickerWrapped ? "w-[146px] flex-wrap" : ""}`}
            >
              {REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  role="menuitem"
                  onClick={() => handleReact(emoji, true)}
                  disabled={myReactions.has(emoji)}
                  aria-label={`React with ${emoji}`}
                  className="w-8 h-8 rounded-sm text-[18px] leading-none hover:bg-text/8 transition-colors focus-visible:outline-none focus-visible:bg-text/8 focus-visible:ring-1 focus-visible:ring-accent/60 disabled:opacity-30 disabled:cursor-default"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Zap: last of the fixed group, so its absence moves nothing */}
        {canZap && (
          <button
            onClick={() => { closePopover(); setShowZap(true); }}
            title={zapSats > 0 ? `Zap. ${zapSats.toLocaleString()} sats so far` : "Zap"}
            aria-label={zapSats > 0 ? `Zap. ${zapSats.toLocaleString()} sats so far` : "Zap"}
            className={`${ACTION} ${zapSats > 0 ? "text-zap hover:bg-zap/10" : "text-text-muted hover:bg-zap/10 hover:text-zap"}`}
          >
            <Zap {...ICON} />
            {zapSats > 0 && <span>{zapSats.toLocaleString()}</span>}
          </button>
        )}

        {/* Reaction pills: after the fixed actions, free to wrap */}
        {sortedGroups.map(([emoji, count]) => (
          <button
            key={emoji}
            onClick={() => handleReact(emoji)}
            disabled={reacting || myReactions.has(emoji)}
            title={myReactions.has(emoji) ? "You reacted with this" : "React with this too"}
            aria-label={`${emoji} ${count}. ${myReactions.has(emoji) ? "You reacted with this" : "React with this too"}`}
            className={`h-7 px-2 inline-flex items-center gap-1 rounded-sm border text-ui tabular-nums transition-colors disabled:cursor-default ${
              myReactions.has(emoji)
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-border text-text-muted hover:border-accent/40 hover:bg-accent/5"
            }`}
          >
            <span className="text-[14px] leading-none">{emoji}</span>
            <span>{count}</span>
          </button>
        ))}

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => { closePopover(); void (isBookmarked ? removeBookmark(event.id!) : addBookmark(event.id!)); }}
            title={isBookmarked ? "Remove bookmark" : "Bookmark"}
            aria-label={isBookmarked ? "Remove bookmark" : "Bookmark"}
            aria-pressed={isBookmarked}
            className={`${ACTION} ${isBookmarked ? "text-accent hover:bg-accent/10" : QUIET}`}
          >
            <Bookmark {...ICON} fill={isBookmarked ? "currentColor" : "none"} />
          </button>

          {/* More: always visible (it was hover-only), and on your own notes too */}
          <div className="relative">
            <button
              onClick={(e) => toggle("more", e)}
              title="More"
              aria-label="More actions"
              aria-haspopup="menu"
              aria-expanded={openPopover === "more"}
              className={`${ACTION} ${openPopover === "more" ? ACTIVE : QUIET}`}
            >
              <Ellipsis {...ICON} />
            </button>
            {openPopover === "more" && (
              <div role="menu" data-popover className={`${MENU} ${sideClass} right-0 w-52`}>
                <MenuItem icon={<Link2 size={14} />} onClick={() => copy(noteReference(event), "Note ID copied.")}>
                  Copy note ID
                </MenuItem>
                <MenuItem icon={<Copy size={14} />} onClick={() => copy(event.content, "Text copied.")}>
                  Copy text
                </MenuItem>
                {!isOwn && (
                  <>
                    <div className="my-1 border-t border-border-subtle" />
                    {/* "Follow" is only offered once the follow list is known.
                        Before it loads, "not in the list" proves nothing. */}
                    {(isFollowing || followsLoaded) && (
                      <MenuItem
                        icon={isFollowing ? <UserMinus size={14} /> : <UserPlus size={14} />}
                        // The menu closes and nothing on the note changes, so this says how it went.
                        onClick={() => { closePopover(true); void setFollowing(event.pubkey, name, !isFollowing); }}
                      >
                        {isFollowing ? "Unfollow" : "Follow"} {name}
                      </MenuItem>
                    )}
                    <MenuItem
                      danger={!isMuted}
                      icon={<VolumeX size={14} />}
                      onClick={() => { closePopover(true); setMuted(event.pubkey, name, !isMuted); }}
                    >
                      {isMuted ? "Unmute" : "Mute"} {name}
                    </MenuItem>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {showZap && (
        <ZapModal
          target={{ type: "note", event, recipientPubkey: event.pubkey }}
          recipientName={name}
          onClose={() => setShowZap(false)}
        />
      )}

      {showQuote && (
        <QuoteModal
          event={event}
          onClose={() => setShowQuote(false)}
          returnFocus={triggerRef}
        />
      )}
    </>
  );
}

/** The same row for someone who cannot sign: counts to read, one thing to do. */
export function LoggedOutStats({ event, enabled = true }: { event: NDKEvent; enabled?: boolean }) {
  const [reactionsData] = useReactions(event.id, enabled);
  const [replyCount] = useReplyCount(event.id, enabled);
  const zapData = useZapCount(event.id, enabled);

  const handleCopy = () => void copyText(noteReference(event), "Note ID copied.");

  const sortedGroups = reactionsData
    ? Array.from(reactionsData.groups.entries()).sort((a, b) => b[1] - a[1])
    : [];
  const STAT = "h-8 inline-flex items-center gap-1.5 text-ui tabular-nums text-text-muted";

  return (
    <div data-no-navigate className="mt-1 py-1 flex flex-wrap items-center gap-x-4 gap-y-1 cursor-default">
      {replyCount !== null && replyCount > 0 && (
        <span className={STAT} title="Replies">
          <MessageCircle size={15} strokeWidth={1.75} aria-hidden />
          {replyCount}
          <span className="sr-only">{replyCount === 1 ? "reply" : "replies"}</span>
        </span>
      )}
      {sortedGroups.map(([emoji, count]) => (
        <span key={emoji} className={STAT}>
          <span className="text-[14px] leading-none">{emoji}</span>
          <span>{count}</span>
          <span className="sr-only">{count === 1 ? "reaction" : "reactions"}</span>
        </span>
      ))}
      {zapData !== null && zapData.totalSats > 0 && (
        <span className={`${STAT} text-zap`} title="Sats zapped">
          <Zap size={15} strokeWidth={1.75} aria-hidden />
          {zapData.totalSats.toLocaleString()} sats
        </span>
      )}
      <button
        onClick={handleCopy}
        title="Copy note ID"
        aria-label="Copy note ID"
        className={`${ACTION} ${QUIET} ml-auto -mr-2`}
      >
        <Link2 {...ICON} />
      </button>
    </div>
  );
}
