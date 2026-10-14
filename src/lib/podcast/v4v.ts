import { fetchWithProxy as fetch } from "../proxy";
import type { PodcastEpisode, V4VRecipient } from "../../types/podcast";
import { payInvoiceViaNWC, payKeysendViaNWC, NwcTimeoutError } from "../lightning/nwc";
import { clipText } from "../utils";
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

/**
 * How a payment ended. "sent": the request reached the wallet's relay and the
 * wallet did not answer in time; the sats have most likely left, so it is
 * counted. Until October 2026 it was a failure, and the counter stayed at zero
 * while 1-sat payments were arriving.
 */
export type PayOutcome = { outcome: "paid" | "sent" } | { outcome: "failed"; reason: string };

function describeFailure(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return clipText(text.replace(/^Error:\s*/i, ""), 90) || "no reason given";
}

async function settle(request: Promise<unknown>): Promise<PayOutcome> {
  try {
    await request;
    return { outcome: "paid" };
  } catch (err) {
    if (err instanceof NwcTimeoutError) return { outcome: "sent" };
    return { outcome: "failed", reason: describeFailure(err) };
  }
}

async function payRecipient(
  recipient: V4VRecipient,
  amountMsats: number,
  nwcUri: string,
): Promise<PayOutcome> {
  if (!recipient.address) return { outcome: "failed", reason: "the recipient has no address" };

  const isLnAddress = recipient.address.includes("@");
  const isNodePubkey = /^[0-9a-f]{66}$/i.test(recipient.address);

  if (isLnAddress) {
    const invoice = await fetchLnurlPayInvoice(recipient.address, amountMsats);
    if (!invoice) return { outcome: "failed", reason: `no invoice came from ${recipient.address}` };
    return settle(payInvoiceViaNWC(nwcUri, invoice));
  }

  if (isNodePubkey) {
    const tlvRecords: { type: number; value: string }[] = [];
    if (recipient.customKey && recipient.customValue) {
      tlvRecords.push({
        type: parseInt(recipient.customKey, 10),
        value: recipient.customValue,
      });
    }
    return settle(payKeysendViaNWC(nwcUri, recipient.address, amountMsats, tlvRecords));
  }

  return { outcome: "failed", reason: "the address is neither a Lightning address nor a node key" };
}

/** Once per episode and recipient: a payment that did not go out, on the dashboard and in a toast. */
let failedThisEpisode = new Set<string>();
function reportFailure(recipient: V4VRecipient, reason: string): void {
  const name = recipient.name || recipient.address || "a recipient";
  useV4VStore.getState().setLastFailure({ recipient: name, reason });
  if (failedThisEpisode.has(name)) return;
  failedThisEpisode.add(name);
  useToastStore.getState().addToast(`Couldn't pay ${clipText(name, 40)}: ${reason}. Streaming goes on.`, "warning", { key: `v4v:${name}` });
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
  failedThisEpisode = new Set();
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

      const result = await payRecipient(recipient, amountMsats, nwcUri);
      if (result.outcome === "failed") {
        reportFailure(recipient, result.reason);
        continue;
      }
      // Paid, or sent without the wallet's answer: the sats left either way.
      onPayment(recipientSats);
      useV4VStore.getState().addCurrentEpisodeSats(recipientSats, result.outcome === "sent");
      const key = recipient.name || recipient.address || "unknown";
      sessionRecipientSats[key] = (sessionRecipientSats[key] || 0) + recipientSats;
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

    const result = await payRecipient(recipient, amountMsats, nwcUri);
    if (result.outcome === "failed") {
      reportFailure(recipient, result.reason);
      continue;
    }
    paid += recipientSats;
  }

  return paid;
}
