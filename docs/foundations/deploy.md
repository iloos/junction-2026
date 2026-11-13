# Deploy

One container (`adapter-node`, [Dockerfile](../../Dockerfile)) on **Aiven Runtime**, Postgres on the free Aiven service `pg-1dfeeeed` (D3). Fallback: a Verda CPU VM.

## Health
`GET /healthz` returns `{ ok, db, ... }`:
- no `DATABASE_URL` → `{"db":"fixture"}`, 200 (fixture mode).
- Postgres reachable → `{"db":"ok","latencyMs":31,"tls":"verified"}`, 200.
- Postgres configured but failing → `{"db":"error","error":"..."}`, **503**.

Smoke test any instance: `EXPECT_DB=ok scripts/deploy/smoke.sh https://<url>`.

## Database connection ([client.ts](../../src/lib/server/db/client.ts))
- `postgres` 4.x, **max 3 connections** per process (the free plan has 15 in total, shared by every instance, dev server and lane).
- One pool per process, kept on `globalThis` across Vite HMR.
- TLS verified against the Aiven project CA, taken from `PROJECT_CA_CERT` (base64, injected by Aiven Runtime) or `PG_CA_CERT` (path or PEM; locally `certs/aiven-ca.pem`). `?sslmode=` is stripped from the URL because it would override the CA and skip verification. A wrong CA fails with "self-signed certificate in certificate chain" (tested).
- `createPgDb()` is Drizzle over that pool and runs `drizzle/` migrations: the Aiven counterpart of `createFixtureDb()`.
- The image carries `build/`, prod `node_modules/`, `drizzle/` (migrations) and `fixtures/` (seeds).

## Local
```sh
pnpm build && node --env-file=.env build          # Postgres mode on :3000
pnpm build && node build                           # fixture mode
scripts/deploy/local-container.sh 3000             # image + Aiven PG, as Runtime runs it (needs Docker)
```

## Aiven Runtime (plan A)
Prerequisites (user, once): connect GitHub to the Aiven org (console → Integrations → GitHub, grant `iloos/junction-2026`), since the repo is private. Approve plan `startup-20-512` in `aws-eu-central-1` (~$0.0164/h catalog price; Runtime has no `do-fra`).

Create (once, via the Aiven MCP `aiven_application_create`):
- project `junction26jq`, service `mandate`, repo `https://github.com/iloos/junction-2026`, branch `main`, port `3000`, Dockerfile `Dockerfile`, build path `.`
- integration: `pg-1dfeeeed` → `connection_string` as `DATABASE_URL` (the platform also injects `PROJECT_CA_CERT`)
- env: `NODE_ENV=production`, `LLM_PROVIDER=fixture`; add API keys as `secret` kind only when a live provider is switched on.

**Redeploy after a merge** (lead):
1. `git push origin main`
2. Aiven MCP `aiven_application_redeploy` (project `junction26jq`, service `mandate`), or the console's Redeploy button.
3. `EXPECT_DB=ok scripts/deploy/smoke.sh https://<mandate url>`

Env changes go through `aiven_service_update` (`user_config.application.environment_variables`), not a rebuild.

## Verda VM (plan B)
`CPU.4V.16G` at $0.048/h (catalog; €200 balance). Ubuntu 24.04 + Docker, the same image, Caddy in front for HTTPS on `<ip>.sslip.io`. Billed create: needs the user's yes.

## Traps
- Docker Desktop on this machine can wedge (engine 500 on `_ping`, `wsl -l` hangs); the fix is `wsl --shutdown` + restart Docker Desktop, which interrupts anything else using WSL.
- Never print `DATABASE_URL`; driver errors carry the host only.
