import { fetch } from "@tauri-apps/plugin-http";
import type { PodcastEpisode, V4VRecipient } from "../../types/podcast";
import { payInvoiceViaNWC } from "../lightning/nwc";

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

let streamingInterval: number | null = null;
let accumulatedSats = 0;
let accumulatedMinutes = 0;

export function startStreaming(
  episode: PodcastEpisode,
  satsPerMinute: number,
  nwcUri: string,
  onPayment: (amount: number) => void,
): number {
  stopStreaming();

  accumulatedSats = 0;
  accumulatedMinutes = 0;
  const recipients = getRecipients(episode);

  if (recipients.length === 0) return -1;

  // Normalize splits to sum to 100
  const totalSplit = recipients.reduce((sum, r) => sum + r.split, 0);

  streamingInterval = window.setInterval(async () => {
    accumulatedMinutes += 1;
    accumulatedSats += satsPerMinute;

    // Accumulate for 5 minutes before paying to avoid rate limits
    if (accumulatedMinutes < 5 && accumulatedMinutes > 0) return;

    const satsToSend = accumulatedSats;
    accumulatedSats = 0;
    accumulatedMinutes = 0;

    for (const recipient of recipients) {
      if (!recipient.address || !recipient.address.includes("@")) continue;

      const share = totalSplit > 0 ? recipient.split / totalSplit : 1 / recipients.length;
      const recipientSats = Math.max(1, Math.round(satsToSend * share));
      const amountMsats = recipientSats * 1000;

      try {
        const invoice = await fetchLnurlPayInvoice(recipient.address, amountMsats);
        if (!invoice) continue;
        await payInvoiceViaNWC(nwcUri, invoice);
        onPayment(recipientSats);
      } catch {
        // Payment failed — silently continue
      }
    }
  }, 60000); // Every 60 seconds

  return streamingInterval;
}

export function stopStreaming() {
  if (streamingInterval !== null) {
    clearInterval(streamingInterval);
    streamingInterval = null;
  }
  accumulatedSats = 0;
  accumulatedMinutes = 0;
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
    if (!recipient.address || !recipient.address.includes("@")) continue;

    const share = totalSplit > 0 ? recipient.split / totalSplit : 1 / recipients.length;
    const recipientSats = Math.max(1, Math.round(totalSats * share));
    const amountMsats = recipientSats * 1000;

    try {
      const invoice = await fetchLnurlPayInvoice(recipient.address, amountMsats);
      if (!invoice) continue;
      await payInvoiceViaNWC(nwcUri, invoice);
      paid += recipientSats;
    } catch {
      // continue
    }
  }

  return paid;
}
