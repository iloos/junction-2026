# Lane: core-db (Track A: the purchasing core)

## Dispatch
- **Track:** A (docs/DISPATCH.md). **Owner:** session 8d. **Worktree:** `../junc26-lanes/core-db`, one short branch per increment cut from `main` (`lane/a-*`). **Dev port:** 5172.
- **Owned paths:** `src/lib/core/{demand,mandate,rank,services}/**`, `src/lib/core/{scenario,state}.ts`, `src/lib/server/store/**`, `src/lib/server/adapters/{catalog,simulator,decide}/**`, their tests. Contract edits (`src/lib/core/contracts/**`) go to the lead as their own commit.
- **Depends on:** B for the chef-reviewed `MenuProposal` (A4); 9c for the scenario clock and visitor workspaces.
- **Acceptance:** `pnpm gate` (`node scripts/merge-gate.mjs`) green.

## State (on main, plus `lane/a4-core`)
- **Gate:** one validator (`core/mandate/validate.ts`) for tiering, ranking and commit. Hard limit `hardLimitCents` = max(5× order cap, 2× weekly cap) unless set; one line or the total over it is forbidden, and the plan still reports its total. `qty_implausible` above 20× a dish need (`seedNeedQty`, at quote and commit) or 500 of the largest pack.
- **Approvals:** `approve{lineIds}` splits an approval by reason group: the decided lines keep the id and the rest move to a new pending approval. A commit is covered line by line by the granted groups of the current version; `Order.lines[].authority` names the mandate or the approval. `Approval.bound` keeps the shown terms; `get_plan.lastVoided` diffs them against the plan now. A commit that loses to another key returns `STALE_VERSION`.
- **Ranking (D8):** lexicographic, `known_stock` before `unknown_stock`, then the D6 score; fit reorders within a tier. A seeded dish's pool is its seed candidates, rescue items and Valio rules only. A make-in-house recipe beats a product no better than unknown supply when every ingredient is orderable: known stock, or Valio ≥999999 (D8a). Lanttulaatikko is made in house, 4 of 5 ingredients unstated. An apply with nothing qualifying writes nothing.
- **Cut-off (A3):** tiering forbids a line whose offer `closingTime` ≤ `ports.clock.now()` (`cutoff_passed`). A commit naming one is refused (`FORBIDDEN`/`cutoff`); a default commit records the re-quote (approvals void) and still buys the mandate's lines. Views are committable only as of now (cut-off passed → closed; expired grants → approve again).
- **Menu plans (A4):** `plan_event{proposal:{id,revision}}` plans only a revision whose stored review record matches its digest (`menuDigest` in `core/demand/menu.ts`, same formula as `server/menu/store.ts`), else `FORBIDDEN`/`review_required`. One need per dish ingredient (`Need.source` lineage; need id carries the ingredient id), each pinned product sized by `sizeDirect` into a `buy` line (`Line.strategy`); no product or unknown pack content → `Need.unresolved`. `Plan.source` names the revision; `planEvent(..., { taskId })` sets `Plan.taskId`. Amount edits by need re-size from the proposal.
- **Demand:** zero demand buys nothing (the line stays `rejected` at qty 0). `place_order` `amount` is the demand: the server sizes it, refuses a disagreeing qty with `computedQty`, and records a `direct` need; substitutes are sized to the amount.
- **Read models (every tool output):** `LineView` (`knownStockCover`, `unknownStockCover`, `physical`, `unitPrice`, `comparisonPrice`); `Plan.view` (`asOf`, `mandateVersion`, `validUntil`, `fulfilment[]`). FulfilmentView is an exact partition allocated by certainty; a recipe is one AND contribution (scarcest ingredient, least certain bucket). Pure in `core/mandate/fulfilment.ts`; facts are gathered in `core/services/views.ts`.
- **Shared helpers:** content per sales unit `core/demand/content.ts` (name vs pack hierarchy vs Valio net weight, cross-checked; request re-exports it); `roundToLots` in `rounding.ts`; `addDays`, `scenarioDate`, `defaultDeliverBy`, `onScenario` in `core/scenario.ts`.
- **Store:** state cached per (workspace, run) while `workspaces.last_seq` is unchanged; approvals and orders are read for the run's plans only. Frozen under tests.
- **Fixtures:** `fixtures/views/{christmas-rescued,milk-direct}.json` come from real tool outputs: `WRITE_VIEW_FIXTURES=1 DATABASE_URL= pnpm vitest run --project server src/lib/server/store/views-fixture.test.ts src/lib/server/store/direct.test.ts`, then `npx prettier --write fixtures/views/*.json`.

