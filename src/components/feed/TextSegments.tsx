import { ReactNode, useState, useEffect } from "react";
import { nip19, NDKFilter, NDKKind } from "@nostr-dev-kit/ndk";
import { useUIStore } from "../../stores/ui";
import { useProfile } from "../../hooks/useProfile";
import { ContentSegment } from "../../lib/parsing";
import { getNDK, fetchWithTimeout } from "../../lib/nostr";

// Returns true if we handled the URL internally (njump.me interception).
export function tryHandleUrlInternally(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.hostname === "njump.me") {
      const entity = u.pathname.replace(/^\//, "");
      if (entity) return tryOpenNostrEntity(entity);
    }
  } catch { /* not a valid URL */ }
  return false;
}

// Decodes a NIP-19 bech32 string and navigates internally where possible.
// Returns true if handled, false if the caller should fall back to a browser open.
export function tryOpenNostrEntity(raw: string): boolean {
  try {
    const decoded = nip19.decode(raw);
    const { openProfile, openArticle } = useUIStore.getState();
    if (decoded.type === "npub") {
      openProfile(decoded.data as string);
      return true;
    }
    if (decoded.type === "nprofile") {
      openProfile((decoded.data as { pubkey: string }).pubkey);
      return true;
    }
    if (decoded.type === "naddr") {
      const { kind, pubkey } = decoded.data as { kind: number; pubkey: string; identifier: string };
      if (kind === 30023) {
        openArticle(raw);
        return true;
      }
      // For other addressable kinds (app listings, emoji sets, etc.)
      // open the author's profile as the best available in-app destination
      if (pubkey) {
        openProfile(pubkey);
        return true;
      }
    }
    // note / nevent — fall through to njump.me
  } catch { /* invalid entity */ }
  return false;
}

/** Resolves an naddr reference to a human-readable name by fetching the event. */
function NaddrName({ kind, pubkey, identifier, fallback }: { kind: number; pubkey: string; identifier: string; fallback: string }) {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const filter: NDKFilter = { kinds: [kind as NDKKind], authors: [pubkey], "#d": [identifier], limit: 1 };
        const events = await fetchWithTimeout(getNDK(), filter, 5000);
        if (cancelled) return;
        const event = Array.from(events)[0];
        if (!event) return;

        // Helper: return string if non-empty, else undefined
        const tagVal = (key: string) => {
          const v = event.tags.find((t) => t[0] === key)?.[1];
          return typeof v === "string" && v.trim() ? v.trim() : undefined;
        };

        // Try tags first: title, name, d
        let resolved = tagVal("title") || tagVal("name") || tagVal("d");

        // If no tag found, try parsing content as JSON (some kinds store metadata in content)
        if (!resolved && event.content) {
          try {
            const json = JSON.parse(event.content);
            const candidate = json.display_name || json.name || json.title;
            if (typeof candidate === "string" && candidate.trim()) {
              resolved = candidate.trim();
            }
          } catch { /* not JSON, ignore */ }
        }

        if (resolved) setName(resolved);
      } catch { /* keep fallback */ }
    })();
    return () => { cancelled = true; };
  }, [kind, pubkey, identifier]);

  return <>{name || fallback}</>;
}

export function MentionName({ pubkey, fallback }: { pubkey?: string; fallback: string }) {
  const profile = useProfile(pubkey ?? "");
  if (!pubkey) return <>{fallback}</>;
  const raw = profile?.displayName || profile?.name;
  const name = typeof raw === "string" ? raw : null;
  return <>{name || fallback}</>;
}

interface RenderTextSegmentsOptions {
  /** If true, use MentionName component for mentions (inline mode). If false, use seg.display directly. */
  resolveMentions?: boolean;
}

export function renderTextSegments(
  segments: ContentSegment[],
  openHashtag: (tag: string) => void,
  options: RenderTextSegmentsOptions = {}
): ReactNode[] {
  const { resolveMentions = false } = options;
  const elements: ReactNode[] = [];

  segments.forEach((seg, i) => {
    switch (seg.type) {
      case "text":
        elements.push(<span key={i}>{typeof seg.value === "string" ? seg.value : String(seg.value)}</span>);
        break;
      case "link":
        elements.push(
          <a
            key={i}
            href={seg.value}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:text-accent-hover underline underline-offset-2 decoration-accent/40"
            onClick={(e) => {
              if (tryHandleUrlInternally(seg.value)) e.preventDefault();
            }}
          >
            {typeof seg.display === "string" ? seg.display : String(seg.display)}
          </a>
        );
        break;
      case "mention":
        elements.push(
          <span
            key={i}
            className="text-accent cursor-pointer hover:text-accent-hover"
            onClick={(e) => { e.stopPropagation(); tryOpenNostrEntity(seg.value); }}
          >
            @{resolveMentions
              ? <MentionName pubkey={seg.mentionPubkey} fallback={String(seg.display ?? seg.value).slice(0, 12) + "…"} />
              : String(seg.display ?? seg.value)}
          </span>
        );
        break;
      case "naddr":
        elements.push(
          <span
            key={i}
            className="text-accent cursor-pointer hover:text-accent-hover inline-flex items-center gap-0.5"
            onClick={(e) => { e.stopPropagation(); tryOpenNostrEntity(seg.value); }}
            title={`Kind ${seg.naddrKind} — click to open`}
          >
            <span className="opacity-60 text-xs">&#x1F517;</span>
            <NaddrName
              kind={seg.naddrKind!}
              pubkey={seg.naddrPubkey!}
              identifier={seg.naddrIdentifier!}
              fallback={seg.value.slice(0, 16) + "…"}
            />
          </span>
        );
        break;
      case "hashtag":
        elements.push(
          <span
            key={i}
            className="text-accent/80 cursor-pointer hover:text-accent"
            onClick={(e) => { e.stopPropagation(); openHashtag(seg.value); }}
          >
            {String(seg.display ?? seg.value)}
          </span>
        );
        break;
      default:
        break;
    }
  });

  return elements;
}
