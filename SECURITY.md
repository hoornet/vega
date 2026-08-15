# Security Policy

## Reporting a vulnerability

**Please report privately, not in a public issue.**

Use GitHub's private vulnerability reporting: go to the [Security tab](https://github.com/hoornet/vega/security) and choose **Report a vulnerability**. This is enabled and monitored. It creates a private thread visible only to you and the maintainer.

If you would rather not use GitHub, say so in a public issue *without any details* ("I'd like to report a security issue privately") and a private channel will be arranged.

## What to expect

Vega is maintained by one person, part-time. Being honest about that rather than promising a corporate SLA:

- **Acknowledgement:** within 7 days.
- **Assessment:** within 14 days, including whether it's in scope and a rough severity.
- **Fix:** as fast as the severity warrants. Anything affecting key material or the updater is dropped-everything urgent.

If you don't hear back within 7 days, please escalate by opening a public issue saying only that a private report is awaiting a response — no details. Silence is a failure on my part, not an invitation to disclose.

Credit is given in the release notes unless you'd rather stay anonymous.

## Supported versions

Only the **latest release** is supported. Vega ships an auto-updater, and fixes go out as a new patch release.

Published versions are never re-tagged — a bad release is superseded by a higher version, never replaced in place, so a given version number always refers to the same artifacts.

## In scope

- Private key handling — key generation, the OS keychain integration, nsec import/export
- The bundled relay (`src-tauri/src/relay/`), including event validation and signature verification
- The auto-updater and release signing
- Relay privacy — anything causing Vega to contact a relay the user did not configure while **Relay reach** is off
- NIP-46 remote signing
- Rendering of untrusted content from relays (articles, notes, profile fields)
- The Tauri IPC surface and Rust commands

## Out of scope

- Vulnerabilities in relays you connect to
- Issues requiring a compromised OS account or physical access to an unlocked machine
- Upstream dependency vulnerabilities without a demonstrated impact on Vega — report those upstream. Note that `@nostr-dev-kit/ndk` is pinned exactly and its upstream is not currently responsive to security reports; if that's your finding, please still tell us privately.

## Existing measures

- Private keys live in the OS keychain, never in app storage or localStorage
- Release builds run `npm ci --ignore-scripts`; the lockfile is the source of truth
- All GitHub Actions are pinned to commit SHAs
- `@nostr-dev-kit/ndk` is pinned exactly, no caret range
- Secret scanning with push protection, and a pre-commit hook (`scripts/check-no-leaks.sh`) blocking credentials and private hostnames
- Distribution channels are verified each release (`scripts/verify-aur-package.sh`)
