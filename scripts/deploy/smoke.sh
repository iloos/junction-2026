#!/usr/bin/env sh
# Smoke-test a running Mandate instance: /healthz must answer 200, and must report db "ok" when EXPECT_DB=ok.
# Usage: scripts/deploy/smoke.sh https://mandate-xxx.aivencloud.app   (default http://localhost:3000)
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
echo OK
