# Vega — Roadmap

> The "already shipped" history below ends at v0.12.x. For everything since — the UI polish sprint, the identifier move, Flathub prep, NIP-42 relay authentication, NIP-17 DM relays — see [CHANGELOG.md](./CHANGELOG.md) and the [GitHub release notes](https://github.com/hoornet/vega/releases).

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

- **Custom feeds / lists** (NIP-51)
- **NIP-96 file storage** integration
- **WoT-powered feed ranking** — use Web of Trust scores to rank, not just filter, the feed
- **Article editor improvements** — image insertion UX, possibly WYSIWYG
- **Encrypted group chat** — NIP-29 (relay-based groups) + NIP-44 (encryption); NIP-104 (gift-wrapped E2E) for small private groups
- **NIP-72 moderated communities** — Reddit-style public communities
- **NIP-58 badges** — achievements/awards on profiles
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

Release history lives in two places, both richer and both kept current at release time:

- **[CHANGELOG.md](./CHANGELOG.md)** — the summary, from v0.13.2 onward.
- **[GitHub Releases](https://github.com/hoornet/vega/releases)** — the full notes for every version back to v0.1.0, and the only record for v0.12.10 through v0.13.1.

This section used to repeat that history inline. It drifted five months and three minor versions behind, and worse, kept describing behaviour that had since been replaced — it still credited `ensureConnected` with trusting `relay.connected`, which is exactly what the v0.15.7 relay-liveness fix removed. A roadmap should say where the project is going; the changelog says where it has been.
