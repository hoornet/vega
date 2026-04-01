import { nip19 } from "@nostr-dev-kit/ndk";

// Regex patterns
const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/g;
const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|svg)(\?[^\s]*)?$/i;
const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|ogg|m4v|avi)(\?[^\s]*)?$/i;
const AUDIO_EXTENSIONS = /\.(mp3|wav|flac|aac|m4a|opus|ogg)(\?[^\s]*)?$/i;
const YOUTUBE_REGEX = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
const TIDAL_REGEX = /tidal\.com\/(?:browse\/)?(?:track|album|playlist)\/([a-zA-Z0-9-]+)/;
const SPOTIFY_REGEX = /open\.spotify\.com\/(track|album|playlist|episode|show)\/([a-zA-Z0-9]+)/;
const VIMEO_REGEX = /vimeo\.com\/(\d+)/;
const FOUNTAIN_REGEX = /fountain\.fm\/(episode|show)\/([a-zA-Z0-9-]+)/;
const NOSTR_MENTION_REGEX = /nostr:(npub1[a-z0-9]+|note1[a-z0-9]+|nevent1[a-z0-9]+|nprofile1[a-z0-9]+|naddr1[a-z0-9]+)/g;
const HASHTAG_REGEX = /(?<=\s|^)#(\w{2,})/g;

export interface ContentSegment {
  type: "text" | "link" | "image" | "video" | "audio" | "youtube" | "vimeo" | "spotify" | "tidal" | "fountain" | "mention" | "hashtag" | "quote" | "naddr";
  value: string;  // for "quote": the hex event ID; for "naddr": raw bech32
  display?: string;
  mediaId?: string;       // video/embed ID for youtube/vimeo
  mediaType?: string;     // e.g. "track", "album" for spotify/tidal
  mentionPubkey?: string; // hex pubkey for npub/nprofile mentions
  naddrKind?: number;     // event kind for naddr references
  naddrPubkey?: string;   // author pubkey for naddr references
  naddrIdentifier?: string; // "d" tag for naddr references
}

