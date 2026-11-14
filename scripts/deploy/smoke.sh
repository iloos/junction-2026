#!/usr/bin/env sh
# Smoke-test a running Mandate instance: /healthz must answer 200, and must report db "ok" when EXPECT_DB=ok.
# Usage: scripts/deploy/smoke.sh https://mandate-xxx.aivencloud.app   (default http://localhost:3000)
# With SMOKE_KEY (a kitchen_agent key bound to its own workspace in MCP_KEYS, e.g. `smoke:kitchen_agent:<key>:ws-smoke`),
# it also starts that workspace over and runs the commit race check (scripts/smoke-race.mjs) against the container.
set -eu
BASE="${1:-http://localhost:3000}"
EXPECT_DB="${EXPECT_DB:-}"
body=$(curl -sS --max-time 20 -w '\n%{http_code}' "$BASE/healthz")
code=$(printf '%s' "$body" | tail -n1)
json=$(printf '%s' "$body" | sed '$d')
echo "$code $json"
[ "$code" = "200" ] || { echo "FAIL: /healthz returned $code"; exit 1; }
if [ -n "$EXPECT_DB" ]; then
	printf '%s' "$json" | grep -q "\"db\":\"$EXPECT_DB\"" || { echo "FAIL: expected db=$EXPECT_DB"; exit 1; }
fi
if [ -n "${SMOKE_KEY:-}" ]; then
	code=$(curl -sS -o /dev/null --max-time 30 -w '%{http_code}' -X POST -H "Authorization: Bearer $SMOKE_KEY" "$BASE/api/demo/reset")
	[ "$code" = "200" ] || { echo "FAIL: smoke workspace reset returned $code"; exit 1; }
	node "$(dirname "$0")/../smoke-race.mjs" "$BASE" || { echo "FAIL: commit race"; exit 1; }
fi
echo OK
