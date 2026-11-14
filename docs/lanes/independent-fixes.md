# Lane: independent fixes

**Branch:** `lane/independent-fixes` · **Worktree:** `scratch/worktrees/independent-fixes` under the main checkout (gitignored) · **Dev port:** 5197 · **Owner:** Codex independent-review session · **Base:** `8844465`

## Goal
Make recall persistence and retries reliable without changing purchasing contracts or the active UI/conversation lanes.

## Context
- `CLAUDE.md`, `docs/handoff/ring6/SESSIONS.md`
- `docs/foundations/web.md`
- `src/lib/server/web/{persist,index,pg-state,queue,watch}.ts`
- `src/routes/api/web/contextdev/+server.ts`

## Owned paths
- `src/lib/server/web/persist.ts` and its tests
- `src/lib/server/web/{queue,pg-state,watch,index}.ts` and targeted tests only where needed for durable recall delivery
- `src/routes/api/web/contextdev/+server.ts` and its targeted tests
- this brief
- `docs/review/INDEPENDENT-REPO-2026-11-14.md` (copy of the independent review, if included in handoff)

## Contracts (read-only)
Core ports/contracts, DB schema/migrations, shared handler/scope wiring, package/lockfile, UI, agent/request/menu code.

## Small commits
- [x] Keep failed persistence dirty and make the durability barrier reject failures; serialize writes so stale completion cannot win.
- [ ] Initialize durable web state before enqueue and refuse acknowledgement on failed persistence.
- [ ] Read claimed recall work from the database so a second worker can process it; fix only related queue/retry seams.

## Acceptance
- Focused regression tests for failed upsert/delete, retry, concurrent flush order and hydration differences.
- Signed webhook tests for cold start and unavailable durable storage, without live APIs.
- PGlite test for claim/drain across two independent queue views where feasible.
- `pnpm gate --only check,lint` plus relevant web tests in fixture mode; no production database.
- No UI changes, dependencies, migrations, deployments, main merges or pushes.

## Needs
- Lead integration after the lane is green. Work is bounded to web delivery; S1–S5 keep their current paths.
- S5/lead: retire `R8-web-write` from `src/lib/server/evals/adversarial.test.ts`'s OPEN map with the first fix. Its existing expected-fail assertion now passes. Run `ADV_SHOW=1 ... -t R8-web-write` to verify without changing the map. If the third fix lands, retire `R8-queue-claim` too. This lane does not edit S5's eval paths.

## Report
- Started from `8844465`; implementation and checks pending.
- 23:00 · done: persistence retry/order/snapshot fixes; 13 targeted tests passed (8 new + 5 existing), check/lint GREEN · needs: retire R8-web-write at integration · ready: yes with the eval-map update. No live services or dataset required.
