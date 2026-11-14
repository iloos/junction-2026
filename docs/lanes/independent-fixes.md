# Lane: independent fixes

**Branch:** `lane/independent-fixes` · **Worktree:** `scratch/worktrees/independent-fixes` under the main checkout (gitignored) · **Dev port:** 5197 · **Owner:** Codex independent-review session · **Base:** `8844465`

**Pinned blobs:** schema `8e9534b208e3de328e68016c2e9bf1cccafb3cf2`; kitchen seed `2417ff63012a0f25edd25a075f432273d3d27424`.

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
- [x] Initialize durable web state before enqueue and refuse acknowledgement on failed persistence.
- [x] Read claimed recall work from the database so a second worker can process it; persist disposition before lease release and keep healing from completing another worker's list.

## Acceptance
- Focused regression tests for failed upsert/delete, retry, concurrent flush order and hydration differences.
- Signed webhook tests for cold start and unavailable durable storage, without live APIs.
- PGlite test for claim/drain across two independent queue views where feasible.
- `pnpm gate --only check,lint` plus relevant web tests in fixture mode; no production database.
- No UI changes, dependencies, migrations, deployments, main merges or pushes.

## Needs
- Lead integration after the lane is green. Work is bounded to web delivery; S1–S5 keep their current paths.
- **S5/lead integration requirement:** remove only `R8-web-write` and `R8-queue-claim` from `src/lib/server/evals/adversarial.test.ts`'s OPEN map with this branch. Both now pass as ordinary assertions; leaving them marked `it.fails` makes the full gate red. This lane did not edit S5's eval paths. Preserve any other OPEN entries added in the meantime. On this base, the resulting declaration is `const OPEN: Record<string, string> = {};`.

## Report
- Started from `8844465`; all three bounded fixes implemented. No main checkout changes, UI changes, live service calls, dependency/schema changes, merges or pushes.
- 23:00 · done: persistence retry/order/snapshot fixes (`2306b0f`); 13 targeted tests passed (8 new + 5 existing), check/lint GREEN · needs: retire R8-web-write at integration · ready: yes with the eval-map update. No live services or dataset required.
- 23:06 · done: webhook cold-start/failure acknowledgement (`7bef3ce`); 13 signed-request tests passed, including startup/write recovery on redelivery; check 0 errors/warnings. No external calls.
- 23:12 · done: atomic claim documents, adopted durable baselines, retry metadata, durable lease release and healing ownership guard; independent read-only review found no blocker · all web tests: **108 passed / 3 skipped**, including **27 new tests**; both R8 probes **2 passed** with ADV_SHOW; check/lint **GREEN**, final-source svelte-check **0 errors / 0 warnings** · ready: yes with the two-flag eval-map integration above.

## Handoff

- Merge/cherry-pick this branch's three commits in order; the lead owns integration and the full gate. All commits are local and available through the shared Git object store.
- Commands (from this worktree, `DATABASE_URL=` blank, `LLM_PROVIDER=fixture`): `pnpm gate --only check,lint`; `pnpm exec vitest run --maxWorkers=1 src/lib/server/web`; `ADV_SHOW=1 node node_modules/vitest/vitest.mjs run --maxWorkers=1 src/lib/server/evals/adversarial.test.ts -t 'R8-web-write|R8-queue-claim'`. On Windows use `pnpm.cmd`; use direct Node for the regex command so a .cmd wrapper cannot interpret the pipe.
- Raw logs: `scratch/check-lint-final.log`, `scratch/check-final-source.log`, `scratch/web-all-tests.log`, `scratch/r8-both.log` (gitignored). No server is running. Worktree dependencies were installed independently; `.env` was never copied. Valio fixture files were copied locally for the existing web tests and remain gitignored.
- Remaining bounds: stale-file authority during general startup hydration is unchanged; this is not an exactly-once queue across expired leases or newer changes to an in-flight notice. A sink must be detached/replaced only after the persistence barrier settles (current production never detaches). Those are future hardening tasks, not claims made by this patch.
