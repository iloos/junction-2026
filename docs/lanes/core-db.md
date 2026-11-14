# Lane: core-db

**Branch:** `lane/core-db` · **Worktree:** `../junc26-lanes/core-db` · **Dev port:** 5172 · **Owner:** peer session junc26-8d

## Goal (one sentence, user-visible)
Every tool in the registry works for real on PGlite (and Aiven): quote, plan an event, place, approve and commit orders under the mandate, and find ranked substitutes, so evals s1–s5 pass.

## Context to read first (≤4 files)
- docs/concept/ARCHITECTURE.md (command flow, rules the handlers enforce, ranking, demand)
- src/lib/core/contracts/{plan,tools,ops}.ts, src/lib/core/ports.ts, src/lib/core/state.ts
- evals/README.md, fixtures/seeds/christmas-buffet-140.json
- docs/foundations/valio-data.md §3–6

## Owned paths (only these may be edited)
- src/lib/core/{demand,mandate,rank,services}/**
- src/lib/server/store/**, src/lib/server/adapters/{catalog,simulator}/**, the seed loader
- evals/** (runner + adapter, `pnpm eval` via Needs)
- tests for the above

## Contracts used (read-only)
`ToolHandlers`, `Ports` (Catalog, Simulator, Store, Clock), `applyOps`, Drizzle schema, seeds in fixtures/seeds/.

## Tasks (each ends in a commit and a SHA to the lead)
- [x] Slice 1: Valio catalog adapter (normalised catalogue, cache-through offers, D6 availability kinds, cents), simulator overlay, `quote` + `search_products` handlers with scope and input checks
- [ ] Slice 2: Drizzle store on PGlite (transact, idempotency, budgets, op seq), `place_order` + mandate tiers + `approve` + `commit_order` + `get_plan` + `set_mandate`; simulator `consume`
- [ ] Slice 3: seed loader (EventSeed), `plan_event` + demand + `edit_line` + `explain_line`
- [ ] Slice 4: `find_substitutes` + rank (frozen formula), make-in-house substitutes
- [ ] Eval adapter: s1–s5 through the handlers on PGlite; `pnpm eval`

## Acceptance (observable)
- [ ] `pnpm check` and `pnpm vitest run --project server` pass
- [ ] `pnpm eval` reports s1–s5 all keys pass on PGlite
- [ ] Works with no Valio key (cache-only fixture)

## Out of scope
UI, MCP/REST serving (agent lane), Gemini fit (Decide port, agent lane; rank uses `fit` when given).

## Needs (requests to the lead)
- `package.json` script `"eval": "node evals/run.ts --adapter fixture"` once the adapter lands.
- Deploy: the container needs `data/valio/` (normalised catalogue + cache, not in git) or live mode with `VALIO_API_KEY`; the adapter builds `data/valio/normalized/products.json` on first load (~1 s, 350 MB heap once).

## Report
- Sat 14 Nov ~05:30 · done: slice 1 (catalog adapter, overlay, quote/search handlers, 7 tests) · stubbed: other tools return PROVIDER_UNAVAILABLE "not implemented yet" · needs: above · ready to merge: yes

## Handoff (Sat 14 Nov)

**Owned paths and branch.** `src/lib/core/{demand,mandate,rank,services}/**`, `src/lib/core/scenario.ts`, `src/lib/server/store/**`, `src/lib/server/adapters/{catalog,simulator,decide}/**`, the seed loader, and their tests. Worktree `../junc26-lanes/core-db`, port 5172. I work on short branches cut from `main` (latest: `review-8d`, merged); `lane/core-db` is historical. The task list above is stale: slices 1–4 and the eval adapter are all done and merged.

**State (main 5615a58).** All tools run for real on PGlite and Aiven. One validator (`core/mandate/validate.ts`) serves tiering, ranking and commit. The hard limit and `qty_implausible` are in place, and so are the seeded-dish substitute pool and scenario dates (`onScenario`). There's a Decide memo, previews run concurrently, and fit is skipped with fewer than 2 survivors. Server suite: 247 passed / 7 skipped. The pg race passes 4/4 opt-in. Open findings are in SYNTHESIS F5, F8–F11, F22, F23, F29, F31 (memo latency) and F32. Track A is mine.

**Why things are the way they are**
- **Hard limit:** `hardLimitCents(m) = m.hardLimitCents ?? max(5×orderCap, 2×weeklyCap)`, which gives k-hotel €8,000, lounas €10,000 and central €16,000. A single line over it is a forbid in the validator. An open order whose total is over it gets every orderable line set unorderable in `tier.ts` (ruling 8: keep). `adversarial.test` uses qty 100 and `request/cases.test` expects 1,000,000 L to be `over_hard_limit` for this reason. Don't "fix" those tests back.
- **Substitute pool:** a dish the seed knows (seed candidates or a rescue) draws only from seed candidates, rescue alternatives/chosen and `fromValioRule`. Category neighbours are used only for unknown dishes. That is the graham-pie / pork-kidney fix (`pool.test.ts`). Open-request dishes (Track B) hit the neighbour path, so they need 1f's retrieval.
- **Dates:** the Valio cache holds November dates. Both catalog adapters re-date them in `offers(ids, deliverBy)`: `availableDate = deliverBy`, and the cut-off is D-1 (Stock) / D-2 (Terminal) at Valio's time of day (17:00 when missing), with the Helsinki offset. The raw value is kept in `raw`, and a note goes in `provenance.note`. `SCENARIO.cutoff` (Tue 8 Dec 15:00) must equal the earliest line cut-off (`dates.test.ts` invariant). Ops queue deadlines read these too.
- **"Now" means `ports.clock.now()`** (the scenario clock, 9c), never `Date.now()`. This matters for F9 (cut-off at commit) and F29.
- **Decide memo:** per process, keyed by `replayKey`, sharing in-flight promises. It stores only gemini answers (a fixture answer never masks a later live one) and holds at most 2,000. A hit reports the original `latencyMs` (F31).
- **Mixed commit (1f's baseline change, `core/services/orders.ts` commit):** with a granted approval it buys `granted.lineIds ∪ act lines`, but stamps `{approvalId}` on all of them (F8, ruling 5: per-line authority).

**Open threads, in order (Track A, after T0 contracts)**
1. **F5 supply tier** (D8): confirmed stock or make-in-house from confirmed ingredients comes before unknown supply, lexicographically, in `core/rank/rank.ts`. Unknown candidates stay visible and labelled. Test: lanttulaatikko → make_in_house (or a Stock option), and 462157 is ranked but below it. On prod before the pool fix, graham pie outranked 462157, so the pg and file catalogs may disagree on 462157. Check it with a prod smoke.
2. **F8 per-line authority** on `Order.lines[]`, plus a mixed-commit test (`granted ∪ act`, each line's authority, the weekly cap on act lines).
3. **F11** zero demand → no line (`toLot` minimum is 1 lot). **F22** default `deliverBy` in `quote` to the scenario delivery date; wire `expectedQty` from plan needs into tiering.
4. **F9** cut-off at commit (before / at / after, against the scenario clock). **F10** direct-order Need in physical units (1 L → 2 × 0.5 L). **FulfilmentView** + **F29**.
5. **If time:** F23 (consumed stock quoted as committable), a Decide memo test, and the pg race in the deploy smoke.

**Traps**
- Run the tests with the DB off: `DATABASE_URL= pnpm vitest run --project server`. Otherwise they hit Aiven.
- Failures that each take ~11 s with several sessions running are load timeouts. Rerun before debugging.
- After a rebase that changes deps, run `pnpm i --frozen-lockfile` in the worktree. svelte-check fails on missing imports otherwise (d3-transition). Never symlink `node_modules`.
- Any new offers path must call `onScenario`. If it doesn't, Ops deadlines and F9 read November dates and every line looks expired.
- Kitchen-lane files (`src/lib/kitchen/**`) are not mine. During a rebase, take main's version.

**Resume**
- `cd ../junc26-lanes/core-db && git fetch && git checkout -b <topic> main && pnpm i --frozen-lockfile`.
- The worktree needs `.env` and `data/valio/` copied from the main checkout (names only, never read values).
- Commands: `pnpm check`, then `DATABASE_URL= pnpm vitest run --project server`, `pnpm eval`, and `pnpm test:pg` (Aiven race, needs `DATABASE_URL`).
- Prod: https://widely-many-scorpion.eur-1.aiven.app (ws-judges).

**Only I know.** My session scratchpad has `tools/mcp-judge.mjs` (not in the repo). It drives prod `/mcp` as the first `judge`/`external_agent` entry in `MCP_KEYS` (it reads the env and never prints the key) and runs initialize → tools/list → quote → place_order → approve (refused) → commit (FORBIDDEN). Rebuild it from that description for the post-Track-A prod smoke. My earlier "/request takes 10–12 s" number was a measurement error (a fixed 9 s wait). Plan → visible was 7.07 s on 39ef642 and hasn't been re-measured since 2d8ce0f.
