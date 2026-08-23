# Changelog

> Note: entries for v0.12.10 through v0.13.1 live in the [GitHub Releases](https://github.com/hoornet/vega/releases) notes; this file resumes at v0.13.2. The release notes on GitHub are the richer record — this file is the summary.

## v0.15.6 — DMs reach your DM relays (2026-08-23)

### Added
- **NIP-17 DM relay lists (kind 10050) are honoured (#49).** Fetching your messages now also asks your own published DM relays, and sending a DM publishes each gift wrap to its owner's DM relays (the recipient's for their copy, yours for the self-copy) — always merged with your configured relays. Gated on **Relay reach**; with it off, Vega stays on your configured relays as before. Your own published DM relays count as "my relays" for the relay-authentication scope, since a dedicated DM inbox relay is exactly the relay that requires NIP-42 before serving messages.

### Fixed
- **Messages open faster on remote signers (#61).** Gift wraps are decrypted in bounded batches instead of one at a time, and a message decrypted once is not decrypted again in the same session (in memory only — decrypted content is never written to disk).
- **Feeds no longer end early on one empty relay answer (#63)**, and switching feed tabs starts at the top (#62).

## v0.15.5 — NIP-42 relay authentication (2026-08-22)

### Added
- **Relay authentication (NIP-42).** Some relays won't serve your gift-wrapped DMs until the client proves who you are; Vega previously had no NIP-42 support, so on those relays Messages sat empty with no explanation. Vega now answers authentication challenges — governed by a new **Relay authentication** setting (Relays view and Settings), because signing an AUTH event tells the relay who you are: **My relays only** (default) or **Any relay that asks**. When Vega declines a challenge, it now says so instead of leaving an empty screen.

## v0.15.4 — Bunker restore & diagnostics log (2026-08-20)

### Fixed
- **Remote signer (bunker) sessions no longer go read-only after a restart (#47).** The v0.14.3 connect fix applied only to fresh logins; a restored session re-sends the same connect secret and hit the same failure, and a failed reconnect also rewrote the account's login type, making it permanent. Reconnect now works, keeps the login type on failure, times out instead of hanging, and reports failures.
- **The unbounded diagnostics log is gone.** Since v0.13.0 Vega appended to `~/vega-diag.log` with no cap. Disk logging is now opt-in (Settings → Diagnostics), capped at 5 MB with rotation, and the old file is cleaned up once (only when it carries Vega's own marker).

### Changed
- Dependency updates (rusqlite 0.40, marked 18, sha2 0.11); SECURITY.md, CONTRIBUTING.md and CODE_OF_CONDUCT.md added.

## v0.15.3 — Browse without signing in (2026-08-15)

### Added
- **Look around first.** The welcome screen no longer requires a key — browse Trending read-only and sign in when you want to post (#34).

### Changed
- **The relay badge counts *your* relays**, with a separate `+N` for anything beyond them (built-in relay, NIP-65 reach). No `+N` with Relay reach off means Vega is staying inside your list (#36).
- **Relay reach now governs every path that adds relays**, including the NDK behaviour that connected to your *published* relay list on login. Follow-feed refreshes also open fewer connections (one relay per followed author instead of two).

## v0.15.2 — Relay list fixes & Relay reach (2026-08-14)

### Fixed
- **Relay list changes apply immediately (#35).** Removed relays used to return on the next refresh until restart; added relays weren't subscribed to until restart.

### Added
- **Relay reach switch** (Relays view + Settings). Vega's NIP-65 outbox model — connecting to the relays the people you follow publish to — stays on by default, but can now be turned off to confine Vega to your configured relays.

## v0.15.1 — DM notifications done right (2026-08-10)

### Added
- **Desktop notifications for incoming DMs** (NIP-04 and NIP-17), on by default, toggleable in Settings → Notifications. The notification names the sender and nothing else — no message content ever reaches the OS notification system. Nothing is announced retroactively and no decrypted content is stored.
- **Growing composers.** The message and quote composers grow as you type instead of being fixed two- and three-line boxes; tidier Messages sidebar with a "New message" link.

### Note
- Supersedes v0.15.0 (published an hour earlier), which included a preview of the message text in the notification — the wrong default for an encrypted-messaging client. v0.15.0 remains published only so its update entry keeps working.

## v0.14.3 — Bunker login & proxy DNS (2026-08-10)

### Fixed
- **Remote signer (NIP-46) login works with spec-compliant bunkers (#17).** NIP-46 allows a signer to answer `connect` with the URI's secret instead of `ack`; Vega accepted only `ack`, so those logins failed as "undefined". Also reported upstream (nostr-dev-kit/ndk#399). Reported and verified by @DalShooth against a real Bunker46.
- **Proxy DNS leaks on Vega's own requests (#11).** Update checks, uploads and lookups now resolve hostnames through the SOCKS5 proxy; relay WebSockets (in the webview) may still resolve locally — noted in Settings.

### Changed
- **Supply-chain hardening:** release builds install from the exact reviewed lockfile with scripts disabled, all GitHub Actions pinned to commit SHAs, dependency monitoring extended to Rust and the build pipeline; the embedded relay's signature verification is now pinned by tests.

## v0.14.2 — Reliable key storage on Linux (2026-07-18)

### Changed
- **Linux key storage now uses the system secret service** (gnome-keyring / KWallet) instead of the kernel keyring. Your secret key now survives reboots reliably, and — importantly — persists inside sandboxed installs (Flatpak), which the kernel keyring could not. macOS and Windows are unchanged.

### Migration
- **Linux users re-enter their key once** after this update. The previous kernel-keyring entry isn't readable by the new backend, so on first launch you'll sign in again; after that it persists as normal.
- Requires a running secret-service provider (gnome-keyring or KWallet — standard on GNOME/KDE and most desktops).

## v0.14.1 — Fix Support view crash, add proxy/Tor support (2026-07-15)

### Fixed
- **Support view no longer crashes.** Opening Support (the About/donate view) crashed the app with a blank "Vega crashed" screen (React error #130). `react-qr-code` ships CommonJS, and since the Vite 8 / Rolldown migration (v0.13.2) its default import resolved to the module namespace object instead of the component, making the QR code an invalid element. The import now unwraps to the real component. Reproduced and verified fixed against the production build.

### Added
- **Configurable network proxy (HTTP / SOCKS5), including Tor.** New section in Settings routes Vega's traffic — relay WebSockets, Rust-side fetches, and update checks — through a proxy. Contributed by [Anderseta](https://github.com/Anderseta) ([#10](https://github.com/hoornet/vega/pull/10)).
- **Contributors section** in the README.

### Known limitation
- The proxy routes traffic but DNS may still resolve locally, so relay hostnames can leak. Full DNS privacy (e.g. `socks5h` for Tor) is not guaranteed yet — noted in the proxy settings and tracked in [#11](https://github.com/hoornet/vega/issues/11).

## v0.14.0 — App identifier moves to `com.veganostr.Vega` (2026-07-14)

### Changed
- **App identifier is now `com.veganostr.Vega`** (was `com.hoornet.vega`). Reverse-DNS app IDs must sit on a domain the project controls; Flathub rejects anything else, and this keeps Vega's identity consistent across Flathub, winget and the native installers.

### Migration
- **Existing data is carried across automatically on first launch.** The identifier keys every per-app directory, so v0.14.0 moves the old directories to the new ones before opening anything: the SQLite cache (`vega.db`), the embedded relay's database (`relay.db`), and webview localStorage (themes, drafts, podcast subscriptions, article read-state). All three per-platform roots are covered — WebView2 keeps localStorage under `%LOCALAPPDATA%` on Windows, and WKWebView keeps it under `~/Library/WebKit` on macOS, neither of which is the app data dir.
- The migration only ever moves into a fresh install; an existing directory with data in it is never overwritten.
- **Keys are unaffected.** The OS keychain service name is independent of the app identifier, so you stay logged in.
- **Windows only:** the identifier change makes Windows treat v0.14.0 as a new application, so it installs alongside v0.13.2 rather than replacing it. Data is carried over; remove the old "Vega" entry from Add/Remove Programs. One-time only.

## v0.13.2 — Mute-aware search, collapsing compose box & resizable sidebar (2026-06-15)

### Added
- **Update banner changelog.** When an update is available, a "What's new" toggle expands the newest version's release notes inline (rendered as markdown), with a link to the full changelog on GitHub. The notes were already fetched by the updater but never shown.
- **Resizable left sidebar.** Drag the right edge to set the sidebar width (clamped 160–360px); double-click to reset. The chosen width persists to localStorage. Collapse-to-icons is unchanged.

### Changed
- **Search now respects the mute list (#7).** Notes, articles, and people from muted pubkeys — and posts matching muted keywords — are filtered out of search results, matching the feed. Previously only the people *suggestions* list was filtered.
- **Compose box collapses when idle (#6).** The note composer shows as a single line until focused, then expands to full height with its toolbar; it stays expanded while you interact with its controls or have unsent content. Reclaims vertical space at the top of the feed (reported as oversized on macOS).
- **Build migrated to Vite 8 / Rolldown.** `manualChunks` converted to the function form Rolldown requires. This also drops the `esbuild` dev-server dependency, clearing two Dependabot alerts (one high, one low).

## v0.12.9 — Web of Trust everywhere (2026-04-23)

### Changed
- **Web of Trust filter now applies everywhere.** Previously it only hid notes from outside your social graph on the global feed. It now also filters:
  - **All feed tabs** — global, following, and trending.
  - **Reaction pills** — emoji counts no longer include reactions from pubkeys outside your trust graph.
  - **Zap totals** — sat counts and zap counts no longer include zaps from outside your trust graph. Zaps are filtered by the actual zapper's pubkey (from the inner zap request), not the outer LNURL service pubkey.

### Removed
- The "new account" badge on notes. It marked pubkeys whose kind-0 profile event was newer than 60 days, on the assumption that that approximated account age. It doesn't — kind-0 `created_at` is "profile last updated," so anyone who tweaked their bio recently got flagged regardless of how long they've been on Nostr. Dropped until there's a real signal to use.

## v0.12.8 — Fix Linux OOM crash (2026-04-16)

### Fixed
- Linux WebKit web process no longer grows unbounded to 8–12 GB and self-kills. Memory now oscillates at ~0.85–1.6 GB during heavy scrolling on Linux and Windows. Root cause: the Blossom SHA-256 URL auto-detection regex introduced in v0.12.6 caused 3–5× more `<img>` elements per feed page, which combined with WebKitGTK's weak bitmap eviction pushed the WebProcess past its self-kill threshold. Blossom URL auto-detection is temporarily disabled pending proper validation in a future release.
- WebKit rendering: `WEBKIT_FORCE_SOFTWARE_RENDERING=1` on Linux to keep the Wayland compositor path intact on Hyprland.
- `fetchNotifications` was firing 3× in the first 8 seconds of login; now fires once and the first background poll is delayed to 90s.

### Changed
- v0.12.7 OOM firefighting reverted: follow feed back to 100 events, global feed caches up to 200 — matching pre-crisis v0.12.6 behavior.

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
