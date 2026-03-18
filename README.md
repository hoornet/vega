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
- **Multi-account switcher** — save multiple identities, switch instantly from the sidebar
- **OS keychain integration** — nsec stored in macOS Keychain / Windows Credential Manager / Linux Secret Service; sessions survive restarts

**Feed & content**
- Global and following feeds with live relay connection
- **Language/script feed filter** — filter by writing system (Latin, CJK, Cyrillic, Arabic, Korean, etc.) via dropdown in feed header; uses Unicode detection + NIP-32 language tags
- Compose notes, inline replies, full thread view
- **Image upload with NIP-98 auth** — paste from clipboard, drag-drop, or use the file picker; uploads authenticated via NIP-98 HTTP Auth with fallback services
- **Image lightbox** — click any image to view full-screen; Escape to close, arrow keys to navigate multi-image posts
- **Feed reply context** — replies show "↩ replying to @name"; click to jump to the parent thread
- Reactions (NIP-25) with live network counts
- Follow / unfollow (NIP-02) with contact list publishing
- **Quote & Repost** (NIP-18) — one-click repost or quote with compose modal
- **Bookmarks** (NIP-51 kind 10003) — save/unsave notes and articles; **Notes/Articles tabs** in bookmark view; article bookmarks use `a` tags for parameterized replaceable events; synced to relays
- **Mute users** (NIP-51) — muted list synced to relays, filtered from feed
- **Long-form article experience** (NIP-23) — **markdown toolbar** (bold, italic, heading, link, image, quote, code, list) with keyboard shortcuts (Ctrl+B/I/K); **multi-draft management** with draft list, resume, delete; **cover image file picker**; dedicated article feed with Latest/Following tabs; article search by keyword or hashtag; article reader with reading time, bookmark, like, and zap; profile Articles tab
- **Quoted note inline preview** — `nostr:note1…` / `nostr:nevent1…` renders as an inline card
- Note rendering: images, video, mentions, hashtags, njump.me link interception
- **Direct Messages** (NIP-04) — conversation list, thread view, per-message decryption; unread badge in sidebar
- **Notifications** — mentions view (🔔 in sidebar) with unread badge; clears on open

**Relay & network**
- Relay management: add/remove relays with live connection status
- **NIP-65 outbox model** — reads user relay lists (kind 10002) so you see notes from people who publish to their own relays; publish your own relay list to Nostr from Settings

**Lightning & zaps**
- **Per-account NWC wallet** — each account remembers its own Lightning wallet; switching accounts loads the correct one automatically
- **NWC guided wizard** — wallet picker (Alby Hub, Alby Extension, Mutiny, Phoenix) with per-wallet setup steps and inline URI validation
- Send zaps via NWC (NIP-47 + NIP-57) with amount presets, custom amounts, comment
- Zap counts on notes (⚡ N sats inline)
- **Zap history** — Received and Sent tabs with amounts, counterparts, comments
- **Support / About page** — zap the developer, Lightning + Bitcoin QR codes, Ko-fi and GitHub links

**Discovery**
- **Discover people** — "follows of follows" suggestions on the Search page with mutual follow counts and one-click follow
- Search: NIP-50 full-text, `#hashtag`, people search with inline follow, **article search** (kind 30023)

**Performance & UX**
- **Auto-updater** — "Update & restart" banner when a new version is available
- **SQLite note cache** — feed loads instantly from local cache on startup; profiles cached for immediate avatar display
- **System tray** — close button hides to tray; "Quit" in tray menu to fully exit
- Collapsible sidebar (icon-only mode)
- **Keyboard shortcuts** — `n` compose, `/` search, `j`/`k` navigate feed, `Esc` back, `?` help overlay
- Skeleton loading placeholders, view fade transitions

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
- Relay health checker
- Web of Trust scoring
- NIP-46 remote signer support
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

## License

MIT License — Copyright (c) 2026 Jure Sršen — [hoornet](https://github.com/hoornet)
