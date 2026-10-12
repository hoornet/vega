import { useEffect } from "react";
import { useUserStore } from "../../stores/user";
import { useMuteStore } from "../../stores/mute";
import { useNotificationsStore } from "../../stores/notifications";
import { NoteCard } from "../feed/NoteCard";
import { SkeletonNoteList } from "../shared/Skeleton";
import { ViewHeader } from "../shared/ViewHeader";
import { Button } from "../shared/Button";

export function NotificationsView() {
  const { pubkey, loggedIn } = useUserStore();
  const {
    notifications,
    unreadCount,
    loading,
    fetchNotifications,
    markAllRead,
    markRead,
    isRead,
  } = useNotificationsStore();
  const { mutedPubkeys, contentMatchesMutedKeyword } = useMuteStore();
  const filteredNotifications = notifications.filter(
    (e) => e.kind !== 3 && e.pubkey !== pubkey && !mutedPubkeys.includes(e.pubkey) && !contentMatchesMutedKeyword(e.content)
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
        {loading && notifications.length === 0 && (
          <SkeletonNoteList count={4} />
        )}

        {!loading && filteredNotifications.length === 0 && (
          <div className="px-4 py-12 text-center space-y-2">
            <p className="text-text-dim text-body">No mentions yet.</p>
            <p className="text-text-dim text-caption">When someone mentions you, it will appear here.</p>
          </div>
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
