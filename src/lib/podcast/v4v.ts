import { fetchWithProxy as fetch } from "../proxy";
import type { PodcastEpisode, V4VRecipient } from "../../types/podcast";
import { payInvoiceViaNWC, payKeysendViaNWC } from "../lightning/nwc";
import { useV4VStore } from "../../stores/v4v";
import { useToastStore } from "../../stores/toast";

const LNURL_CACHE: Record<string, string> = {};

async function fetchLnurlPayInvoice(lud16: string, amountMsats: number): Promise<string | null> {
  try {
    const [name, domain] = lud16.split("@");
    if (!name || !domain) return null;

    // Fetch LNURL-pay endpoint
    const wellKnownUrl = `https://${domain}/.well-known/lnurlp/${name}`;
    const cacheKey = wellKnownUrl;

    let callbackUrl = LNURL_CACHE[cacheKey];
    if (!callbackUrl) {
      const res = await fetch(wellKnownUrl);
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.callback) return null;
      callbackUrl = data.callback;
      LNURL_CACHE[cacheKey] = callbackUrl;
    }

    // Request invoice
    const separator = callbackUrl.includes("?") ? "&" : "?";
    const invoiceRes = await fetch(`${callbackUrl}${separator}amount=${amountMsats}`);
    if (!invoiceRes.ok) return null;
    const invoiceData = await invoiceRes.json();
    return invoiceData.pr ?? null;
  } catch {
    return null;
  }
}

function getRecipients(episode: PodcastEpisode): V4VRecipient[] {
  if (episode.value && episode.value.length > 0) return episode.value;
  return [];
}

async function payRecipient(
  recipient: V4VRecipient,
  amountMsats: number,
  nwcUri: string,
): Promise<boolean> {
  if (!recipient.address) return false;

  const isLnAddress = recipient.address.includes("@");
  const isNodePubkey = /^[0-9a-f]{66}$/i.test(recipient.address);

  if (isLnAddress) {
    const invoice = await fetchLnurlPayInvoice(recipient.address, amountMsats);
    if (!invoice) return false;
    await payInvoiceViaNWC(nwcUri, invoice);
    return true;
  }

  if (isNodePubkey) {
    const tlvRecords: { type: number; value: string }[] = [];
    if (recipient.customKey && recipient.customValue) {
      tlvRecords.push({
        type: parseInt(recipient.customKey, 10),
        value: recipient.customValue,
      });
    }
    await payKeysendViaNWC(nwcUri, recipient.address, amountMsats, tlvRecords);
    return true;
  }

  return false;
}

let streamingInterval: number | null = null;
let accumulatedSats = 0;
let accumulatedMinutes = 0;
let currentStreamingEpisode: PodcastEpisode | null = null;
let sessionRecipientSats: Record<string, number> = {};

export function startStreaming(
  episode: PodcastEpisode,
  satsPerMinute: number,
  nwcUri: string,
  onPayment: (amount: number) => void,
): number {
  stopStreaming();

  accumulatedSats = 0;
  accumulatedMinutes = 0;
  currentStreamingEpisode = episode;
  sessionRecipientSats = {};
  const recipients = getRecipients(episode);

  if (recipients.length === 0) return -1;

  const v4vStore = useV4VStore.getState();
  v4vStore.resetCurrentEpisodeSats();

  // Normalize splits to sum to 100
  const totalSplit = recipients.reduce((sum, r) => sum + r.split, 0);

  streamingInterval = window.setInterval(async () => {
    // Check budget caps before accumulating
    const v4v = useV4VStore.getState();
    if (v4v.isCapReached()) {
      const reason = v4v.perEpisodeCap > 0 && v4v.currentEpisodeSats >= v4v.perEpisodeCap
        ? "Per-episode cap reached"
        : "Weekly budget reached";
      useToastStore.getState().addToast(reason, "warning", 6000);
      v4v.setCapReachedReason(reason);
      stopStreaming();
      return;
    }

    accumulatedMinutes += 1;
    accumulatedSats += satsPerMinute;

    // Accumulate for 5 minutes before paying to avoid rate limits
    if (accumulatedMinutes < 5 && accumulatedMinutes > 0) return;

    const satsToSend = accumulatedSats;
    accumulatedSats = 0;
    accumulatedMinutes = 0;

    for (const recipient of recipients) {
      const share = totalSplit > 0 ? recipient.split / totalSplit : 1 / recipients.length;
      const recipientSats = Math.max(1, Math.round(satsToSend * share));
      const amountMsats = recipientSats * 1000;

      try {
        const success = await payRecipient(recipient, amountMsats, nwcUri);
        if (success) {
          onPayment(recipientSats);
          useV4VStore.getState().addCurrentEpisodeSats(recipientSats);
          const key = recipient.name || recipient.address || "unknown";
          sessionRecipientSats[key] = (sessionRecipientSats[key] || 0) + recipientSats;
        }
      } catch {
        // Payment failed — silently continue
      }
    }
  }, 60000); // Every 60 seconds

  return streamingInterval;
}

function recordHistory() {
  const episode = currentStreamingEpisode;
  if (!episode) return;

  const v4v = useV4VStore.getState();
  const totalStreamed = v4v.currentEpisodeSats;
  if (totalStreamed <= 0) return;

  const recipients = Object.entries(sessionRecipientSats).map(([name, sats]) => ({
    name,
    address: "",
    sats,
  }));

  v4v.addHistoryEntry({
    episodeGuid: episode.guid,
    episodeTitle: episode.title,
    showTitle: episode.showTitle || "",
    satsStreamed: totalStreamed,
    satsBoosted: 0,
    recipients,
    timestamp: Date.now(),
  });
}

export function stopStreaming() {
  if (streamingInterval !== null) {
    recordHistory();
    clearInterval(streamingInterval);
    streamingInterval = null;
  }
  accumulatedSats = 0;
  accumulatedMinutes = 0;
  currentStreamingEpisode = null;
  sessionRecipientSats = {};
}

export async function boost(
  episode: PodcastEpisode,
  totalSats: number,
  nwcUri: string,
): Promise<number> {
  const recipients = getRecipients(episode);
  if (recipients.length === 0) return 0;

  const totalSplit = recipients.reduce((sum, r) => sum + r.split, 0);
  let paid = 0;

  for (const recipient of recipients) {
    const share = totalSplit > 0 ? recipient.split / totalSplit : 1 / recipients.length;
    const recipientSats = Math.max(1, Math.round(totalSats * share));
    const amountMsats = recipientSats * 1000;

    try {
      const success = await payRecipient(recipient, amountMsats, nwcUri);
      if (success) paid += recipientSats;
    } catch {
      // continue
    }
  }

  return paid;
}
