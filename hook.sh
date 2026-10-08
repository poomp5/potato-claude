#!/usr/bin/env bash
# Forwards a Claude Code hook event to น้อง potato.
# Never blocks Claude: if the server isn't running, curl fails fast and we exit 0.
curl -s -m 1 -X POST -H 'content-type: application/json' --data-binary @- \
  "http://127.0.0.1:${NONG_POTATO_PORT:-4747}/event" >/dev/null 2>&1
exit 0
