#!/usr/bin/env bash
# Vega memory test — records peak WebKit RSS per phase.
# Start vega first, then run this script. Press Enter to advance phases.
# Usage: ./scripts/memory-test.sh [label]

LABEL="${1:-$(date +%Y%m%d-%H%M%S)}"
OUTFILE="memory-test-${LABEL}.tsv"

phases=(
  "1:baseline_before_login"
  "2:after_login_idle"
  "3:global_scroll_full"
  "4:following_tab_idle"
  "5:following_scroll_full"
  "6:trending_tab"
  "7:thread_open"
  "8:profile_view"
  "9:back_to_global"
)

get_webkit_mb() {
  ps aux --no-headers | awk '/webkit2gtk/ && !/awk/ {sum += $6} END {printf "%d", sum/1024}'
}

echo -e "phase\tpeak_mb\tmin_mb\tsamples" > "$OUTFILE"
echo ""
echo "=== Vega Memory Test: $LABEL ==="
echo "Output → $OUTFILE"
echo ""

for entry in "${phases[@]}"; do
  num="${entry%%:*}"
  name="${entry#*:}"

  echo "──────────────────────────────────────"
  echo "Phase $num: $name"
  read -r -p "  → Perform the action, then press Enter to START recording: "

  peak=0; min=9999999; count=0
  stop_file=$(mktemp)
  rm "$stop_file"   # file absence = keep sampling

  # Background sampler writes readings to a temp file
  tmpdata=$(mktemp)
  (
    while [[ ! -f "$stop_file" ]]; do
      mb=$(get_webkit_mb)
      echo "$mb" >> "$tmpdata"
      echo -n " ${mb}"
      sleep 1
    done
  ) &
  sampler_pid=$!

  read -r -p "  → Press Enter to STOP recording: "
  touch "$stop_file"
  wait "$sampler_pid" 2>/dev/null
  echo ""

  while IFS= read -r mb; do
    [[ -z "$mb" ]] && continue
    (( mb > peak )) && peak=$mb
    (( mb < min )) && min=$mb
    (( count++ ))
  done < "$tmpdata"
  rm -f "$tmpdata" "$stop_file"

  [[ $count -eq 0 ]] && peak=0 && min=0
  echo "  ✓ Peak: ${peak}MB   Min: ${min}MB   Samples: ${count}"
  echo -e "${name}\t${peak}\t${min}\t${count}" >> "$OUTFILE"
  echo ""
done

echo "══════════════════════════════════════"
echo "Results: $LABEL"
echo ""
column -t -s $'\t' "$OUTFILE"
echo ""
echo "Saved to: $OUTFILE"
