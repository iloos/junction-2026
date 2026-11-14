# Deploy

One container (`adapter-node`, [Dockerfile](../../Dockerfile)) on **Aiven Runtime**, Postgres on the Aiven service `pg-1dfeeeed`, both in `aws-eu-central-1` (D3). A staging copy builds from the `staging` branch. Fallback: a Verda CPU VM.

| Service | Plan | $/h (catalog) | What |
|---|---|---|---|
| `mandate` | `startup-100-2048` (1 vCPU, 2 GB) | 0.0685 | prod, https://app.mandate.kitchen (fallback https://widely-many-scorpion.eur-1.aiven.app) |
| `mandate-staging` | `startup-20-512` | 0.0164 | staging, https://ideally-expert-wolf.eur-1.aiven.app |
| `pg-1dfeeeed` | `startup-4` (2 vCPU, 4 GB, 100 connections, PgBouncer on :24911) | 0.158 | Postgres 18.7, shared by prod and staging |

About $0.24/h in total. Plans were raised on Sat 14 Nov ~05:00 with the user's approval (budget ~$50 to Sun 14:00).

## Domains
- **`mandate.kitchen`** (registered at Namecheap, DNS on Cloudflare): the landing page plus `/story`, `/how` and `/proof`, served by the Cloudflare Worker `mandate-landing` from `site/public`. Deploy from `site/` with `npx wrangler@4 deploy`. Paths the site lacks 302 to the app, so `mandate.kitchen/agents` lands on the app's `/agents`; `www` 301s to the bare domain.
- **`app.mandate.kitchen`**: a Cloudflare CNAME (DNS only, never proxied, or Aiven can't issue the certificate) to the Aiven app, added as a custom domain on port `default`; Let's Encrypt certificate. Aiven takes subdomains only, which is why the app isn't on the bare domain. A failed domain check is not retried automatically: press Verify in the console or call `aiven_application_custom_domain_verify`.
- The `aiven.app` URL keeps working as the fallback.

## Health and smoke

`GET /healthz` returns `{ ok, db, ... }`:

- no `DATABASE_URL` → `{"db":"fixture"}`, 200 (fixture mode).
- Postgres reachable → `{"db":"ok","latencyMs":31,"tls":"verified"}`, 200.
- Postgres configured but failing → `{"db":"error","error":"..."}`, **503**.

`EXPECT_DB=ok scripts/deploy/smoke.sh <url>` checks it. `SMOKE_UI=1` adds the prod UI checks (`evals/ui`: one scenario clock on every surface, the order summary across a reload, an agent's approval link; about 20 s headless). With `SMOKE_KEY` (the `ws-smoke` key, below) it also starts `ws-smoke` over and runs the commit race check `scripts/smoke-race.mjs`: 4 commits with one idempotency key must give one receipt, 3 with different keys exactly one.

```sh
# From the main checkout; the key is read from .env without printing it
SMOKE_KEY="$(grep -E '^SMOKE_KEY=' .env | cut -d= -f2-)" SMOKE_UI=1 EXPECT_DB=ok scripts/deploy/smoke.sh https://app.mandate.kitchen
```

## Database connection ([client.ts](../../src/lib/server/db/client.ts))

- `postgres` 4.x, **max 3 connections** per process plus one `LISTEN` connection for the op stream. The plan allows 100, shared by prod, staging, dev servers and lanes.
- One pool per process, kept on `globalThis` across Vite HMR.
- TLS verified against the Aiven project CA, taken from `PROJECT_CA_CERT` (base64, injected by Aiven Runtime) or `PG_CA_CERT` (path or PEM; locally `certs/aiven-ca.pem`). `?sslmode=` is stripped from the URL because it would override the CA and skip verification. A wrong CA fails with "self-signed certificate in certificate chain".
- `SQL_TRACE=1` prints the most frequent statements every 10 s while queries arrive (diagnostics, off by default).
- Migrations run by `pnpm db:migrate` from the main checkout, never at request time. The image carries `build/`, prod `node_modules/`, `drizzle/` and `fixtures/`.

## Local

```sh
pnpm build && node --env-file=.env build          # Postgres mode on :3000
pnpm build && node build                           # fixture mode (node build does not read .env)
scripts/deploy/local-container.sh 3000             # image + Aiven PG, as Runtime runs it (needs Docker)
```

Fixture mode in a container needs the gitignored Valio cache mounted writable (`docker run -u root -v "$PWD/data/valio:/app/data/valio" …`) and uses ~850 MiB, so the deployed app is Postgres mode only (~170 MiB).

## Aiven Runtime

Both apps build from GitHub (`iloos/junction-2026`, VCS integration `vcs5f404a66b3d`, repo id `1456805781`) with the `Dockerfile` on port 3000. Integration `pg-1dfeeeed` → `DATABASE_URL`; `PROJECT_CA_CERT` holds the project CA. Prod builds the branch or tag it was last redeployed with (`aiven_service_get` → `user_config.application.source.branch`). Any env change in the console also rebuilds from that branch.

**Promote: staging → verify → prod.**

1. `git push origin <sha>:staging`, then `aiven_application_redeploy` on `mandate-staging`.
2. Verify on staging: `warm.sh`, `smoke.sh`, and the visitor gate (`GATE_URL=<staging url> npx playwright test -c scripts/deploy/pw-gate.config.ts`). Staging has no secrets (fixture model, no presenter or judge keys; visitor cookies are signed per process). It shares the database, so it only ever writes its own visitors' sandboxes.
3. Prod: `aiven_application_redeploy` on `mandate` with `branch` set to `main` or a tag (e.g. `ring1-clean`). A tag build reports no `application_deployment_commit_sha`.
4. Wait for the new container, not just `COMPLETED`: the runtime log shows a new `Listening on http://0.0.0.0:3000`. Expect about a minute of 302/307 to the status page while the container switches. Then run `warm.sh` and the smoke with `SMOKE_KEY`.

**Rule: no redeploy in the last 30 minutes before judging or recording.** A redeploy redirects to the status page for about a minute, restarts every in-memory run pointer and kitchen session, and its first requests are cold.

**Plan changes** go through `aiven_service_update` with only `plan` (and `cloud` for a move) set. Never send `user_config` for a plan change. Moving Postgres between clouds is online: on Sat 14 Nov the DigitalOcean → AWS move took 5 minutes, with one redirect seen by prod's health check and the same host, port and CA afterwards.

## Environment (Aiven console)

**An env update replaces the whole list.** `aiven_service_update` with `environment_variables` drops every variable not re-sent, including `PROJECT_CA_CERT` and the console-added secrets. Add or edit one variable at a time in the console. Agents never read `.env` values; the user pastes secrets.

| Variable | Kind | What |
|---|---|---|
| `NODE_ENV` | variable | `production` |
| `LLM_PROVIDER` | variable | model provider for request parsing and agent decisions |
| `GEMINI_STUDIO_API_KEY` | secret | Gemini |
| `MANDATE_KEY_CHEF`, `_KITCHEN_AGENT`, `_APPROVER`, `_EXTERNAL_AGENT` | secret | keys that act in the stage `ws-demo` |
| `MCP_KEYS` | secret | `label:actor:key[:workspace]`, comma-separated; an entry without a workspace acts in `ws-judges`. Holds `smoke:kitchen_agent:<key>:ws-smoke` for the smoke. |
| `JUDGE_KEY_SECRET` | secret | ≥16 chars; signs visitor cookies and judge keys. Unset: cookies are signed per process (a fresh sandbox after each restart) and judge keys answer 503. Changing it gives every visitor a new sandbox. |
| `JUDGE_KEY_EXPIRES` | variable, optional | ISO time judge keys expire; default 2026-11-16 00:00 Helsinki |
| `EXA_API_KEY`, `CONTEXT_DEV_API_KEY`, `CONTEXT_DEV_WEBHOOK_SECRET` | secret | web lookups and the recall webhook |
| `WEB_PROVIDER`, `WEB_CACHE_DIR` | variable | `live`, `/tmp/web-cache` |
| `WEB_CAP_PER_KEY`, `WEB_CAP_GLOBAL`, `WEB_RECALL_WORKSPACES` | variable, optional | web spend caps (defaults 40 / 600) and recall workspaces (default `ws-demo`) |
| `DEMO_RESET_OPEN` | never set on prod | opens presenter actions to everyone (dev does this by itself) |

## Workspaces and rooms

| Workspace | Who | Reset |
|---|---|---|
| `ws-j-<24 hex>` | one per browser, from the signed `mandate_visitor` cookie; seeded with a fresh run on first use | "Start over" (no key, 20 s cooldown per sandbox) |
| `ws-judges` | shared room (`?ws=ws-judges`); also where new visitors go past 300 sandboxes per process | same as a sandbox |
| `ws-demo` | the stage: presenters only (`?ws=ws-demo` after signing in on /ops) | presenter on /ops, or `POST /api/demo/reset` with the chef or approver key |
| `ws-smoke` | the deploy smoke's `MCP_KEYS` key | `POST /api/demo/reset` with that key |
| `ws-synth` | the simulated run on /ops (memory only) | restarts by itself |
| `ws-stress` | dev-only load test (`/ops?ws=ws-stress&copies=50`) | n/a |

The resolver is `server/demo/visitor.ts`. Another visitor's id in a link, cookie or query selects nothing. `/api/events` serves `ws-demo`, `ws-judges` and `ws-synth` to anyone, and a sandbox only to its own browser.

## Keyed endpoints

```sh
# Start the stage over before a demo (reads the key from .env without printing it)
curl -s -X POST -H "Authorization: Bearer $(grep -E '^MANDATE_KEY_CHEF=' .env | cut -d= -f2-)" https://app.mandate.kitchen/api/demo/reset
```

- `POST /api/demo/reset`: starts a fresh run of the key's workspace. Chef or approver keys may reset the stage. A key bound to another workspace may reset only that one. Outside agents never may.
- `POST /api/demo/sandbox/reset` (no key, the browser's cookie): starts that browser's room over; 429 `{ retryInMs }` during the cooldown, 403 for the stage. Every reset also clears that workspace's idempotency rows.
- `GET /api/demo/judge-key` (cookie): `{ workspaceId, key, mcpUrl }` for the browser's own sandbox. The key `jk_<ws>.<exp>.<hmac>` acts as an outside agent (never approves) on that sandbox's current run.
- /ops "Presenter" takes the chef or approver key once and sets a signed httpOnly cookie (12 h; it ends when the key rotates). That browser then defaults to the stage and gets Run, Stop and Reset.
- `POST /api/agent/run` and `POST /api/agent/run/<id>/cancel`: chef key only.
- `/api/web/*`: `POST contextdev` takes the Context.dev webhook (signature checked against `CONTEXT_DEV_WEBHOOK_SECRET`, else 401); `POST replay` needs a chef or approver key; `recall`, `facts`, `outside` and `findings` take any key.

## Warm up before judging

`scripts/deploy/warm.sh <url>` waits out the status-page redirect, then walks one visitor's first minute (pages, a sandbox seed, the kitchen snapshot, the op stream) and prints each time. A cold container answers its first `/healthz` in about 7 s (container wake + first Postgres connect + TLS); warm calls take 0.2–0.4 s from Helsinki.

## Aiven evidence (for the submission)

Checked against the live service; each line says how.

| Claim | Evidence |
|---|---|
| The app runs on **Aiven Runtime** | Service `mandate`, built from `main` by Aiven from the Dockerfile; `smoke.sh` passes on every deploy. |
| Data lives in **Aiven for PostgreSQL** with verified TLS | `pg-1dfeeeed`, PostgreSQL 18.7; `/healthz` returns `"tls":"verified"`. A wrong CA is rejected (tested locally). |
| Schema by migration | Drizzle migrations through `0004`, run by `pnpm db:migrate`; `0000` creates the `vector` extension (pgvector 0.8.7). |
| Real catalogue | `products` holds **17,546** Valio products. Embeddings are not populated, so no vector-search claim. |
| **No double orders** on Postgres | `smoke.sh` with `SMOKE_KEY` on f2052ca: 4 concurrent commits with one idempotency key → one receipt; 3 with different keys → one receipt, two refused. |
| Live op stream on **LISTEN/NOTIFY** | Committed ops and agent traces are published with `NOTIFY mandate_events` and fanned out from one `LISTEN` per process to SSE. An SSE client received the routine agent's 8 trace events live during a 1.56 s run. |
| One sandbox per visitor | `src/routes/ops/visitor-gate.e2e.ts` passes against prod (68cb2d8): two browsers, an outside agent on one visitor's key, and a stranger opening that visitor's link each stay in their own sandbox; forged cookies select nothing. |
| 30 visitors at once | `scripts/deploy/visitors.mjs <url> 30` on 68cb2d8: 30 sandboxes, 0 errors, `/healthz` never failed (max 3.3 s). Planning ran one at a time on the 512 MB plan (2.6 s alone, ~76 s each with 30 at once). |
| 10 visitors plan at once | `visitors.mjs <url> 10`, each planning the event. 0.2 vCPU app, Postgres on DigitalOcean: ~26 s each. **1 vCPU app (`startup-100-2048`): 3.6 s each**, one alone 0.7 s. Postgres moved to AWS `startup-4`: 3.8 s (same; the app's CPU was the limit). |
| Reset keeps the audit trail | A reset starts a new run; old runs' ops stay in `ops`, and the stream, tools and /ops follow only the current run. |

## Verda VM (plan B)

`CPU.4V.16G` at $0.048/h (catalog; €200 balance). Ubuntu 24.04 + Docker, the same image, Caddy in front for HTTPS on `<ip>.sslip.io`. A billed create needs the user's yes.

## Traps

- Docker Desktop on this machine can wedge (engine 500 on `_ping`, `wsl -l` hangs). The fix is `wsl --shutdown` and a restart of Docker Desktop, which interrupts anything else using WSL.
- Never print `DATABASE_URL`; driver errors carry the host only.
- Stopping a local `node build` with `Stop-Process` kills it hard, so `--cpu-prof` never writes. Profile from inside the process (`node:inspector/promises`) instead.
