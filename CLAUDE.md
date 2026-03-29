# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Wrystr is a cross-platform Nostr desktop client built with Tauri 2.0 (Rust) + React + TypeScript. It connects to Nostr relays via NDK (Nostr Dev Kit) and aims for Telegram Desktop-quality UX. Long-form content (NIP-23) is a first-class, distinguishing feature — not an afterthought.

## AgentDocs

When the user shares an AgentDocs URL, fetch the raw content using:
```
curl https://agentdocs.exe.xyz/api/shared/<token>/raw
```
The `<token>` is the hash at the end of the shared URL. This returns the document as plain text/markdown with embedded image references.

## Commands

```bash
npm run tauri dev       # Run full app with hot reload (recommended for development)
npm run dev             # Vite-only dev server (no Tauri window)
npm run build           # TypeScript compile + Vite build
npm run tauri build     # Production binary
```

Prerequisites: Node.js 20+, Rust stable, `@tauri-apps/cli`

## Releasing a New Version

**Order matters — do not tag before bumping versions.**

1. Bump version to `X.Y.Z` in all four files (they must stay in sync):
   - `src-tauri/tauri.conf.json` → `"version": "X.Y.Z"`
   - `package.json` → `"version": "X.Y.Z"`
   - `src-tauri/Cargo.toml` → `version = "X.Y.Z"`
   - `PKGBUILD` → `pkgver=X.Y.Z`
2. Update the release notes in `.github/workflows/release.yml`
3. Commit: `git commit -m "Bump to vX.Y.Z — <summary>"`
4. Tag: `git tag vX.Y.Z`
5. Push: `git push origin main vX.Y.Z`

CI triggers on the tag and builds all three platforms (Ubuntu, Windows, macOS ARM). All jobs must complete for `latest.json` to be assembled.

