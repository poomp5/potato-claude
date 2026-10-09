#!/usr/bin/env bash
# Forwards a Codex lifecycle hook to น้อง potato without changing Codex decisions.
# Codex runs this hook asynchronously; a missing local server is harmless.
set -euo pipefail

payload="$(jq -c '. + {provider: "codex"}' 2>/dev/null || true)"
[ -n "$payload" ] || exit 0
curl -s -m 1 -X POST -H 'content-type: application/json' --data-binary "$payload" \
  "http://127.0.0.1:${NONG_POTATO_PORT:-4747}/event" >/dev/null 2>&1 || true
printf '{}\n'
exit 0
