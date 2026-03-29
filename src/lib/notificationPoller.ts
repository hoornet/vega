import { fetchMentions, fetchZapsReceived, fetchNewFollowers, fetchProfile, ensureConnected } from "./nostr";
import { notifyMention, notifyZap, notifyFollower } from "./notifications";
import { useNotificationsStore } from "../stores/notifications";
import { dbSaveNotifications, dbNewestNotificationTs } from "./db";
import { debug } from "./debug";

const POLL_INTERVAL = 60_000; // 60 seconds

let intervalId: ReturnType<typeof setInterval> | null = null;

async function getProfileName(pubkey: string): Promise<string> {
  try {
    const p = await fetchProfile(pubkey);
    if (p) {
      const meta = p as Record<string, string>;
      return meta.display_name || meta.name || pubkey.slice(0, 8) + "…";
    }
  } catch { /* ignore */ }
  return pubkey.slice(0, 8) + "…";
}

async function pollOnce(pubkey: string) {
  // Skip polling if no relays are connected — avoids empty results
  try {
    const connected = await ensureConnected();
    if (!connected) {
      debug.warn("notif:poll skipped — no relays connected");
      return;
    }
  } catch { return; }

  const now = Math.floor(Date.now() / 1000);
  const existingIds = new Set(
    useNotificationsStore.getState().notifications.map((e) => e.id!)
  );

  // Mentions
  try {
    const mentionsSince = (await dbNewestNotificationTs(pubkey, "mention")) ?? (now - 300);
    const mentions = await fetchMentions(pubkey, mentionsSince, 10);
    const newMentions = mentions.filter((e) => e.pubkey !== pubkey && !existingIds.has(e.id!));
    if (newMentions.length > 0) {
      dbSaveNotifications(newMentions.map((e) => JSON.stringify(e.rawEvent())), pubkey, "mention");
      for (const e of newMentions) {
        const name = await getProfileName(e.pubkey);
        notifyMention(name, e.content?.slice(0, 120) || "mentioned you").catch(() => {});
      }
    }
    // Also update the notifications store
    useNotificationsStore.getState().fetchNotifications(pubkey).catch(() => {});
  } catch { /* non-critical */ }

  // Zaps
  try {
    const zapsSince = (await dbNewestNotificationTs(pubkey, "zap")) ?? (now - 300);
    const zaps = await fetchZapsReceived(pubkey, 10);
    const newZaps = zaps.filter((e) => !existingIds.has(e.id!) && (e.created_at ?? 0) > zapsSince);
    if (newZaps.length > 0) {
      dbSaveNotifications(newZaps.map((e) => JSON.stringify(e.rawEvent())), pubkey, "zap");
      for (const e of newZaps) {
        const desc = e.tags.find((t) => t[0] === "description")?.[1];
        let senderName = "Someone";
        let amount = 0;
        if (desc) {
          try {
            const zapReq = JSON.parse(desc) as { pubkey?: string; tags?: string[][] };
            if (zapReq.pubkey) senderName = await getProfileName(zapReq.pubkey);
            const amountTag = zapReq.tags?.find((t) => t[0] === "amount");
            if (amountTag?.[1]) amount = Math.round(parseInt(amountTag[1]) / 1000);
          } catch { /* malformed */ }
        }
        if (amount > 0) {
          notifyZap(senderName, amount).catch(() => {});
        }
      }
    }
  } catch { /* non-critical */ }

  // New followers — dedup by pubkey, not event ID (kind 3 is replaceable, same
  // person produces a new event ID every time they update their contact list)
  try {
    const followersSince = (await dbNewestNotificationTs(pubkey, "follower")) ?? (now - 300);
    const followers = await fetchNewFollowers(pubkey, followersSince, 5);
    const existingFollowerPubkeys = new Set(
      useNotificationsStore.getState().notifications
        .filter((e) => e.kind === 3)
        .map((e) => e.pubkey)
    );
    const newFollowers = followers.filter((e) => e.pubkey !== pubkey && !existingFollowerPubkeys.has(e.pubkey));
    if (newFollowers.length > 0) {
      dbSaveNotifications(newFollowers.map((e) => JSON.stringify(e.rawEvent())), pubkey, "follower");
      for (const e of newFollowers) {
        const name = await getProfileName(e.pubkey);
        notifyFollower(name).catch(() => {});
        useNotificationsStore.getState().incrementNewFollowers();
      }
    }
  } catch { /* non-critical */ }
}

export function startNotificationPoller(pubkey: string) {
  stopNotificationPoller();

  // Instant: load cached notifications from DB (no flicker)
  useNotificationsStore.getState().loadFromDb(pubkey);

  // Then connect to relays and fetch new data in background
  (async () => {
    try {
      const connected = await ensureConnected();
      debug.log("notif:poller ensureConnected →", connected);
    } catch { /* continue anyway */ }
    debug.log("notif:poller initial fetch for", pubkey.slice(0, 8));
    useNotificationsStore.getState().fetchNotifications(pubkey).catch(() => {});
  })();

  // Run first full poll after a longer delay (give relays more time)
  setTimeout(() => pollOnce(pubkey).catch(() => {}), 8000);
  intervalId = setInterval(() => pollOnce(pubkey).catch(() => {}), POLL_INTERVAL);
}

export function stopNotificationPoller() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