**Hard-won CI rules:**
- `includeUpdaterJson: true` must be set in tauri-action — without it `latest.json` is never uploaded and the auto-updater silently does nothing
- `bundle.createUpdaterArtifacts: true` must be set in `tauri.conf.json` — without it `.sig` files are never generated even if the signing key is set (Tauri 2 requirement)
- Valid `bundle.targets`: `"deb"`, `"rpm"`, `"nsis"`, `"msi"`, `"dmg"` — do NOT add `"updater"` (that's a plugin, not a bundle format)
- macOS runner is `macos-latest` (ARM only) — `macos-12`/`macos-13` are gone
- Verify after CI: `https://api.github.com/repos/hoornet/wrystr/releases/latest` (check for `.sig` assets + `latest.json`)

## Architecture

**Frontend** (`src/`): React 19 + TypeScript + Vite + Tailwind CSS 4

- `src/App.tsx` — root component; shows `OnboardingFlow` for new users, then view routing via UI store
- `src/stores/` — Zustand stores per domain: `feed.ts`, `user.ts`, `ui.ts`, `lightning.ts`, `drafts.ts`, `relayHealth.ts`, `bookmark.ts`, `toast.ts`
- `src/lib/nostr/` — NDK wrapper split into domain modules (`core.ts`, `notes.ts`, `social.ts`, `articles.ts`, `engagement.ts`, `dms.ts`, `bookmarks.ts`, `muting.ts`, `search.ts`, `relays.ts`, `trending.ts`, `vertex.ts`); barrel `index.ts` re-exports all; all Nostr calls go through here
- `src/lib/themes.ts` — Color theme definitions (7 themes) and `applyTheme()` utility
- `src/lib/lightning/` — NWC client (`nwc.ts`); Lightning payment logic
- `src/hooks/` — `useProfile.ts`, `useReactions.ts` (grouped emoji reactions with throttled fetch queue), `useReputation.ts` (Vertex WoT with cache)
- `src/lib/debug.ts` — Dev-only logger (silent in production builds)
- `src/components/feed/` — Feed, NoteCard, NoteContent, NoteActions, InlineReplyBox, TextSegments, MediaCards, ComposeBox
- `src/components/profile/` — ProfileView, EditProfileForm, ImageField, Nip05Field, ProfileMediaGallery
- `src/components/thread/` — ThreadView
- `src/components/search/` — SearchView (advanced search with modifiers, NIP-50, hashtag, people, articles)
- `src/lib/search.ts` — Advanced search query parser (by:, has:, is:, kind:, since:, until:, OR)
- `src/lib/nostr/relayHealth.ts` — Relay health checker (NIP-11, latency probing, status classification)
- `src/components/article/` — ArticleEditor, ArticleView, ArticleFeed, ArticleCard, MarkdownToolbar (NIP-23)
- `src/components/bookmark/` — BookmarkView
- `src/components/media/` — MediaFeed (media discovery with tab filtering)
- `src/components/zap/` — ZapModal
- `src/components/onboarding/` — OnboardingFlow (welcome, create key, backup, login)
- `src/components/shared/` — RelaysView (relay health dashboard + recommendations), SettingsView (themes + font size + NWC + identity + data export), EmojiPicker (categorized emoji insertion)
- `src/components/sidebar/` — Sidebar navigation

**Backend** (`src-tauri/`): Rust + Tauri 2.0

- `src-tauri/src/lib.rs` — Tauri app init and command registration
- Rust commands must return `Result<T, String>`
- OS keychain via `keyring` crate — `store_nsec`, `load_nsec`, `delete_nsec` commands
- SQLite note/profile cache via `rusqlite`
- File uploads handled entirely in TypeScript with NIP-98 auth (Rust upload_file removed in v0.7.0)
- Future: lightning node integration

## Key Conventions (from AGENTS.md)

- Functional React components only — no class components
- Never use `any` — define types in `src/types/`
- Tailwind classes only — no inline styles, except unavoidable WebkitUserSelect
- Private keys stored in OS keychain via Rust `keyring` crate; nsec persists across restarts
- New Zustand stores per domain when adding features
- NDK interactions only through `src/lib/nostr/` wrapper
- Lightning/NWC only through `src/lib/lightning/` wrapper

## NIP Priority Reference

- **P1 (core):** NIP-01, 02, 03, 10, 11, 19, 21, 25, 27, 50
- **P2 (monetization):** NIP-47 (NWC/Lightning), NIP-57 (zaps), NIP-65 (relay lists)
- **P3 (advanced):** NIP-04/44 (DMs), NIP-11 (relay info — used by health checker), NIP-23 (articles), NIP-96 (file storage), NIP-98 (HTTP Auth — implemented for uploads)

## Current State

**Implemented:**
- Onboarding: key generation, nsec backup flow, login with nsec/npub
- Global + following feed, compose, reply, thread view
- Reactions (NIP-25) with **grouped emoji pills** (❤️5 🤙3 🔥2), multi-reaction per note, throttled fetch queue
- Follow/unfollow (NIP-02), contact list publishing
- Profile view + edit (kind 0) with Notes/Articles tab toggle
- Long-form article editor (NIP-23) with **markdown toolbar** (bold, italic, heading, link, image, quote, code, list), **keyboard shortcuts** (Ctrl+B/I/K), **multi-draft management**, **cover image file picker**
- **Article discovery feed** — dedicated "Articles" view in sidebar; Latest/Following tabs
- **Article reader** — markdown rendering, reading time, bookmark, like, zap
- **Article search** — NIP-50 + hashtag search for kind 30023 articles
- **Article cards** — reusable component with title, summary, author, cover thumbnail, reading time, tags
- **NIP-98 HTTP Auth** for image uploads with fallback services (nostr.build, void.cat, nostrimg.com)
- Zaps: NWC wallet connect (NIP-47) + NIP-57 via NDKZapper
- **Advanced search** — query parser with modifiers: `by:author`, `mentions:npub`, `kind:N`, `is:article`, `has:image`, `since:date`, `until:date`, `#hashtag`, `"phrase"`, boolean `OR`; NIP-05 resolution; client-side content filters; search help panel
- Search: NIP-50 full-text, hashtag (#t filter), people, articles, **npub/nprofile direct navigation**
- Settings: color themes (7 presets), font size presets, NWC wallet, notifications, data export, identity, mute lists
- **Relay management** — consolidated Relays view with add/remove individual relays, health checker (NIP-11 info, WebSocket latency, online/slow/offline status), expandable cards with all supported NIPs, per-relay remove button, "Remove dead" workflow, publish relay list (NIP-65)
- **Relay recommendations** — suggest relays based on follows' NIP-65 relay lists; "Discover relays" button with follow count, one-click "Add"
- **Relay status badge** — compact "N/M relays" indicator in feed header with color coding; hover tooltip shows per-relay connection state
- **Toast notifications** — transient status messages for relay connection events (lost, reconnecting, back online)
- **Per-tab "last updated" timestamp** — relative time in feed header, tracked independently per tab (global/following/trending)
- **Subscription debug panel** — Ctrl+Shift+D toggles hidden panel showing NDK uptime, live sub status, per-relay state, feed timestamps, recent diagnostics log
- **Data export** — export bookmarks, follows, and relay list as JSON via native save dialog (Tauri plugin-dialog + plugin-fs)
- **Profile banner polish** — hero-height banner (h-36), click-to-lightbox, avatar overlaps banner edge with ring, loading shimmer
- **Reading list tracking** — read/unread state on bookmarked articles (localStorage-backed), unread dot indicators, sidebar badge, auto-mark-read on open
- **Trending hashtags** — #t tag frequency analysis from recent events; clickable tag pills on search idle screen
- OS keychain integration — nsec persists across restarts via `keyring` crate
- SQLite note + profile cache
- Direct messages (NIP-04 + NIP-17 gift wrap)
- NIP-65 outbox model
- Image lightbox (click to expand, arrow key navigation)
- Bookmark list (NIP-51 kind 10003) with sidebar nav, **Notes/Articles tabs**, article `a` tag support, **read/unread tracking**
- Follow suggestions / discovery (follows-of-follows algorithm)
- Language/script feed filter (Unicode script detection + NIP-32 tags)
- Skeleton loading states, view fade transitions
- Note sharing (nevent URI to clipboard)
- Reply counts on notes
- Media players (video/audio inline, YouTube/Vimeo/Spotify cards)
- Multi-account switcher with keychain-backed session restore
- System tray, keyboard shortcuts, auto-updater
- **NIP-05 verification badges** — cached verification with green checkmark on note cards
- **Dedicated hashtag pages** — clicking #tag opens a live feed, not generic search
- **Keyword muting** — word/phrase mute list, client-side filtering across all views
- **Follow suggestion dismissal** — persistent "don't suggest again" per person
- **Background notification poller** — 60s polling for mentions, zaps, new followers; each type independently toggleable; relay-aware startup (waits for connection before first fetch)
- **Dev-only debug logger** — `debug.log/warn/error` via `src/lib/debug.ts`; uses `import.meta.env.DEV`, silent in production
- **Trending feed polish** — 24h time window, time decay scoring, articles mixed with notes
- **NIP-46 remote signer** — bunker:// URI login, session persistence via toPayload/fromPayload, account switching
- **Media feed** — dedicated "Media" view with All/Videos/Images/Audio tabs; filters notes by embedded media type
- **Profile media gallery** — "Media" tab on profiles with grid layout; images open lightbox, videos/audio navigate to thread
- **Emoji picker** — shared categorized emoji picker (Frequent/Faces/Gestures/Objects/Symbols) in compose box, inline reply, thread reply; emoji reaction picker on note cards via visible + button
- **External link opener** — global click handler intercepts http(s) links and opens in system browser via `@tauri-apps/plugin-opener`
- **Color themes** — 7 built-in themes (Midnight, Light, Catppuccin Mocha, Tokyo Night, Gruvbox, Ethereal, Hackerman); CSS custom properties swapped at runtime; persisted to localStorage
- **Font size presets** — Small/Normal/Large/Extra Large; CSS zoom scaling on document root; persisted to localStorage
- **Web of Trust** — Vertex DVM integration (kind 5312→6312); personalized "Followed by people you trust" on profiles with clickable follower avatars
- **SQLite-backed notifications** — instant load on startup from local cache; relay diff merged in background; read state persists in DB across restarts

**Not yet implemented:**
- NIP-96 file storage
- Custom feeds / lists
