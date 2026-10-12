import { useEffect, useState } from "react";
import type { NDKEvent } from "@nostr-dev-kit/ndk";
import { useUserStore } from "../../stores/user";
import { useUIStore } from "../../stores/ui";
import { useMuteStore } from "../../stores/mute";
import { useNotificationsStore, notificationKind, type NotificationKind } from "../../stores/notifications";
import { useProfile } from "../../hooks/useProfile";
import { timeAgo, nameOf } from "../../lib/utils";
import { NoteCard } from "../feed/NoteCard";
import { ZapRow, parseReceipt } from "../zap/ZapRow";
import { FollowRow } from "../follows/FollowRow";
import { SkeletonNoteList } from "../shared/Skeleton";
import { ViewHeader } from "../shared/ViewHeader";
import { Tabs, tabPanelProps } from "../shared/Tabs";
import { Button } from "../shared/Button";
import { ListState, stateWithoutRows } from "../shared/ListState";

type Tab = "all" | NotificationKind;

/** How long the view is in front of you before what it shows counts as seen. */
const SEEN_AFTER_MS = 1500;

/** Who did the thing: the zapper for a receipt, else the event's author. */
function actorOf(e: NDKEvent): string | null {
  return notificationKind(e) === "zap" ? parseReceipt(e).senderPubkey : e.pubkey;
}

/** The line above each item that says what happened. "New" is said in words too, for a screen reader. */
function Reason({ event, actor, isNew }: { event: NDKEvent; actor: string | null; isNew: boolean }) {
  const profile = useProfile(actor ?? "");
  const name = actor ? nameOf(profile, actor) : "Someone";
  const kind = notificationKind(event);
  // A kind 1 with an `e` tag is a reply in a thread you are tagged in, not necessarily to your note.
  const text = kind === "zap"
    ? (() => { const { amount } = parseReceipt(event); return amount !== null ? `${name} zapped you ${amount.toLocaleString()} sats` : `${name} zapped you`; })()
    : kind === "follower" ? `${name} follows you`
    : event.tags.some((t) => t[0] === "e") ? `${name} replied in a thread you're in` : `${name} mentioned you`;
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 pt-2 text-caption text-text-muted">
      <span className="truncate">{isNew && <span className="sr-only">New: </span>}{text}</span>
      <span className="shrink-0 text-text-dim">{timeAgo(event.created_at ?? 0)}</span>
    </div>
  );
}

const EMPTY: Record<Tab, { text: string; hint: string }> = {
  all: { text: "No notifications yet.", hint: "Replies, mentions, zaps and new followers will appear here." },
  mention: { text: "No mentions yet.", hint: "When someone replies to you or mentions you, it will appear here." },
  zap: { text: "No zaps received yet.", hint: "When someone zaps you or your notes, it will appear here." },
  follower: { text: "No followers to show from the last 30 days.", hint: "Everyone who follows you is listed under People." },
};

