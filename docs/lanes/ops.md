# Lane: ops (deploy, Operations, op stream, visitor sandboxes)

## Dispatch

- **Track:** G: sandboxes, Operations, deploy, Aiven. Session 9c.
- **Branch / worktree:** `lane/g17` (g6–g16 are on main) in `../junc26-lanes/ops`. Dev port 5176, run with `DATABASE_URL=` blank (dev uses PGlite anyway unless `DEV_USE_REMOTE_DB=1`).
- **Owned paths:**
  - `src/lib/server/demo/**`, `src/lib/server/bus/**`, `src/lib/server/db/client.ts`
  - `src/routes/ops/**`, `src/routes/api/events/**`, `src/routes/api/demo/**`, `src/routes/healthz/**`
  - `Dockerfile`, `scripts/deploy/**`, `docs/foundations/deploy.md`
- **Acceptance:** `pnpm gate` green. For anything touching sandboxes, `src/routes/ops/visitor-gate.e2e.ts` green on a production build. For UI, Playwright screenshots at 1440 and 390.

## State (checkpoint, Sat 14 Nov, wind-down)

- **Prod:** main `a9f06ee` (`/healthz` commit `a9f06eed5ae3…`), deployed, warmed, smoked: 13 passed, 13 skipped (no `SMOKE_KEY`), **1 failed**: `evals/ui/dock-sync.e2e.ts:28` "approving on the page shows in the dock": the dock's status line "You approved N lines" never appeared (20 s). Not this lane's code (dock = E/1f); flagged to the lead. Plan `startup-100-2048`; Postgres `pg-1dfeeeed` `startup-4`; staging `mandate-staging` on branch `staging`.
- **Lead's a9f06ee checks (scratch/a9f-checks.mjs on prod):**
  - Start over resets only this sandbox: **yes** (A got a new run; B's workspace and run unchanged).
  - Bill grid: 1440 px one row, price column aligned (spread 0 px). 390 px: the script found no bill rows on screen, so **not verified** at 390.
  - Add to calendar downloads: **not verified**: the script's `getByRole('button', {name: /Add to calendar/})` timed out. The control is `src/lib/ui/CalendarSubscribe.svelte` (a menu whose items are `<a download="plan-dates.ics">` and `kitchen-calendar.ics`); fix the selector to open that menu first.
- **Live cross-tab Ops (scratch/live-tabs.mjs, prod a9f06ee, tab A loads first, then B on /ops):**
  - Order in A appears in B with no reload: **yes**, seq 3 → 15 in 0.6 s, 8 problems.
  - Reset in A (`POST /kitchen-api/scenario {action:'reset'}` → 200), does B follow: **no** after 30 s. B's run id stayed `run-mwgsz0p8…`; seq rose 15 → 18 and problems fell 8 → 3. So the reset appended to the same run (or B's run check never fired). Open: P1 for the rework's Live tab.
  - A second browser gets its own sandbox: yes.
- **Done (all on main):** g6–g14 (Ops Problems/Orders/Demand/Engine room, RecordRefusal, `/healthz` `services[]`, body limits, calendar feed + `cal_` token, privacy notice, visitor cap, ordered stream with gap repair, stages cache, typed causes, dueOf); g15 `f596f34` Plan.origin, `b48b673` kitchen basket; g16 `fe2d17e` usual door records `origin: 'usual'`, `030584c` clocks e2e waits on the plan heading.
- **In flight:** `lane/g17` @ the WIP commit (see the final message): `src/routes/ops/stream.svelte.ts` starts R12-09: `loadHistory(events)` feeds stored trace rows (from `/api/ops/traces?as=events`) through `onTrace`, deduped by `traceKey` (at|step|source|model-or-tool|latency) against live rows, grouped by `agentRun` else `req:<requestId>`. Type-checks clean; nothing calls `loadHistory` yet. **WIP, do not merge alone.**

## Next, in priority

