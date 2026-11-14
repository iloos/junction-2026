# Lane: ops (deploy, Operations, op stream, visitor sandboxes)

## Dispatch

- **Track:** G: sandboxes, Operations, deploy, Aiven. Session 9c.
- **Branch / worktree:** `lane/g9` (g6, g7, g8 are on main) in `../junc26-lanes/ops`. Dev port 5176, run with `DATABASE_URL=` blank (dev uses PGlite anyway unless `DEV_USE_REMOTE_DB=1`).
- **Owned paths:**
  - `src/lib/server/demo/**`, `src/lib/server/bus/**`, `src/lib/server/db/client.ts`
  - `src/routes/ops/**`, `src/routes/api/events/**`, `src/routes/api/demo/**`, `src/routes/healthz/**`
  - `Dockerfile`, `scripts/deploy/**`, `docs/foundations/deploy.md`
- **Acceptance:** `pnpm gate` green. For anything touching sandboxes, `src/routes/ops/visitor-gate.e2e.ts` green on a production build. For UI, Playwright screenshots at 1440 and 390.

## State

- **Prod:** `mandate` runs main (`/healthz` reports `commit` and, with g7, per-service state). Plan `startup-100-2048`; Postgres `pg-1dfeeeed` is `startup-4` in `aws-eu-central-1`; staging `mandate-staging` builds branch `staging`. About $0.24/h.
- **Smoke:** green with `SMOKE_UI=1` on every deploy today. The race check needs `SMOKE_KEY`, which this session's permission guard won't read from `.env`; the lead or the user runs it.
- **On main (g6):**
  - Ops opens on **Problems** (`problems.ts`, `ProblemCard`): one card per cause across kitchens, consequence first ("Christmas ham: 28 kg short for 1 kitchen"), "Agents already …" from the op log, € waiting, time to cut-off, only the kitchen link as a button.
  - **Story** per problem (`story.ts`, `StoryPanel`): its ops in seq order with a chip, one sentence and the consequence; ops without a sentence are counted, never vague. "Technical detail" opens the op in `TraceDrawer`.
  - **Engine room** tab (timeline, op log, agent traces) only with the System toggle.
  - **RecordRefusal** op: the gate records FORBIDDEN for outside and kitchen agents (REST and MCP, including tools the MCP server doesn't list), one per caller, tool and plan per 60 s; shown as a red story step.
  - M2 (`onCurrentRun` always follows the newest run), R9-09 (bus delivers in order per workspace), R9-10 (NOTIFY limit in bytes; publish failures logged).
  - Words: "Ordered", "Order refused", days not ISO dates.
- **On main (g7, g8):** service status (`external/status.ts`, `/healthz` `services[]`, `ServiceStatus` in the Ops header), RecordRefusal caps, ids behind System, days not ISO dates, privacy (5,000 sandboxes per process, `roomNotice` on every shared room), the outside agent's door from `via` (MCP or API).
- **`lane/g9`** (pushed, not merged): kitchen calendar feed. `core/calendar.ts` (RFC 5545, Finnish holidays), `/kitchen-api/calendar.ics?kitchen=` (cookie), `/api/calendar/<kitchen>.ics?token=` (read-only `cal_` token from `/api/demo/calendar-link`).
- **Earlier:** per-visitor signed sandboxes, judge keys, presenter session (`?presenter=1`), stale-run fix, dev DB guard, `/ops/views`, `/healthz` commit.

## Next, in order

1. Lead merges g9; deploy; check `/healthz` `services[]` on prod (91's `evals/ui/services.e2e.ts` asserts Valio live).
2. Run `visitor-gate.e2e.ts` on a production build: the cap/notice, calendar token and refusal writer all touch sandboxes and it hasn't run since g6.
3. Story wording on a run with grants, denials, commits, edits and a recall (only the seeded run plus a refusal is tested), then #11 stakes chart.

**NEEDS from others:** 1f and B render `room.notice` / `workspace.notice` where people type; 1f mounts the calendar subscribe link (`/api/demo/calendar-link?kitchen=` → `.webcal`); the lead mounts `ServiceStatus` in the shell for the System layer; the race smoke needs `SMOKE_KEY` (the user or the lead runs it).

## Self-review (Ring 4 checkpoint)

- **Solid:** Problems and stories are a pure projection, tested on the captured seeded run. RecordRefusal is tested over MCP (unlisted tool) and REST, with the dedupe window and an unchanged plan version. Bus ordering (R9-09) and byte limit (R9-10) have tests that fail on the old code. Every deploy today smoked green with `SMOKE_UI=1`.
- **Fragile:** the service status is per process and resets on deploy (every service `idle` until called), and Valio offers served from stored Postgres rows leave no trace. Problems group across kitchens, but the seeded run has one kitchen, so multi-kitchen titles ("for N kitchens") are untested on real data.
- **Untested:** `visitor-gate.e2e.ts` on a production build since g6; the race smoke since 3684d29 (no `SMOKE_KEY` in this session); story sentences for granted, denied and voided approvals, commits, edits and recalls on real ops; the calendar in a real calendar app.
- **One hour before the freeze:** run the visitor gate on a production build, walk prod Ops through approve → order → a recall drill and fix any sentence that reads wrong, and get the race smoke run with the key.

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

- **Worktree:** branch `lane/g9` (head in `git log -1`; g6–g8 merged); `pnpm i`; `.env` and `data/valio/` copied from the main checkout.
- **Checks:** `pnpm check && pnpm lint && pnpm test:unit --run`, then `pnpm gate` before handing a SHA.
- **Production build without Aiven:** `pnpm build && scripts/deploy/serve-fixture.sh` (:4177; the test chef key is in the script). Then `GATE_URL=http://localhost:4177 npx playwright test -c scripts/deploy/pw-gate.config.ts`.
- **Prod UI checks:** `KITCHEN_URL=<url> npx playwright test -c evals/ui/pw-prod.config.ts`, from the worktree root.
- **Load against prod:** `node scripts/deploy/visitors.mjs <url> 10`. With 10 at once each plan takes about 3.6–3.9 s.
