#!/usr/bin/env sh
# A production build in fixture mode (no DATABASE_URL, throwaway secrets) on :4177, for the visitor integration gate:
#   pnpm build && scripts/deploy/serve-fixture.sh &
#   GATE_URL=http://localhost:4177 npx playwright test -c scripts/deploy/pw-gate.config.ts
# `node build` does not read .env, so nothing here reaches Aiven.
cd "$(dirname "$0")/../.."
exec env -u DATABASE_URL -u PG_CA_CERT PORT=4177 ORIGIN=http://localhost:4177 NODE_ENV=production LLM_PROVIDER=fixture \
	JUDGE_KEY_SECRET=local-gate-secret-0123456789 MANDATE_KEY_CHEF=local-gate-chef-0123456789 \
	MANDATE_KEY_APPROVER=local-gate-approver-0123456 node build
