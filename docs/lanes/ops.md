# Lane: ops (deploy, Operations, op stream, visitor sandboxes)

## Dispatch

- **Track:** G: sandboxes, Operations, deploy, Aiven. Session 9c.
- **Branch / worktree:** `lane/g15` (g6–g14 are on main) in `../junc26-lanes/ops`. Dev port 5176, run with `DATABASE_URL=` blank (dev uses PGlite anyway unless `DEV_USE_REMOTE_DB=1`).
- **Owned paths:**
  - `src/lib/server/demo/**`, `src/lib/server/bus/**`, `src/lib/server/db/client.ts`
  - `src/routes/ops/**`, `src/routes/api/events/**`, `src/routes/api/demo/**`, `src/routes/healthz/**`
  - `Dockerfile`, `scripts/deploy/**`, `docs/foundations/deploy.md`
- **Acceptance:** `pnpm gate` green. For anything touching sandboxes, `src/routes/ops/visitor-gate.e2e.ts` green on a production build. For UI, Playwright screenshots at 1440 and 390.

## State (checkpoint, Sat evening)

- **Prod:** main `b10cd43`, smoke 11 passed; the only failures are `/agents` raw ids (da) and R11-14 now passing (91 drops its expected-fail). Plan `startup-100-2048`; Postgres `pg-1dfeeeed` `startup-4`; staging `mandate-staging` on branch `staging`.
- **On main, from this lane:**
  - Ops: Problems + story, Orders (four stages, approve in place, "Confirmed by the kitchen"), Demand (Valio's view), "Through the rules" counts, Engine room, service status strip.
  - RecordRefusal (gate refusals in the op log, MCP and REST), `/healthz` `services[]`, body limits (`hooks.server.ts`), calendar feed + `cal_` token, privacy room notice, visitor cap 5,000.
  - Stream: in-order delivery with gap repair that only skips a seq the log proves absent (R9-09, R10, R11-06).
  - Stages: one replay, cached per run and cursor (R11-12); typed causes, never "out of stock" for a rule (R11-11); `dueOf` everywhere.
- **`lane/g15` @ `6b09e27`** (pushed, not merged): `Plan.origin` (server-set door, `3b1d8e0`) and the kitchen basket (`core/services/basket.ts`, `GET /kitchen-api/basket`, `6b09e27`).

## Next, in order

1. Lead merges g15; deploy; check `/kitchen-api/basket` on prod.
2. `origin: 'usual'` in U's `planUsual` (`src/lib/server/patterns/route.ts`: `{ ...contextFor('chef', ...), origin: 'usual' }`) once `7b37e83` is on main.
3. "Sponsors, last hour" panel in the Engine room from O's `/api/ops/traces/summary` (calls, p50/p95, error rate, cache hits per source), and the trace drawer prepending `&as=events` history (contract: `docs/lanes/o-obs.md`, needs migration 0005).
4. R11-07a with 1f: re-run 91's probe (`src/lib/server/evals/adversarial-r11.test.ts`) after 1f's resync (`daf76af`) and say why it still fails, if it does.
5. Ops brief from d0's brainstorm with the user, when d0 sends it.

**NEEDS from others (doors for `CallContext.origin`):** /request `request` (B, `src/lib/server/request`), chat `chat` (E, `/api/chat/*`), MCP/REST outside agents `agent` (lead, `server/auth` `resolveKey`/`contextFor`), menu → plan `menu` (B/menu-v2). Each is one line where the door builds its ctx. 1f and B render `room.notice`; c3 builds the Basket view on the type sent.

## Self-review (checkpoint)

- **Solid:** the projections (problems, stages, demand, basket, gate counts) are pure and tested on captured real runs plus a 10× case; one replay serves Orders, Demand and the basket. RecordRefusal, origin and body limits have tests through the real gate. Every deploy today was smoked.
- **Fragile:** service status is per process (idle after a deploy until called). `Plan.origin` exists only on new plans, so older plans fall back to createdBy/eventId/via. The basket's week budget counts only this run's orders (the commit lock counts the DB's budget rows, which survive a reset).
- **Untested:** the race smoke since 3684d29 (no `SMOKE_KEY` in this session); the basket and Orders on a run with many kitchens and days on prod; the gap-repair resync path against a live Postgres outage.
- **Found on prod, not mine:** `/request` "250 ml milk" rounds up to a 5 l case with no question (B); `/agents` raw tool names (da).

## Deploy and roll back

- **Deploy:**
  1. `aiven_application_redeploy` (project `junction26jq`, service `mandate`).
  2. Wait until `/healthz` `commit` = the pushed SHA; this takes about 3 min, and the old container answers meanwhile.
  3. Run `scripts/deploy/warm.sh <url>`.
  4. From the main checkout: `SMOKE_KEY=… SMOKE_UI=1 EXPECT_DB=ok scripts/deploy/smoke.sh <url>`. Run it only once `/healthz` shows the new commit; a smoke mid-switch fails the race check.
- **Roll back:** branch `rollback` on origin is at `f3591fd`. Redeploy with `branch: "rollback"`; the next deploy passes `branch: "main"`. Aiven doesn't build tags.
- Details: `docs/foundations/deploy.md`.

## Traps

- **Aiven env updates replace the whole list.** Add single variables in the console; change the plan with `plan` alone.
- **No redeploy in the last 30 minutes before judging.**
- Dev servers in any worktree must not write prod: keep `DATABASE_URL=` blank; dev defaults to its own sandbox.
- Prettier reformats on save, so scripted string replacements miss after a format; use the Edit tool.
- Never resolve a rebase conflict with `--theirs`/`--ours` on a whole file other lanes edit.
- `Stop-Process` kills `node build` hard; an old server can keep the port and serve a deleted build. Check the listener first.
- Per-process state (run pointers, sessions, cooldowns, rings, the state cache): `mandate` runs one instance. Other processes on the same database converge on runs within 5 s.
- The kitchen page no longer has `#event-h`: plan through `POST /kitchen-api/scenario {action:'start'}` in scripts.

## Resume

- **Worktree:** `../junc26-lanes/ops`, branch `lane/g15` (head in `git log -1`); `pnpm i`; `.env` and `data/valio/` copied from the main checkout. Dev server: `DATABASE_URL= pnpm dev --port 5176 --strictPort`.
- **Checks (gate rule from Sat 19:00):** `pnpm check && pnpm lint` plus targeted tests (`npx vitest run src/routes/ops src/lib/core/services src/lib/server/bus src/lib/server/demo src/lib/server/tools`), then send the SHA. The lead runs the only full gate.
- **Deploy:** `aiven_application_redeploy` (junction26jq / mandate, branch main) → wait for `/healthz` `commit` → `scripts/deploy/warm.sh` → `SMOKE_UI=1 EXPECT_DB=ok scripts/deploy/smoke.sh <url>` from the main checkout (no `SMOKE_KEY` here: the race check needs the lead or the user).
- **Scripts in `scratch/`** (gitignored): `ops-sweep.mjs` (raw-id rules over every Ops tab), `orders-shot.mjs`/`demand-shot.mjs` (screenshots with an ordered plan), `events-check.mjs`, `veg-check.mjs`, `behaviour-check.mjs`, `request-check.mjs`.
- **Fixtures:** `src/routes/ops/fixtures/seeded-ops.ndjson` (the seeded Christmas run), `src/lib/core/services/fixtures/ordered-ops.ndjson` (an outside agent's by-line order, refused once, signed, placed).
- **Production build without Aiven:** `pnpm build && scripts/deploy/serve-fixture.sh` (:4177), then `GATE_URL=http://localhost:4177 npx playwright test -c scripts/deploy/pw-gate.config.ts` (visitor gate).
