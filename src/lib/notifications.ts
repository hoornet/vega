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
}

const defaults: NotificationSettings = { mentions: true, dms: true, zaps: true };

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
    body: preview.slice(0, 120),
  });
}

export async function notifyDM(authorName: string, preview: string): Promise<void> {
  const settings = getNotificationSettings();
  if (!settings.dms) return;
  if (!(await ensurePermission())) return;
  sendNotification({
    title: `DM from ${authorName}`,
    body: preview.slice(0, 120),
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
