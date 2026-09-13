# Flathub packaging for Vega

This directory holds the Flatpak packaging for `com.veganostr.Vega`, built **entirely
from source** (Flathub forbids bundling prebuilt binaries — do **not** use Tauri's
official Flatpak guide, which repackages a `.deb`).

## Files

| File | Purpose | Lives in |
|---|---|---|
| `com.veganostr.Vega.yaml` | Flatpak manifest | Flathub PR repo (copy here for reference) |
| `com.veganostr.Vega.metainfo.xml` | AppStream metadata (store page) | this repo, installed from source |
| `com.veganostr.Vega.desktop` | Desktop entry | this repo, installed from source |
| `cargo-sources.json` | Vendored Rust crates (offline build) | generated → Flathub PR repo |
| `node-sources.json` | Vendored npm packages (offline build) | generated → Flathub PR repo |

## Regenerating the vendored sources (after any dependency bump)

```bash
# Rust
pip install toml aiohttp
python flatpak-cargo-generator.py -d src-tauri/Cargo.lock -o flatpak/cargo-sources.json

# npm (lockfile v3)
pipx install git+https://github.com/flatpak/flatpak-builder-tools.git#subdirectory=node
flatpak-node-generator npm -o flatpak/node-sources.json package-lock.json
```

The generated sources **must** match the `Cargo.lock` / `package-lock.json` at the git
tag the manifest pins.

## Validate locally

```bash
appstreamcli validate flatpak/com.veganostr.Vega.metainfo.xml
desktop-file-validate flatpak/com.veganostr.Vega.desktop
```

## Test build (needs ~several GB of SDK)

```bash
flatpak install flathub org.gnome.Platform//50 org.gnome.Sdk//50 \
  org.freedesktop.Sdk.Extension.rust-stable org.freedesktop.Sdk.Extension.node20
flatpak install flathub org.flatpak.Builder
git clone https://github.com/flathub/shared-modules.git   # for libappindicator
flatpak run org.flatpak.Builder --force-clean --user --install \
  build-dir flatpak/com.veganostr.Vega.yaml
flatpak run com.veganostr.Vega
```

## Submitting to Flathub

1. Fork `github.com/flathub/flathub`, branch off **`new-pr`** (NOT `master`).
2. Add `com.veganostr.Vega.yaml`, `cargo-sources.json`, `node-sources.json`, and the
   `shared-modules` submodule at the repo top level.
3. Open a PR against `new-pr`; a reviewer comments `bot, build` to test-build.

## Status

Submitted to Flathub pinned to **v0.15.7**. Resolved along the way, so nobody
re-investigates them:

- **Screenshots** — four real PNGs under `screenshots/`, referenced from
  `metainfo.xml` by **commit SHA** (`ba57143`), not a branch, per Flathub guidance.
  `.gitignore` has blanket `screenshots/` and `*.png` rules, so the negations
  `!flatpak/screenshots/` are load-bearing — don't drop them.
- **Codecs** — GNOME 50 uses `org.freedesktop.Platform.codecs-extra`
  (version `25.08-extra`). **Not `ffmpeg-full`**, which only exists on the 24.08
  runtime and is the old-runtime pattern. The manifest currently omits codec
  extensions; adding them for AAC/MP3/H.264 podcast playback is a follow-up.
- **Keyring in the sandbox** — fixed in v0.14.2, and the cause was not the sandbox.
  The `keyring` crate had been configured with `linux-native`, which is the Linux
  *kernel* keyring, not the Secret Service. A kernel session keyring is tied to the
  login session, so every Flatpak launch got a fresh one and the nsec was lost.
  Switched to `sync-secret-service` + `crypto-rust`. Verified: log in, fully quit
  via the tray, relaunch, still logged in. This was a native win too — the kernel
  keyring did not reliably survive reboots either.
  The `oo7`/Secret-Portal path is a dead end on Hyprland: xdg-desktop-portal there
  does not expose `org.freedesktop.portal.Secret`.

## Runtime version gotchas (cost real time)

- **GNOME 50 = freedesktop base 25.08, not 24.08.** Install the SDK extensions as
  `//25.08`. `flatpak remote-ls` can show stale branch lists — confirm a specific
  branch with `flatpak remote-info flathub <ref>//25.08`.
- The sandboxed `org.flatpak.Builder` may fail to resolve SDK-extension versions,
  requesting `rust-stable//50` (the runtime version) instead of `//25.08`. Having
  the correct-branch extensions already installed is what fixes it.
- `--install-deps-from=flathub` fails when flathub is a *system* remote: the builder
  looks for a user one. Install the deps beforehand and omit the flag.
