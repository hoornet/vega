# Wrystr

A cross-platform desktop Nostr client built with Tauri 2.0 + React + TypeScript. Polished UI, deep Lightning integration, and first-class support for long-form writing.

> Named as a nod to Nostr with a wry twist.

## Download

Grab the latest release from the [Releases page](https://github.com/hoornet/wrystr/releases).

| Platform | File | Command |
|---|---|---|
| Ubuntu / Debian / Mint | `.deb` | `sudo dpkg -i wrystr_*.deb` |
| Fedora | `.rpm` | `sudo rpm -i wrystr-*.rpm` |
| openSUSE | `.rpm` | `sudo zypper install wrystr-*.rpm` |
| Arch / Manjaro | AUR | `yay -S wrystr-git` |
| Windows | `.exe` installer | run the installer |
| macOS (Apple Silicon) | `aarch64.dmg` | open and drag to Applications |

**Windows note:** The installer is not yet code-signed. Windows SmartScreen will show an "Unknown publisher" warning — click "More info → Run anyway" to install.

**Linux note:** Video and audio playback requires GStreamer codec packages. The AUR package installs these automatically. For `.deb`/`.rpm` installs, you may need:
```bash
# Arch / Manjaro
sudo pacman -S gst-plugins-base gst-plugins-good gst-libav

# Ubuntu / Debian
sudo apt install gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-libav

# Fedora
sudo dnf install gstreamer1-plugins-base gstreamer1-plugins-good gstreamer1-libav
```

## Features

**Identity & accounts**
- In-app key generation with plain-language nsec backup — no browser extension required
- **Create new account** from the account switcher — no need to restart or go through onboarding again
- Login with nsec (full access) or npub (read-only)
- **NIP-46 remote signer** — connect via `bunker://` URI (nsecBunker, Amber, etc.) with session persistence across restarts
- **Multi-account switcher** — save multiple identities, switch instantly from the sidebar
- **OS keychain integration** — nsec stored in macOS Keychain / Windows Credential Manager / Linux Secret Service; sessions survive restarts

**Feed & content**
- **Live streaming feed** — persistent relay subscriptions deliver new notes in real-time; no manual refresh needed
- Global and following feeds with live relay connection
- **Language/script feed filter** — filter by writing system (Latin, CJK, Cyrillic, Arabic, Korean, etc.) via dropdown in feed header; uses Unicode detection + NIP-32 language tags
- Compose notes, inline replies, **nested thread trees** with reply-to-any-note and multi-level back navigation
- **Image upload with NIP-98 auth** — paste from clipboard, drag-drop, or use the file picker; uploads authenticated via NIP-98 HTTP Auth with fallback services
- **Image lightbox** — click any image to view full-screen; Escape to close, arrow keys to navigate multi-image posts
- **Feed reply context** — replies show "↩ replying to @name"; click to jump to the parent thread or scroll to it in the current thread
- Reactions (NIP-25) with live network counts
- Follow / unfollow (NIP-02) with contact list publishing
- **Quote & Repost** (NIP-18) — one-click repost or quote with compose modal
- **Bookmarks** (NIP-51 kind 10003) — save/unsave notes and articles; **Notes/Articles tabs** in bookmark view; article bookmarks use `a` tags for parameterized replaceable events; synced to relays
- **Mute users** (NIP-51) — muted list synced to relays, filtered from feed
- **Long-form article experience** (NIP-23) — **markdown toolbar** (bold, italic, heading, link, image, quote, code, list) with keyboard shortcuts (Ctrl+B/I/K); **multi-draft management** with draft list, resume, delete; **cover image file picker**; dedicated article feed with Latest/Following tabs; article search by keyword or hashtag; article reader with reading time, bookmark, like, and zap; profile Articles tab
- **Quoted note inline preview** — `nostr:note1…` / `nostr:nevent1…` renders as an inline card
- **Syntax highlighting** — code blocks in notes and articles render with syntax highlighting
- Note rendering: images, video, mentions, hashtags, njump.me link interception
- **External links** — all http(s) links open in your system browser via Tauri opener
- **Emoji reactions** — reaction picker with common emojis on note cards; emoji insertion in compose and reply boxes via categorized emoji picker
- **Keyword muting** — word/phrase mute list with client-side filtering across all views
- **Direct Messages** (NIP-04 + NIP-17 gift wrap) — conversation list, thread view, per-message decryption; unread badge in sidebar
- **Notifications** — background poller (60s) for mentions, zaps, new followers; each type independently toggleable; OS push notifications; 🔔 in sidebar with unread badge

**Relay & network**
- **Relay status badge** — compact "8/12 relays" indicator in feed header with color coding (green/yellow/red by connection ratio); hover shows per-relay connection status
- **Toast notifications** — transient status messages for relay events: "Connection lost — reconnecting", "Back online", "Relays reconnected"
- **Relay health checker** — NIP-11 info fetch, WebSocket latency probing, online/slow/offline classification; expandable cards show all supported NIPs, software, description; per-relay remove button; "Remove dead" strips offline relays; "Publish list" publishes NIP-65 relay list; auto-checks on mount
- **Relay recommendations** — discover relays based on your follows' NIP-65 relay lists; shows follow count, one-click "Add"
- Relay management: add/remove relays, all in one consolidated Relays view
- **NIP-65 outbox model** — reads user relay lists (kind 10002) so you see notes from people who publish to their own relays; publish your own relay list to Nostr

**Lightning & zaps**
- **Per-account NWC wallet** — each account remembers its own Lightning wallet; switching accounts loads the correct one automatically
- **NWC guided wizard** — wallet picker (Alby Hub, Alby Extension, Mutiny, Phoenix) with per-wallet setup steps and inline URI validation
- Send zaps via NWC (NIP-47 + NIP-57) with amount presets, custom amounts, comment
- Zap counts on notes (⚡ N sats inline)
- **Zap history** — Received and Sent tabs with amounts, counterparts, comments
- **Support / About page** — zap the developer, Lightning + Bitcoin QR codes, Ko-fi and GitHub links

**Discovery**
- **Trending feed** — trending notes and articles from the last 24h, ranked by engagement with time decay scoring
- **Media feed** — dedicated "Media" view in sidebar with All/Videos/Images/Audio tab filtering
- **Dedicated hashtag pages** — clicking any #tag opens a live feed for that hashtag
- **Trending hashtags** — popular hashtags shown as clickable pills on the search idle screen
- **Discover people** — "follows of follows" suggestions on the Search page with mutual follow counts and one-click follow; persistent "don't suggest again" per person
- **Advanced search** — `by:author`, `mentions:npub`, `kind:number`, `is:article`, `has:image`, `since:2026-01-01`, `until:2026-12-31`, `#hashtag`, `"exact phrase"`, boolean `OR`; NIP-05 resolution for author lookups; client-side content filters for media types; search help panel with modifier reference
- Search: NIP-50 full-text, `#hashtag`, people search with inline follow, **article search** (kind 30023)
- **NIP-05 verification badges** — cached verification with green checkmark on note cards

**Personalization**
- **Color themes** — 7 built-in themes: Midnight (default dark), Light, Catppuccin Mocha, Tokyo Night, Gruvbox, Ethereal, Hackerman; instant switching from Settings
- **Font size** — Small / Normal / Large / Extra Large presets; scales the entire UI uniformly

**Performance & UX**
- **Resilient relay connectivity** — all relay queries have timeouts (no more infinite loading); automatic reconnection with NDK instance reset as last resort; toast notifications for connection events; feed diagnostics for debugging
- **Per-tab "last updated" timestamp** — relative time indicator in feed header shows how fresh each tab's data is
- **Subscription debug panel** — `Ctrl+Shift+D` toggles a hidden panel showing NDK uptime, live subscription status, per-relay state, feed timestamps, and recent diagnostics
- **Auto-updater** — "Update & restart" banner when a new version is available
- **SQLite note cache** — feed loads instantly from local cache on startup; profiles cached for immediate avatar display
- **Data export** — export bookmarks, follows, and relay list as JSON via native save dialog
- **Profile media gallery** — "Media" tab on profiles shows a grid of the user's images, videos, and audio; images open in lightbox
- **Reading list tracking** — read/unread state on bookmarked articles with unread dot indicators and sidebar badge
- **Profile banner polish** — hero-height banner with click-to-lightbox, avatar overlaps banner edge with ring
- **System tray** — close button hides to tray; "Quit" in tray menu to fully exit
- Collapsible sidebar (icon-only mode)
- **Keyboard shortcuts** — `n` compose, `/` search, `j`/`k` navigate feed, `Esc` back, `?` help overlay
- Skeleton loading placeholders, view fade transitions

## Supported NIPs

| NIP | Description | Status |
|-----|-------------|--------|
| [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md) | Basic protocol flow | Full |
| [NIP-02](https://github.com/nostr-protocol/nips/blob/master/02.md) | Follow list | Full |
| [NIP-04](https://github.com/nostr-protocol/nips/blob/master/04.md) | Encrypted direct messages (legacy) | Full |
| [NIP-05](https://github.com/nostr-protocol/nips/blob/master/05.md) | DNS-based verification | Full (display + live verify in editor) |
| [NIP-10](https://github.com/nostr-protocol/nips/blob/master/10.md) | Reply threading | Full (nested trees, root+reply markers) |
| [NIP-11](https://github.com/nostr-protocol/nips/blob/master/11.md) | Relay information | Full (health checker) |
| [NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md) | Private direct messages (gift wrap) | Full |
| [NIP-18](https://github.com/nostr-protocol/nips/blob/master/18.md) | Reposts | Full |
| [NIP-19](https://github.com/nostr-protocol/nips/blob/master/19.md) | bech32-encoded entities | Full (npub, nsec, note, nevent, nprofile, naddr) |
| [NIP-21](https://github.com/nostr-protocol/nips/blob/master/21.md) | `nostr:` URI scheme | Full |
| [NIP-23](https://github.com/nostr-protocol/nips/blob/master/23.md) | Long-form content (articles) | Full (editor, reader, feed, search) |
| [NIP-25](https://github.com/nostr-protocol/nips/blob/master/25.md) | Reactions | Full (emoji reactions) |
| [NIP-27](https://github.com/nostr-protocol/nips/blob/master/27.md) | Text note references | Full |
| [NIP-46](https://github.com/nostr-protocol/nips/blob/master/46.md) | Nostr Connect (remote signer) | Full (bunker:// login) |
| [NIP-47](https://github.com/nostr-protocol/nips/blob/master/47.md) | Wallet Connect (NWC) | Full |
| [NIP-50](https://github.com/nostr-protocol/nips/blob/master/50.md) | Search | Full (notes, articles, people) |
| [NIP-51](https://github.com/nostr-protocol/nips/blob/master/51.md) | Lists | Partial (bookmarks, mute list) |
| [NIP-57](https://github.com/nostr-protocol/nips/blob/master/57.md) | Zaps | Full |
| [NIP-65](https://github.com/nostr-protocol/nips/blob/master/65.md) | Relay list metadata | Full (outbox model) |
| [NIP-98](https://github.com/nostr-protocol/nips/blob/master/98.md) | HTTP Auth | Full (image uploads) |

## Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri 2.0 (Rust) |
| Frontend | React 19 + TypeScript + Vite |
| Nostr protocol | NDK 3.x (Nostr Dev Kit) |
| Styling | Tailwind CSS 4 |
| State | Zustand |
| Local storage | SQLite (rusqlite, bundled) |
| Keychain | keyring crate (OS-native) |

## Development

```bash
# Prerequisites: Node.js 20+, Rust stable, @tauri-apps/cli
npm install
npm run tauri dev       # full app with hot reload
npm run dev             # browser only (no Tauri window)
npm run tauri build     # production binary
```

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for the full prioritised next steps.

Up next:
- UI polish and visual makeover
- Nostr NIP research sprint — expanding protocol support
- Web of Trust scoring
- Custom feeds / lists

## Support

Wrystr is free and open-source. If it's useful to you:

| Method | Details |
|---|---|
| ⚡ Zap (in-app) | Open the **support** view in Wrystr's sidebar and zap directly |
| ⚡ Lightning | `harpos@getalby.com` |
| ₿ Bitcoin | `bc1qcgaupf80j28ca537xjlcs9dm9s03khezjs7crp` |
| ☕ Ko-fi | [ko-fi.com/jure](https://ko-fi.com/jure) |
| ♥ GitHub Sponsors | [github.com/sponsors/hoornet](https://github.com/sponsors/hoornet) |
| ★ GitHub star | Helps with visibility and grant applications |

## Acknowledgements

Wrystr is built on the shoulders of excellent open-source projects:

- [Tauri](https://tauri.app/) — the desktop shell that makes cross-platform Rust+Web apps possible
- [NDK (Nostr Dev Kit)](https://github.com/nostr-dev-kit/ndk) by [Pablo Fernandez](https://github.com/pablof7z) — the Nostr protocol library that powers all relay communication
- [Nostr protocol](https://github.com/nostr-protocol/nostr) by [fiatjaf](https://github.com/fiatjaf) — the protocol itself
- [React](https://react.dev/), [Vite](https://vite.dev/), [Tailwind CSS](https://tailwindcss.com/), [Zustand](https://github.com/pmndrs/zustand) — the frontend stack
- [ants](https://github.com/dergigi/ants) by [Gigi](https://github.com/dergigi) — inspiration and Nostr ecosystem advocacy
- The Nostr community — for building an open, censorship-resistant communication layer

## License

MIT License — Copyright (c) 2026 Jure Sršen — [hoornet](https://github.com/hoornet)