1. **Reset follow (P1, before the rework's Live tab).** Find why B stays on the old run after a reset in A: does `reset` mint a new run id in the same workspace (`server/demo/reset.ts`), and does `/api/events` send a `run` event that `stream.svelte.ts` acts on? Accept: `scratch/live-tabs.mjs` prints "B follows: yes" within 3 s on prod.
2. **Finish R12-09** on top of the WIP: TraceDrawer and the Engine room load `/api/ops/traces?as=events` once per open (and per `requestId` to follow a call), merge with live rows via `loadHistory`; a Sponsors panel from `/api/ops/traces/summary` split live / cache / replay / fixture per provider. Accept: one row per call (no duplicates after a reload), screenshots 1440 + 390.
3. **The Ops rework** (the lead's brief, verbatim below), in steps, each green and deployed with a SHA and screenshots.
4. Fix the a9f checks script (calendar menu selector, bill rows at 390) and re-verify on prod.

### The lead's Ops rework brief (verbatim)

> The user widened the Ops rework: a full rework and refinement into a professional dashboard (formatting, layout, UX), folding in the best of the mock visualisations. This supersedes step 2 of my earlier message; step 1, the live cross-tab smoke, still comes first.
>
> **Sources.** The mocks are in the main checkout at c:/Users/jiaqi/Documents/.ai/hackathon/Junc26/scratch/ux-mock/ (gitignored; serve with `python -m http.server 8765`, index.html is the map). Read docs/handoff/ui-mockset-to-prod.md rows 3, 4, 5, 11, 12, 13 and 14 and its "Ready for lanes" and "Drop" sections. The research is docs/research/ui-dataviz-patterns.md. Use the impeccable skill: critique before, polish after.
>
> **Layout.**
> - One dashboard header: the sandbox scope stated ("this browser's sandbox, live"), a live dot, and the run clock.
> - KPI row: orders today, € ordered, lines held for a person, refused by rules, and the next cut-off. Each comes only from recorded counts.
> - Then tabs: Live (order feed plus the cases that touch plans), Demand, Forecast, Engine room (System).
> - Navy Ops theme and Plex; tabular numbers; one card style; each item says its text once.
>
> **Visualisations, best first.**
> 1. **Demand flow sankey** (flow.html): kitchen → event/source → dish → product → stock state, over the sandbox's real plans and needs grouped by Need.source (event, usual, request, chat, agent). Top N plus "other", and shortages never fold into other. d3-sankey is approved as a new dependency (it's small).
> 2. **"What happened to this case"** (ops.html #4): the op-by-op story with actor chips, one sentence per op from opSummary, and technical detail opening TraceDrawer.
> 3. **Stakes chart** (#11): € held by time to cut-off, next 72 h.
> 4. **Gate paths** (#12): straight through, held, replayed, refused. Recorded counts only, and hide it if a source isn't recorded.
> 5. **Forecast** (engine.html #13): start with the ordered and planned layers plus the usual layer from /kitchen-api/usual's simulated history (labelled). Skip P(short) wherever Valio hasn't stated stock. If you need a pure projectDemand in core, write it as its own commit in core/demand with tests, and tell 8d (junc26-e6). 8d is busy with the Round 12 P1s, so don't wait on them.
>
> **Fold in:** R12-09 (stored traces plus the Sponsors summary in Engine room). Recalls with no catalogue match collapse to one line.
>
> **Ship in steps:** each lands green and deploys. Send me a SHA per step with screenshots at 1440 and 390 (fresh visitor, plus a sandbox with a few orders from Kitchen, /request and chat). Make sure it holds at 10× demo size.

**NEEDS from others (doors for `CallContext.origin`):** /request `request` (B, `src/lib/server/request`), chat `chat` (E, `/api/chat/*`), MCP/REST outside agents `agent` (lead, `server/auth` `resolveKey`/`contextFor`), menu → plan `menu` (B/menu-v2). Each is one line where the door builds its ctx. The sankey's "by source" reads better once these land.

## Risks

- **Reset not followed live** (above): a judge with /ops open in a second tab sees a stale run after Start over until reload.
- **dock-sync smoke red** on prod a9f06ee (not this lane); re-run after E/1f's next merge.
- Service status is per process (idle after a deploy until called). `Plan.origin` exists only on new plans; older plans fall back to createdBy/eventId/via. The basket's week budget counts only this run's orders.
- **Untested:** the race smoke since 3684d29 (no `SMOKE_KEY` in this session; reading it from `.env` is denied: the lead or the user runs it); Orders and the basket on a run with many kitchens on prod; gap-repair resync against a live Postgres outage.
- The rework touches `src/routes/ops/**` only, but the sankey adds `d3-sankey` (approved) to `package.json` (a shared file: ask the lead to merge it or send it as its own commit).

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

- **Worktree:** `../junc26-lanes/ops`, branch `lane/g17` (head in `git log -1`); `pnpm i`; `.env` and `data/valio/` copied from the main checkout. Dev server: `DATABASE_URL= pnpm dev --port 5176 --strictPort`.
- **Checks (gate rule from Sat 19:00):** `pnpm check && pnpm lint` plus targeted tests (`npx vitest run src/routes/ops src/lib/core/services src/lib/server/bus src/lib/server/demo src/lib/server/tools`), then send the SHA. The lead runs the only full gate.
- **Deploy:** `aiven_application_redeploy` (junction26jq / mandate, branch main) → wait for `/healthz` `commit` → `scripts/deploy/warm.sh` → `SMOKE_UI=1 EXPECT_DB=ok scripts/deploy/smoke.sh <url>` from the main checkout (no `SMOKE_KEY` here: the race check needs the lead or the user).
- **Scripts in `scratch/`** (gitignored): `ops-sweep.mjs` (raw-id rules over every Ops tab), `orders-shot.mjs`/`demand-shot.mjs` (screenshots with an ordered plan), `events-check.mjs`, `veg-check.mjs`, `behaviour-check.mjs`, `request-check.mjs`.
- **Fixtures:** `src/routes/ops/fixtures/seeded-ops.ndjson` (the seeded Christmas run), `src/lib/core/services/fixtures/ordered-ops.ndjson` (an outside agent's by-line order, refused once, signed, placed).
- **Production build without Aiven:** `pnpm build && scripts/deploy/serve-fixture.sh` (:4177), then `GATE_URL=http://localhost:4177 npx playwright test -c scripts/deploy/pw-gate.config.ts` (visitor gate).
- **Aiven:** project `junction26jq`; prod app `mandate` (https://widely-many-scorpion.eur-1.aiven.app); staging `mandate-staging` (branch `staging`); Postgres `pg-1dfeeeed`; rollback branch `rollback`.
- **`.env` keys (names only; copy the file from the main checkout, never print it):** `DATABASE_URL` (blank for dev), `SMOKE_KEY`, `JUDGE_KEY_SECRET`, `VALIO_API_KEY`, `GEMINI_API_KEY`, `EXA_API_KEY`, `CONTEXT_DEV_API_KEY`, `LLM_PROVIDER`, `VISITOR_CAP`, `PUBLIC_ORIGIN` (set in the Aiven console: env updates replace the whole list).
- **Scratch checks for this checkpoint:** `node scratch/live-tabs.mjs <url>` (cross-tab live order + reset follow), `node scratch/a9f-checks.mjs <url> <outdir>` (Start over, bill grid, calendar).

## Report (ring 6, S4)
- Sat 22:20 · deployed main 2a26437 (user OK), warm OK · ready yes
- Sat 22:40 · R12-09: Ops loads stored traces; Engine room "Outside calls, last hour" with byMode/liveOk · 4b68af6 · merged wave A
- Sat 23:10 · D24 Room view (join code via publicOrigin, stores sorted and folded, orders arriving, shortage per store; reads S1's 'notice' events) · 76fe47f · merged wave B
- Sat 23:40 · deployed 8844465 (wave A) and 0eaa1b2 (wave B), warm OK; the user allows deploys on the lead's "gate green" from now on
- Sun 00:00 · Ops follows a reset in another tab (Orders/Demand keyed on run); S5 P1 KPI vs cards (withApprovals) · ready yes
- Sun 00:30 · D27 stock model in src/lib/core/stock (10 tests, 10x) + Forecast tab; Flow tab (sankey, no new dep); op/seq numbers System-only · fb9080a · ready yes
- Sun 00:45 · wave C deploy e88ff05: Aiven registry push failed ("authentication required"), retried · needs: plan bump only with the user's OK (load: ~1.1 s per concurrent planner on 1 vCPU; code is the lever)
