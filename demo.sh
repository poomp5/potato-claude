#!/usr/bin/env bash
# Sends fake events so you can see every mood without running Claude.
# Clean up afterwards with:  ./demo.sh clear
URL="http://127.0.0.1:${NONG_POTATO_PORT:-4747}/event"
send() { curl -s -X POST -H 'content-type: application/json' --data "$1" "$URL" >/dev/null; }

if [ "${1:-}" = "clear" ]; then
  for i in 1 2 3 4 5 6; do send "{\"session_id\":\"demo-$i\",\"hook_event_name\":\"SessionEnd\"}"; done
  echo "ล้างน้องตัวอย่างแล้ว"; exit 0
fi

ev() { send "{\"session_id\":\"demo-$1\",\"cwd\":\"/demo/$2\",\"hook_event_name\":\"$3\"$4}"; }
ev 1 my-website     UserPromptSubmit ',"prompt":"ทำหน้า landing ให้โหลดเร็วขึ้น"'
ev 1 my-website     PreToolUse       ',"tool_name":"Edit","tool_input":{"file_path":"/demo/app/page.tsx"}'
ev 2 api-server     UserPromptSubmit ',"prompt":"migrate database"'
ev 2 api-server     Notification     ',"message":"Claude needs your permission to use Bash"'
ev 3 mobile-app     UserPromptSubmit ',"prompt":"เขียนเทสให้หน้า login"'
ev 3 mobile-app     PreToolUse       ',"tool_name":"Bash","tool_input":{"description":"Run unit tests"}'
ev 3 mobile-app     Stop             ''
ev 4 design-system  UserPromptSubmit ',"prompt":"เพิ่มปุ่มแบบใหม่"'
ev 5 my-website     UserPromptSubmit ',"prompt":"แก้บั๊ก dark mode"'
ev 5 my-website     PreToolUse       ',"tool_name":"Grep","tool_input":{"pattern":"prefers-color-scheme"}'
echo "🥔 ส่งน้องตัวอย่างไปแล้ว ดูที่หน้าเว็บได้เลย (ล้างด้วย ./demo.sh clear)"
