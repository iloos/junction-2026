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

## Next (in priority order, with acceptance)
1. **R12-02 cereal codes and contradictions** (meets.ts).
   - The gluten codes are AW, UW (wheat), NR (rye), GB (barley), GO (oats). Today meets only knows AW/GLUTEN/WHEAT, so real record 460082 (Kikkoman soy sauce, contains AY, UW) passes `excludes: ['gluten_cereals']`.
   - Export one normalised allergen-group table (milk/gluten/egg… → codes) from core. ui/diet.ts (1f), request lookup and the answers read it.
   - Contradictory evidence (a free-from claim plus a declared allergen of that group) never yields ok.
   - Acceptance: 460082 is `no` for gluten_cereals and freeFrom GLUTEN; a "GLUTEN claim + UW listed" record is `no`; the facets eval stays at 0 unsafe.
2. **R12-04 = R10-05 contention residual** (services/contention.ts).
   - Today contention converts what it keeps only into served kg, so a 4 l direct need with 2 l kept still adds a full 4 l (6 l bought).
   - Compute what the kept part covers in the need's own unit (via `contentValue`), and size the substitute for direct needs to the remainder with `sizeDirect`.
   - Acceptance: kept plus added equals the need in its own unit, plus rounding, for kg, l and pcs. Close probe R10-05 in adversarial-r10.test.ts (its OPEN entry) and tell 91 (junc26-2f).
3. **R11-04: return a saved command result without a fresh quote.** `place_order` and `commit_order` fetch offers before the idempotency check (orders.ts ~194, ~431). Acceptance: retrying an identical completed command while the supplier is down returns the saved result; a conflicting payload under the same key is still DUPLICATE.
4. **R11-10 + kinds with 91.**
   - Use pack/brand only for supported identity; a qualified head match (juusto vs vuohenjuusto) is form or functional with the difference stated. Remove the brand as a whole word, not a substring.
   - Apply 91's base-gap list (origin and grade tokens, shared heads ≥ 5 letters, joined compounds, short bases, synonyms; category not required). Their pairs file: `../f-evals/scratch/kinds-pairs-for-8d.tsv`.
   - Acceptance: `src/lib/server/evals/substitute-kinds.test.ts` accuracy ≥ 0.9, then flip it from `it.fails` to `it`. Write the agreed definition into docs/research/substitutes.md.
