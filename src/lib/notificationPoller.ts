import { fetchMentions, fetchZapsReceived, fetchNewFollowers, fetchProfile } from "./nostr";
import { notifyMention, notifyZap, notifyFollower } from "./notifications";
import { useNotificationsStore } from "../stores/notifications";

const POLL_INTERVAL = 60_000; // 60 seconds
const POLL_TS_KEY = "wrystr_notif_poll_ts";
const MAX_SEEN = 200;

let intervalId: ReturnType<typeof setInterval> | null = null;
const recentlySeen = new Set<string>();

function loadPollTimestamps(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(POLL_TS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function savePollTimestamps(ts: Record<string, number>) {
  localStorage.setItem(POLL_TS_KEY, JSON.stringify(ts));
}

function trimSeenSet() {
  if (recentlySeen.size > MAX_SEEN) {
    const arr = Array.from(recentlySeen);
    arr.splice(0, arr.length - MAX_SEEN);
    recentlySeen.clear();
    arr.forEach((id) => recentlySeen.add(id));
  }
}

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
  const ts = loadPollTimestamps();
  const now = Math.floor(Date.now() / 1000);

  // Mentions
  try {
    const mentionsSince = ts.mentions || (now - 300);
    const mentions = await fetchMentions(pubkey, mentionsSince, 10);
    for (const e of mentions) {
      if (recentlySeen.has(e.id!)) continue;
      if (e.pubkey === pubkey) continue; // don't notify self-mentions
      recentlySeen.add(e.id!);
      const name = await getProfileName(e.pubkey);
      notifyMention(name, e.content?.slice(0, 120) || "mentioned you").catch(() => {});
    }
    if (mentions.length > 0) ts.mentions = now;
    // Also update the notifications store unread count
    useNotificationsStore.getState().fetchNotifications(pubkey).catch(() => {});
  } catch { /* non-critical */ }

  // Zaps
  try {
    const zapsSince = ts.zaps || (now - 300);
    const zaps = await fetchZapsReceived(pubkey, 10);
    for (const e of zaps) {
      if (recentlySeen.has(e.id!)) continue;
      if ((e.created_at ?? 0) <= zapsSince) continue;
      recentlySeen.add(e.id!);
      // Extract sender and amount from zap receipt
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
    ts.zaps = now;
  } catch { /* non-critical */ }

  // New followers
  try {
    const followersSince = ts.followers || (now - 300);
    const followers = await fetchNewFollowers(pubkey, followersSince, 5);
    for (const e of followers) {
      if (recentlySeen.has(e.id!)) continue;
      if (e.pubkey === pubkey) continue;
      recentlySeen.add(e.id!);
      const name = await getProfileName(e.pubkey);
      notifyFollower(name).catch(() => {});
      useNotificationsStore.getState().incrementNewFollowers();
    }
    if (followers.length > 0) ts.followers = now;
  } catch { /* non-critical */ }

  trimSeenSet();
  savePollTimestamps(ts);
}

export function startNotificationPoller(pubkey: string) {
  stopNotificationPoller();
  // Run first poll after a short delay (let relays connect)
  setTimeout(() => pollOnce(pubkey).catch(() => {}), 5000);
  intervalId = setInterval(() => pollOnce(pubkey).catch(() => {}), POLL_INTERVAL);
}

export function stopNotificationPoller() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
