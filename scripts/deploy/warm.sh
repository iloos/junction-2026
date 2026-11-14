#!/usr/bin/env sh
# Warm a fresh deploy before judging: wait out Aiven's status-page redirect, then touch every path a visitor's
# first minute uses (pages, a sandbox seed, the kitchen snapshot, the op stream), and print each time.
# Usage: scripts/deploy/warm.sh https://<mandate url>   (default http://localhost:3000)
set -eu
BASE="${1:-http://localhost:3000}"
JAR=$(mktemp)
trap 'rm -f "$JAR"' EXIT

# 1. Until /healthz answers 200 itself (a redeploy redirects to a status page for about a minute).
i=0
while :; do
	code=$(curl -s -o /dev/null --max-time 20 -w '%{http_code}' "$BASE/healthz" || echo 000)
	[ "$code" = "200" ] && break
	i=$((i + 1))
	[ "$i" -ge 36 ] && { echo "FAIL: /healthz still $code after 3 min"; exit 1; }
	echo "waiting: /healthz $code"
	sleep 5
done

# 2. One visitor's first minute, with a cookie jar (a sandbox is seeded on the first kitchen call).
hit() {
	t=$(curl -s -o /dev/null -b "$JAR" -c "$JAR" --max-time 60 -w '%{http_code} %{time_total}s' "$BASE$1")
	echo "$t  $1"
}
hit /healthz
hit /
hit /kitchen-api/snapshot
hit /request
hit /ops
hit '/api/events?workspace=ws-demo&mode=poll'
hit /healthz
echo OK
