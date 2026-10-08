#!/usr/bin/env bash
# Removes น้อง potato's hooks (and the macOS autostart, if installed). Other hooks are untouched.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
SETTINGS="${CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"
CMD="\"$DIR/hook.sh\""
LABEL="com.nong-potato.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [ -f "$SETTINGS" ]; then
  cp "$SETTINGS" "$SETTINGS.bak-nong-potato-$(date +%Y%m%d%H%M%S)"
  tmp="$(mktemp)"
  jq --arg cmd "$CMD" '
    if .hooks then
      .hooks |= (with_entries(.value |= map(select(([.hooks[]?.command] | index($cmd)) | not)))
                 | with_entries(select(.value | length > 0)))
    else . end
  ' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
  echo "✅ เอา hook ออกจาก $SETTINGS แล้ว"
fi

if [ -f "$PLIST" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm "$PLIST"
  echo "✅ ปิด autostart แล้ว"
fi
echo "👋 บ๊ายบาย น้อง potato"
