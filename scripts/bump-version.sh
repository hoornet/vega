#!/usr/bin/env bash
# Bump the five version files to a new version and put the release's entry into CHANGELOG.md and the
# Flathub metainfo. No commit, no tag: read the diff, then commit "Bump to vX.Y.Z — <title>" and tag.
#
#   scripts/bump-version.sh X.Y.Z <changelog-entry.md> <metainfo-release.xml>
#
# <changelog-entry.md> is the "## vX.Y.Z — Title (date)" block that goes at the top of CHANGELOG.md;
# <metainfo-release.xml> is one <release version="X.Y.Z" date="..."> block (four-space indented) for
# flatpak/com.veganostr.Vega.metainfo.xml. The lockfiles are synced here because CI's `npm ci` and
# `cargo --locked` fail on a mismatch, on every platform, after the tag is already public.
set -euo pipefail
V=${1:?version}; CHANGELOG_ENTRY=${2:?changelog entry file}; METAINFO_ENTRY=${3:?metainfo release file}
cd "$(dirname "$0")/.."
[ -z "$(git status --short)" ] || { echo "working tree not clean"; exit 1; }
[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || { echo "not on main"; exit 1; }
grep -q "^## v$V " "$CHANGELOG_ENTRY" || { echo "$CHANGELOG_ENTRY does not start with '## v$V '"; exit 1; }
grep -q "version=\"$V\"" "$METAINFO_ENTRY" || { echo "$METAINFO_ENTRY has no version=\"$V\""; exit 1; }
sed -i "s/^  \"version\": \"[0-9.]*\",/  \"version\": \"$V\",/" src-tauri/tauri.conf.json package.json
sed -i "0,/^version = \"[0-9.]*\"/s//version = \"$V\"/" src-tauri/Cargo.toml
sed -i "s/^pkgver=.*/pkgver=$V/" PKGBUILD
npm install --package-lock-only --ignore-scripts --no-audit --no-fund >/dev/null
( cd src-tauri && cargo check --locked -q 2>/dev/null ) || ( cd src-tauri && cargo check -q )
( cd src-tauri && cargo check --locked -q )
python3 - "$CHANGELOG_ENTRY" <<'PY'
import sys
entry = open(sys.argv[1], encoding="utf-8").read().rstrip() + "\n\n"
p = "CHANGELOG.md"; s = open(p, encoding="utf-8").read()
i = s.index("\n## v") + 1
open(p, "w", encoding="utf-8").write(s[:i] + entry + s[i:])
PY
python3 - "$METAINFO_ENTRY" <<'PY'
import sys
block = open(sys.argv[1], encoding="utf-8").read().rstrip("\n") + "\n"
p = "flatpak/com.veganostr.Vega.metainfo.xml"; s = open(p, encoding="utf-8").read()
i = s.index("<releases>") + len("<releases>\n")
open(p, "w", encoding="utf-8").write(s[:i] + block + s[i:])
PY
git diff --stat
echo "---"
grep -n "\"version\"" package.json src-tauri/tauri.conf.json; grep -n '^version' src-tauri/Cargo.toml; grep -n pkgver= PKGBUILD
echo "package-lock.json entries at $V: $(grep -c "\"version\": \"$V\"" package-lock.json) (expect 2)"
