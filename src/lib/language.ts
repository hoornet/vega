// Unicode script detection for feed filtering

const SCRIPT_RANGES: [string, RegExp][] = [
  ["Latin", /[\u0041-\u024F\u1E00-\u1EFF]/],
  ["CJK", /[\u2E80-\u2FFF\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]|[\uD840-\uD87F][\uDC00-\uDFFF]/],
  ["Cyrillic", /[\u0400-\u04FF\u0500-\u052F]/],
  ["Arabic", /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/],
  ["Devanagari", /[\u0900-\u097F]/],
  ["Thai", /[\u0E00-\u0E7F]/],
  ["Korean", /[\uAC00-\uD7AF\u1100-\u11FF]/],
  ["Hebrew", /[\u0590-\u05FF]/],
  ["Greek", /[\u0370-\u03FF]/],
  ["Georgian", /[\u10A0-\u10FF]/],
  ["Armenian", /[\u0530-\u058F]/],
];

export function detectScript(text: string): string {
  // Strip URLs, mentions, hashtags to avoid noise
  const cleaned = text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/nostr:\S+/g, "")
    .replace(/#\w+/g, "")
    .trim();

  if (!cleaned) return "Unknown";

  // Count characters per script
  const counts = new Map<string, number>();
  for (const char of cleaned) {
    for (const [name, regex] of SCRIPT_RANGES) {
      if (regex.test(char)) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
        break;
      }
    }
  }

  if (counts.size === 0) return "Unknown";

  // Return dominant script
  let maxScript = "Unknown";
  let maxCount = 0;
  for (const [script, count] of counts) {
    if (count > maxCount) {
      maxScript = script;
      maxCount = count;
    }
  }

  return maxScript;
}

// Check NIP-32 language tags on an event
export function getEventLanguageTag(tags: string[][]): string | null {
  const langTag = tags.find(
    (t) => t[0] === "l" && t[2] === "ISO-639-1"
  );
  return langTag?.[1] ?? null;
}

export const FILTER_SCRIPTS = [
  "Latin",
  "CJK",
  "Cyrillic",
  "Arabic",
  "Devanagari",
  "Thai",
  "Korean",
  "Hebrew",
  "Greek",
] as const;
