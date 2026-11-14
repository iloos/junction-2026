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
1. R11-04: return a saved command result without a fresh quote (orders.ts preflight before the idempotency check).
2. R11-09: rank by price on a common physical basis or total cost to satisfy, else say so (with B's rank-by).
3. R11-10 + kinds with 91: pack/brand only for supported identity; apply 91's base-gap list to basekey.ts (origin and grade tokens, shared heads ≥ 5 letters, joined compounds, short bases, synonyms, category not required); flip substitute-kinds.test.ts.
4. `facets(product)` as meets()'s evidence layer, using Valio's keyIngredients (needs the normaliser to keep them).
5. "Valio suggests" decision-options contract; R10-05 contention residual in the need's unit; R10-06 recipe partial receipts; R10-08 calendar DTSTART.
6. Every place_order line makes a need (today only lines with amount, requirements or ask do).

## Traps
- Run tests with the DB off: `DATABASE_URL= pnpm vitest run --project server`; otherwise they hit Aiven. The Postgres race test is opt-in: `pnpm test:pg`.
- "Now" is `ports.clock.now()`. Every offers path re-dates through `onScenario` (both catalog adapters do, defaulting to `SCENARIO.delivery`); a new path that skips it shows November cut-offs, and A3 refuses everything. Tests that order for November dates need a November clock (`createDbPorts({ now })`): the default is the scenario start, Mon 7 Dec 21:40.
- State is shared and cached: never mutate what `load`/`transact` return (applyOps returns a new state). Tests freeze it.
- Known stock is not supplier-confirmed (D10): only a receipt confirms (`FulfilmentView.supplierConfirmed`).
- A recipe's allocation appears on each ingredient line; sum the FulfilmentView buckets, never the allocations.
- Under parallel gates PGlite hooks slow down; the server project's timeout is 120 s. Rerun before debugging a timeout.

## Resume (14 Nov night, checkpoint)
- **Branch:** `lane/a-atp`, rebased on main 35fd83e and pushed. Head is in the lead message (f31e4d2 or later). Rule since 19:00: lanes run `pnpm gate --only check,lint` plus targeted vitest; only the lead runs the full gate.
- **Done since Ring 4:**
  - Contracts (all additive): ecfb39c BaseKey/kinds, f96db0e order requirements/best try, a8153c0/685f7b1/dc855e9 D16 (diet, excludes, RequirementCheck, Line.unmet, requirementsFrom, find_substitutes requirements), 362edd4 D18 (Need.ask, kind 'sales', exceeds_need, need_size_unknown, commandKey).
  - Logic: ce5f37e kinds; 8fd0f4d dueOf; 39d2368 order-scope requirements + best try + relax; 6643b30/0a248d1 meets() as the one evaluator (validator, ranking, substitutes; dish codes → needs; refusals with detail); 942c646 R10-03/04; 1afb1b5 sales-unit needs (R11-02 core); 7256982 line binding (R11-01) + R11-05; f31e4d2 the 68-product facets eval (0 unsafe oks).
- **Handed off:**
  - B: request orderLine sends `ask`/requirements without amount.
  - E/B/Kitchen: switch to core `commandKey`.
  - da: builds on RequirementCheck and the refusal detail.
  - 1f: reason labels for requirement_unknown, exceeds_need, need_size_unknown, requirement_relaxed.*; "rescued · stock unstated".
  - lead: re-seed prod's catalogue (normaliser v4).
- **Chat replays:** any tool *input* schema change misses the recorded f* sessions (the planner prompt embeds input schemas). Re-record: `CHAT_LIVE=1 CHAT_RECORD=1 LIVE_ONLY=f LLM_PROVIDER=gemini DATABASE_URL= node --env-file=.env node_modules/vitest/vitest.mjs run --project server src/lib/server/evals/chat-free.test.ts`.
- **Traps:** run dev and tests with `DATABASE_URL=`. Never edit files while this worktree's gate runs. Never `cat >` without a heredoc (it waits on stdin and looks like a hang).

## Self-review (checkpoint)
- **Solid:** one evaluator (meets) for every hard requirement, at rank, quote and commit, with the fact behind each refusal. Lines are bound to their need's amount. Each R9–R11 fix has a test that flips its probe.
- **Fragile:**
  - Diet judgement leans on category prefixes and name words. The eval set holds (0 unsafe), but coverage is 57/68 and prepared foods without a diet tag hold.
  - `findSubstitutes` carries many options (keep, keepOriginal, coverage, exclude, per-call requirements, best try).
  - D18's "every entry makes a need" is partial.
- **Untested on prod:** the dish-code requirements on the lunch kitchen, `exceeds_need` against real request flows, and the 429 pause.
- **With one more hour:** R11-04 (saved results without a re-quote) and the kinds reconciliation with 91.

`git fetch && git checkout -b lane/a-<topic> main && pnpm i --frozen-lockfile` in the worktree (never link `node_modules`). Copy `.env` and `data/valio/` from the main checkout. `pnpm check`, then `DATABASE_URL= pnpm vitest run --project server`, then `pnpm gate`. Prod: https://widely-many-scorpion.eur-1.aiven.app; an MCP smoke as the judge key reads `MCP_KEYS` from `.env` via `node --env-file=.env`.
