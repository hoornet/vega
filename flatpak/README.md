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

## Open items before submission

- **Screenshots**: `metainfo.xml` references three PNGs under
  `flatpak/screenshots/`. Add real screenshots there and pin the manifest's git
  source to a tag/commit that contains them (metainfo screenshot URLs should use a
  tag/commit ref, not a branch).
- **`ffmpeg-full` `version:`** must match GNOME 50's freedesktop base — verify at
  first `bot, build`.
- **Keyring in the sandbox**: the `keyring` crate uses the Secret Service over D-Bus
  (`--talk-name=org.freedesktop.secrets`). Verify nsec survives a sandboxed restart;
  if not, the `oo7` crate's file backend is the known fallback.
