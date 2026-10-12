import { useEffect } from "react";
import { useUserStore } from "../../stores/user";
import { useMuteStore } from "../../stores/mute";
import { useNotificationsStore } from "../../stores/notifications";
import { NoteCard } from "../feed/NoteCard";
import { SkeletonNoteList } from "../shared/Skeleton";
import { ViewHeader } from "../shared/ViewHeader";
import { Button } from "../shared/Button";
import { ListState, stateWithoutRows } from "../shared/ListState";

export function NotificationsView() {
  const { pubkey, loggedIn } = useUserStore();
  const {
    notifications,
    unreadCount,
    loading,
    fetchOutcome,
    fetchNotifications,
    markAllRead,
    markRead,
    isRead,
  } = useNotificationsStore();
  const { mutedPubkeys, contentMatchesMutedKeyword } = useMuteStore();
  // What this view lists at all. The store also holds follower events (kind 3)
  // for the People badge, and those are never rows here.
  const mentions = notifications.filter((e) => e.kind !== 3 && e.pubkey !== pubkey);
  const filteredNotifications = mentions.filter(
    (e) => !mutedPubkeys.includes(e.pubkey) && !contentMatchesMutedKeyword(e.content)
  );

  useEffect(() => {
    if (!pubkey) return;
    fetchNotifications(pubkey);
  }, [pubkey]);

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

  return (
    <div className="h-full flex flex-col">
      <ViewHeader
        title="Notifications"
        actions={unreadCount > 0 ? (
          <Button variant="ghost" onClick={markAllRead}>Mark all read</Button>
        ) : undefined}
      />

      <div className="flex-1 overflow-y-auto content-column">
        {/* With rows already on screen (from the local cache), a fetch that
            failed changes nothing. With none, it must not read as "no mentions". */}
        {filteredNotifications.length === 0 && (!loading || mentions.length === 0) && (
          <ListState
            state={stateWithoutRows(loading, mentions.length, fetchOutcome)}
            loadingLabel="Loading notifications…"
            loading={<SkeletonNoteList count={4} />}
            empty="No mentions yet."
            emptyHint="When someone mentions you, it will appear here."
            what="your notifications"
            onRetry={() => { if (pubkey) void fetchNotifications(pubkey); }}
          />
        )}

        {filteredNotifications.map((event) => {
          const read = isRead(event.id!);
          return (
            <div
              key={event.id}
              // `opacity-50` makes a read item its own stacking context, so the
              // next item painted over a note menu that opened downward, and
              // the menu itself was drawn at half strength. While a menu is
              // open the item is lifted and shown at full strength.
              className={`transition-opacity has-[[data-popover-open]]:relative has-[[data-popover-open]]:z-10 has-[[data-popover-open]]:opacity-100 ${read ? "opacity-50" : "border-l-2 border-accent/40"}`}
              onClick={() => { if (!read && event.id) markRead(event.id); }}
            >
              <NoteCard event={event} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
