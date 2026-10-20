# Vega

A cross-platform desktop Nostr client built with Tauri 2.0 + React + TypeScript. Polished UI, deep Lightning integration, and first-class support for long-form writing.

**Website:** [veganostr.com](https://veganostr.com) · **Download:** [Releases](https://github.com/hoornet/vega/releases) · **AUR:** `vega-nostr`

> Named after Jurij Vega (1754–1802), a Slovenian mathematician who made knowledge accessible through his pioneering logarithm tables — just as Vega makes writing accessible on Nostr.

## Download

Grab the latest release from the [Releases page](https://github.com/hoornet/vega/releases), or visit **[veganostr.com](https://veganostr.com)** for screenshots and an introduction.

| Platform | File | Command |
|---|---|---|
| Ubuntu / Debian / Mint | `.deb` | `sudo dpkg -i Vega_*.deb` |
| Fedora | `.rpm` | `sudo rpm -i Vega-*.rpm` |
| openSUSE | `.rpm` | `sudo zypper install Vega-*.rpm` |
| Arch / Manjaro | AUR | `yay -S vega-nostr` |
| Windows | `.exe` installer | run the installer |
| Windows | winget | `winget install Hoornet.Vega` |
| macOS (Apple Silicon) | `aarch64.dmg` | open and drag to Applications |

**Windows note:** The installer is not yet code-signed. Windows SmartScreen will show an "Unknown publisher" warning — click "More info → Run anyway" to install.

**Upgrading from v0.13.x or earlier?** v0.14.0 changed the app identifier to `com.veganostr.Vega`. Your data is migrated automatically and your keys are unaffected. On **Windows**, the new version installs alongside the old one — once it's running, uninstall the old "Vega" entry from Add/Remove Programs (one-time step). On **Linux**, v0.14.2 moved key storage to the system secret service (gnome-keyring / KWallet), so you'll sign in once more after upgrading.

**Arch note:** `vega-nostr` builds the latest released tag — that's the one you want. `vega-nostr-git` also exists and builds the development branch, so it ships unreleased work; install it only if that's what you're after.

**Linux note:** Video and audio playback requires GStreamer codec packages. The AUR packages install these automatically. For `.deb`/`.rpm` installs, you may need:
```bash
# Arch / Manjaro
sudo pacman -S gst-plugins-base gst-plugins-good gst-libav

# Ubuntu / Debian
sudo apt install gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-libav

# Fedora
sudo dnf install gstreamer1-plugins-base gstreamer1-plugins-good gstreamer1-libav
```

### Verifying signatures

Every release artifact except the macOS `.dmg` — the Linux `.deb`/`.rpm`, the Windows `.exe`/`.msi`, and the macOS `.app.tar.gz` — ships with a minisign `.sig` file, the same signatures the auto-updater checks. To verify a download:

```bash
# Save the public key
echo "untrusted comment: minisign public key: F9D2C39297592652
RWRSJlmXksPS+cSpOrnmUpmJSebrbT1gxNeS33X/S7fxBAb/SdvWewNm" > vega.pub

# Verify an artifact (any file with a matching .sig)
minisign -Vm Vega_X.Y.Z_amd64.deb -p vega.pub
```

## Features

**Identity & accounts**
- **In-app account creation** — asks what people should call you and publishes that as your first profile; your secret key is shown once, with Copy, and a reminder stays until you have copied it; no browser extension required
- **A first day that makes sense** — a "start here" card above the feed (picture, bio, follow three people, back up your key, say hello), people to start with until you follow three, and every empty view saying what it is for and offering the next step
- **Looking around first** — browse without an account; "Create account" and "I have a key" open the same sign-up flow over the app, from the account switcher too
- Login with nsec (full access) or npub (read-only)
- **NIP-46 remote signer** — connect via `bunker://` URI (nsecBunker, Amber, etc.) with session persistence across restarts
- **Multi-account switcher** — save multiple identities, switch instantly from the sidebar
- **OS keychain integration** — nsec stored in macOS Keychain / Windows Credential Manager / Linux Secret Service; sessions survive restarts
- **View your secret key** — reveal and copy your `nsec` from Settings → Account at any time, to back it up or move to another client

**Feed & content**
- **Virtualized feed with infinite scroll** — the Global feed loads older notes automatically as you scroll; only on-screen notes stay in memory, so it remains fast and memory-bounded no matter how far you go
- Global, Following, and Trending feeds; instant load from local cache on startup, Refresh pulls the latest
- **Language/script feed filter** — filter by writing system (Latin, CJK, Cyrillic, Arabic, Korean, etc.) via dropdown in feed header; uses Unicode detection + NIP-32 language tags
- Compose notes, inline replies, **nested thread trees** with reply-to-any-note and multi-level back navigation
- **Image upload with NIP-98 auth** — paste from clipboard, drag-drop, or use the file picker; uploads authenticated via NIP-98 HTTP Auth with fallback services
- **Image lightbox** — click any image to view full-screen; Escape to close, arrow keys to navigate multi-image posts
- **Feed reply context** — replies show "↩ replying to @name"; click to jump to the parent thread or scroll to it in the current thread
- Reactions (NIP-25) with live network counts
- Follow / unfollow (NIP-02) with contact list publishing
- **Quote & Repost** (NIP-18) — Repost and Quote share one menu on each note; Quote opens a compose dialog
- **Bookmarks** (NIP-51 kind 10003) — save/unsave notes and articles; **Notes/Articles tabs** in bookmark view; article bookmarks use `a` tags for parameterized replaceable events; synced to relays, with each change made on the relays' copy of the list and nothing published while that copy is unknown
- **Mute users** (NIP-51) — muted list synced to relays the same way as bookmarks, filtered from feed and search results
- **Long-form article experience** (NIP-23) — the editor is laid out as the reader's page, with a **markdown toolbar** (bold, italic, heading, link, image, quote, code, list) and keyboard shortcuts (Ctrl+B/I/K); **multi-draft management** with draft list, resume, delete; Publish opens a sheet with the card as it will appear, the summary, a **cover image file picker** and tags; **published articles can be edited** as an update to the same article; dedicated article feed with Following/Latest tabs; article search by keyword or hashtag; article reader set in a bundled reading typeface (Literata), with reading time, bookmark, like, and zap, and the writer's bio and more of their articles at the end; profile Articles tab
- **Quoted note inline preview** — `nostr:note1…` / `nostr:nevent1…` renders as an inline card
- **naddr clickable links** — `nostr:naddr1…` references resolve to clickable named links (article titles, etc.)
- **Syntax highlighting** — code blocks in notes and articles render with syntax highlighting
- Note rendering: images, video, mentions, hashtags, njump.me link interception
- **External links** — all http(s) links open in your system browser via Tauri opener
- **Emoji reactions** — reaction picker with common emojis on note cards; emoji insertion in compose and reply boxes via categorized emoji picker
- **Keyword muting** — word/phrase mute list with client-side filtering across all views
- **Web of Trust filter** — hide notes, reactions, and zaps from people outside your social graph (people you follow + follows-of-follows), powered by Vertex DVM trust scoring; toggleable in Settings
- **Direct Messages** (NIP-04 + NIP-17 gift wrap) — conversation list, thread view, per-message decryption; unread badge in sidebar; honours published DM relay lists (kind 10050), so messages reach a dedicated DM relay even when it isn't in your main list; **New message** finds people you follow by name, or takes a key or a name@domain address
- **Notifications** — background poller (60s) for mentions, zaps, new followers, and incoming messages; each type independently toggleable; OS push notifications (DM notifications name the sender only — never the message content); a Notifications view with Mentions, Zaps and Followers tabs, a line on each item saying what happened, and one unread badge in the sidebar
- **New follower badges** — recently gained followers marked with a "new" badge and sorted to the top of your followers in People

**Relay & network**
- **Every event a relay sends is checked**: its signature, and that its id is the hash of its own contents
- **Relay status badge** — compact "3/3 relays +2" indicator in feed header with color coding; counts *your* relays, with a separate `+N` for extra reach found through NIP-65; says "not answering" when relays stop answering; hover or keyboard focus shows per-relay connection status grouped by origin
- **Toast notifications** — say what happened when nothing else on screen shows it, and say when something failed, with Undo or Try again where it helps; also relay events: "Connection lost — reconnecting", "Back online", "Relays reconnected"
- **Relay health checker** — NIP-11 info fetch, WebSocket latency probing, one status word per relay (connected, slow, not answering); expandable cards show all supported NIPs, software, description; a Remove button on every relay, with Undo; relays that did not answer the last check can be removed after a confirmation; "Share my relay list" publishes your NIP-65 relay list; auto-checks on mount
- **Relay recommendations** — discover relays based on your follows' NIP-65 relay lists; shows follow count, one-click "Add"
- **Embedded Nostr relay** — optional built-in strfry relay (Settings → Advanced) with catch-up sync on startup; your notes are always available locally even when remote relays are slow or offline
- **Vega public relay** — `wss://relay2.veganostr.com` included by default; custom Go relay with NIP-45/50/77, ensuring data availability when other relays are flaky or down
- Relay management: add/remove relays, all in one consolidated Relays view that shows your relays apart from the extra reach Vega found on its own; changes apply immediately, no restart needed
- **NIP-65 outbox model with a Relay reach switch** — reads user relay lists (kind 10002) so you see notes from people who publish to their own relays; publish your own relay list to Nostr. On by default; in Relays, turn off **Also look on the relays that people I follow use** to confine Vega strictly to your configured relays
- **Relay authentication (NIP-42) with a privacy scope** — answers relay AUTH challenges so auth-gated relays serve your messages; because authenticating tells a relay who you are, you choose the scope in Relays: **Only my relays** (default) or **Any relay that asks**. Declined challenges are surfaced instead of showing an empty screen

**Podcasts & Value 4 Value**
- **Built-in podcast player** — search and play podcasts via Fountain.fm integration with Podcast Index enrichment
- **V4V streaming** — stream sats per minute to podcast creators while listening via Lightning (keysend + LNURL-pay)
- **Auto-streaming** — once a per-episode cap and a weekly budget are set, enable it once and V4V starts automatically on every supported episode at your chosen rate
- **Per-episode caps & weekly budgets** — set spending limits; streaming stops automatically when caps are reached
- **Value 4 Value view** — reached from Podcasts; dashboard with live streaming status, budget bars, stats, settings, and full history
- **Recipient breakdown** — see exactly who gets paid and their split percentages
- **V4V nudge** — brief non-intrusive tooltip when a V4V-enabled episode starts playing (once per episode per session)
- **V4V badges on episodes** — ⚡ V4V pill on episode cards so you know which shows support it
- **Subscriptions follow your account** — "My Podcasts" is published as a NIP-51 kind 30003 bookmark set (`d="podcasts"`), so your show list syncs across devices and is restored on reinstall as long as you sign in with the same key

**Lightning & zaps**
- **Per-account NWC wallet** — each account remembers its own Lightning wallet; switching accounts loads the correct one automatically
- **NWC guided wizard** — wallet picker (Alby Hub, Alby Extension, Phoenix, or another NWC wallet) with per-wallet setup steps and inline URI validation; a wallet counts as connected once it has answered, so a revoked or mistyped code shows up at once
- Send zaps via NWC (NIP-47 + NIP-57) with amount presets, custom amounts, comment
- Zap counts on notes (⚡ N sats inline)
- **Zap history** — Received and Sent tabs with amounts, counterparts, comments, and clickable note previews
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
- **Color themes** — 7 built-in themes: Midnight (default dark), Light, Catppuccin Mocha, Gruvbox, Nord Frost, Hackerman, and **Reader** (a warm, low-glare palette for comfortable long reading); instant switching from Settings
- **Text size** — Small / Normal / Large / Extra Large presets; scales the whole window, the sidebar included
- **Easy-Read Font** — optional Atkinson Hyperlegible typeface, designed by the Braille Institute for legibility, with slightly wider letter-spacing and line-height; helps dyslexic readers and long reading sessions

**Performance & UX**
- **Resilient relay connectivity** — all relay queries have timeouts (no more infinite loading); reachability is judged by whether relays actually answer, not by whether a socket claims to be open, so Vega recovers on its own when a laptop wakes from sleep or the network changes underneath it; automatic reconnection with NDK instance reset as last resort; toast notifications for connection events; feed diagnostics for debugging
- **Per-tab "last updated" timestamp** — relative time indicator in feed header shows how fresh each tab's data is
- **Subscription debug panel** — `Ctrl+Shift+D` toggles a hidden panel showing NDK uptime, live subscription status, per-relay state, feed timestamps, and recent diagnostics
- **Auto-updater** — "Update & restart" banner when a new version is available
- **SQLite note cache** — feed loads instantly from local cache on startup; profiles cached for immediate avatar display
- **Data export** — export bookmarks, follows, and relay list as JSON via native save dialog
- **Profile media gallery** — "Media" tab on profiles shows a grid of the user's images, videos, and audio; images open in lightbox
- **Reading list tracking** — read/unread state on bookmarked articles with unread dot indicators and sidebar badge
- **Profile banner polish** — hero-height banner with click-to-lightbox, avatar overlaps banner edge with ring
- **System tray** — close button hides to tray; "Quit" in tray menu to fully exit
- **Collapsible & resizable sidebar** — nine places (Home, Notifications, Messages, Bookmarks, People, Search, Articles, Media, Podcasts), a Write button with your draft count, and Settings, Relays, Keyboard shortcuts and Support at the foot; Zap history is in the account menu; collapse to icon-only mode, or drag the right edge to set the width (double-click to reset; remembered between sessions)
- **Collapsing compose box** — sits as a single line when idle and expands to full height with the toolbar when you focus it, keeping the top of the feed compact
- **Update banner with changelog** — when an update is available, "What's new" shows the release notes of every version since the one you have, newest first, with a link to the full changelog on GitHub
- **Keyboard shortcuts** — `n` compose, `/` search, `j`/`k` navigate feed, `Esc` closes what opened last or goes back, `F6` newest toast, `?` help overlay
- Skeleton loading placeholders, view fade transitions
- **Media pause on navigation** — video and audio in feed automatically pause when you navigate to another view
- **Accessibility** — WCAG AA contrast (text colours at 4.5:1 or better in every theme), ARIA labels, reduced motion support; dialogs take focus, keep Tab inside and give focus back; switches and tabs tell a screen reader their state
- **Podcast player stability** — 15s loading timeout with user-friendly error messages; automatic V4V stop on audio failure
- **Identity banner** — looking around without an account, a line at the top offers Create account and I have a key; a public-key account is told whose view it is and what a key adds; an account made here is reminded until its secret key is backed up

## Supported NIPs

| NIP | Description | Status |
|-----|-------------|--------|
| [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md) | Basic protocol flow | Full |
| [NIP-02](https://github.com/nostr-protocol/nips/blob/master/02.md) | Follow list | Full |
| [NIP-04](https://github.com/nostr-protocol/nips/blob/master/04.md) | Encrypted direct messages (legacy) | Full |
| [NIP-05](https://github.com/nostr-protocol/nips/blob/master/05.md) | DNS-based verification | Full (display + live verify in editor) |
| [NIP-10](https://github.com/nostr-protocol/nips/blob/master/10.md) | Reply threading | Full (nested trees, root+reply markers) |
| [NIP-11](https://github.com/nostr-protocol/nips/blob/master/11.md) | Relay information | Full (health checker) |
| [NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md) | Private direct messages (gift wrap) | Full (incl. DM relay lists, kind 10050) |
| [NIP-18](https://github.com/nostr-protocol/nips/blob/master/18.md) | Reposts | Full |
| [NIP-19](https://github.com/nostr-protocol/nips/blob/master/19.md) | bech32-encoded entities | Full (npub, nsec, note, nevent, nprofile, naddr) |
| [NIP-21](https://github.com/nostr-protocol/nips/blob/master/21.md) | `nostr:` URI scheme | Full |
| [NIP-23](https://github.com/nostr-protocol/nips/blob/master/23.md) | Long-form content (articles) | Full (editor, reader, feed, search) |
| [NIP-25](https://github.com/nostr-protocol/nips/blob/master/25.md) | Reactions | Full (emoji reactions) |
| [NIP-27](https://github.com/nostr-protocol/nips/blob/master/27.md) | Text note references | Full |
| [NIP-32](https://github.com/nostr-protocol/nips/blob/master/32.md) | Labeling | Partial (language filter via script tags) |
| [NIP-42](https://github.com/nostr-protocol/nips/blob/master/42.md) | Relay authentication | Full (with privacy scope setting) |
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
# Prerequisites: Node.js 22.22+ or 24.15+ (24 LTS recommended), Rust stable, @tauri-apps/cli
npm install
npm run tauri dev       # full app with hot reload
npm run dev             # browser only (no Tauri window)
npm run tauri build     # production binary
```

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for the full prioritised next steps.

Up next:
- Custom feeds / lists
- NIP-96 file storage
- NIP-58 badges, NIP-72 communities
- WoT-powered feed ranking

## Support

Vega is free and open-source. If it's useful to you:

| Method | Details |
|---|---|
| ⚡ Zap (in-app) | Open **Support** (the heart at the foot of Vega's sidebar) and zap directly |
| ⚡ Lightning | `jure@getalby.com` |
| ₿ Bitcoin | `bc1qcgaupf80j28ca537xjlcs9dm9s03khezjs7crp` |
| ☕ Ko-fi | [ko-fi.com/jure](https://ko-fi.com/jure) |
| ♥ GitHub Sponsors | [github.com/sponsors/hoornet](https://github.com/sponsors/hoornet) |
| ★ GitHub star | Helps with visibility and grant applications |

## Contributors

Vega is built by one person, but it's better because of the people who've pitched in. Thank you:

- **[Anderseta](https://github.com/Anderseta)** — configurable HTTP/SOCKS5 network proxy, including Tor support, with the update checks routed through the proxy too ([#10](https://github.com/hoornet/vega/pull/10)).
- **[SondreB](https://github.com/SondreB)** — Vega's first external contributor; early new-user-experience feedback that shaped onboarding ([#2](https://github.com/hoornet/vega/issues/2)).

Spotted a bug or have an idea? Issues and pull requests are welcome.

## Acknowledgements

Vega is built on the shoulders of excellent open-source projects:

- [Tauri](https://tauri.app/) — the desktop shell that makes cross-platform Rust+Web apps possible
- [NDK (Nostr Dev Kit)](https://github.com/nostr-dev-kit/ndk) by [Pablo Fernandez](https://github.com/pablof7z) — the Nostr protocol library that powers all relay communication
- [Nostr protocol](https://github.com/nostr-protocol/nostr) by [fiatjaf](https://github.com/fiatjaf) — the protocol itself
- [React](https://react.dev/), [Vite](https://vite.dev/), [Tailwind CSS](https://tailwindcss.com/), [Zustand](https://github.com/pmndrs/zustand) — the frontend stack
- [ants](https://github.com/dergigi/ants) by [Gigi](https://github.com/dergigi) — inspiration and Nostr ecosystem advocacy
- The Nostr community — for building an open, censorship-resistant communication layer

## License

MIT License — Copyright (c) 2026 Jure Sršen — [hoornet](https://github.com/hoornet)
