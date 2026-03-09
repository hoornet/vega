# Wrystr — Next Steps Roadmap

_Generated 2026-03-09 based on codebase analysis._

---

## Quick wins (high impact, low effort)

### 1. Settings View
- Currently 100% stubbed with placeholder text
- Add relay management: add/remove relay URLs
- Appearance toggles (theme, etc.)
- Key export/management UI

### 2. Follow/Unfollow from UI (NIP-02 — P1)
- Follow list is already fetched in the user store and used for the following feed
- Just needs a Follow/Unfollow button on ProfileView
- Data layer is already there — this is mostly UI work

### 3. Reaction counts from network
- Likes are currently tracked in localStorage only
- Reaction counts from the network are never fetched or displayed
- Would make notes feel much more alive socially

---

## Medium effort, high value

### 4. Zaps (NIP-57 + NIP-47 — P2)
- lud16 (Lightning address) is already shown on profile pages
- Needs: zap modal, amount picker, NWC wallet connection (NIP-47)
- Big UX differentiator vs other clients

### 5. Search (NIP-50 — P1)
- Not started at all
- Easiest entry point: hashtag search (hashtags are already highlighted in NoteContent)
- Then: full-text note search, user search

### 6. OS Keychain via Rust (Tauri backend)
- Security-critical: private keys currently only live in memory
- Rust backend (`src-tauri/src/lib.rs`) only has a placeholder `greet()` command
- Tauri has keychain plugins ready to use

---

## Longer term

### 7. SQLite note caching
- Notes disappear on every refresh — no persistence
- Would make the app feel dramatically more solid and fast
- Rust backend is the right place for this

### 8. Direct Messages (NIP-44 — P3)
- Significant complexity (encryption, key handling)
- Major feature gap but non-trivial to implement well

---

## What's already done (for reference)

- Global + following feed
- Note rendering (images, video, mentions, hashtags)
- Compose + reply
- Reactions (like button, localStorage-persisted)
- Profile view + edit
- Thread view
- Article editor (NIP-23, with draft auto-save)
- Login (nsec + read-only pubkey)
- Relay connection status view (read-only)
- NDK wrapper for all Nostr interactions
