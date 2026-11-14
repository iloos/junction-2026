# Lane: core-db (Track A: the purchasing core)

## Dispatch
- **Track:** A (docs/DISPATCH.md). **Owner:** session 8d. **Worktree:** `../junc26-lanes/core-db`, one short branch per increment cut from `main` (`lane/a-*`). **Dev port:** 5172.
- **Owned paths:** `src/lib/core/{demand,mandate,rank,services}/**`, `src/lib/core/{scenario,state}.ts`, `src/lib/server/store/**`, `src/lib/server/adapters/{catalog,simulator,decide}/**`, their tests. Contract edits (`src/lib/core/contracts/**`) go to the lead as their own commit.
- **Depends on:** B for the chef-reviewed `MenuProposal` (A4); 9c for the scenario clock and visitor workspaces.
- **Acceptance:** `pnpm gate` (`node scripts/merge-gate.mjs`) green.

## State (on main, plus `lane/a-cleanup`)
- **Gate:** one validator (`core/mandate/validate.ts`) for tiering, ranking and commit. Hard limit `hardLimitCents` = max(5× order cap, 2× weekly cap) unless set; one line or the total over it is forbidden, and the plan still reports its total. `qty_implausible` above 20× a dish need (`seedNeedQty`, at quote and commit) or 500 of the largest pack.
- **Approvals:** `approve{lineIds}` splits an approval by reason group: the decided lines keep the id and the rest move to a new pending approval. A commit is covered line by line by the granted groups of the current version; `Order.lines[].authority` names the mandate or the approval. `Approval.bound` keeps the shown terms; `get_plan.lastVoided` diffs them against the plan now. A commit that loses to another key returns `STALE_VERSION`.
- **Ranking (D8):** lexicographic, `known_stock` before `unknown_stock`, then the D6 score; fit reorders within a tier. A seeded dish's pool is its seed candidates, rescue items and Valio rules only. A make-in-house recipe beats a product of unknown supply when every ingredient is known stock (lanttulaatikko → make in house, verified on prod). An apply with nothing qualifying writes nothing.
- **Demand:** zero demand buys nothing (the line stays `rejected` at qty 0). `place_order` `amount` is the demand: the server sizes it, refuses a disagreeing qty with `computedQty`, and records a `direct` need; substitutes are sized to the amount.
- **Read models (every tool output):** `LineView` (`knownStockCover`, `unknownStockCover`, `physical`, `unitPrice`, `comparisonPrice`); `Plan.view` (`asOf`, `mandateVersion`, `validUntil`, `fulfilment[]`). FulfilmentView is an exact partition allocated by certainty; a recipe is one AND contribution (scarcest ingredient, least certain bucket). Pure in `core/mandate/fulfilment.ts`; facts are gathered in `core/services/views.ts`.
- **Shared helpers:** content per sales unit `core/demand/content.ts` (name vs pack hierarchy vs Valio net weight, cross-checked; request re-exports it); `roundToLots` in `rounding.ts`; `addDays`, `scenarioDate`, `defaultDeliverBy`, `onScenario` in `core/scenario.ts`.
- **Store:** state cached per (workspace, run) while `workspaces.last_seq` is unchanged; approvals and orders are read for the run's plans only. Frozen under tests.
- **Fixtures:** `fixtures/views/{christmas-rescued,milk-direct}.json` come from real tool outputs: `WRITE_VIEW_FIXTURES=1 DATABASE_URL= pnpm vitest run --project server src/lib/server/store/views-fixture.test.ts src/lib/server/store/direct.test.ts`, then `npx prettier --write fixtures/views/*.json`.

## Open (in order)
1. **A3, cut-off at commit (F9):** refuse a line whose offer `closingTime` is past `ports.clock.now()` (scenario clock, never `Date.now()`); test before / at / after. F29: `committable` only as of `Plan.view.asOf`.
2. **A4, plan from a reviewed proposal:** `plan_event{proposal:{id,revision}}` checked against `MenuStore.review`; dishes → needs with `Need.source` lineage → lines with `Line.strategy`. `events.ts` returns INVALID_INPUT for it today.
3. **set_mandate** is in the registry but returns PROVIDER_UNAVAILABLE: implementing it needs a Store method (kitchens live outside `WorkspaceState`); removing it touches mcp/present/facts and the kitchen fixture. Lead's call.
4. Read caching that 9c measured next: `store.kitchens` (16× per visitor) and catalogue product docs (23×).

## Traps
- Run tests with the DB off: `DATABASE_URL= pnpm vitest run --project server`; otherwise they hit Aiven. The Postgres race test is opt-in: `pnpm test:pg`.
- "Now" is `ports.clock.now()`. Every offers path re-dates through `onScenario` (both catalog adapters do, defaulting to `SCENARIO.delivery`); a new path that skips it shows November cut-offs, and A3 would refuse everything.
- State is shared and cached: never mutate what `load`/`transact` return (applyOps returns a new state). Tests freeze it.
- Known stock is not supplier-confirmed (D10): only a receipt confirms (`FulfilmentView.supplierConfirmed`).
- A recipe's allocation appears on each ingredient line; sum the FulfilmentView buckets, never the allocations.
- Under parallel gates PGlite hooks slow down; the server project's timeout is 120 s. Rerun before debugging a timeout.

## Resume
`git fetch && git checkout -b lane/a-<topic> main && pnpm i --frozen-lockfile` in the worktree (never link `node_modules`). Copy `.env` and `data/valio/` from the main checkout. `pnpm check`, then `DATABASE_URL= pnpm vitest run --project server`, then `pnpm gate`. Prod: https://widely-many-scorpion.eur-1.aiven.app; an MCP smoke as the judge key reads `MCP_KEYS` from `.env` via `node --env-file=.env`.
