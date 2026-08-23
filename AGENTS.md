# AGENTS.md — Vega

This file guides AI coding agents working on this codebase.
**See `CLAUDE.md` for the authoritative, up-to-date architecture and conventions.**

---

## What is Vega?

Vega is a cross-platform desktop Nostr client built for Mac, Windows, and Linux.
Named after Jurij Vega (1754–1802), Slovenian mathematician.
The goal: best Nostr desktop experience — polished UI, deep Lightning integration,
full NIP coverage, performance that feels native.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri 2.0 (Rust backend) |
| Frontend | React 19 + TypeScript (Vite 8 / Rolldown) |
| Nostr protocol | NDK (Nostr Dev Kit) |
| Lightning | Nostr Wallet Connect (NIP-47) |
| Styling | Tailwind CSS 4 |
| State management | Zustand |
| Local storage | SQLite via `rusqlite` (bundled) |
| Key storage | OS keychain via `keyring` crate |

---

## Coding Conventions

### TypeScript / React
- Functional components only, no class components
- Zustand stores per domain (`src/stores/`)
- Types in `src/types/` — never use `any`
- NDK interactions only through `src/lib/nostr/` wrapper
- Lightning/NWC only through `src/lib/lightning/` wrapper
- Tailwind classes only — no inline styles (except unavoidable WebkitUserSelect)

### Rust
- Commands return `Result<T, String>`
- Private keys only in OS keychain via `keyring` crate
- No secrets logged in production

### General
- No secrets, keys, or credentials committed to git
- Private docs (drafts, specs, research) go in `private_docs/` (gitignored)
- Prefer explicit over clever

---

## What to Avoid

- Do NOT add dependencies without checking if the existing stack covers it
- Do NOT store private keys anywhere except the OS keychain
- Do NOT expose Lightning credentials to the frontend/JS layer
- Do NOT use inline styles — use Tailwind classes
- Do NOT add paywalls to core social/protocol features

---

## Monetization

Open source client (MIT) + closed source server-side premium services.
Core social features stay fully free. Revenue at the edges (PRO relay, NIP-05, analytics).
