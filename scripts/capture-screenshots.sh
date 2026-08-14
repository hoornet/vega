#!/bin/bash
# Capture native Vega screenshots for every major view.
# Requires: ydotoold running, grim, hyprctl
# Usage: bash scripts/capture-screenshots.sh

set -e

YDOTOOL_SOCKET="/run/user/1000/.ydotool_socket"
OUT="$(cd "$(dirname "$0")/.." && pwd)/screenshots"
mkdir -p "$OUT"

export YDOTOOL_SOCKET

# ── Helpers ────────────────────────────────────────────────────────────────

click() {
  local x=$1 y=$2
  ydotool mousemove --absolute -x "$x" -y "$y"
  sleep 0.1
  ydotool click 0x40000001   # button 1 down
  ydotool click 0x80000001   # button 1 up
}

get_window() {
  hyprctl clients -j | jq -r '
    .[] | select(.class | test("vega|Vega"; "i"))
    | "\(.at[0]) \(.at[1]) \(.size[0]) \(.size[1])"
  ' | head -1
}

wait_for_window() {
  echo "  Waiting for Vega window..."
  for i in $(seq 1 60); do
    local info
    info=$(get_window)
    if [[ -n "$info" ]]; then
      echo "  Window found: $info"
      return 0
    fi
    sleep 1
  done
  echo "  ERROR: Vega window never appeared" >&2
  exit 1
}

screenshot() {
  local name=$1
  local info
  info=$(get_window)
  read -r wx wy ww wh <<< "$info"
  grim -g "$wx,$wy ${ww}x${wh}" "$OUT/${name}.png"
  echo "  ✓ $name.png"
}

sidebar_click() {
  local item_index=$1   # 0-based index in NAV_ITEMS
  local info
  info=$(get_window)
  read -r wx wy ww wh <<< "$info"

  # Sidebar layout:
  #   Header:        ~43px  (py-2.5 + VEGA brand text)
  #   Nav py-2 top:  8px
  #   Write article: 36px   (py-1.5 — shown when logged in)
  #   Each nav item: 36px   (py-1.5)
  #   Click x = window_x + 96  (center of 192px sidebar)

  local header=43
  local nav_pad=8
  local write_btn=36
  local item_h=36

  local item_y=$(( header + nav_pad + write_btn + (item_index * item_h) + (item_h / 2) ))
  local abs_x=$(( wx + 96 ))
  local abs_y=$(( wy + item_y ))

  click "$abs_x" "$abs_y"
}

# NAV_ITEMS order (matches Sidebar.tsx):
# 0=feed 1=articles 2=media 3=podcasts 4=search 5=bookmarks
# 6=dm 7=notifications 8=follows 9=zaps 10=v4v 11=relays 12=settings 13=about

# ── Main ───────────────────────────────────────────────────────────────────

echo "Starting Vega..."
REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
WEBKIT_DISABLE_DMABUF_RENDERER=1 npm --prefix "$REPO_ROOT" run tauri dev &>/tmp/vega-screenshot-run.log &
VEGA_PID=$!

wait_for_window

echo "Waiting 8s for app to fully load and connect to relays..."
sleep 8

echo ""
echo "Capturing screenshots..."

# 1. Feed (initial view — global feed)
sidebar_click 0
sleep 3
screenshot "01-feed-global"

# 2. Feed — scroll to show some content (just re-capture, content should be there)
sleep 1
screenshot "02-feed-with-content"

# 3. Articles feed
sidebar_click 1
sleep 3
screenshot "03-articles-feed"

# 4. Media feed
sidebar_click 2
sleep 3
screenshot "04-media-feed"

# 5. Podcasts
sidebar_click 3
sleep 3
screenshot "05-podcasts"

# 6. Search
sidebar_click 4
sleep 2
screenshot "06-search"

# 7. Bookmarks
sidebar_click 5
sleep 2
screenshot "07-bookmarks"

# 8. Direct messages
sidebar_click 6
sleep 2
screenshot "08-direct-messages"

# 9. Notifications
sidebar_click 7
sleep 2
screenshot "09-notifications"

# 10. Follows
sidebar_click 8
sleep 2
screenshot "10-follows"

# 11. Zap history
sidebar_click 9
sleep 2
screenshot "11-zap-history"

# 12. V4V dashboard
sidebar_click 10
sleep 2
screenshot "12-v4v-dashboard"

# 13. Relays
sidebar_click 11
sleep 2
screenshot "13-relays"

# 14. Settings
sidebar_click 12
sleep 2
screenshot "14-settings"

# 15. About / Support
sidebar_click 13
sleep 2
screenshot "15-about"

# 16. Compose box — click back to feed and open compose
sidebar_click 0
sleep 2
info=$(get_window)
read -r wx wy ww wh <<< "$info"
# Compose box is in the feed header area — click the compose input
# Feed header is approximately 80px from top, compose box starts around y=80
# The input/textarea in ComposeBox is inside a card below the feed header tabs
# It's typically at about y = header(40) + feed-header(40) + padding = ~90px
# and x is centered in the content area (sidebar 192px + content starts)
content_x=$(( wx + 192 + (ww - 192) / 2 ))
compose_y=$(( wy + 90 ))
click "$content_x" "$compose_y"
sleep 1
screenshot "16-compose"

echo ""
echo "Done! Screenshots saved to: $OUT"
echo ""
ls -la "$OUT/"*.png 2>/dev/null | awk '{print $NF, $5}'

# Leave the app running so user can inspect
echo ""
echo "Vega is still running (PID $VEGA_PID). Close it manually when done."
