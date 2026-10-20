#!/usr/bin/env bash
# Put the real release notes into the `notes` field of the published latest.json, so the in-app
# "What's new" shows them: the release workflow fills that field with its fixed text, and clients up
# to v0.16.0 show nothing else. Only `notes` changes; every other byte is proven identical before the
# upload. Run it ONLY after the whole release run has completed (a later job would write the file
# again), and after scripts/verify-release.sh. Reversible: the original is kept next to the new file.
#
#   scripts/latest-json-notes.sh X.Y.Z <notes.md>     (notes.md from scripts/build-latest-notes.py)
set -euo pipefail
V=${1:?version}; NOTES=${2:?notes file}
NOTES=$(realpath "$NOTES")
D=$(mktemp -d); cd "$D"
gh release download -R hoornet/vega "v$V" -p latest.json -O latest.orig.json --clobber
python3 - "$V" "$NOTES" <<'PY'
import json, sys
V, notes_path = sys.argv[1], sys.argv[2]
raw = open("latest.orig.json", encoding="utf-8").read()
d = json.loads(raw)
assert json.dumps(d, indent=2, ensure_ascii=False) == raw, "the formatter does not reproduce the file byte for byte; stop"
assert d["version"] == V, f"latest.json is for {d['version']}, not {V}"
assert len(d["platforms"]) == 8, f"expected 8 platform entries, found {list(d['platforms'])}: the run is not complete"
notes = open(notes_path, encoding="utf-8").read()
assert f"### v{V} " in notes, "the notes have no '### vX.Y.Z' section: see scripts/build-latest-notes.py"
old = d["notes"]; d["notes"] = notes
new = json.dumps(d, indent=2, ensure_ascii=False)
check = json.loads(new); check["notes"] = old
assert json.dumps(check, indent=2, ensure_ascii=False) == raw, "something other than notes changed"
open("latest.json", "w", encoding="utf-8").write(new)
print(f"notes: {len(old)} -> {len(notes)} chars; everything else identical")
PY
gh release upload -R hoornet/vega "v$V" latest.json --clobber
AID=$(gh release view -R hoornet/vega "v$V" --json assets --jq '.assets[] | select(.name=="latest.json") | .apiUrl' | awk -F/ '{print $NF}')
gh api -H "Accept: application/octet-stream" "repos/hoornet/vega/releases/assets/$AID" > latest.api.json
cmp latest.json latest.api.json && echo "the release asset is the new file"
for i in 1 2 3 4 5 6 7 8 9 10; do
  curl -sL -o latest.served.json "https://github.com/hoornet/vega/releases/latest/download/latest.json"
  if cmp -s latest.json latest.served.json; then echo "the updater endpoint serves it (after $((i*20-20)) s)"; break; fi
  sleep 20
done
cmp -s latest.json latest.served.json || { echo "the updater endpoint still serves the old file after 3 minutes (CDN); check again later"; exit 1; }
python3 - <<'PY'
import json, re
d = json.load(open("latest.served.json", encoding="utf-8"))
ls = d["notes"].split("\n"); hs = [i for i, l in enumerate(ls) if re.match(r"^###\s+v", l.strip(), re.I)]
sec = ls[hs[0]:(hs[1] if len(hs) > 1 else len(ls))]
print("a pre-v0.16.1 client's panel shows:", sec[0].strip(), f"({len(sec)} lines)")
PY
echo "files kept in $D (latest.orig.json is the original; re-upload it to undo)"
