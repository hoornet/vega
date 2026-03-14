# Wrystr — Roadmap

---

## Vision: more than a Nostr client

Wrystr is not just a great desktop Nostr client. **Long-form content is a first-class,
distinguishing feature** — not an afterthought, not a checkbox NIP.

The article editor (NIP-23), the reading experience, the writing tools around it — these
set Wrystr apart from other clients and define its identity. Think of it as a publishing
platform that happens to live on Nostr, not a social feed that happens to support articles.

---

## Development process

Each phase is built, then thoroughly tested (especially on Windows) before the next begins.
Bugs found during testing are fixed before Phase N+1 starts. A release is cut between phases.

---

## Phase 1 — Complete the core experience ✓ COMPLETE

*Shipped in v0.1.5. Tested on Windows (v0.1.7 fixes applied). Ready for OpenSats application (April 1, 2026).*

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

## Phase 3 — Polish & completeness ✓ MOSTLY COMPLETE

*Shipped in v0.4.0. NIP-17 DMs deferred to Phase 4.*

- ✓ **Image lightbox** — click any image to view full-screen; Escape to close, left/right arrows for multi-image navigation
- ✓ **Bookmarks (NIP-51 kind 10003)** — save/unsave notes with one click; dedicated Bookmarks view in sidebar; synced to relays
- ✓ **Follow suggestions / discovery** — "follows of follows" algorithm on Search page; shows mutual follow counts with one-click follow
- ✓ **Language/script feed filter** — dropdown in feed header; Unicode script detection (Latin, CJK, Cyrillic, Arabic, Korean, Hebrew, etc.) + NIP-32 language tag support
- ✓ **UI polish** — skeleton loading placeholders, improved empty states with helpful prompts, subtle view fade transitions

### Remaining: NIP-17 DMs (gift wrap)
- Current DMs use NIP-04 (kind 4) — works but deprecated and leaks metadata
- NIP-17 wraps messages in gift wrap (kind 1059) for proper sender/recipient privacy
- Needs inbox relay support (kind 10050) and ephemeral key signing
- Not interoperable with NIP-04 — both should be supported during migration

---

## Brainstorm backlog (not yet scheduled)

### Web of Trust (WOT)
- Social graph distance for trust scoring
- Could power: feed ranking, spam filtering, people search, follow suggestions
- Needs dedicated design session

### Long-form features (NIP-23 depth)
- Discovery: browse articles from followed authors, trending articles
- Reading history, estimated read time, table of contents
- Editor improvements: image upload, word count, tag suggestions
- Cross-posting to other platforms

### NIP-46 remote signer
- Sign events via a remote signer (Nsecbunker, Amber, etc.)
- Would complete the multi-account story for users who don't want nsec in keychain

### NIP-05 monetization (Phase 4 idea)
- Offer a paid "Verified NIP-05 name" service (e.g. name@wrystr.app)
- Would need a backend + domain; Wrystr talks to it; users pay sats via Lightning
- Free tier: self-hosted as today; paid tier: managed registration

---

## What's already shipped

### v0.4.0 — Phase 3: Discovery & Polish
- **Image lightbox** — click any image to view full-screen; Escape to close, arrow keys to navigate multi-image posts
- **Bookmarks (NIP-51 kind 10003)** — save/unsave notes with one click; dedicated Bookmarks view in sidebar; synced to relays
- **Discover people** — "follows of follows" suggestions on Search page with mutual follow counts and one-click follow
- **Language/script feed filter** — dropdown in feed header filters by writing system (Latin, CJK, Cyrillic, Arabic, Korean, Hebrew, Greek, Thai, Devanagari); Unicode script detection + NIP-32 language tag support
- **UI polish** — skeleton loading placeholders instead of "Loading..." text; improved empty states with helpful prompts; subtle view fade transitions on navigation

### v0.3.1
- **Feed tab persists across navigation** — back button now returns to the correct tab (Global/Following) instead of always resetting to Global
- **Available on AUR** — Arch/Manjaro users can install with `yay -S wrystr-git`

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