## Open (in order)
1. Substitute kind (a): `core/demand/basekey.ts` (BaseKey from the name; `substituteKind`, `whatChanges`). Contract ecfb39c. Then fill it at normalise, wire it into candidates, report coverage in valio-data.md.
2. `set_mandate` stays on hold (the lead's ring-3 synthesis).
3. Read caching: `store.kitchens` (16× per visitor) and catalogue product docs (23×).

## Traps
- Run tests with the DB off: `DATABASE_URL= pnpm vitest run --project server`; otherwise they hit Aiven. The Postgres race test is opt-in: `pnpm test:pg`.
- "Now" is `ports.clock.now()`. Every offers path re-dates through `onScenario` (both catalog adapters do, defaulting to `SCENARIO.delivery`); a new path that skips it shows November cut-offs, and A3 refuses everything. Tests that order for November dates need a November clock (`createDbPorts({ now })`): the default is the scenario start, Mon 7 Dec 21:40.
- State is shared and cached: never mutate what `load`/`transact` return (applyOps returns a new state). Tests freeze it.
- Known stock is not supplier-confirmed (D10): only a receipt confirms (`FulfilmentView.supplierConfirmed`).
- A recipe's allocation appears on each ingredient line; sum the FulfilmentView buckets, never the allocations.
- Under parallel gates PGlite hooks slow down; the server project's timeout is 120 s. Rerun before debugging a timeout.

## Resume (14 Nov, Ring 4 checkpoint)
- **Branch:** `lane/a-atp`. Head is in the Report line below. Everything through 81c3fb7 is gated green and sent to the lead; main merged up to 8094dc3 (04c4394).
- **Since Ring 3:**
  - change_date in LineView; contention re-rescue (`services/contention.ts`).
  - R9/R7 fixes:
    - NeedRequirements bind rank, quote and commit.
    - superseded originals; amount edits (refused across dimensions, with the converted amount when the product's own density is known).
    - dish dependency closure; off_delivery_day; run fence in `transact`.
    - Valio per-adapter semaphore and 429 30 s pause.
    - receipts confirm their qty; supply in the terms hash; CAUTION.model_fit.
  - Valio's answers: ≥999999 unknown, lot step 1, D8a.
- **Next:** (1) finish substitute kind (a), gate, send. (2) Read caching. (3) Whatever the Ring 4 synthesis assigns.
- **Handed off:**
  - E: chat resize → `edit_line{needId, patch.amount}`; core `nextActionFor`; R9-03 and R8-next-action close with that.
  - 1f: reason labels for requirement_unmet, off_delivery_day, superseded, CAUTION.model_fit; the "rescued · stock unstated" chip; the contention wiring in `kitchen/live.ts`.
  - lead: re-normalise and re-seed prod's catalogue (normaliser v3: density, ≥999999, lot step).
- **Traps:** run dev and tests with `DATABASE_URL=` (the worktree `.env` is prod). The gate yields to the main checkout's gate. Never edit files while this worktree's gate runs. Tests that need known-stock milk/cream/butter set it through the simulator overlay, since Valio states none.

## Self-review (Ring 4)
- **Solid:** the shared validator is the single rule for rank, quote and commit (requirements, calendar, cut-off, hard limit). The run fence and terms hash make stale or drifted approvals fail closed. Each R7/R9 fix has a test that flips its probe.
- **Fragile:**
  - The terms hash now includes non-known supply. Any approval granted on unknown stock before this deploy voids once at the next commit.
  - `findSubstitutes` has grown option flags (keep, keepOriginal, coveredServedKg, exclude); the contention split leans on them.
- **Untested on prod:** the 429 pause and the semaphore against real Valio, the run fence across two real instances, and density conversions on a non-seeded catalogue.
- **With one more hour:** an end-to-end prod walk of contention → split → approve → commit, plus a test that the ham story reads the same in the kitchen, Ops and MCP after the ≥999999 change.

`git fetch && git checkout -b lane/a-<topic> main && pnpm i --frozen-lockfile` in the worktree (never link `node_modules`). Copy `.env` and `data/valio/` from the main checkout. `pnpm check`, then `DATABASE_URL= pnpm vitest run --project server`, then `pnpm gate`. Prod: https://widely-many-scorpion.eur-1.aiven.app; an MCP smoke as the judge key reads `MCP_KEYS` from `.env` via `node --env-file=.env`.
