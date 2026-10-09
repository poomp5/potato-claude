#!/usr/bin/env bash
# Adds น้อง potato's hooks to Claude Code and Codex user settings (all projects).
# Existing hooks are kept; backups are written before changes. Safe to re-run.
#   ./install.sh              add hooks
#   ./install.sh --autostart  also start the server at login (macOS launchd)
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
SETTINGS="${CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"
CMD="\"$DIR/hook.sh\""
EVENTS='["SessionStart","UserPromptSubmit","PreToolUse","PostToolUse","PreCompact","Notification","Stop","SubagentStop","SessionEnd"]'
CODEX_SETTINGS="${CODEX_HOOKS:-$HOME/.codex/hooks.json}"
CODEX_CMD="\"$DIR/codex-hook.sh\""
CODEX_EVENTS='["SessionStart","UserPromptSubmit","PreToolUse","PermissionRequest","PostToolUse","PreCompact","Stop","SubagentStart","SubagentStop","Interrupt","SessionEnd"]'
LABEL="com.nong-potato.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

command -v jq >/dev/null || { echo "ต้องมี jq ก่อน (brew install jq / apt install jq)"; exit 1; }
command -v bun >/dev/null || echo "⚠️  ยังไม่เจอ bun — ติดตั้งจาก https://bun.sh ก่อนรัน server"

chmod +x "$DIR/hook.sh"
chmod +x "$DIR/codex-hook.sh"
mkdir -p "$(dirname "$SETTINGS")"
[ -s "$SETTINGS" ] || echo '{}' > "$SETTINGS"
cp "$SETTINGS" "$SETTINGS.bak-nong-potato-$(date +%Y%m%d%H%M%S)"

tmp="$(mktemp)"
jq --arg cmd "$CMD" --argjson events "$EVENTS" '
  .hooks //= {}
  | reduce $events[] as $e (.;
      .hooks[$e] = (
        ((.hooks[$e] // []) | map(.hooks |= map(select(.command != $cmd)) | select(.hooks | length > 0)))
        + [{"matcher": "", "hooks": [{"type": "command", "command": $cmd}]}]
      ))
' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
echo "✅ ใส่ hook ใน $SETTINGS แล้ว"

mkdir -p "$(dirname "$CODEX_SETTINGS")"
[ -s "$CODEX_SETTINGS" ] || echo '{"hooks":{}}' > "$CODEX_SETTINGS"
cp "$CODEX_SETTINGS" "$CODEX_SETTINGS.bak-nong-potato-$(date +%Y%m%d%H%M%S)"
tmp="$(mktemp)"
jq --arg cmd "$CODEX_CMD" --argjson events "$CODEX_EVENTS" '
  .hooks //= {}
  | reduce $events[] as $e (.;
      .hooks[$e] = (
        ((.hooks[$e] // []) | map(.hooks |= map(select(.command != $cmd)) | select(.hooks | length > 0)))
        + [{"matcher": "", "hooks": [{"type": "command", "command": $cmd, "async": true}]}]
      ))
' "$CODEX_SETTINGS" > "$tmp" && mv "$tmp" "$CODEX_SETTINGS"
echo "✅ ใส่ hook ใน $CODEX_SETTINGS แล้ว"
echo "ℹ️  เปิด Codex แล้วใช้ /hooks เพื่อตรวจและ trust hook ของน้อง potato ก่อน"

if [ "${1:-}" = "--autostart" ]; then
  [ "$(uname)" = "Darwin" ] || { echo "--autostart รองรับแค่ macOS ตอนนี้ (Linux ดู README)"; exit 1; }
  BUN="$(command -v bun)"
  mkdir -p "$(dirname "$PLIST")"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$BUN</string><string>$DIR/server.ts</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/server.log</string>
  <key>StandardErrorPath</key><string>$DIR/server.log</string>
</dict>
</plist>
PLIST
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "✅ server จะเปิดเองทุกครั้งที่ login"
else
  echo "👉 รัน server: bun \"$DIR/server.ts\""
fi
echo "🥔 แล้วเปิด http://localhost:${NONG_POTATO_PORT:-4747}"