export function parseContent(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  const allMatches: { index: number; length: number; segment: ContentSegment }[] = [];

  // Find URLs
  let match: RegExpExecArray | null;
  const urlRegex = new RegExp(URL_REGEX.source, "g");
  while ((match = urlRegex.exec(content)) !== null) {
    const url = match[0];
    // Clean trailing punctuation that's likely not part of the URL
    const cleaned = url.replace(/[.,;:!?)]+$/, "");

    if (IMAGE_EXTENSIONS.test(cleaned)) {
      allMatches.push({
        index: match.index,
        length: cleaned.length,
        segment: { type: "image", value: cleaned },
      });
    } else if (VIDEO_EXTENSIONS.test(cleaned)) {
      allMatches.push({
        index: match.index,
        length: cleaned.length,
        segment: { type: "video", value: cleaned },
      });
    } else if (AUDIO_EXTENSIONS.test(cleaned)) {
      allMatches.push({
        index: match.index,
        length: cleaned.length,
        segment: { type: "audio", value: cleaned },
      });
    } else {
      // Check for embeddable media URLs
      const ytMatch = cleaned.match(YOUTUBE_REGEX);
      const vimeoMatch = cleaned.match(VIMEO_REGEX);
      const spotifyMatch = cleaned.match(SPOTIFY_REGEX);
      const tidalMatch = cleaned.match(TIDAL_REGEX);

      if (ytMatch) {
        allMatches.push({
          index: match.index,
          length: cleaned.length,
          segment: { type: "youtube", value: cleaned, mediaId: ytMatch[1] },
        });
      } else if (vimeoMatch) {
        allMatches.push({
          index: match.index,
          length: cleaned.length,
          segment: { type: "vimeo", value: cleaned, mediaId: vimeoMatch[1] },
        });
      } else if (spotifyMatch) {
        allMatches.push({
          index: match.index,
          length: cleaned.length,
          segment: { type: "spotify", value: cleaned, mediaType: spotifyMatch[1], mediaId: spotifyMatch[2] },
        });
      } else if (tidalMatch) {
        // Extract the type (track/album/playlist) from the URL
        const tidalTypeMatch = cleaned.match(/tidal\.com\/(?:browse\/)?(track|album|playlist)\//);
        allMatches.push({
          index: match.index,
          length: cleaned.length,
          segment: { type: "tidal", value: cleaned, mediaType: tidalTypeMatch?.[1] ?? "track", mediaId: tidalMatch[1] },
        });
      } else if (FOUNTAIN_REGEX.test(cleaned)) {
        const fmMatch = cleaned.match(FOUNTAIN_REGEX);
        allMatches.push({
          index: match.index,
          length: cleaned.length,
          segment: { type: "fountain", value: cleaned, mediaType: fmMatch?.[1] ?? "episode", mediaId: fmMatch?.[2] },
        });
      } else {
        // Shorten display URL
        let display = cleaned;
        try {
          const u = new URL(cleaned);
          display = u.hostname + (u.pathname !== "/" ? u.pathname : "");
          if (display.length > 50) display = display.slice(0, 47) + "…";
        } catch { /* keep as-is */ }

        allMatches.push({
          index: match.index,
          length: cleaned.length,
          segment: { type: "link", value: cleaned, display },
        });
      }
    }
  }

  // Find nostr: mentions
  const mentionRegex = new RegExp(NOSTR_MENTION_REGEX.source, "g");
  while ((match = mentionRegex.exec(content)) !== null) {
    const raw = match[1];
    let display = raw.slice(0, 12) + "…";
    let mentionPubkey: string | undefined;

    let isQuote = false;
    let isNaddr = false;
    let naddrData: { kind: number; pubkey: string; identifier: string } | null = null;
    let eventId = "";
    try {
      const decoded = nip19.decode(raw);
      if (decoded.type === "npub") {
        mentionPubkey = decoded.data as string;
      } else if (decoded.type === "nprofile") {
        mentionPubkey = (decoded.data as { pubkey: string }).pubkey;
      } else if (decoded.type === "note") {
        // Always treat note1 references as inline quotes
        isQuote = true;
        eventId = decoded.data as string;
      } else if (decoded.type === "nevent") {
        const d = decoded.data as { id: string; kind?: number };
        // Only quote kind-1 notes (or unknown kind)
        if (!d.kind || d.kind === 1) {
          isQuote = true;
          eventId = d.id;
        } else {
          display = "event:" + raw.slice(7, 15) + "…";
        }
      } else if (decoded.type === "naddr") {
        const d = decoded.data as { kind: number; pubkey: string; identifier: string };
        isNaddr = true;
        naddrData = d;
      }
    } catch { /* keep default */ }

    allMatches.push({
      index: match.index,
      length: match[0].length,
      segment: isQuote
        ? { type: "quote", value: eventId }
        : isNaddr && naddrData
          ? { type: "naddr", value: raw, naddrKind: naddrData.kind, naddrPubkey: naddrData.pubkey, naddrIdentifier: naddrData.identifier }
          : { type: "mention", value: raw, display, mentionPubkey },
    });
  }

  // Find hashtags
  const hashtagRegex = new RegExp(HASHTAG_REGEX.source, "g");
  while ((match = hashtagRegex.exec(content)) !== null) {
    allMatches.push({
      index: match.index,
      length: match[0].length,
      segment: { type: "hashtag", value: match[1], display: `#${match[1]}` },
    });
  }

  // Sort matches by index, remove overlaps
  allMatches.sort((a, b) => a.index - b.index);
  const filtered: typeof allMatches = [];
  let lastEnd = 0;
  for (const m of allMatches) {
    if (m.index >= lastEnd) {
      filtered.push(m);
      lastEnd = m.index + m.length;
    }
  }

  // Build segments
  let cursor = 0;
  for (const m of filtered) {
    if (m.index > cursor) {
      segments.push({ type: "text", value: content.slice(cursor, m.index) });
    }
    segments.push(m.segment);
    cursor = m.index + m.length;
  }
  if (cursor < content.length) {
    segments.push({ type: "text", value: content.slice(cursor) });
  }

  return segments;
}
