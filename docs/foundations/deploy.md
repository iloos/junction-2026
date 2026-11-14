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
- Tool routes (`/api/tools/*`, `/mcp`) accept the keys under Production rules below.

**Redeploy after a merge** (lead):
1. `git push origin main`
2. Aiven MCP `aiven_application_redeploy` (project `junction26jq`, service `mandate`), or the console's Redeploy button.
3. `EXPECT_DB=ok scripts/deploy/smoke.sh https://<mandate url>`

Env changes go through `aiven_service_update` (`user_config.application.environment_variables`), not a rebuild.

## Production rules
- **Keys** (Aiven env, kind `secret`; values also in the main checkout's `.env`, never printed): `MANDATE_KEY_CHEF`, `MANDATE_KEY_KITCHEN_AGENT`, `MANDATE_KEY_APPROVER`, `MANDATE_KEY_EXTERNAL_AGENT` act in the stage workspace `ws-demo`. `MCP_KEYS` = `label:actor:key[:workspace]`, comma-separated; judge entries default to the sandbox `ws-judges`, created with the seed kitchens on first use. Public fixture keys (`MANDATE_FIXTURE_KEYS`) stay off.
- **`GEMINI_STUDIO_API_KEY`** is pasted into the Aiven console by the user (agents never read `.env` values).
- **Env updates replace the whole list.** `aiven_service_update` with `environment_variables` drops anything not re-sent, including `PROJECT_CA_CERT` (base64 of `certs/aiven-ca.pem`) and the console-added Gemini key. Prefer adding a single variable in the console.
- **Presenter actions need a key on prod:** `POST /api/demo/reset` (chef or approver key) starts a fresh `ws-demo` run; `POST /api/agent/run` (chef, kitchen-agent or approver key) runs the routine agent. The key-less /ops buttons appear only in dev or with `DEMO_RESET_OPEN=1`, which stays unset on prod.
- **`/api/events`** serves only `ws-demo`, `ws-judges` and `ws-synth` on prod until CallContext gates it.
- **Scenario clock:** `src/lib/core/scenario.ts`; the served app ticks it from each run's start. Reset re-anchors it.

```sh
# Reset the stage before a demo (reads the key from .env without printing it)
curl -s -X POST -H "Authorization: Bearer $(grep -E '^MANDATE_KEY_CHEF=' .env | cut -d= -f2-)" https://widely-many-scorpion.eur-1.aiven.app/api/demo/reset
```

## Verda VM (plan B)
`CPU.4V.16G` at $0.048/h (catalog; €200 balance). Ubuntu 24.04 + Docker, the same image, Caddy in front for HTTPS on `<ip>.sslip.io`. Billed create: needs the user's yes.

## Traps
- Docker Desktop on this machine can wedge (engine 500 on `_ping`, `wsl -l` hangs); the fix is `wsl --shutdown` + restart Docker Desktop, which interrupts anything else using WSL.
- Never print `DATABASE_URL`; driver errors carry the host only.
