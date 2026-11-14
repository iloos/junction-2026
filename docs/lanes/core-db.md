# Lane: core-db (Track A: the purchasing core)

## Dispatch
- **Track:** A (docs/DISPATCH.md). **Owner:** session 8d. **Worktree:** `../junc26-lanes/core-db`, one short branch per increment cut from `main` (`lane/a-*`). **Dev port:** 5172.
- **Owned paths:** `src/lib/core/{demand,mandate,rank,services}/**`, `src/lib/core/{scenario,state}.ts`, `src/lib/server/store/**`, `src/lib/server/adapters/{catalog,simulator,decide}/**`, their tests. Contract edits (`src/lib/core/contracts/**`) go to the lead as their own commit.
- **Depends on:** B for the chef-reviewed `MenuProposal` (A4); 9c for the scenario clock and visitor workspaces.
- **Acceptance:** `pnpm gate` (`node scripts/merge-gate.mjs`) green.

## State (on main, plus `lane/a4-core`)
- **Gate:** one validator (`core/mandate/validate.ts`) for tiering, ranking and commit. Hard limit `hardLimitCents` = max(5× order cap, 2× weekly cap) unless set; one line or the total over it is forbidden, and the plan still reports its total. `qty_implausible` above 20× a dish need (`seedNeedQty`, at quote and commit) or 500 of the largest pack.
- **Approvals:** `approve{lineIds}` splits an approval by reason group: the decided lines keep the id and the rest move to a new pending approval. A commit is covered line by line by the granted groups of the current version; `Order.lines[].authority` names the mandate or the approval. `Approval.bound` keeps the shown terms; `get_plan.lastVoided` diffs them against the plan now. A commit that loses to another key returns `STALE_VERSION`.
- **Ranking (D8):** lexicographic, `known_stock` before `unknown_stock`, then the D6 score; fit reorders within a tier. A seeded dish's pool is its seed candidates, rescue items and Valio rules only. A make-in-house recipe beats a product of unknown supply when every ingredient is known stock (lanttulaatikko → make in house, verified on prod). An apply with nothing qualifying writes nothing.
- **Cut-off (A3):** tiering forbids a line whose offer `closingTime` ≤ `ports.clock.now()` (`cutoff_passed`). A commit naming one is refused (`FORBIDDEN`/`cutoff`); a default commit records the re-quote (approvals void) and still buys the mandate's lines. Views are committable only as of now (cut-off passed → closed; expired grants → approve again).
- **Menu plans (A4):** `plan_event{proposal:{id,revision}}` plans only a revision whose stored review record matches its digest (`menuDigest` in `core/demand/menu.ts`, same formula as `server/menu/store.ts`), else `FORBIDDEN`/`review_required`. One need per dish ingredient (`Need.source` lineage; need id carries the ingredient id), each pinned product sized by `sizeDirect` into a `buy` line (`Line.strategy`); no product or unknown pack content → `Need.unresolved`. `Plan.source` names the revision; `planEvent(..., { taskId })` sets `Plan.taskId`. Amount edits by need re-size from the proposal.
- **Demand:** zero demand buys nothing (the line stays `rejected` at qty 0). `place_order` `amount` is the demand: the server sizes it, refuses a disagreeing qty with `computedQty`, and records a `direct` need; substitutes are sized to the amount.
- **Read models (every tool output):** `LineView` (`knownStockCover`, `unknownStockCover`, `physical`, `unitPrice`, `comparisonPrice`); `Plan.view` (`asOf`, `mandateVersion`, `validUntil`, `fulfilment[]`). FulfilmentView is an exact partition allocated by certainty; a recipe is one AND contribution (scarcest ingredient, least certain bucket). Pure in `core/mandate/fulfilment.ts`; facts are gathered in `core/services/views.ts`.
- **Shared helpers:** content per sales unit `core/demand/content.ts` (name vs pack hierarchy vs Valio net weight, cross-checked; request re-exports it); `roundToLots` in `rounding.ts`; `addDays`, `scenarioDate`, `defaultDeliverBy`, `onScenario` in `core/scenario.ts`.
- **Store:** state cached per (workspace, run) while `workspaces.last_seq` is unchanged; approvals and orders are read for the run's plans only. Frozen under tests.
- **Fixtures:** `fixtures/views/{christmas-rescued,milk-direct}.json` come from real tool outputs: `WRITE_VIEW_FIXTURES=1 DATABASE_URL= pnpm vitest run --project server src/lib/server/store/views-fixture.test.ts src/lib/server/store/direct.test.ts`, then `npx prettier --write fixtures/views/*.json`.

