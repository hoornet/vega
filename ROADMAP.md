# Vega — Roadmap

---

## Vision: more than a Nostr client

Vega is not just a great desktop Nostr client. **Long-form content is a first-class,
distinguishing feature** — not an afterthought, not a checkbox NIP.

The article editor (NIP-23), the reading experience, the writing tools around it — these
set Vega apart from other clients and define its identity. Think of it as a publishing
platform that happens to live on Nostr, not a social feed that happens to support articles.

---

## Development process

Each phase is built, then thoroughly tested (especially on Windows) before the next begins.
Bugs found during testing are fixed before Phase N+1 starts. A release is cut between phases.

---

## Phase 1 — Complete the core experience ✓ COMPLETE

*Shipped in v0.1.5. Tested on Windows (v0.1.7 fixes applied).*

- ✓ Long-form article reader (NIP-23) — `nostr:naddr1…` links open in-app reader
- ✓ Zap counts on notes — ⚡ N sats inline on every note
- ✓ Quoted note inline preview — `nostr:note1…` / `nostr:nevent1…` render as inline cards
- ✓ Auto-updater — "Update & restart" banner via tauri-plugin-updater

---

## Phase 2 — Engagement & reach ✓ COMPLETE

*Shipped in v0.1.11.*

- ✓ **Feed reply context** — "↩ replying to @name" shown above reply notes; click to open parent thread
- ✓ **NIP-65 outbox model** — fetch user relay lists (kind 10002) for better note discovery; "Publish relay list" button in Settings; profile notes fetched via write relays
- ✓ **Notifications** — mentions view with unread badge; 🔔 nav item in sidebar; badge clears on view
- ✓ **DM unread badge** — messages nav item shows badge count; clears when conversation opened
- ✓ **Keyboard shortcuts** — n (compose), / (search), j/k (feed nav), Esc (back), ? (help modal)

---

## Phase 3 — Polish & completeness ✓ COMPLETE

*Shipped in v0.4.0. NIP-17 DMs shipped in v0.5.0.*

- ✓ **Image lightbox** — click any image to view full-screen; Escape to close, left/right arrows for multi-image navigation
- ✓ **Bookmarks (NIP-51 kind 10003)** — save/unsave notes with one click; dedicated Bookmarks view in sidebar; synced to relays
- ✓ **Follow suggestions / discovery** — "follows of follows" algorithm on Search page; shows mutual follow counts with one-click follow
- ✓ **Language/script feed filter** — dropdown in feed header; Unicode script detection (Latin, CJK, Cyrillic, Arabic, Korean, Hebrew, etc.) + NIP-32 language tag support
- ✓ **UI polish** — skeleton loading placeholders, improved empty states with helpful prompts, subtle view fade transitions

### NIP-17 DMs (gift wrap) ✓ SHIPPED
- ✓ NIP-17 gift-wrapped DMs (kind 1059) with NIP-04 fallback
- ✓ Both protocols supported — reads legacy NIP-04 + modern NIP-17

---

## Up next

- **V4V section** — dedicated sidebar view with Dashboard (live budget bars), Settings (auto-enable, caps, rate), and History (streaming log with recipient breakdowns)
- **Custom feeds / lists** (NIP-51)
- **NIP-96 file storage** integration
- **Article editor improvements** — image insertion UX, possibly WYSIWYG
- **Encrypted group chat** — NIP-29 (relay-based groups) + NIP-44 (encryption); NIP-104 (gift-wrapped E2E) for small private groups
- **NIP-72 moderated communities** — Reddit-style public communities
- **Code signing** — Windows EV cert + macOS notarization

---

## Brainstorm backlog (not yet scheduled)

### Relay health checker — ✓ SHIPPED (v0.7.1)
- ✓ NIP-11 info fetch + WebSocket latency probing
- ✓ Online/slow/offline classification with summary counts
- ✓ "Remove dead" + "Republish list" workflow
- ✓ NIP badge display, expandable relay cards

