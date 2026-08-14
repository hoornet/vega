# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**This file is published.** It ships in the public repo and in every release tag, so write it as public copy. Internal hostnames, private instances, IPs, tokens, and anything else that only makes sense on a private server belong in `private_docs/` (gitignored) or in the global `~/.claude/CLAUDE.md` — never here. Removing such a thing later does not unpublish it: an internal host sat in this file from 2026-03-25 to 2026-08-14 and remains in the git history and in every tag cut during that window.

**Enable the pre-commit hook on every clone** — `core.hooksPath` is local config and does not travel with the repo:

```bash
git config core.hooksPath .githooks
```

It runs `scripts/check-no-leaks.sh` over the *added lines* of staged changes, blocking credentials, hardcoded home directories, public IPs, known-private hostnames, and files that should never be tracked. `scripts/check-no-leaks.sh --all` audits every tracked file. Bypass with `git commit --no-verify` — and if you had to, widen the exclusion in the script so the next person isn't trained to ignore it.

## What This Is

Vega is a cross-platform Nostr desktop client built with Tauri 2.0 (Rust) + React + TypeScript. It connects to Nostr relays via NDK (Nostr Dev Kit) and aims for Telegram Desktop-quality UX. Long-form content (NIP-23) is a first-class, distinguishing feature — not an afterthought.

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

0. **Verify we are not shipping someone else's payload** — run `scripts/verify-aur-package.sh`. It must print `AUR package is clean.` (exit 0) before you tag. See "Distribution channel integrity" below for why this is step zero and not an afterthought.
1. Bump version to `X.Y.Z` in all **five** files (they must stay in sync):
   - `src-tauri/tauri.conf.json` → `"version": "X.Y.Z"`
   - `package.json` → `"version": "X.Y.Z"`
   - `package-lock.json` → run `npm install --package-lock-only` after bumping `package.json`
   - `src-tauri/Cargo.toml` → `version = "X.Y.Z"` (then `cargo check` to sync `Cargo.lock`)
   - `PKGBUILD` → `pkgver=X.Y.Z`
2. **Leave `.github/workflows/release.yml` alone.** Do not add per-version notes to `releaseBody` — see the release-notes rule below. Write the notes to a file and apply them after CI with `gh release edit vX.Y.Z --notes-file f.md`.
3. Commit: `git commit -m "Bump to vX.Y.Z — <summary>"`
4. Tag: `git tag vX.Y.Z`
5. Push: `git push origin main vX.Y.Z`
6. Update AUR: in your local `vega-aur` checkout (the script defaults to `~/projects/vega-aur`), bump `pkgver=X.Y.Z` in `PKGBUILD`, then:
   ```bash
   makepkg --printsrcinfo > .SRCINFO
   git add PKGBUILD .SRCINFO && git commit -m "Bump to vX.Y.Z" && git push
   ```
   Not urgent, and safe to do late: `vega-nostr-git` is a VCS package that builds the default branch, so Arch users get the new version from the pushed tag whether or not `pkgver` has been bumped. The bump is display metadata. AUR git writes are also gated independently of the website — the site can be HTTP 200 while pushes report "The AUR is down due to maintenance".
7. Re-run `scripts/verify-aur-package.sh` after the AUR push, so the check also covers what you just published.

**`package-lock.json` is a version file.** CI runs `npm ci`, which *fails* on a package.json/lockfile mismatch — `npm install` used to reconcile it silently. Forgetting it breaks the build on all three platforms.

**The point of no return is `git push --tags`, not the release notes.** CI builds and publishes the binaries the moment the tag lands, so any behaviour change decided after that is not in the release, however early the notes still feel. Once a version's artifacts and its `latest.json` entry are public, **supersede with a patch release — never move the tag**: users who already updated would be running different code under the same version number, which is unrecoverable. Cost of superseding is one CI run. This was learned the hard way between v0.15.0 and v0.15.1.

