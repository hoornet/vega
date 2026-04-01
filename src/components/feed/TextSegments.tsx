import { ReactNode } from "react";
import { nip19 } from "@nostr-dev-kit/ndk";
import { useUIStore } from "../../stores/ui";
import { useProfile } from "../../hooks/useProfile";
import { ContentSegment } from "../../lib/parsing";

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
      const { kind } = decoded.data as { kind: number; pubkey: string; identifier: string };
      if (kind === 30023) {
        openArticle(raw);
        return true;
      }
    }
    // note / nevent / other naddr kinds — fall through to njump.me
  } catch { /* invalid entity */ }
  return false;
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
