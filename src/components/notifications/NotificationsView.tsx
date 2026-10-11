import { useEffect } from "react";
import { useUserStore } from "../../stores/user";
import { useMuteStore } from "../../stores/mute";
import { useNotificationsStore } from "../../stores/notifications";
import { NoteCard } from "../feed/NoteCard";
import { SkeletonNoteList } from "../shared/Skeleton";

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
      <div className="h-full flex items-center justify-center text-text-dim text-[12px]">
        Log in to see notifications.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-border px-4 py-2.5 flex items-center justify-between shrink-0">
        <h1 className="text-text text-sm font-medium tracking-wide">Notifications</h1>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            className="text-[11px] text-text-dim hover:text-accent transition-colors"
          >
            Mark all read
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto content-column">
        {loading && notifications.length === 0 && (
          <SkeletonNoteList count={4} />
        )}

        {!loading && filteredNotifications.length === 0 && (
          <div className="px-4 py-12 text-center space-y-2">
            <p className="text-text-dim text-[13px]">No mentions yet.</p>
            <p className="text-text-dim text-[11px] opacity-60">When someone mentions you, it will appear here.</p>
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
