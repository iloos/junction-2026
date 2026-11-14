# Lane: ops (deploy, Operations, op stream, visitor sandboxes)

## Dispatch

- **Track:** G: sandboxes, Operations, deploy, Aiven. Session 9c.
- **Branch / worktree:** `lane/g6` in `../junc26-lanes/ops`. Dev port 5176, run with `DATABASE_URL=` blank (dev uses PGlite anyway unless `DEV_USE_REMOTE_DB=1`).
- **Owned paths:**
  - `src/lib/server/demo/**`, `src/lib/server/bus/**`, `src/lib/server/db/client.ts`
  - `src/routes/ops/**`, `src/routes/api/events/**`, `src/routes/api/demo/**`, `src/routes/healthz/**`
  - `Dockerfile`, `scripts/deploy/**`, `docs/foundations/deploy.md`
- **Acceptance:** `pnpm gate` green. For anything touching sandboxes, `src/routes/ops/visitor-gate.e2e.ts` green on a production build. For UI, Playwright screenshots at 1440 and 390.

## State

- **Prod:** `mandate` runs main `70c30e2` (`/healthz` reports `commit`). Plan `startup-100-2048`; Postgres `pg-1dfeeeed` is `startup-4` in `aws-eu-central-1`; staging `mandate-staging` builds branch `staging`. About $0.24/h.
- **Smoke:** passes on 70c30e2, including the race check. The prod UI checks pass except 91's BUG-9 "looks fixed" (91 removes it from KNOWN).
- **`lane/g6` @ `f04a722`** (gate GREEN on 70c30e2), not merged:
  - #10: Ops counts decisions (decisionsOf), products that can't be ordered and unresolved needs the way the kitchen does; log and timeline in decisions.
  - `SMOKE_UI=1` in `smoke.sh`.
- **On main already:**
  - per-visitor signed sandboxes, judge keys, presenter session (`?presenter=1`);
  - Ops cases per cause, closing on rescue or commit;
  - timeline, run graph, simulated traces;
  - stale-run fix (5 s run refresh, live stream filtered by run);
  - dev DB guard;
  - `/ops/views` (FulfilmentView coverage);
  - `/healthz` commit.

## Next, in order

1. g6 merged by the lead, then deploy, warm and smoke.
2. **#3 CaseTicket, consequence first** (`docs/handoff/ui-mockset-to-prod.md`):
   - the title is the consequence; `decisionsOf` already writes a consequence sentence per decision;
   - one line of what agents already did (rescues proposed, lines orderable);
   - € held and time to cut-off;
   - only wired buttons (the kitchen deep link).
3. **#5 Engine room:** an Ops tab holding the timeline swimlanes, run graph and traces. The first Ops screen keeps cases and stories only.
4. **#4 "What happened to this case":** a vertical story of the case's ops from `stream.log` (filter by planId), time, actor chip and `opSummary`, with "Technical detail" opening the run graph or raw op. Only if every op type's sentence holds; test on the seeded run and a perturbed one.
5. After: #11 stakes chart, #12 gate paths (counted sources only), #9 product sheet with 1f.

Mocks are in the main checkout at `scratch/ux-mock/ops.html` and `ops-story.png`. Words follow `docs/concept/VOCABULARY.md`. No new dependencies.

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

- **Worktree:** `pnpm i`; `.env` and `data/valio/` copied from the main checkout.
- **Checks:** `pnpm check && pnpm lint && pnpm test:unit --run`, then `pnpm gate` before handing a SHA.
- **Production build without Aiven:** `pnpm build && scripts/deploy/serve-fixture.sh` (:4177; the test chef key is in the script). Then `GATE_URL=http://localhost:4177 npx playwright test -c scripts/deploy/pw-gate.config.ts`.
- **Prod UI checks:** `KITCHEN_URL=<url> npx playwright test -c evals/ui/pw-prod.config.ts`, from the worktree root.
- **Load against prod:** `node scripts/deploy/visitors.mjs <url> 10`. With 10 at once each plan takes about 3.6–3.9 s.