CI triggers on the tag and builds all three platforms (Ubuntu, Windows, macOS ARM). All jobs must complete for `latest.json` to be assembled. The winget submission is a **separate** workflow (`winget.yml`) so a package-submission failure can't mark a good release red.

## Distribution channel integrity

Vega is shipped through channels that carry our name: the AUR, winget, GitHub releases, and Flathub. If one of them were adopted, modified or hijacked, we would be the ones distributing the payload. Being the vector is worse than being the victim, so this is checked on every release, not when something feels wrong.

- `scripts/verify-aur-package.sh` answers two questions: **is the AUR serving exactly what we pushed** (no tampering), and **did we actually push the current version** (no stale channel). Byte-identity covers the first on its own — an injected `install=` script, a repointed `source=`, or an added `prepare()` all have to appear in the PKGBUILD to take effect. Exit 0 clean, 1 mismatch, 2 couldn't check (treat 2 as unverified, not as a pass).
- **It compares against the AUR *remote*, not local `origin/master`, and reads content from the AUR *git repo*, not cgit.** Both matter, and both were wrong until 2026-08-14:
  - Comparing cgit against the local ref meant a missed push left *both sides equally stale* and the check reported clean. The v0.15.1 AUR bump sat committed-but-unpushed for a month behind a green tick, found only when v0.15.2 pushed two commits at once. A gate that passes while the channel is stale is not a gate.
  - cgit is a cached web view that lags the repo by minutes after a push — i.e. exactly when you run this — so it produced a false MISMATCH on the v0.15.2 release. AUR helpers clone the git repo, so the repo is what users get; cgit lag is now reported as an advisory note and never fails the check.
- The script also asserts the published `pkgver` matches `package.json`. Override with `AUR_EXPECT_VERSION` if you ever need to check a package you are not currently releasing.
- Prompted by the Arch advisory of 2026-06-12, "Active AUR malicious packages incident" — a high volume of malicious package *adoptions and updates*, with AUR submissions blocked in response. First run against `vega-nostr-git` on 2026-08-10: clean.
- A mismatch is never "probably fine". Investigate before announcing.

