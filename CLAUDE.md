# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Wrystr is a cross-platform Nostr desktop client built with Tauri 2.0 (Rust) + React + TypeScript. It connects to Nostr relays via NDK (Nostr Dev Kit) and aims for Telegram Desktop-quality UX. Long-form content (NIP-23) is a first-class, distinguishing feature — not an afterthought.

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
- `src/stores/` — Zustand stores per domain: `feed.ts`, `user.ts`, `ui.ts`, `lightning.ts`, `drafts.ts`
- `src/lib/nostr/` — NDK wrapper (`client.ts` + `index.ts`); all Nostr calls go through here
- `src/lib/lightning/` — NWC client (`nwc.ts`); Lightning payment logic
- `src/hooks/` — `useProfile.ts`, `useReactionCount.ts`
- `src/components/feed/` — Feed, NoteCard, NoteContent, ComposeBox
- `src/components/profile/` — ProfileView (own + others, edit form)
- `src/components/thread/` — ThreadView
- `src/components/search/` — SearchView (NIP-50, hashtag, people, articles)
- `src/components/article/` — ArticleEditor, ArticleView, ArticleFeed, ArticleCard, MarkdownToolbar (NIP-23)
- `src/components/bookmark/` — BookmarkView
- `src/components/zap/` — ZapModal
- `src/components/onboarding/` — OnboardingFlow (welcome, create key, backup, login)
- `src/components/shared/` — RelaysView, SettingsView (relay mgmt + NWC + identity)
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
- **P3 (advanced):** NIP-04/44 (DMs), NIP-23 (articles), NIP-96 (file storage), NIP-98 (HTTP Auth — implemented for uploads)

## Current State

**Implemented:**
- Onboarding: key generation, nsec backup flow, login with nsec/npub
- Global + following feed, compose, reply, thread view
- Reactions (NIP-25) with live network counts
- Follow/unfollow (NIP-02), contact list publishing
- Profile view + edit (kind 0) with Notes/Articles tab toggle
- Long-form article editor (NIP-23) with **markdown toolbar** (bold, italic, heading, link, image, quote, code, list), **keyboard shortcuts** (Ctrl+B/I/K), **multi-draft management**, **cover image file picker**
- **Article discovery feed** — dedicated "Articles" view in sidebar; Latest/Following tabs
- **Article reader** — markdown rendering, reading time, bookmark, like, zap
- **Article search** — NIP-50 + hashtag search for kind 30023 articles
- **Article cards** — reusable component with title, summary, author, cover thumbnail, reading time, tags
- **NIP-98 HTTP Auth** for image uploads with fallback services (nostr.build, void.cat, nostrimg.com)
- Zaps: NWC wallet connect (NIP-47) + NIP-57 via NDKZapper
- Search: NIP-50 full-text, hashtag (#t filter), people, articles
- Settings: relay add/remove (persisted to localStorage), NWC URI, npub copy
- Relay connection status view
- OS keychain integration — nsec persists across restarts via `keyring` crate
- SQLite note + profile cache
- Direct messages (NIP-04 + NIP-17 gift wrap)
- NIP-65 outbox model
- Image lightbox (click to expand, arrow key navigation)
- Bookmark list (NIP-51 kind 10003) with sidebar nav, **Notes/Articles tabs**, article `a` tag support
- Follow suggestions / discovery (follows-of-follows algorithm)
- Language/script feed filter (Unicode script detection + NIP-32 tags)
- Skeleton loading states, view fade transitions
- Note sharing (nevent URI to clipboard)
- Reply counts on notes
- Media players (video/audio inline, YouTube/Vimeo/Spotify cards)
- Multi-account switcher with keychain-backed session restore
- System tray, keyboard shortcuts, auto-updater

**Not yet implemented:**
- Web of Trust scoring
- NIP-46 remote signer
- NIP-96 file storage
- Custom feeds / lists
