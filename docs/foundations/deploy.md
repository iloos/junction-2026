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
- **Presenter actions need a key on prod.** The key-less /ops buttons (run, stop, reset) appear only in dev or with `DEMO_RESET_OPEN=1`, which stays unset on prod (one rule: `server/demo/presenter.ts`).
  - `POST /api/demo/reset` (chef or approver key): starts a fresh `ws-demo` run.
  - `POST /api/demo/sandbox/reset` (no key, 20 s cooldown, 429 with `retryInMs` meanwhile): starts the judges' sandbox `ws-judges` over; it can never reach `ws-demo`. Server function: `resetSandbox()` in `server/demo/sandbox.ts`.
  - `POST /api/agent/run` (**chef key only**, needs `agent:run`): runs the routine agent; NDJSON traces, 409 while a run is going. Its ops name the starter.
  - `POST /api/agent/run/<id>/cancel` (chef key only): stops that run; 202 `{ id, cancelled, run }` once the loop has stopped, 404 if it isn't the run in progress.
- **Web routes** (`/api/web/*`):
  - `POST contextdev`: Context.dev monitor webhook, no key; needs a valid `X-Context-Signature` for `CONTEXT_DEV_WEBHOOK_SECRET` (or `x-mandate-webhook-secret` from our scripts), else 401. Answers 202; anomalies arrive on the op stream.
  - `POST replay` (chef or approver key): plays a recorded real Ruokavirasto recall into the current run, labelled as a replay (or DRILL with `drillProductId`).
  - `POST recall`, `POST facts`, `POST outside`, `GET findings` (any key): read a recall notice, look up missing product facts, find outside recipes/alternatives, list findings.
  - Env: `EXA_API_KEY`, `CONTEXT_DEV_API_KEY`, `CONTEXT_DEV_WEBHOOK_SECRET` (secrets) and `WEB_PROVIDER=live`, `WEB_CACHE_DIR=/tmp/web-cache` are added in the console.
- **`/api/events`** serves only `ws-demo`, `ws-judges` and `ws-synth` on prod until CallContext gates it.
- **Scenario clock:** `src/lib/core/scenario.ts`; the served app ticks it from each run's start. Reset re-anchors it.

```sh
# Reset the stage before a demo (reads the key from .env without printing it)
curl -s -X POST -H "Authorization: Bearer $(grep -E '^MANDATE_KEY_CHEF=' .env | cut -d= -f2-)" https://widely-many-scorpion.eur-1.aiven.app/api/demo/reset
```

## Aiven evidence (for the submission)
_Checked Sat 14 Nov ~03:00 against the live service; each line says how._

| Claim | Evidence |
|---|---|
| The app runs on **Aiven Runtime** | Service `mandate` (`startup-20-512`, aws-eu-central-1), built from `main` by Aiven from the Dockerfile; live at https://widely-many-scorpion.eur-1.aiven.app; `scripts/deploy/smoke.sh` passes on fb58016. |
| Data lives in **Aiven for PostgreSQL** with verified TLS | `pg-1dfeeeed`, PostgreSQL 18.7; `/healthz` returns `"tls":"verified"` (the client checks the project CA from `PROJECT_CA_CERT`; a wrong CA is rejected with "self-signed certificate in certificate chain", tested locally). Pool capped at 3 connections for the free plan's 15. |
| Schema by migration | Drizzle migration `0000_init` applied (`drizzle.__drizzle_migrations` = 1 row), run by `pnpm db:migrate`, never at request time; it creates the `vector` extension (pgvector 0.8.7). |
| Real catalogue seeded | `products` holds **17,546** Valio products (`select count(*)`). Embeddings are not populated yet (0 rows), so no vector-search claim. |
| Live op stream on **LISTEN/NOTIFY** | Every committed op and agent trace is published with `NOTIFY mandate_events` and fanned out from one `LISTEN` connection per process to SSE (`/api/events`). On prod, an SSE client on `ws-demo` received the routine agent's 8 trace events live while `POST /api/agent/run` ran (1.56 s). |
| Reset keeps the audit trail | `POST /api/demo/reset` starts a new run; old runs stay in `ops` (run-1's 15 ops are still there after three resets), and the stream, tools and /ops follow only the current run. |
| Catch-up survives history | With 1,116 ops of earlier runs (PGlite, same schema), /ops goes live in 0.87 s showing only the current run's 12 ops; `bus/catchup.test.ts` covers 1,100 old ops + a fresh run (the run filter sits in SQL, before the limit). |
| Holds at 10× | `ws-stress` (dev) interleaves N synthetic runs at 250 events/s into /ops at 1920×1080: 10× (190 events) 1 long task of 76 ms, 61 fps idle; 50× (950 events, 200 queue rows) 2 long tasks (103 ms total), 20.5 MB heap, 62 fps idle. |
| No catalogue or model call holds a database lock | `store/prepare.test.ts` fails on any catalogue call made inside a store transaction across the full journey and three concurrent commands; it passes (0). The author's commit (4c553fd) reports 21 such calls on the previous code. |

## Warm up before judging
A container that has just started, or has sat idle, answers its first request slowly: the first `/healthz` after a deploy took **7.3 s** (container wake + first Postgres connect + TLS), the first `quote` 0.85 s; warm calls are 0.2–0.4 s from Helsinki. Aiven's proxy also redirects to its status page (302/307) for about a minute while a redeploy switches containers. Before judging or recording: open `/`, `/ops` and `/request` once, run one `quote`, and run `EXPECT_DB=ok scripts/deploy/smoke.sh <url>`; don't redeploy in the last half hour.

Measured on 39ef642 (fresh sandbox, Chromium, from Helsinki): page ready 1.9 s; **Plan the event 7.1 s** = `POST /kitchen-api/scenario` 4.7 s + a follow-up `GET /kitchen-api/snapshot` 1.8 s + 0.5 s client; `/request` 1.0–1.7 s (≈0.75 s Gemini parse); `place_order` 0.3–0.4 s.

## Verda VM (plan B)
`CPU.4V.16G` at $0.048/h (catalog; €200 balance). Ubuntu 24.04 + Docker, the same image, Caddy in front for HTTPS on `<ip>.sslip.io`. Billed create: needs the user's yes.

## Traps
- Docker Desktop on this machine can wedge (engine 500 on `_ping`, `wsl -l` hangs); the fix is `wsl --shutdown` + restart Docker Desktop, which interrupts anything else using WSL.
- Never print `DATABASE_URL`; driver errors carry the host only.
