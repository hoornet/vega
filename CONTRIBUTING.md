# Contributing to Vega

Thanks for considering it. Vega is a Nostr desktop client built by one person part-time, so a good patch is genuinely valuable — and so is a good bug report.

## Before anything else: enable the pre-commit hook

`core.hooksPath` is local config and does **not** travel with a clone. Run this once:

```bash
git config core.hooksPath .githooks
```

It runs `scripts/check-no-leaks.sh` over the added lines of staged changes, blocking credentials, hardcoded home directories, public IPs and known-private hostnames. This repo is public; the hook exists because a removal does not unpublish anything.

## Setup

Prerequisites: Node.js 20+, Rust stable, `@tauri-apps/cli`.

```bash
npm install
npm run tauri dev     # full app with hot reload — use this
npm run dev           # Vite only, no Tauri window
npm run build         # tsc && vite build
npm run test          # vitest (watch)
npm run test:run      # vitest once
```

Linux also needs GStreamer plugins for audio/video playback — see the README.

## Where things live

- `src/lib/nostr/` — the **only** place NDK is touched. Domain modules (`core`, `notes`, `social`, `articles`, `dms`, `relays`, …) with a barrel `index.ts`.
- `src/stores/` — Zustand, one store per domain.
- `src/components/` — grouped by feature (`feed/`, `article/`, `thread/`, `profile/`, …).
- `src/lib/lightning/` — NWC and payments.
- `src-tauri/src/` — Rust: keychain, SQLite, the embedded relay.

`CLAUDE.md` is the authoritative architecture document and is kept current. Read it before a non-trivial change — it also records the mistakes that already cost us releases, which is the fastest way to avoid repeating them.

## Conventions

- Functional React components only.
- **Never `any`.** Types go in `src/types/`.
- Tailwind classes only — no inline styles (the one exception is unavoidable `WebkitUserSelect`).
- All NDK access through `src/lib/nostr/`. All Lightning through `src/lib/lightning/`.
- New feature domain → new Zustand store.
- Rust commands return `Result<T, String>`.
- Colours come from the theme system (`src/lib/themes.ts`), not hardcoded hex.

## Things that will bite you

These are real, each one cost us time or a release:

- **Verify relay changes on the Following tab, in the running app.** Global sends no `authors` filter, so it exercises none of the relay-routing machinery and looks correct no matter what. A fix for issue #35 once passed its unit tests and was still completely wrong on Following.
- **Startup and lifecycle changes need the real binary**, not unit tests. A data migration once had four passing tests and would still have wiped every Linux user's data — the defect was in *when* it ran.
- **Some breakage only appears in built bundles.** CommonJS-only libraries can resolve to a namespace object under Vite/Rolldown and throw React #130, which never reproduces in `npm run tauri dev`. If you add a CJS dependency rendered as JSX, guard it and test a production build.
- **WebKitGTK on Linux does not evict decoded bitmaps** the way Chromium does. Anything that multiplies `<img>` elements per feed page translates roughly linearly into memory. Validate "render this as an image" heuristics against a real content-type check.
- **`package-lock.json` is a version file.** CI runs `npm ci`, which *fails* on a package.json/lockfile mismatch rather than reconciling it.

## Tests

Run `npm run test:run` before opening a PR; Rust changes also need `cargo test` in `src-tauri/`.

Add tests when you fix a bug — and make sure the test **fails without your fix**. A test that passes either way documents nothing. If a bug was invisible to the existing tests, say why in the PR; that is often the most useful thing in it.

## Pull requests

- Branch off `main`. Keep PRs focused — one concern each.
- Explain **why**, not just what. The diff shows what.
- Say how you verified it. "Tests pass" is weaker than "reproduced on the Following tab before and after."
- Draft PRs are welcome for early feedback.
- Don't bump the version or edit `.github/workflows/release.yml` — releases are a maintainer task with an order that matters.

Commit messages: imperative mood, explain the reasoning in the body when it isn't obvious. No `Co-Authored-By` trailers.

## Reporting bugs

Include your OS, Vega version, and what you expected versus what happened. Steps to reproduce are worth more than a description.

Two details that are disproportionately useful: whether it survives a **restart**, and whether it happens on the **Following** tab specifically. Both have pointed straight at root causes before.

For anything security-related, do **not** open a public issue — see [SECURITY.md](SECURITY.md).

## Feature ideas

Open an issue before building something large, so we can agree on the shape first. Long-form content (NIP-23) is a first-class feature here rather than an afterthought, and anything strengthening it is especially welcome.

Vega aims to work for anyone using Nostr. Keep that in mind and you'll be fine.
