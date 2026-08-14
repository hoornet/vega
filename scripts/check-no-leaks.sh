#!/usr/bin/env bash
#
# Block private information from entering a PUBLIC repo.
#
# Why this exists: CLAUDE.md carried an internal hostname from 2026-03-25 to
# 2026-08-14 — five months and every release tag in that window — before anyone
# noticed. Removing it did not unpublish it. The only point where removal
# actually works is before the commit exists, which is why this runs as a
# pre-commit hook rather than a release check.
#
# By default it scans only ADDED lines in staged changes, so pre-existing
# content never blocks an unrelated commit and the signal stays trustworthy.
# A check people routinely bypass is worth nothing, so it is deliberately
# conservative: high-confidence patterns only.
#
# Usage:
#   scripts/check-no-leaks.sh          # staged changes (what the hook runs)
#   scripts/check-no-leaks.sh --all    # every tracked file, for an audit
#
# Install the hook:  git config core.hooksPath .githooks
# Bypass once:       git commit --no-verify
#
# Exit: 0 = clean, 1 = findings

set -uo pipefail

MODE="${1:-staged}"
findings=0

report() {
  printf '\n  \033[1;31m%s\033[0m\n' "$1"
  printf '%s\n' "$2" | sed 's/^/    /'
  findings=1
}

# Collect the text to scan. This file is excluded from its own scan — it
# necessarily contains the patterns it looks for, and blocked its own first
# commit on `BEGIN [A-Z ]*PRIVATE KEY` before the exclusion existed.
if [ "$MODE" = "--all" ]; then
  subject=$(git grep -nI "" -- . ':!package-lock.json' ':!*.lock' ':!scripts/check-no-leaks.sh' 2>/dev/null)
else
  # Added lines only, prefixed with the file they came from.
  subject=$(git diff --cached -U0 --diff-filter=ACM -- . ':!package-lock.json' ':!*.lock' ':!scripts/check-no-leaks.sh' 2>/dev/null \
    | awk '/^\+\+\+ b\//{f=substr($0,7)} /^\+[^+]/{print f": "substr($0,2)}')
fi

[ -z "$subject" ] && exit 0

check() {
  local label="$1" pattern="$2" exclude="${3:-}"
  local hits
  hits=$(printf '%s\n' "$subject" | grep -nE "$pattern" 2>/dev/null)
  [ -n "$exclude" ] && hits=$(printf '%s\n' "$hits" | grep -vE "$exclude")
  hits=$(printf '%s\n' "$hits" | grep -v '^$')
  [ -n "$hits" ] && report "$label" "$(printf '%s\n' "$hits" | head -5)"
}

# ── Credentials. These are never acceptable, staged or otherwise. ────────────
check "Private key material" \
  "BEGIN [A-Z ]*PRIVATE KEY|BEGIN OPENSSH PRIVATE KEY"
check "API token or access key" \
  "ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{32,}"
# Full-length only: the repo legitimately contains "nsec1…" placeholders and
# startsWith("nsec1") checks.
check "Nostr private key (nsec)" \
  "nsec1[023456789acdefghjklmnpqrstuvwxyz]{58}"

# ── Local machine paths. Leak the username and the developer's layout. ──────
check "Hardcoded home directory" \
  "/home/[a-z0-9_.-]+/|/Users/[a-zA-Z0-9_.-]+/" \
  "/home/(user|you|youruser|USER|\\\$)|/Users/(user|you|youruser|USER|\\\$)|runner"

# ── Internal infrastructure. Extend as new hosts appear. ────────────────────
# Known-private domains match as plain substrings — specific enough to be safe.
check "Internal or superseded hostname" \
  "[a-z0-9.-]*exe\.xyz"
# .local/.internal only count as a hostname in an actual host position; bare
# ".local" is far too common (~/.local/share, *.local in .gitignore, `...local]`).
check "Internal .local/.internal host" \
  "(https?|wss?)://[a-z0-9.-]+\.(local|internal)\b|@[a-z0-9.-]+\.(local|internal)\b"

# Public IPs — loopback, link-local, RFC1918, docs ranges and version-like
# strings are all excluded.
# Known limitation: exclusions are line-wise, so a real IP sharing a line with
# an excluded one (e.g. a 203.0.113.x doc example) is missed. Traded for a low
# false-positive rate, because a hook people bypass protects nothing.
check "Public IP address" \
  "\b([0-9]{1,3}\.){3}[0-9]{1,3}\b" \
  "127\.0\.0\.1|0\.0\.0\.0|255\.255|10\.[0-9]|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.|224\.0\.0|203\.0\.113|198\.51\.100|192\.0\.2\.|[0-9]+\.[0-9]+\.[0-9]+[\"',)\`]|version|@[0-9]"

# ── Files that should never be tracked at all. ──────────────────────────────
if [ "$MODE" = "--all" ]; then
  staged_files=$(git ls-files)
else
  staged_files=$(git diff --cached --name-only --diff-filter=ACM)
fi
bad_files=$(printf '%s\n' "$staged_files" | grep -iE "(^|/)\.env($|\.)|\.pem$|\.key$|(^|/)id_rsa|\.p12$|\.pfx$|(^|/)\.claude/|(^|/)\.omc/" || true)
[ -n "$bad_files" ] && report "File that should not be committed" "$bad_files"

if [ "$findings" -ne 0 ]; then
  cat <<'EOF'

  ─────────────────────────────────────────────────────────────────────
  This repo is PUBLIC. Anything committed stays in the history and in
  every release tag cut afterwards — deleting it later does not
  unpublish it.

  Move it to private_docs/ (gitignored) or the global ~/.claude/CLAUDE.md.
  If this is a false positive, commit with --no-verify and please widen
  the exclusion in scripts/check-no-leaks.sh so the next one is quiet.
  ─────────────────────────────────────────────────────────────────────
EOF
  exit 1
fi

exit 0
