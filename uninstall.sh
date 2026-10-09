#!/usr/bin/env bash
# Removes น้อง potato's hooks (and the macOS autostart, if installed). Other hooks are untouched.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
SETTINGS="${CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"
CMD="\"$DIR/hook.sh\""
CODEX_SETTINGS="${CODEX_HOOKS:-$HOME/.codex/hooks.json}"
CODEX_CMD="\"$DIR/codex-hook.sh\""
LABEL="com.nong-potato.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [ -f "$SETTINGS" ]; then
  cp "$SETTINGS" "$SETTINGS.bak-nong-potato-$(date +%Y%m%d%H%M%S)"
  tmp="$(mktemp)"
  jq --arg cmd "$CMD" '
    if .hooks then
      .hooks |= (with_entries(.value |= map(.hooks |= map(select(.command != $cmd)) | select(.hooks | length > 0))
                 | with_entries(select(.value | length > 0)))
    else . end
  ' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
  echo "✅ เอา hook ออกจาก $SETTINGS แล้ว"
fi

if [ -f "$CODEX_SETTINGS" ]; then
  cp "$CODEX_SETTINGS" "$CODEX_SETTINGS.bak-nong-potato-$(date +%Y%m%d%H%M%S)"
  tmp="$(mktemp)"
  jq --arg cmd "$CODEX_CMD" '
    if .hooks then
      .hooks |= (with_entries(.value |= map(.hooks |= map(select(.command != $cmd)) | select(.hooks | length > 0))
                 | with_entries(select(.value | length > 0)))
    else . end
  ' "$CODEX_SETTINGS" > "$tmp" && mv "$tmp" "$CODEX_SETTINGS"
  echo "✅ เอา hook ออกจาก $CODEX_SETTINGS แล้ว"
fi

if [ -f "$PLIST" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm "$PLIST"
  echo "✅ ปิด autostart แล้ว"
fi
echo "👋 บ๊ายบาย น้อง potato"