## Open (in order)
1. **Valio live cache-through** on the PG catalogue (Ring 2 step 2), then core-current-atp, `nextActionFor(plan)`, `place_order` qty optional (contract commit).
2. **set_mandate** is in the registry but returns PROVIDER_UNAVAILABLE: implementing it needs a Store method (kitchens live outside `WorkspaceState`); removing it touches mcp/present/facts and the kitchen fixture. Lead's call.
3. Read caching that 9c measured next: `store.kitchens` (16× per visitor) and catalogue product docs (23×).

## Traps
- Run tests with the DB off: `DATABASE_URL= pnpm vitest run --project server`; otherwise they hit Aiven. The Postgres race test is opt-in: `pnpm test:pg`.
- "Now" is `ports.clock.now()`. Every offers path re-dates through `onScenario` (both catalog adapters do, defaulting to `SCENARIO.delivery`); a new path that skips it shows November cut-offs, and A3 refuses everything. Tests that order for November dates need a November clock (`createDbPorts({ now })`): the default is the scenario start, Mon 7 Dec 21:40.
- State is shared and cached: never mutate what `load`/`transact` return (applyOps returns a new state). Tests freeze it.
- Known stock is not supplier-confirmed (D10): only a receipt confirms (`FulfilmentView.supplierConfirmed`).
- A recipe's allocation appears on each ingredient line; sum the FulfilmentView buckets, never the allocations.
- Under parallel gates PGlite hooks slow down; the server project's timeout is 120 s. Rerun before debugging a timeout.

## Resume (14 Nov, before compaction)
- **Branch:** `lane/a-atp`, cut from main 70c30e2 (main has since moved to e0c5bb5: rebase first). Commits: ATP 37da22a, Valio traces → caller's drawer ab302b6, `nextActionFor` f56b4d8, contract `FulfilmentView.basis`/`yield` d67f439 (accepted by the lead), served-basis fulfilment 13781f5, this brief. Gate was running on 13781f5 at compaction: rerun it after the rebase.
- **Merged on main:** A3, A4 (menu proposal → plan, `Need.unresolved`), Valio live cache-through (`adapters/catalog/valio-live.ts`, half-open breaker, 15 min availability TTL).
- **On this branch:**
  - ATP: `afterCommits` in `store/db-ports.ts` lowers known amounts by the run's sim_stock, with a note "N already committed in this run".
  - `realHandlers` wraps every call in `inWorkspace`; D's `withExternalScope` wraps outside it, and both stay.
  - `core/mandate/next.ts` `nextActionFor(plan, now)`: change_date → find_substitute → resolve_rule → resolve_need → approve → commit → wait_for_supplier → done, plus `deadline` and `earliestDate`. `earliestDelivery` is in scenario.ts.
  - Served basis: a dish need with a yield reports FulfilmentView in served kg (ham 18.9 kg served, not 27 kg raw).
- **Next, in order:**
  1. Rebase on main, gate, send the SHAs.
  2. E switches its callers from `agent/next-action.ts` to core's. Their kinds map as: substitute→find_substitute, chef→approve, resolve→resolve_rule|resolve_need, await_supplier→wait_for_supplier.
  3. Assess the mandate-change op. The Op union has none, yet the schema says mandate history lives in the op log, and `set_mandate` returns PROVIDER_UNAVAILABLE. Likely a `SetMandate{kitchenId, mandate, version}` op through applyOps with a Store method for kitchens. That needs a contract edit, so ask the lead.
  4. `place_order` qty optional when amount is given: an approved contract change, as its own commit.
  5. Read caching for `store.kitchens` and product docs.
- **Handed off:** the "another kitchen" blame text is 1f's (`kitchen/live-view.ts` ~277/286). Rule sent: simulator provenance → simulated; ATP note → this run; else Valio stock. UIs label served amounts "kg served".
- **Traps:** run dev and tests with `DATABASE_URL=` (the worktree `.env` is prod). The gate yields to the main checkout's gate. Never edit files while this worktree's gate runs.

`git fetch && git checkout -b lane/a-<topic> main && pnpm i --frozen-lockfile` in the worktree (never link `node_modules`). Copy `.env` and `data/valio/` from the main checkout. `pnpm check`, then `DATABASE_URL= pnpm vitest run --project server`, then `pnpm gate`. Prod: https://widely-many-scorpion.eur-1.aiven.app; an MCP smoke as the judge key reads `MCP_KEYS` from `.env` via `node --env-file=.env`.