5. **R11-09 rank by price on a common basis** (with B's rank-by): price per kg or l from content, or the total cost to satisfy the requested amount including lot rounding; when no basis exists, say so instead of comparing pack prices.
6. **R10-06 recipe partial receipts** (fulfilment.ts recipe branch): use each ingredient's `confirmedQty` with the recipe's limiting ratio. Acceptance: probe R10-06, where 1 of 10 is confirmed on one ingredient and the recipe is not fully confirmed.
7. **R10-08 calendar DTSTART** (core/calendar.ts; c3 added calendarDays there): anchor the receiving series on the first receiving day inside the window. Acceptance: probe R10-08, where a Thursday-only series starts on a Thursday.
8. **facets(product) on Valio keyIngredients**: the normaliser keeps `synkkaData.keyIngredients`, and meets() uses them as first evidence. Acceptance: facets eval coverage above 57/68 at 0 unsafe.
9. **"Valio suggests" decision options** (contract first; 1f renders):
   - The chef's pick (by preference) plus at most two alternatives, at most one of them a "Valio suggests" slot.
   - That slot is a higher-tier or better-value product with a stated reason; it never leaves the mandate or a hard requirement and is never the default. "I don't mind" means the agent picks by preference.
   - Claim no margin.
10. **Every place_order line makes a need** (D18): today only lines with an amount, requirements or an ask do.
11. Glance at da's rankBy edit in services/substitutes.ts (agent-rank rebase). `set_mandate` stays on hold.

## Ideas: where a model or a sponsor would do better than code (noted, not scheduled)
- **Product kind by judgement, not word lists** (15 Nov). meets() falls back to Finnish name words for meat/fish/dairy, which over- and under-catch: 'kana' inside 'porkkana' made carrots meat; 'jauhelihalle' (a seasoning for mince) and 'hedelmälihalla' (juice with fruit flesh) read as meat; 973 products are meat by name only, 145 of them with no meat word in their English name. Better: one batch pass with Gemini Decisions over nameFi + nameEn + category + keyIngredients (~115 calls for 13.5k foods), stored as an enrichment with provenance, read by meets() before the words; checked against the facets eval at 0 unsafe. Language-general without a translation API (Valio gives nameEn for 95%; the model reads Finnish). DeepL only if we show names in more languages.

- **Finnish morphology from a library, not regexes** (15 Nov). retrieval.ts guesses base forms (baseForm) and compound heads (wordSim's endsWith) by hand. Voikko (the Finnish morphology library: compound split, lemma) would make "palvi + kinkku" and "porkkana is not a compound" facts; the Snowball Finnish stemmer is a small JS alternative for baseForm. Voikko's WASM build and dictionary are several MB (needs the lead's clearance); measure on the substitute-kinds and retrieval evals before swapping, since it moves every substitute ranking. Complements the classifier above, doesn't replace it.

## Traps
- Run tests with the DB off: `DATABASE_URL= pnpm vitest run --project server`; otherwise they hit Aiven. The Postgres race test is opt-in: `pnpm test:pg`.
- "Now" is `ports.clock.now()`. Every offers path re-dates through `onScenario` (both catalog adapters do, defaulting to `SCENARIO.delivery`); a new path that skips it shows November cut-offs, and A3 refuses everything. Tests that order for November dates need a November clock (`createDbPorts({ now })`): the default is the scenario start, Mon 7 Dec 21:40.
- State is shared and cached: never mutate what `load`/`transact` return (applyOps returns a new state). Tests freeze it.
- Known stock is not supplier-confirmed (D10): only a receipt confirms (`FulfilmentView.supplierConfirmed`).
- A recipe's allocation appears on each ingredient line; sum the FulfilmentView buckets, never the allocations.
- Under parallel gates PGlite hooks slow down; the server project's timeout is 120 s. Rerun before debugging a timeout.

## Resume (lane restart, 14–15 Nov night)
- **Worktree:** `c:\Users\jiaqi\Documents\.ai\hackathon\junc26-lanes\core-db`, branch `lane/a-atp`, pushed. Final SHA is in the lead message. Everything up to 6570a75 is on main; f882939 (R12-01) and this brief are on the branch. Dev port 5172.
- **Commands:**
  - `pnpm i --frozen-lockfile`.
  - `DATABASE_URL= LLM_PROVIDER=fixture pnpm dev --port 5172`: the worktree `.env` holds the prod DATABASE_URL, so always blank it.
  - Tests: `DATABASE_URL= LLM_PROVIDER=fixture npx vitest run src/lib/server src/lib/core`.
  - Light gate (lanes don't run the full gate): `DATABASE_URL= node scripts/merge-gate.mjs --only check,lint`.
- **Local state:** `.env` (copied from the main checkout; keys used: VALIO_API_KEY, the Gemini/LLM keys, DATABASE_URL — never read values) and `data/valio/` (raw catalogue and normalised cache, normaliser v4).
- **Done tonight (SHAs on main unless noted):**
  - D16 meets() as the one evaluator, RequirementCheck, Line.unmet, refusal detail, dish codes on needs: 6643b30, 0a248d1, dc855e9.
  - D18: Need.ask, sales-unit needs, line binding, commandKey: 362edd4, 1afb1b5, 7256982. need_rounding_large: 241f1ef.
  - Commit replay of a completed command: 10929f5. Dairy and gluten by product identity: 6570a75.
  - Facets eval at 0 unsafe: f31e4d2. R12-01 ask binds: f882939 (branch).
- **In flight:** nothing; no WIP.
- **Handed off:**
  - B: request orderLine sends `ask`/requirements without amount; reason `need_rounding_large`.
  - E/B/Kitchen: switch to core `commandKey`.
  - da: get_context, refusals and dock answers on RequirementCheck and ALLERGEN_NAMES.
  - 1f: reason labels (requirement_unknown, exceeds_need, need_size_unknown, need_rounding_large, requirement_relaxed.*, CAUTION.model_fit, superseded, off_delivery_day); ui/diet.ts to read core's allergen table.
  - lead: re-seed prod's catalogue (normaliser v4).
- **Traps:**
  - Any tool *input* schema change misses the recorded free-text chat replays. Re-record with `CHAT_LIVE=1 CHAT_RECORD=1 LIVE_ONLY=f LLM_PROVIDER=gemini DATABASE_URL= node --env-file=.env node_modules/vitest/vitest.mjs run --project server src/lib/server/evals/chat-free.test.ts`.
  - Never edit files while this worktree's gate runs.
  - In Python heredocs a regex `\b` can land as a backspace byte: fix by byte replacement.
  - `cat >` without a heredoc waits on stdin and looks like a hang.
  - Tests under src/lib/core run in a project without `node:fs`; put catalogue probes under src/lib/server.

## Self-review (checkpoint)
- **Solid:** one evaluator (meets) for every hard requirement, at rank, quote and commit, with the fact behind each refusal. Lines are bound to their need's amount. Each R9–R11 fix has a test that flips its probe.
- **Fragile:**
  - Diet judgement leans on category prefixes and name words. The eval set holds (0 unsafe), but coverage is 57/68 and prepared foods without a diet tag hold.
  - `findSubstitutes` carries many options (keep, keepOriginal, coverage, exclude, per-call requirements, best try).
  - D18's "every entry makes a need" is partial.
- **Untested on prod:** the dish-code requirements on the lunch kitchen, `exceeds_need` against real request flows, and the 429 pause.
- **With one more hour:** R11-04 (saved results without a re-quote) and the kinds reconciliation with 91.

`git fetch && git checkout -b lane/a-<topic> main && pnpm i --frozen-lockfile` in the worktree (never link `node_modules`). Copy `.env` and `data/valio/` from the main checkout. `pnpm check`, then `DATABASE_URL= pnpm vitest run --project server`, then `pnpm gate`. Prod: https://widely-many-scorpion.eur-1.aiven.app; an MCP smoke as the judge key reads `MCP_KEYS` from `.env` via `node --env-file=.env`.