export function NotificationsView() {
  const { pubkey, loggedIn } = useUserStore();
  // Selectors: this view stays mounted behind Back, and must not render its rows for a DM count.
  const notifications = useNotificationsStore((s) => s.notifications);
  const loading = useNotificationsStore((s) => s.loading);
  const fetchOutcome = useNotificationsStore((s) => s.fetchOutcome);
  const fetchNotifications = useNotificationsStore((s) => s.fetchNotifications);
  const markAllRead = useNotificationsStore((s) => s.markAllRead);
  const markReadMany = useNotificationsStore((s) => s.markReadMany);
  const readIds = useNotificationsStore((s) => s.readIds);
  const newFollowerPubkeys = useNotificationsStore((s) => s.newFollowerPubkeys);
  const clearNewFollowers = useNotificationsStore((s) => s.clearNewFollowers);
  const mutedPubkeys = useMuteStore((s) => s.mutedPubkeys);
  const contentMatchesMutedKeyword = useMuteStore((s) => s.contentMatchesMutedKeyword);
  const inFront = useUIStore((s) => s.currentView === "notifications");
  const [tab, setTab] = useState<Tab>("all");
  // What was new while the view was in front: highlighted until the view is left, read or not.
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const isRead = (id: string) => readIds.has(id);

  // Not your own doing (a zap from your own key included), and not from someone you muted.
  const rows = notifications.filter((e) => {
    if (e.pubkey === pubkey) return false;
    const actor = actorOf(e);
    if (actor === pubkey) return false;
    if (actor && mutedPubkeys.includes(actor)) return false;
    return !(notificationKind(e) === "mention" && contentMatchesMutedKeyword(e.content));
  });
  const held = notifications.filter((e) => e.pubkey !== pubkey);
  const ofTab = (list: NDKEvent[], t: Tab) => (t === "all" ? list : list.filter((e) => notificationKind(e) === t));
  // Unread: mentions and zaps by their read state; followers by whether they are still new.
  const unread = (e: NDKEvent) => (notificationKind(e) === "follower" ? newFollowerPubkeys.has(e.pubkey) : !isRead(e.id!));
  const unreadIn = (t: Tab) => ofTab(rows, t).filter(unread).length;
  const unreadTotal = unreadIn("all");
  const shown = ofTab(rows, tab);

  useEffect(() => {
    if (!pubkey) return;
    fetchNotifications(pubkey);
  }, [pubkey]);

  // Seen by being looked at, not by being clicked: what the open tab shows, in front for a moment,
  // counts as read, and exactly that (not other tabs, not what arrived after). An item that arrives
  // while the view is in front joins the highlight and gets its own moment. The highlight stays until
  // the view is left.
  const unreadShown = shown.filter(unread);
  const unreadKey = unreadShown.map((e) => e.id!).sort().join(",");
  useEffect(() => {
    if (!inFront) { setFresh(new Set()); return; }
    if (unreadShown.length === 0) return;
    setFresh((f) => new Set([...f, ...unreadShown.map((e) => e.id!)]));
    const ids = unreadShown.filter((e) => notificationKind(e) !== "follower").map((e) => e.id!);
    const people = unreadShown.filter((e) => notificationKind(e) === "follower").map((e) => e.pubkey);
    const timer = setTimeout(() => {
      if (ids.length) markReadMany(ids);
      if (people.length) clearNewFollowers(people);
    }, SEEN_AFTER_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inFront, unreadKey]);

  if (!loggedIn || !pubkey) {
    return (
      <div className="h-full flex flex-col">
        <ViewHeader title="Notifications" />
        <div className="flex-1 flex items-center justify-center text-text-dim text-body">
          Log in to see notifications.
        </div>
      </div>
    );
  }

  const count = (n: number) => (n > 0 ? n : undefined);

  return (
    <div className="h-full flex flex-col">
      <ViewHeader
        title="Notifications"
        actions={unreadTotal > 0 ? (
          <Button variant="ghost" onClick={() => { markAllRead(); clearNewFollowers(); }}>Mark all read</Button>
        ) : undefined}
      />
      <Tabs
        label="Notifications"
        panel="notifications-panel"
        tabs={[
          { id: "all", label: "All", unread: count(unreadTotal) },
          { id: "mention", label: "Mentions", unread: count(unreadIn("mention")) },
          { id: "zap", label: "Zaps", unread: count(unreadIn("zap")) },
          { id: "follower", label: "Followers", unread: count(unreadIn("follower")) },
        ]}
        value={tab}
        onChange={setTab}
      />

      <div {...tabPanelProps("notifications-panel", tab)} className="flex-1 overflow-y-auto content-column">
        {/* With rows already on screen (from the local cache), a fetch that
            failed changes nothing. With none, it must not read as "nothing yet". */}
        {shown.length === 0 && (!loading || ofTab(held, tab).length === 0) && (
          <ListState
            state={stateWithoutRows(loading, ofTab(held, tab).length, fetchOutcome)}
            loadingLabel="Loading notifications…"
            loading={<SkeletonNoteList count={4} />}
            empty={EMPTY[tab].text}
            emptyHint={EMPTY[tab].hint}
            what="your notifications"
            onRetry={() => { if (pubkey) void fetchNotifications(pubkey); }}
          />
        )}

        {shown.map((event) => {
          const kind = notificationKind(event);
          const actor = actorOf(event);
          const highlight = fresh.has(event.id!) || unread(event);
          return (
            <div
              key={event.id}
              // Lifted while a note menu is open inside it, or the next item is painted over the menu.
              // The left border is always there, so rows do not shift when the highlight comes and goes.
              // Note cards and zap rows bring their own bottom border; a follower row does not.
              className={`border-l-2 has-[[data-popover-open]]:relative has-[[data-popover-open]]:z-10 ${kind === "follower" ? "border-b border-border-subtle" : ""} ${highlight ? "border-l-accent bg-accent/5" : "border-l-transparent"}`}
            >
              <Reason event={event} actor={actor} isNew={highlight} />
              {kind === "mention" && <NoteCard event={event} />}
              {kind === "zap" && (() => { const { amount, comment, noteId } = parseReceipt(event); return <ZapRow pubkey={actor} amount={amount} comment={comment} noteId={noteId} createdAt={event.created_at ?? 0} direction="received" compact />; })()}
              {kind === "follower" && <FollowRow pubkey={event.pubkey} isNew={newFollowerPubkeys.has(event.pubkey) || fresh.has(event.id!)} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
