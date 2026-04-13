# Changelog

## v0.12.7 — Upload Fixes (2026-04-13)

### Fixed
- Image uploads now work again — nostr.build and files.sovbit.host endpoints updated to their current NIP-96 URLs; removed void.cat (dead) and nostrcheck.me (returned broken URLs without file extensions)
- NIP-98 HTTP Auth header now includes the required SHA-256 payload hash, fixing rejections from strict NIP-96 servers
- SVG files are now rejected with a clear error message before upload in profile picture, banner, compose box, and inline reply — SVGs were silently uploading but rendering as broken images on all Nostr clients

## v0.12.6 — Rich Text Everywhere (2026-04-10)

### Added
- Profile bios now render clickable links, `@mentions`, and `#hashtags` — profiles link to other profiles automatically
- DM messages now render clickable URLs, inline images, nostr entity links, and hashtags
- Article editor: selecting multiple images now inserts all of them correctly (previously only the last one was kept)
- Article editor: image thumbnail strip is now clickable — opens a full-size lightbox

### Fixed
- Blossom / NIP-96 image URLs with non-standard extensions (`.jp`, no extension) now render as inline images
- `nostr:` entity matching made case-insensitive for broader compatibility
- Multi-image article upload now inserts images with proper spacing between them

## v0.12.5 — UI Polish & Consistency (2026-04-09)

### Fixed
- V4V auto-streaming now stays off when manually disabled mid-episode; previously any play/pause/seek event would re-engage it for the same episode

### Changed
- Sentence case applied consistently to all button labels, tab labels, status text, and placeholders across every view
- All hard-coded colors (`amber-*`, `gray-*`, `bg-white`, `text-white` on non-colored backgrounds) replaced with theme tokens — correct appearance across all 7 themes
- All debug logging routed through `debug.ts` — production builds are fully silent (zero `console.*` leaks)
- Unicode punctuation: `...` → `…`, ASCII `x` close buttons → `×` throughout
- Hover `title` tooltips added to all truncated text (names, NIP-05, relay URLs, npub/nsec)
- Focus rings added to interactive elements for keyboard navigation
- `aria-label` added to all icon-only buttons

## v0.12.4 — Polls, Custom Relay & UI Polish (2026-04-06)

- NIP-1068 Polls — create, vote, animated result bars
- Switched default relay to Vega's custom Go relay (`wss://relay2.veganostr.com`)
- Note action icons with tooltips
- Fix duplicate search results (people search deduplication)
- Fix thread indentation overflow on narrow windows

## v0.12.3 — Fix Direct Messages (2026-03-xx)

- Fix DMs not loading — switched from fetchEvents to subscribe-based fetch for NIP-17 gift wraps

## v0.12.2 — Vega Public Relay

- `wss://relay2.veganostr.com` included by default

## v0.12.1 — Fixes

- Fix empty Media feed (24h time window)
- Fix empty Trending feed (retry on empty)
- Read-only mode banner

## v0.12.0 — Podcasts & Value 4 Value

- Built-in podcast player with Fountain.fm + Podcast Index
- V4V streaming sats per minute to creators
- Auto-streaming with per-episode caps and weekly budgets
- V4V sidebar dashboard with history

## v0.11.0 — Embedded Relay & Polish

- Embedded Nostr relay (strfry), naddr links, new themes, follower badges

## v0.10.0 — Rename to Vega

- Project renamed from Wrystr to Vega (named after Jurij Vega)
- All localStorage/keychain keys preserved for backward compatibility
