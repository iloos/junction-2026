#!/usr/bin/env sh
# Build the image and run it locally against Aiven Postgres, as Aiven Runtime would (CA passed base64 in PROJECT_CA_CERT).
# Needs a running Docker engine, .env with DATABASE_URL, and certs/aiven-ca.pem. Usage: scripts/deploy/local-container.sh [port]
set -eu
PORT="${1:-3000}"
docker build -t mandate:local .
DB_URL=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)
CA_B64=$(base64 -w0 certs/aiven-ca.pem)
docker rm -f mandate-local >/dev/null 2>&1 || true
docker run -d --name mandate-local -p "$PORT:3000" \
	-e DATABASE_URL="$DB_URL" -e PROJECT_CA_CERT="$CA_B64" -e LLM_PROVIDER=fixture mandate:local
sleep 3
EXPECT_DB=ok "$(dirname "$0")/smoke.sh" "http://localhost:$PORT"