**Hard-won CI rules:**
- `includeUpdaterJson: true` must be set in tauri-action — without it `latest.json` is never uploaded and the auto-updater silently does nothing
- `bundle.createUpdaterArtifacts: true` must be set in `tauri.conf.json` — without it `.sig` files are never generated even if the signing key is set (Tauri 2 requirement)
- Valid `bundle.targets`: `"deb"`, `"rpm"`, `"nsis"`, `"msi"`, `"dmg"`, `"app"` — do NOT add `"updater"` (that's a plugin, not a bundle format)
- `"app"` MUST be in `bundle.targets` or the macOS auto-updater silently breaks: the `.app.tar.gz` updater artifact (and its `.sig`) is generated from the `app` target, NOT `dmg`. With only `dmg`, the `.app` is built as a throwaway intermediate, no `.app.tar.gz` is emitted, and `latest.json` gets no `darwin-aarch64` entry. `app`/`dmg` are macOS-only and skipped on Linux/Windows builds. This was broken from before v0.12.9 through v0.12.13; fixed in v0.12.14.
- macOS runner is `macos-latest` (ARM only) — `macos-12`/`macos-13` are gone
- Verify after CI: `https://api.github.com/repos/hoornet/vega/releases/latest` (check for `.sig` assets + `latest.json`)
- **Release notes in `release.yml` can trigger a GitHub workflow startup failure** ("workflow file issue", 0 jobs) that passes `yaml.safe_load` AND `actionlint`. Hit in v0.14.1 by 5 lines of plain-markdown release notes in the `releaseBody` block scalar; root cause never found. Keep the workflow's `releaseBody` minimal and known-good; put rich per-version notes on the release afterward with `gh release edit vX.Y.Z --notes-file f.md` — the release-body path doesn't go through the workflow parser.
- **`tauri-action` is pinned to the v0 SHA on purpose — v1.0.0 is a deliberate hold.** v1 renames the macOS updater artifact (`.app.tar.gz`/`.sig` now carry the version) and switches `latest.json` to github URLs instead of browser-download URLs. Both touch the exact machinery that silently broke macOS updates for five releases (see the `"app"` rule above). Take it at the *start* of a release cycle, then check the releases API for per-platform `.sig` assets and a `darwin-aarch64` entry in `latest.json` before announcing.
- **Never write `@dependabot <command>` as literal text in a GitHub comment.** Dependabot parses commands out of comment bodies with no regard for surrounding prose — a sentence explaining why you would *not* run a command still runs it. Writing "`@dependabot ignore this major version` would be wrong here" in a comment on the tauri-action PR closed it and set a permanent 1.x ignore two seconds later; recovered with `@dependabot unignore tauri-apps/tauri-action`. Refer to commands descriptively ("the ignore-this-major-version command") instead.

## Supply chain

- The release job builds and signs what users install, so `release.yml` runs **`npm ci --ignore-scripts`, never `npm install`** — `install` re-resolves inside caret ranges, so a compromised patch release could reach a signed build without appearing in the reviewed lockfile.
- **All actions are pinned to commit SHAs**, with the version in a trailing comment. Tags are mutable; `tauri-action` runs with the signing key in env. Dependabot (`.github/dependabot.yml`, covering npm + cargo + github-actions) keeps the SHAs current.
- `@nostr-dev-kit/ndk` is pinned **exactly**, not with a caret. Upstream is effectively single-maintainer, last published 2026-02-23, and a request to enable private security reporting has gone unanswered since June (nostr-dev-kit/ndk#393). NDK moves when we choose to move it. Vega carries a NIP-46 workaround for it in `src/lib/nostr/nip46.ts`.
- Known-and-accepted `cargo audit` noise: 4 quick-xml DoS advisories (build-time via `plist`, and XML *writing* via `tauri-winrt-notification` — neither parses untrusted input) plus ~22 `unmaintained` warnings, mostly gtk3-rs, which is Tauri's Linux stack.

## CommonJS default imports (bundler gotcha)

`react-qr-code` (and any CommonJS-only lib) can crash a view: under Vite 8 / Rolldown, `import X from "cjs-lib"` may resolve to the module namespace object `{ ..., default }` instead of the component, so `<X/>` throws React #130 ("element type is invalid… got: object") and the error boundary blanks the app. This only shows in built bundles, not `npm run tauri dev`. `AboutView.tsx` keeps a defensive unwrap (`(X as ...).default ?? X`) — don't revert it to a plain default import, and use the same guard for other CJS libs rendered as JSX.

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
- NIP-65 outbox model — **on by default**; opt out via the "Relay reach" toggle in Relays or Settings (see the outbox section below)
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
- **Update banner changelog** (v0.13.2) — "What's new" toggle expands the new version's release notes inline (sliced from the cumulative updater body via `latestChangelogSection` in `App.tsx`, rendered with `renderMarkdown`), plus a "Full changelog on GitHub" link
- **Mute-aware search** (v0.13.2) — search results (notes/articles by pubkey + keyword, people by pubkey) honour the mute list, not just the feed
- **Collapsing compose box** (v0.13.2) — single line when idle, expands on focus; uses focus-within blur semantics so toolbar clicks don't collapse it
- **Resizable sidebar** (v0.13.2) — drag right edge (160–360px), double-click reset, width persisted to `wrystr_sidebar_width`
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
- **Color themes** — 7 built-in themes (Midnight, Light, Catppuccin Mocha, Sepia, Gruvbox, Nord Frost, Hackerman); CSS custom properties swapped at runtime; persisted to localStorage
- **Font size presets** — Small/Normal/Large/Extra Large; CSS zoom scaling on document root; persisted to localStorage
- **Web of Trust** — Vertex DVM integration (kind 5312→6312); personalized "Followed by people you trust" on profiles with clickable follower avatars
- **SQLite-backed notifications** — instant load on startup from local cache; relay diff merged in background; read state persists in DB across restarts
- **SQLite-backed followers cache** — instant load from DB, relay results merged in background; follower count only grows (never lost to partial relay results)
- **SQLite-backed bookmarks cache** — bookmarked notes load instantly from DB; relay fetch fills in any new additions; articles auto-classified to correct tab
- **SQLite-backed articles cache** — articles feed (latest tab) loads instantly from DB
- **Instant own-profile load** — sidebar badge shows name/picture from DB cache immediately, no raw npub on slow relays
- **Retry-on-empty pattern** — followers, profile notes/articles, hashtag feeds retry once after 3s if relays return empty
- **Embedded Nostr relay** — built-in strfry relay with catch-up sync on startup; notes always available locally
- **naddr clickable links** — `nostr:naddr1…` references resolve to clickable named links (article titles)
- **New follower badges** — recently gained followers marked with "new" badge, sorted to top of follows list
- **Batch bookmark fetch** — fetches bookmarked notes with `{ ids: [...] }` filter; debounced kind 10003 publishes prevent race conditions
- **Resilient relay pool** — resetNDK preserves outbox-discovered relay URLs (fixes relay pool dropping to 3)
- **Relay reach toggle** (v0.15.2) — switch for NIP-65 outbox, in both the Relays view and Settings; on by default, turn it off to confine Vega to your configured relays

**Not yet implemented:**
- NIP-96 file storage
- Custom feeds / lists
- Safe Blossom URL auto-detection (temporarily disabled in v0.12.8 after OOM regression — needs HEAD `Content-Type` validation or known-server whitelist before reintroduction)

## Relay reach & NDK's outbox model

The relay list is a promise to the user: if they delete every public relay, Vega must not phone home to anyone else's. Two NDK behaviours break that promise, and neither is obvious from the option names.

- **NDK enables the outbox model unless you pass a literal `enableOutboxModel: false`.** The check is `if (!(opts.enableOutboxModel === false))` — omitting the option, or omitting `outboxRelayUrls`, leaves outbox fully **on**. `core.ts` claimed for years that omitting `outboxRelayUrls` disabled it; it never did. With outbox on, a follow feed resolves every author to their NIP-65 write relays and connects to all of them — **29 relays observed against a configured list of one** (issue #35). This is also the mechanism CLAUDE.md blamed for the "pool balloons 7 → 40+, firehose into `startLiveFeed()` → OOM" crashes, which means that fix was never in effect either. `nwc.ts` always got this right; copy that instance's options, not the old feed ones.
- **Removing a relay from `pool.relays` does not stop NDK using it.** `calculateRelaySetsFromFilter` falls back to `ndk.explicitRelayUrls` for any filter it can't scope to authors and re-adds those URLs to the pool, so a deleted relay returns on the next subscription and only stays gone after a restart. `addRelay`/`removeRelay` must keep `explicitRelayUrls` in sync.
- **Never assign `ndk.explicitRelayUrls = [...]`.** The setter also runs `pool.relayUrls = urls`, which clears the pool and reconstructs every `NDKRelay` — silently dropping the embedded strfry relay, which lives in the pool but deliberately never in the stored list. Mutate the array in place, as NDK's own `addExplicitRelay` does.
- `relayConnectionFilter` is the enforcement point: NDK consults it in `NDKPool.addRelay` **and** in the OutboxTracker, where it prunes each author's discovered read/write relays. It does *not* gate `NDKRelaySet.fromRelayUrls`, which connects its relay objects directly — that's why NIP-46 bunker login still works, and why `fetchUserNotesNIP65` needed a separate explicit gate.
- Verify this one **in the running app, on the Following tab.** Global sends no `authors` filter, so it exercises none of the outbox machinery and looks fixed no matter what. The first attempt at #35 passed its unit tests and was still completely wrong on Following.

**Why outbox stayed on by default**, despite being what #35 reported: it had been silently enabled for the app's entire history, so every release users were happy with shipped *with* it. Switching it off would have been the untested change, not the conservative one — and the OOM crashes it was blamed for turned out to be the Blossom regex, fixed in v0.12.8, since outbox was never actually off during any of that. Users who want Vega confined to their own list opt out; everyone else keeps the reach they already had. The toggle is surfaced in the Relays view as well as Settings, because someone who wants it is already on that screen.

## App identifier & data migration (v0.14.0)

The identifier is **`com.veganostr.Vega`** (was `com.hoornet.vega` before v0.14.0). It must stay on a domain the project controls — **Flathub rejects anything else**, and it keys the app ID for winget and the native installers too.

- **Never migrate app data from inside `.setup()`.** Tauri builds the config-defined windows *before* invoking the setup hook, and building a webview unconditionally `create_dir_all`s `<LocalData>/<identifier>` — which on Linux is the same directory holding `vega.db`, `relay.db` and localStorage. A migration running in `setup()` therefore always sees a non-empty destination. `migrate_legacy_data_dirs()` runs at the **top of `run()`, before `tauri::Builder`**, and uses the `dirs` crate (no `App` needed). Do not move it back.
- **Never use "destination is empty" as the migration trigger** — it is guaranteed non-empty after one launch, so the failure is self-sealing and unrecoverable. Migrate entry-by-entry; never overwrite an entry that already exists at the destination.
- **localStorage is not in the app data dir on every platform.** Linux → data dir (WebKitGTK). Windows → `%LOCALAPPDATA%` (WebView2 `EBWebView/`), *not* `%APPDATA%`. macOS → `~/Library/WebKit/<bundle-id>`. Migrating only `app_data_dir` silently loses themes, drafts, podcast subs and read-state on Windows and macOS.
- Keys are safe across identifier changes: `KEYRING_SERVICE` is the hardcoded literal `"wrystr"`, independent of the identifier.
- **Changing the identifier makes Windows treat the app as new** — it installs alongside the old version rather than upgrading in place. Document it; it's a one-time manual uninstall for users.
- The v0.10.0 Wrystr→Vega rename did this *without* a migration and silently stranded a full data directory (768 MB found on the dev machine). That is what this machinery exists to prevent.

## Hard-won Linux/WebKitGTK lessons

- **Startup/lifecycle changes must be verified by running the real binary**, not unit tests. The v0.14.0 migration had four passing unit tests and would still have wiped every Linux user's data — the defect was in *when* it ran, which no unit test could see. Run it against a scratch env: `XDG_DATA_HOME=/tmp/scratch ./target/debug/vega`, with data seeded beforehand and asserted after. Note `#[cfg(target_os = "...")]` branches are never type-checked on the build host.
- **WebKitGTK does not evict decoded bitmaps** under memory pressure the way Chromium does. Any path that multiplies `<img>` elements per feed page will translate ~linearly into WebProcess RSS. Validate new "render as image" heuristics (e.g. Blossom SHA-256 URLs) with a real content-type probe before shipping.
- **`MemoryPressureSettings` set on `WebsiteDataManager` only affects the NetworkProcess**, not the WebProcess where decoded bitmaps live. Setting a WebProcess cap requires reaching `WebContext` at construction time (construct-only GObject property) — wry does not currently expose this.
- **Bisect regression windows before investigating root cause.** If memory behavior changed between versions, `git bisect` the release tags first. Four days of WebKit-level investigation was avoidable once the regression was traced to a single commit in v0.12.6.
- **Distinguish caches from leaks.** Oscillating memory = elastic cache (fine). Monotonic growth = leak or uncapped working set (fix it).
