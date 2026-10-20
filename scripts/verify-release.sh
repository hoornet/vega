#!/usr/bin/env bash
# Verify a published release the way the updater sees it, before announcing it:
#   - latest.json at the updater endpoint names the version and holds every platform entry;
#   - each entry's signature equals the matching .sig asset;
#   - each entry's URL serves the binary to the updater's request (Accept: application/octet-stream).
# A plain request to those URLs returns JSON; that is not a failure. See CLAUDE.md, "Hard-won CI rules".
#
#   scripts/verify-release.sh X.Y.Z
set -uo pipefail
V=${1:?version}; TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
curl -sL -o "$TMP/latest.json" "https://github.com/hoornet/vega/releases/latest/download/latest.json"
python3 - "$V" "$TMP" <<'PY'
import json, subprocess, sys
V, tmp = sys.argv[1], sys.argv[2]
d = json.load(open(f"{tmp}/latest.json", encoding="utf-8"))
print("latest.json version:", d["version"], "ok" if d["version"] == V else "WRONG", "| pub_date:", d["pub_date"])
assets = json.loads(subprocess.check_output(["gh", "release", "view", "-R", "hoornet/vega", f"v{V}", "--json", "assets", "--jq", ".assets"]))
by_name = {a["name"]: a for a in assets}
ok = 0
for plat, e in d["platforms"].items():
    url = e["url"]; aid = url.rsplit("/", 1)[-1]
    name = subprocess.check_output(["gh", "api", f"repos/hoornet/vega/releases/assets/{aid}", "--jq", ".name"]).decode().strip()
    sig_asset = by_name.get(name + ".sig")
    if not sig_asset:
        print(f"  {plat}: {name} -> NO .sig ASSET"); continue
    sig_id = sig_asset["apiUrl"].rsplit("/", 1)[-1]
    sig = subprocess.check_output(["gh", "api", "-H", "Accept: application/octet-stream", f"repos/hoornet/vega/releases/assets/{sig_id}"]).decode().strip()
    same = sig == e["signature"].strip()
    head = subprocess.run(["curl", "-sIL", "-H", "Accept: application/octet-stream", url], capture_output=True, text=True).stdout.lower().split("\n")
    ctype = [l for l in head if l.startswith("content-type")]; clen = [l for l in head if l.startswith("content-length")]
    served = bool(ctype) and "application/octet-stream" in ctype[-1]
    size = clen[-1].split(":", 1)[1].strip() if clen else "?"
    print(f"  {plat}: {name} sig={'match' if same else 'MISMATCH'} download={'octet-stream' if served else 'NOT BINARY'} size={size}")
    ok += same and served
n = len(d["platforms"])
print(f"{ok}/{n} entries verified" + ("" if ok == n and n == 8 else "  <-- expected 8/8"))
sys.exit(0 if ok == n == 8 else 1)
PY
