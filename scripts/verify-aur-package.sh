#!/usr/bin/env bash
#
# Verify that what the AUR is serving for our package is byte-identical to what
# we last pushed, AND that what we last pushed is actually the current version.
#
# Why this exists: the AUR had an incident on 2026-06-12 involving "a high volume
# of malicious package adoptions and updates", and the advisory told users to
# review all PKGBUILD and install-script changes. Vega's AUR package is a
# distribution channel with our name on it — if it were adopted or modified, we
# would be the ones shipping the payload. Being the vector is worse than being
# the victim, so this runs on every release.
#
# A byte-identical PKGBUILD is sufficient to rule out tampering on its own: an
# injected `install=` script, a repointed `source=`, or an added prepare()/build()
# step all have to appear in the PKGBUILD to take effect.
#
# Two lessons are baked in, both learned on 2026-08-14 releasing v0.15.2:
#
#   1. Compare against the AUR REMOTE, not local `origin/master`. The old version
#      compared cgit against the local ref, so when a push was missed both sides
#      were equally stale and it reported "clean" — the v0.15.1 AUR bump sat
#      committed-but-unpushed for a month behind a green check. A gate that can
#      pass while the channel is stale is not a gate.
#
#   2. Read content from the AUR GIT repo, not cgit. cgit is a cached web view
#      and lags the repo by minutes after a push, which produces a false MISMATCH
#      exactly when you are most likely to be running this — right after pushing.
#      AUR helpers clone the git repo, so the repo is what users actually get.
#      cgit is still checked, but only ever as an advisory note.
#
# Usage:  scripts/verify-aur-package.sh [path-to-vega-aur-checkout]
# Env:    AUR_PKG            override package name
#         AUR_EXPECT_VERSION override expected pkgver (default: package.json)
# Exit:   0 = matches, 1 = MISMATCH (investigate before releasing), 2 = can't check

set -uo pipefail

PKG="${AUR_PKG:-vega-nostr-git}"
AUR_REPO="${1:-$HOME/projects/vega-aur}"
AUR_URL="https://aur.archlinux.org/${PKG}.git"
CGIT="https://aur.archlinux.org/cgit/aur.git/plain"

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

fail=0
note() { printf '%s\n' "$*"; }
worse() { [ "$1" -gt "$fail" ] && fail="$1"; return 0; }

# The version we believe we are shipping. During a release this is the freshly
# bumped package.json; at step 0 it is still the previous release, and the AUR
# should already be on that — which is how a missed push gets caught.
if [ -n "${AUR_EXPECT_VERSION:-}" ]; then
  expect_version="$AUR_EXPECT_VERSION"
else
  expect_version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$REPO_ROOT/package.json" | head -1)
fi

if [ ! -d "$AUR_REPO/.git" ]; then
  note "SKIP: no AUR checkout at $AUR_REPO — pass the path as \$1"
  exit 2
fi

# ── 1. Did we actually publish what we have? ─────────────────────────────────
remote_tip=$(git ls-remote "$AUR_URL" refs/heads/master 2>/dev/null | awk '{print $1}')
if [ -z "$remote_tip" ]; then
  note "SKIP: could not reach the AUR git remote (network, or AUR down)"
  exit 2
fi

local_tip=$(git -C "$AUR_REPO" rev-parse --verify --quiet HEAD) || {
  note "SKIP: no HEAD in $AUR_REPO"
  exit 2
}

note "AUR remote master: ${remote_tip:0:8}"
note "Local checkout:    ${local_tip:0:8}"

if [ "$remote_tip" != "$local_tip" ]; then
  if git -C "$AUR_REPO" merge-base --is-ancestor "$remote_tip" "$local_tip" 2>/dev/null; then
    note "  MISMATCH local commits are NOT published to the AUR:"
    git -C "$AUR_REPO" log --oneline "$remote_tip..$local_tip" | sed 's/^/    /'
    note "  ^ Push them, or the AUR is serving an older package than you think."
  else
    note "  MISMATCH the AUR remote has commits we do not have locally:"
    note "    remote ${remote_tip:0:8} is not a descendant of local ${local_tip:0:8}"
    note "  ^ Someone else may have pushed. Investigate before releasing."
  fi
  worse 1
fi

# ── 2. Is what the AUR serves byte-identical to what we pushed? ──────────────
tmp=$(mktemp -d) || exit 2
trap 'rm -rf "$tmp"' EXIT

if ! git clone -q --depth 1 "$AUR_URL" "$tmp/pkg" 2>/dev/null; then
  note "SKIP: could not clone $AUR_URL"
  worse 2
else
  for f in PKGBUILD .SRCINFO; do
    if [ ! -f "$tmp/pkg/$f" ]; then
      note "  MISMATCH $f is missing from the published package"
      worse 1
      continue
    fi
    if ! git -C "$AUR_REPO" show "$remote_tip:$f" >/dev/null 2>&1; then
      note "SKIP $f: not present in the published commit locally — run 'git fetch' in $AUR_REPO"
      worse 2
      continue
    fi
    if diff -u <(git -C "$AUR_REPO" show "$remote_tip:$f") "$tmp/pkg/$f" > /dev/null; then
      note "  OK       $f is byte-identical to the published commit"
    else
      note "  MISMATCH $f differs from the published commit:"
      diff -u <(git -C "$AUR_REPO" show "$remote_tip:$f") "$tmp/pkg/$f" | sed 's/^/    /'
      note "  ^ Do NOT dismiss this. Someone may have adopted or edited the package."
      worse 1
    fi
  done

  # ── 3. Is the published version the one we think we are shipping? ──────────
  published_ver=$(sed -n 's/^pkgver=//p' "$tmp/pkg/PKGBUILD" | head -1)
  if [ -z "$expect_version" ]; then
    note "  SKIP     could not determine expected version from package.json"
    worse 2
  elif [ "$published_ver" = "$expect_version" ]; then
    note "  OK       published pkgver $published_ver matches package.json"
  else
    note "  MISMATCH published pkgver is $published_ver, package.json says $expect_version"
    note "  ^ The AUR is not serving the version you are releasing."
    worse 1
  fi

  # ── 4. cgit is a cached view; lag is normal, so this only ever informs. ────
  if cgit_ver=$(curl -fsS --max-time 30 "$CGIT/PKGBUILD?h=$PKG" 2>/dev/null | sed -n 's/^pkgver=//p' | head -1); then
    if [ "$cgit_ver" != "$published_ver" ]; then
      note "  NOTE     cgit still serves $cgit_ver (repo has $published_ver) — cache lag, not a fault"
    fi
  fi
fi

case $fail in
  0) note "AUR package is clean." ;;
  1) note "AUR PACKAGE MISMATCH — investigate before announcing the release." ;;
  *) note "Could not fully verify — re-run when the AUR is reachable." ;;
esac
exit $fail
