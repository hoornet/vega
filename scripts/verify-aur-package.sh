#!/usr/bin/env bash
#
# Verify that what the AUR is serving for our package is byte-identical to what
# we last pushed.
#
# Why this exists: the AUR had an incident on 2026-06-12 involving "a high volume
# of malicious package adoptions and updates", and the advisory told users to
# review all PKGBUILD and install-script changes. Vega's AUR package is a
# distribution channel with our name on it — if it were adopted or modified, we
# would be the ones shipping the payload. Being the vector is worse than being
# the victim, so this runs on every release.
#
# A byte-identical PKGBUILD is sufficient on its own: an injected `install=`
# script, a repointed `source=`, or an added prepare()/build() step all have to
# appear in the PKGBUILD to take effect.
#
# Usage:  scripts/verify-aur-package.sh [path-to-vega-aur-checkout]
# Exit:   0 = matches, 1 = MISMATCH (investigate before releasing), 2 = can't check

set -uo pipefail

PKG="${AUR_PKG:-vega-nostr-git}"
AUR_REPO="${1:-$HOME/projects/vega-aur}"
BASE="https://aur.archlinux.org/cgit/aur.git/plain"

fail=0
note() { printf '%s\n' "$*"; }

if [ ! -d "$AUR_REPO/.git" ]; then
  note "SKIP: no AUR checkout at $AUR_REPO — pass the path as \$1"
  exit 2
fi

# Compare against the last commit actually pushed to the AUR, not the working
# tree: a local-only version bump is an expected difference, not tampering.
pushed=$(git -C "$AUR_REPO" rev-parse --verify --quiet origin/master) || {
  note "SKIP: no origin/master in $AUR_REPO — run 'git fetch' there first"
  exit 2
}
note "Comparing AUR-published files against $AUR_REPO @ ${pushed:0:8} (origin/master)"

for f in PKGBUILD .SRCINFO; do
  published=$(mktemp) || exit 2
  if ! curl -fsS --max-time 30 "$BASE/$f?h=$PKG" -o "$published"; then
    note "SKIP $f: could not fetch from AUR (network, or AUR unavailable)"
    rm -f "$published"
    fail=2
    continue
  fi

  if ! git -C "$AUR_REPO" show "$pushed:$f" >/dev/null 2>&1; then
    note "SKIP $f: not present in the pushed commit"
    rm -f "$published"
    fail=2
    continue
  fi

  if diff -u <(git -C "$AUR_REPO" show "$pushed:$f") "$published" > /dev/null; then
    note "  OK       $f is byte-identical to what we pushed"
  else
    note "  MISMATCH $f differs from what we pushed:"
    diff -u <(git -C "$AUR_REPO" show "$pushed:$f") "$published" | sed 's/^/    /'
    note "  ^ Do NOT dismiss this. Someone may have adopted or edited the package."
    fail=1
  fi
  rm -f "$published"
done

case $fail in
  0) note "AUR package is clean." ;;
  1) note "AUR PACKAGE MISMATCH — investigate before announcing the release." ;;
  *) note "Could not fully verify — re-run when the AUR is reachable." ;;
esac
exit $fail
