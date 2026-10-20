#!/usr/bin/env python3
"""Build the text for latest.json's `notes` field from the release notes files, for
scripts/latest-json-notes.sh. Clients up to v0.16.0 show the FIRST `### vX.Y.Z` section of that
field as "What's new", so the newest release's notes go under one `### vX.Y.Z — Title` heading and
each older release named on the command line goes inside that section under `#### Also in vX.Y.Z`,
with headings demoted. Titles come from CHANGELOG.md's `## vX.Y.Z — Title (date)` lines.

    scripts/build-latest-notes.py X.Y.Z [OLDER ...] > notes.md

Each version's notes are read from private_docs/release-notes-vX.Y.Z.md (the file applied to the
GitHub release); --notes-dir changes where they are read from.
"""
import argparse, re, sys
from pathlib import Path

HEADER = ("## Vega v{v}\n\nCross-platform Nostr desktop client — polished UI, deep Lightning integration, first-class long-form writing.\n\n"
          "> **Windows note:** The installer is not yet code-signed. Windows SmartScreen will show an \"Unknown publisher\" warning — click \"More info → Run anyway\" to install.\n\n")

def titles(changelog: Path) -> dict[str, str]:
    out = {}
    for line in changelog.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^## v(\d+\.\d+\.\d+) — (.+?) \(\d{4}-\d{2}-\d{2}\)\s*$", line)
        if m: out[m.group(1)] = m.group(2)
    return out

def body(path: Path, depth: int) -> str:
    """The notes without their page header (the `## Vega vX` line, tagline and Windows note), headings demoted to `depth`."""
    out, skipping = [], True
    for line in path.read_text(encoding="utf-8").split("\n"):
        if skipping:
            if line.startswith("## ") or line.startswith("Cross-platform") or line.startswith("> **Windows note") or not line.strip():
                continue
            skipping = False
        out.append(re.sub(r"^### ", "#" * depth + " ", line))
    return "\n".join(out).rstrip()

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("versions", nargs="+", help="the release, then any older releases to include under it")
    ap.add_argument("--notes-dir", default="private_docs", help="where release-notes-vX.Y.Z.md files are")
    ap.add_argument("--changelog", default="CHANGELOG.md")
    a = ap.parse_args()
    t = titles(Path(a.changelog))
    missing = [v for v in a.versions if v not in t]
    if missing:
        print(f"no '## vX — Title (date)' line in {a.changelog} for: {', '.join(missing)}", file=sys.stderr); return 1
    newest, older = a.versions[0], a.versions[1:]
    notes = lambda v: Path(a.notes_dir) / f"release-notes-v{v}.md"
    text = HEADER.format(v=newest) + f"### v{newest} — {t[newest]}\n\n" + body(notes(newest), 4)
    for v in older:
        text += (f"\n\n#### Also in v{v} — {t[v]}\n\nIf you are updating from an older version, this is what v{v} brought. "
                 f"The in-app panel could not show it at the time.\n\n" + body(notes(v), 5))
    sys.stdout.write(text + "\n")
    lines = text.split("\n"); heads = [i for i, l in enumerate(lines) if re.match(r"^###\s+v", l.strip(), re.I)]
    if len(heads) != 1:
        print(f"expected exactly one '### v' heading, found {len(heads)}", file=sys.stderr); return 1
    return 0

if __name__ == "__main__":
    sys.exit(main())
