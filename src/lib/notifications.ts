import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

const SETTINGS_KEY = "wrystr_notification_settings";

interface NotificationSettings {
  mentions: boolean;
  dms: boolean;
  zaps: boolean;
  followers: boolean;
}

const defaults: NotificationSettings = { mentions: true, dms: true, zaps: true, followers: true };

export function getNotificationSettings(): NotificationSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    return stored ? { ...defaults, ...JSON.parse(stored) } : defaults;
  } catch {
    return defaults;
  }
}

export function saveNotificationSettings(settings: NotificationSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export async function ensurePermission(): Promise<boolean> {
  let granted = await isPermissionGranted();
  if (!granted) {
    const result = await requestPermission();
    granted = result === "granted";
  }
  return granted;
}

export async function notifyMention(authorName: string, preview: string): Promise<void> {
  const settings = getNotificationSettings();
  if (!settings.mentions) return;
  if (!(await ensurePermission())) return;
  sendNotification({
    title: `${authorName} mentioned you`,
    body: preview.slice(0, 120) || "New mention",
  });
}

/**
 * Deliberately title-only: no message body. Vega's whole point with DMs is that
 * they're encrypted, and an OS notification is the one place that content would
 * leave the app — onto a lock screen, a notification daemon's history, or a
 * screen being shared. The notification's job is "go look", and the message is
 * one click away.
 *
 * Takes no message content by design — mentions and zaps still show theirs,
 * which is public either way.
 */
export async function notifyDM(authorName: string): Promise<void> {
  const settings = getNotificationSettings();
  if (!settings.dms) return;
  if (!(await ensurePermission())) return;
  sendNotification({
    title: "New message",
    body: `from ${authorName}`,
  });
}

export async function notifyZap(senderName: string, amount: number): Promise<void> {
  const settings = getNotificationSettings();
  if (!settings.zaps) return;
  if (!(await ensurePermission())) return;
  sendNotification({
    title: `${senderName} zapped you`,
    body: `${amount.toLocaleString()} sats`,
  });
}

export async function notifyFollower(followerName: string): Promise<void> {
  const settings = getNotificationSettings();
  if (!settings.followers) return;
  if (!(await ensurePermission())) return;
  sendNotification({
    title: `${followerName} followed you`,
    body: "You have a new follower",
  });
}
