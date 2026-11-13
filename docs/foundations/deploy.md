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
Container facts (tested on fc98e0c): Postgres mode uses ~170 MiB and serves `/healthz` (verified TLS), `/api/tools/quote` and `/api/events` from Aiven. **Fixture mode in a container** needs the gitignored Valio cache mounted *writable* (the catalogue writes `data/valio/normalized/`): `docker run -u root -v "$PWD/data/valio:/app/data/valio" …`, and uses ~850 MiB, so it does not fit the 512 MB Runtime plan. The deployed app is Postgres mode only.

## Aiven Runtime (live)
**URL: https://widely-many-scorpion.eur-1.aiven.app** (service `mandate`, project `junction26jq`, `startup-20-512`, `aws-eu-central-1`, ~$0.0164/h catalog price). GitHub is connected to the Aiven org (integration `vcs5f404a66b3d`, repo id `1456805781`).

How it was created (once, via the Aiven MCP `aiven_application_create`):
- project `junction26jq`, service `mandate`, repo `https://github.com/iloos/junction-2026`, branch `main`, port `3000`, Dockerfile `Dockerfile`, build path `.`
- integration: `pg-1dfeeeed` → `connection_string` as `DATABASE_URL` (the platform also injects `PROJECT_CA_CERT`)
- env: `NODE_ENV=production`, `LLM_PROVIDER=fixture`; add API keys as `secret` kind only when a live provider is switched on.
- Tool routes (`/api/tools/*`, `/mcp`) accept only keys from `MCP_KEYS`, or the public fixture keys when `MANDATE_FIXTURE_KEYS=1`; production has neither until one is set.

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
