# Wrystr

A cross-platform desktop Nostr client built with Tauri 2.0 + React + TypeScript. Polished UI, deep Lightning integration, and first-class support for long-form writing.

> Named as a nod to Nostr with a wry twist.

## Download

Grab the latest release from the [Releases page](https://github.com/hoornet/wrystr/releases).

| Platform | File |
|---|---|
| Linux | `.AppImage` (make executable, then run) |
| Windows | `.exe` installer |
| macOS (Apple Silicon) | `aarch64.dmg` |
| macOS (Intel) | `x86_64.dmg` |

No dependencies required — everything is bundled.

## Features

**Identity & accounts**
- In-app key generation with plain-language nsec backup — no browser extension required
- Login with nsec (full access) or npub (read-only)
- **Multi-account switcher** — save multiple identities, switch instantly from the sidebar
- **OS keychain integration** — nsec stored in macOS Keychain / Windows Credential Manager / Linux Secret Service; sessions survive restarts

**Feed & content**
- Global and following feeds with live relay connection
- Compose notes, inline replies, full thread view
- Reactions (NIP-25) with live network counts
- Follow / unfollow (NIP-02) with contact list publishing
- **Quote & Repost** (NIP-18) — one-click repost or quote with compose modal
- **Mute users** (NIP-51) — muted list synced to relays, filtered from feed
- Long-form article editor (NIP-23) with title, tags, cover image, live preview, auto-save drafts
- Note rendering: images, video, mentions, hashtags, njump.me link interception

**Lightning & zaps**
- **NWC guided wizard** — wallet picker (Alby Hub, Alby Extension, Mutiny, Phoenix) with per-wallet setup steps and inline URI validation
- Send zaps via NWC (NIP-47 + NIP-57) with amount presets, custom amounts, comment
- **Zap history** — Received and Sent tabs with amounts, counterparts, comments
- **Support / About page** — zap the developer, Lightning + Bitcoin QR codes, Ko-fi and GitHub links

**Performance & UX**
- **SQLite note cache** — feed loads instantly from local cache on startup; profiles cached for immediate avatar display
- **System tray** — close button hides to tray; "Quit" in tray menu to fully exit
- Collapsible sidebar (icon-only mode)
- Search: NIP-50 full-text, `#hashtag`, people search with inline follow
- Relay management: add/remove relays with live connection status

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
- Sidebar improvements (auto-hide, clearer collapse affordance)
- Profile helpers (NIP-05 guide, image upload via NIP-96/Blossom)
- Search improvements (NIP-50 relay detection)
- Direct messages (NIP-44/17)
- Long-form article reader view

## Support

Wrystr is free and open-source. If it's useful to you:

| Method | Details |
|---|---|
| ⚡ Zap (in-app) | Open the **support** view in Wrystr's sidebar and zap directly |
| ⚡ Lightning | `harpos@getalby.com` |
| ₿ Bitcoin | `bc1qcgaupf80j28ca537xjlcs9dm9s03khezjs7crp` |
| ☕ Ko-fi | [ko-fi.com/jure](https://ko-fi.com/jure) |
| ★ GitHub star | Helps with visibility and grant applications |

## License

MIT — [hoornet](https://github.com/hoornet)