### Advanced search — ✓ SHIPPED (v0.7.1)
- ✓ Query parser with modifiers (by:, has:, is:, kind:, since:, until:, #hashtag, "phrase", OR)
- ✓ NIP-05 resolution for author lookups
- ✓ Client-side content filters (image, video, audio, code, link, youtube)
- ✓ Search help panel with modifier reference
- Remaining: search relay discovery (kind 10007), WoT-powered search ranking

### Thread & conversation overhaul — ✓ SHIPPED (v0.9.0)
- ✓ Nested visual thread trees with indentation and connecting lines
- ✓ Reply to any note in the thread with inline reply boxes
- ✓ Recursive reply fetching (2-round-trip strategy)
- ✓ Ancestor chain for context when opening deep replies
- ✓ Multi-level back navigation (20-entry stack)
- ✓ Thread collapse (>3 children) with "show N more"
- ✓ Mute filtering in trees
- Remaining: "Threads I'm in" view, live reply subscriptions, thread caching in SQLite

### Web of Trust — ✓ SHIPPED (v0.11.0)
- ✓ Vertex DVM integration (kind 5312→6312)
- ✓ "Followed by people you trust" on profiles with clickable follower avatars
- ✓ Personalized trust scoring
- ✓ WoT spam filtering — v0.12.9 extends the filter to reactions, zaps, and all feed tabs (global, following, trending)
- Remaining: WoT-powered feed ranking

### Long-form features (NIP-23 depth) — mostly shipped (v0.6.0 + v0.7.0)
- ✓ Discovery: dedicated article feed with Latest/Following tabs
- ✓ Article search (NIP-50 + hashtag for kind 30023)
- ✓ Profile Articles tab — browse any author's long-form posts
- ✓ Reading time estimate, bookmark/like/zap on article reader
- ✓ Markdown toolbar with keyboard shortcuts (Ctrl+B/I/K)
- ✓ NIP-98 image upload with fallback services
- ✓ Multi-draft management (create, resume, delete)
- ✓ Cover image file picker upload
- ✓ Article bookmarks (NIP-51 `a` tags) with Notes/Articles tabs
- Remaining: reading history, table of contents, trending articles, tag suggestions
- Cross-posting to other platforms

### NIP-46 remote signer — ✓ SHIPPED (v0.8.3)
- ✓ Connect via bunker:// URI (nsecBunker, Amber, etc.)
- ✓ Session persistence across restarts via toPayload/fromPayload
- ✓ Third login tab in onboarding and add-account modal
- ✓ Account switching between local nsec and remote signer accounts

### NIP-05 monetization (Phase 4 idea)
- Offer a paid "Verified NIP-05 name" service (e.g. name@vega.app)
- Would need a backend + domain; Vega talks to it; users pay sats via Lightning
- Free tier: self-hosted as today; paid tier: managed registration

---

## What's already shipped

### v0.12.x — Podcasts & Value 4 Value (2026-04-05)
- **Podcast player** — search, subscribe, play podcasts directly in Vega
- **V4V streaming** — stream sats to podcast creators via Lightning (keysend + LNURL-pay); automatic recipient splits (hosts, producers, apps)
- **Own relay** — `wss://relay2.veganostr.com` (custom Go relay, Helsinki); 19 NIPs, NIP-45 COUNT, NIP-50 Search, NIP-77 Negentropy
- **Media feed fixed** — 24h window replaces 2h, actually returns results now
- **Trending feed resilience** — retry on slow startup, preserves existing notes
- **Read-only banner** — clear visual indicator when not signed in
- **Accessibility** — proper contrast across all themes, screen reader labels, reduced motion support
- **Media pause on navigate** — videos and audio stop when switching views

### v0.11.0 — DB-First Caching & Performance
- **SQLite-backed notifications** — instant load from local cache; relay diff merged in background
- **SQLite-backed followers** — instant follower count from DB; relay results merged in background
- **SQLite-backed bookmarks** — bookmarked notes load instantly; articles auto-classified to correct tab
- **SQLite-backed articles** — articles feed loads instantly from DB
- **Instant own-profile load** — sidebar shows name/picture from DB cache immediately
- **Retry-on-empty pattern** — followers, profile notes, hashtag feeds retry after 3s if relays return empty
- **Web of Trust** — Vertex DVM integration with personalized trust scoring on profiles
- **Embedded Nostr relay** — built-in strfry relay with catch-up sync on startup
- **Batch bookmark fetch** — `{ ids: [...] }` filter; debounced publishes prevent race conditions
- **Resilient relay pool** — resetNDK preserves outbox-discovered relay URLs
- **New follower badges** — recently gained followers marked and sorted to top
- **naddr clickable links** — `nostr:naddr1…` references resolve to named article links

### v0.10.0 — Rename to Vega
- **Wrystr → Vega** — renamed across the entire codebase, UI, and packaging
- **nevent/naddr search** — paste Nostr URIs directly into search
- **Copy npub** — one-click copy from profile view
- **Zap reliability** — fixed race conditions in zap flow

### v0.9.1 — Live Feed & Relay Reliability
- **Live streaming feed** — persistent relay subscriptions (`closeOnEose: false`) deliver new notes in real-time; no manual refresh needed. Inspired by Wisp's streaming architecture.
- **Timeouts on all relay fetches** — every `fetchEvents` call across the entire codebase now has a timeout (5–12s depending on query type). No view can hang indefinitely.
- **Fixed relay death spiral** — removed aggressive liveness probe that was force-disconnecting working relays; `ensureConnected` now trusts `relay.connected` and only reconnects when zero relays are connected
- **NDK subscription hygiene** — `groupable: false` prevents NDK from batching/reusing stale subscriptions; `since` filters on global (2h) and follow (24h) feeds ensure freshness
- **Feed diagnostics** — `feedDiagnostics.ts` tracks every feed fetch with timing, event freshness, relay states; console helpers `__feedDiag()`, `__feedDiagRelays()`; periodic relay snapshots
- **NDK reset as last resort** — `resetNDK()` destroys and recreates the NDK instance (preserving signer) when relay connections are unrecoverable; triggered automatically after 30s of continuous failure
- **Fixed Articles Latest** — article feed no longer wipes results when follows array changes
- **Fixed Zap History** — loading state initialised correctly; increased timeout for zap queries (12s)

### v0.9.0 — Thread Conversation Overhaul
- **Nested thread trees** — replies displayed as visual trees with indentation and connecting border lines; see who replied to whom at a glance
- **Reply to any note** — inline reply boxes open directly below the note you're replying to; proper NIP-10 root + reply marker tagging
- **Recursive reply fetching** — 2-round-trip strategy discovers deep replies (replies to replies) that were previously invisible
- **Ancestor chain** — compact parent notes shown above the root when opening a deep reply from the feed
- **Multi-level back navigation** — 20-entry navigation stack retraces your exact path through threads
- **Smart "replying to" links** — scrolls to parent note if visible, otherwise opens parent thread
- **Thread collapse** — threads with >3 replies show first 2 + "show N more" button
- **Mute filtering in trees** — muted subtrees pruned with "N replies hidden" indicator
- **Loading shimmer** — animated skeleton blocks while thread data loads
- **Podcast subscriptions** — My Podcasts tab, episode playback with V4V streaming sats

### v0.8.4 — Codebase Refactor & Docs
- **Codebase refactor** — split 5 overgrown files into focused modules: `client.ts` (1036 lines) into 11 domain files under `lib/nostr/`; `ProfileView`, `NoteContent`, and `NoteCard` split into sub-components. All component files now ≤270 lines, all lib files ≤300
- **Documentation** — Supported NIPs table in README, updated features list, current roadmap
- **Bug fixes** (from v0.8.3 testing) — mute filtering in media feed, notification toggle sizing, external links via Tauri opener, emoji picker in compose/reply/reactions, trending refresh visual feedback

### v0.8.3 — Trending, Remote Signer, Media
- **Trending feed** — 24h time window with engagement decay scoring; articles mixed with notes
- **NIP-46 remote signer** — connect via bunker:// URI; session persistence; third login tab
- **Media feed** — new "Media" view with All/Videos/Images/Audio tab filtering
- **Profile media gallery** — "Media" tab on profiles with grid layout; images open lightbox
- **Syntax highlighting** — code blocks render with syntax highlighting
- **OS push notifications** — background poller (60s) for mentions, zaps, new followers; each type toggleable
- **Zen writing mode** — distraction-free article editing with auto-save indicator
- **NIP-05 verification badges** — cached verification with green checkmark on note cards
- **Dedicated hashtag pages** — clicking #tag opens a live feed
- **Keyword muting** — word/phrase mute list, client-side filtering across all views
- **Follow suggestion dismissal** — persistent "don't suggest again" per person
- **Emoji picker** — categorized emoji picker in compose, reply, and reactions

### v0.8.0 — Polish, Portability & Discovery
- **Profile banner polish** — hero-height banner, click-to-lightbox, avatar overlaps with ring
- **Data export** — bookmarks, follows, relay list as JSON via native save dialog
- **Relay recommendations** — suggest relays from follows' NIP-65 lists with follow count
- **Reading list tracking** — read/unread state on bookmarked articles, unread dot indicators, sidebar badge
- **Trending hashtags** — #t tag frequency analysis from recent events; clickable tag pills

### v0.7.1 — Relay Health Checker & Advanced Search
- **Relay health checker** — NIP-11 info fetch + WebSocket latency probing; relays classified as online/slow/offline; expandable cards show software, description, supported NIPs (badges for 1, 4, 11, 17, 23, 25, 50, 57, 65, 96, 98); header summary counts; "Remove dead" strips offline relays; "Republish list" publishes cleaned NIP-65 relay list; auto-checks on mount
- **Advanced search** — full query parser inspired by ants (dergigi/ants); modifiers: `by:author`, `mentions:npub`, `kind:N`, `is:article`, `has:image`, `since:2026-01-01`, `until:2026-12-31`, `#hashtag`, `"exact phrase"`, boolean `OR`; NIP-05 resolution for author lookups; client-side content filters for media types; search help panel with modifier reference
- New files: `src/lib/nostr/relayHealth.ts`, `src/stores/relayHealth.ts`, `src/lib/search.ts`
- `RelaysView.tsx` rewritten from simple list to full health dashboard

### v0.7.0 — Writer Tools & Upload Fix
- **NIP-98 HTTP Auth uploads** — image uploads now authenticate via signed kind 27235 events; fallback to void.cat and nostrimg.com if nostr.build fails
- **Markdown toolbar** — bold, italic, heading, link, image, quote, code, list buttons above the article editor textarea
- **Editor keyboard shortcuts** — Ctrl+B bold, Ctrl+I italic, Ctrl+K link
- **Multi-draft management** — create multiple article drafts; draft list view with word count, timestamps, delete; auto-migrates old single-draft localStorage
- **Cover image file picker** — upload button next to URL input in article meta panel
- **Article bookmarks** — bookmarks now support NIP-51 `a` tags for parameterized replaceable events (kind 30023 articles); Notes/Articles tab toggle in BookmarkView
- **Upload moved to TypeScript** — removed Rust `upload_file` command; all uploads go through TS with NIP-98 auth; dropped `reqwest` and `mime_guess` Rust dependencies
- **Upload spinner** — animated spinner in compose box and article editor during image upload
- **Draft count badge** — sidebar "write article" button shows draft count
- **Empty states** — draft list, bookmark articles tab

### v0.6.0 — Long-form article experience
- **Article discovery feed** — dedicated "Articles" view in sidebar with Latest and Following tabs; browse kind 30023 articles from all relays or just followed authors
- **Article cards** — title, summary snippet, author avatar+name, cover image thumbnail, reading time, tag chips
- **Article search** — search notes, articles, and people in parallel; articles tab in search results; supports full-text (NIP-50) and hashtag search
- **Profile Articles tab** — Notes/Articles tab toggle on every profile; lazy-loads author's long-form posts
- **Article reader polish** — estimated reading time (words/230), bookmark (save/unsave), like (reaction), zap — all in header and footer
- **74 tests passing**, TypeScript strict, no regressions

### v0.5.0 — Sharing & Thread Indicators
- **Note sharing** — share button copies `nostr:nevent1…` URI to clipboard; works logged out
- **Reply count** — reply count next to reply button; optimistic update on send

### v0.4.1 — Media Players
- Video/audio inline players, YouTube/Vimeo/Spotify rich cards

### v0.4.0 — Phase 3: Discovery & Polish
- **Image lightbox** — click any image to view full-screen; Escape to close, arrow keys to navigate multi-image posts
- **Bookmarks (NIP-51 kind 10003)** — save/unsave notes with one click; dedicated Bookmarks view in sidebar; synced to relays
- **Discover people** — "follows of follows" suggestions on Search page with mutual follow counts and one-click follow
- **Language/script feed filter** — dropdown in feed header filters by writing system (Latin, CJK, Cyrillic, Arabic, Korean, Hebrew, Greek, Thai, Devanagari); Unicode script detection + NIP-32 language tag support
- **UI polish** — skeleton loading placeholders instead of "Loading..." text; improved empty states with helpful prompts; subtle view fade transitions on navigation

### v0.3.1
- **Feed tab persists across navigation** — back button now returns to the correct tab (Global/Following) instead of always resetting to Global
- **Available on AUR** — Arch/Manjaro users can install with `yay -S vega-nostr-git`

### v0.3.0
- **Instant feedback** — posted notes appear in feed immediately; thread replies show up without waiting for relay
- **Image paste fix** — uploads now use Tauri HTTP plugin, fixing "Failed to fetch" on Windows
- **Sent zaps visible** — zap history now correctly shows sent zaps
- **Reply-to @name clickable** — clicking the @name in "↩ replying to @name" now opens that person's profile
- **Feed refresh on login** — switching or adding an account immediately loads the new account's feed

### v0.2.1 — Batch 3 playtest fixes
- **Fix: repost + quote in thread view** — root note in thread view now shows repost and quote buttons (parity with feed cards)
- **Fix: login persistence after Windows update** — nsec accounts with a lost keychain entry now stay logged out (login button visible) instead of silently going read-only

### v0.2.0 — Phase 2: Engagement & Reach
- **Feed reply context** — replies show "↩ replying to @name" above the note; click to open the parent thread
- **NIP-65 outbox model** — reads kind 10002 relay lists so you see notes from people who publish to their own relays; profile notes fetched via their write relays; "Publish relay list to Nostr" button in Settings
- **Notifications view** — 🔔 sidebar nav item; lists recent mentions with unread badge; badge clears on open
- **DM unread badge** — messages nav item shows count of conversations with new messages; clears when conversation is opened
- **Keyboard shortcuts** — `n` focus compose, `/` focus search, `j`/`k` navigate feed with ring highlight, `Esc` go back, `?` help overlay

### v0.1.10
- **Fix: Bitcoin QR to right edge** — Support page QR section uses `justify-between` so Lightning sits left, Bitcoin sits right

### v0.1.9
- **Fix: account switch read-only bug (root cause)** — signers are now cached in-memory after login; `switchAccount` reuses the cached signer directly instead of re-fetching from the OS keychain on every switch. Keychain is only consulted at startup. Verified with 9-switch stress test across 3 accounts: 9/9 `ok`, signer present every time.
- **Dev tooling** — Tauri invoke mock + 3 test accounts for Playwright-based debugging

### v0.1.8
- **Fix: account switch broken** — `switchAccount` now checks the signer was actually set before returning; falls back to read-only instead of silently doing nothing; always navigates to feed after switch
- **Fix: "Not logged in" on profile edit** — edit button hidden when signed in read-only (npub); read-only badge shown in profile header
- **Sidebar version number** — `v0.1.8` shown below WRYSTR brand, auto-tracked from package.json
- **Support page QR spacing** — Lightning and Bitcoin QR codes have more breathing room (`gap-16`)
- **ROADMAP: language filter** added to Phase 3 backlog

### v0.1.7
- **Per-account Lightning wallet** — NWC URI stored per-pubkey; switching accounts loads the correct wallet automatically
- **New account creation in-app** — "Add account" → "New account" tab generates a fresh keypair inline
- **Zap button on thread root note** — like and zap the main post in a thread view
- **Conditional zap button** — ⚡ only shown for profiles that have a Lightning address (lud16/lud06)
- **Image paste in compose** — paste clipboard image → auto-uploads to nostr.build, inserts URL at cursor
- **Account switcher redesign** — larger active account avatar, sign-out/remove in dropdown only
- **GitHub Sponsors link** in Support page
- Fix: signer cleared before account switch — eliminates race where old account could sign outgoing events

### v0.1.6
- **Linux packaging** — ships `.deb` (Ubuntu/Debian/Mint) and `.rpm` (Fedora/openSUSE) instead of AppImage
- Arch / Manjaro: `PKGBUILD` in repo root — builds from source via git tag

### v0.1.5
- **Long-form article reader** (NIP-23) — click any `nostr:naddr1…` to open in-app reader with markdown, cover image, author, tags; zap the author inline
- **Zap counts on notes** — ⚡ N sats shown inline on each note
- **Quoted note inline preview** — `nostr:note1…` / `nostr:nevent1…` render as bordered inline cards; click to open thread
- **Auto-updater** — "Update & restart" banner via tauri-plugin-updater + GitHub Releases manifest

### v0.1.4
- **Sidebar** — explicit ‹/› toggle, state persisted, collapsed mode completeness
- **Profile image upload** — uploads to nostr.build, auto-fills URL field
- **NIP-05 live verification** — real-time domain check with ✓/✗ status
- **Search improvements** — NIP-50 relay detection, hashtag fallback suggestion

### v0.1.3
- **OS keychain** — nsec stored securely; sessions survive restarts
- **Multi-account switcher** — sidebar footer, instant switch, keychain-backed
- **SQLite note + profile cache** — feed loads from local cache on startup
- **Quote & Repost** (NIP-18) — one-click repost, compose modal for quotes
- **Mute users** (NIP-51) — mute list synced to relays, filtered from feed
- **NWC setup wizard** — guided wallet picker with per-wallet instructions + inline validation
- **System tray** — close hides to tray; Quit in tray menu exits
- **Zap history** — Received / Sent tabs with amounts, counterparts, comments
- **About / Support page** — in-app zap, Lightning + Bitcoin QR codes
- **Direct Messages** (NIP-04) — conversation list, thread view, per-message decryption

### Shipped earlier (v0.1.0 – v0.1.2)
- Onboarding (key generation, nsec backup, plain-language UX)
- Global + following feed, compose, inline replies, thread view
- Reactions (NIP-25) with live network counts
- Follow / unfollow (NIP-02), contact list publishing
- Profile view + edit (kind 0)
- Long-form article editor (NIP-23) with draft auto-save
- Zaps via NWC (NIP-47 + NIP-57), amount presets, comments
- Search: NIP-50 full-text, #hashtag, people with inline follow
- Relay management with live connection status
- Read-only (npub) login mode
