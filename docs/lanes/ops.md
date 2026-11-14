# Lane: ops (deploy, Operations, op stream, demo runs)

**Branch:** `lane/ops` · **Worktree:** `../junc26-lanes/ops` · **Dev port:** 5176 · **Owner:** session 9c

## Goal (one sentence, user-visible)
The app runs on Aiven. Operations shows every held line, refused commit and anomaly as one live queue, and each visitor gets a demo run they can start over safely.

## Owned paths
- Deploy: `Dockerfile`, `scripts/deploy/**`, `docs/foundations/deploy.md`, `src/lib/server/db/client.ts`, `src/routes/healthz/**`
- Op stream: `src/lib/server/bus/**`, `src/routes/api/events/**`
- Demo runs: `src/lib/server/demo/**`, `src/routes/api/demo/**`, `src/lib/core/scenario.ts`
- Operations: `src/routes/ops/**`

## Handoff (Sat 14 Nov)

**State.** `lane/ops` = main `5615a58`, nothing unmerged. Prod runs `f2edb21` (Aiven `commit_sha`), smoke OK; ws-demo on run `run-mwfr9p7l`, ws-judges on `run-mwfr9pis`. Review: `docs/handoff/review-9c-ops.md`. Next: Track G in `docs/handoff/SYNTHESIS.md` §5, pending the user's re-scope.

**How it fits** (read in this order):
- `demo/run.ts`: `currentRun` per workspace, loaded from the newest `runs` row and held in memory.
- `demo/reset.ts` and `sandbox.ts`: start a new run; audit rows survive.
- `bus/index.ts`: `publish` (the Store calls it after commit) → MemoryBus ring of 500 per workspace, plus PgTransport NOTIFY `mandate_events` on prod.
- `/api/events`: subscribe → catch up (run filter in SQL before the limit) → dedupe by seq. It sends `event: run` when the run changes and falls back to polling.
- `ops/stream.svelte.ts`: applies events in rAF batches. `ops/cases.ts` builds the queue and is pure and tested.
- The scenario clock is `core/scenario.ts`, ticked from the run's start.

**Non-obvious.**
- **Aiven env updates replace the whole list.** `aiven_service_update` drops `PROJECT_CA_CERT` and the console-added keys (Gemini, Exa, Context.dev). Add single variables in the console. Never read `.env` values; ask the user to paste secrets.
- **Redeploy:**
  - Push main, then `aiven_application_redeploy` (project `junction26jq`, service `mandate`).
  - Expect about 1 min of 302/307 to Aiven's status page, then `EXPECT_DB=ok scripts/deploy/smoke.sh https://widely-many-scorpion.eur-1.aiven.app`.
  - Check the deployed `commit_sha` with `aiven_service_get`, not by timing.
- **Warm up before judging:** the first hit after a deploy or idle takes about 7 s. Open `/`, `/ops` and `/request`, run one quote and the smoke test, and don't redeploy in the last 30 min.
- Presenter actions on prod (reset, run, stop) need the chef key via `curl` (deploy.md has the command); `DEMO_RESET_OPEN` stays unset.
- Workspace choice is made in three places, none of them mine: `kitchen/live.ts:62`, `request/workspace.ts` `pageWorkspace`, and `ops/+page.server.ts:49` (defaults to ws-demo, hence F2).
- `/api/events` on prod serves only ws-demo, ws-judges and ws-synth. Track G turns that into a pattern.
- NOTIFY payloads over 7,000 bytes are dropped with a warning; ops fall back to a ref fetch, traces don't.
- Context.dev returns 4xx without retrying. A delivery that failed while the route or secret was missing stays failed; retry it by hand with the `retry-webhook-delivery` MCP tool. The monitor runs hourly.

**Open threads:**
- Track G: per-visitor workspace (`ws-j-<id>` cookie) with a scoped reset, Ops following the visitor, exact-plan links, a presenter session and a two-browser test. My step-2 additions to its done-when:
  - one resolver for the workspace;
  - a cap on what each visitor costs;
  - `/api/events` gated by the visitor's cookie;
  - a judge key minted at runtime.
- Bugs, both F26: the `/ops` clock doesn't re-anchor when the run is reset elsewhere (`+page.svelte:26`); an empty `?/cancelAgent` returns 500 instead of 400.
- No tests yet:
  - `PgTransport`;
  - the NOTIFY ref path;
  - `publishSim` in Postgres. It has no callers anyway, so live workspaces show no simulated events.
- The pg race test (`MANDATE_TEST_PG=1`) result isn't recorded in the deploy.md evidence table yet.

**Traps:**
- Prettier reformats on save, so Python or sed string replacements miss; use Edit.
- Svelte rejects a `<form>` inside `<p>`.
- Lint `no-navigation-without-resolve` needs `resolve()` or a scoped disable.
- `reader.test` needs a 30 s timeout.
- Docker Desktop can wedge (engine 500); the fix is `wsl --shutdown`, which is the user's call.
- Per-process state (`currentRun`, cooldown, agent lock, rings): never scale `mandate` past one instance.

**Resume:**
- In the worktree: `pnpm i`, copy `.env` and `data/valio/` from the main checkout, then `pnpm dev --port 5176`.
- Load tests: dev-only `ws-stress` at `/ops?ws=ws-stress&copies=10|50`.
- Playwright scripts and screenshots are in `scratch/` (gitignored).
- Checks: `pnpm check && pnpm lint && pnpm test:unit`.
- Aiven over MCP: project `junction26jq`; app `mandate`; Postgres `pg-1dfeeeed` (PG 18.7, pool max 3, TLS verified via `PROJECT_CA_CERT`).

**Only I know:**
- The €2.7M sandbox order came in through key-less `/request`, before the ceiling.
- The kitchen runaway loop (996 ops) is fixed by 8d.
- Plan the event takes 4.24 s, of which 2.88 s is the stage-2 rescues; that's the next latency target.
- `ops/+page.server.ts` names come from seeds plus `SYNTH_PRODUCTS`, not `catalog.get`, so a product outside them shows as "Product <id>".
