# Lane: request

**Branch:** `lane/b-request` · **Worktree:** `../junc26-lanes/request` · **Dev port:** 5173 or 5185 · **Owner:** request lane agent (Track B: request UI and menu module)

## Goal
A chef types a purchase request and gets a priced, availability-checked, mandate-tiered order to approve (Valio's Request → Lookup → Order → Approval). When the request is an event ("Christmas dinner for 50 on 20 December"), it becomes a brief, then a menu proposal the chef reviews, then a plan.

## Owned paths
- `src/lib/server/request/**`, `src/lib/server/menu/**`
- `src/routes/request/**`, `src/routes/api/request/**`
- `src/lib/ui/request/**`
- tests beside them

## Contracts used (read-only)
- Tools through `serveTool` (no direct store access); `hardLimitCents`; `toLot` (`core/services/orders`); `scenarioDate`.
- `EventBrief`, `MenuProposal`, `MenuStore`, `Catalog.resolve` (`core/contracts/event.ts`, `core/ports.ts`).
- The page's workspace comes from `visitorWorkspace` / `roomLabel` (`server/demo/visitor.ts`, Track G).
- Others import from this lane: the agent (`parseRules`, `baseId`, `filterHits`, `ParsedItem`, `ReqUnit`), evals (`runRequest`, `contentPerSalesUnit`, `orderAmount`). Keep those signatures stable.

## State
**Purchase requests (`server/request`).**
- `parse.ts`: two parsers, one shape. Rules (EN and FI) always run. The model path (`createLlmRouter(env).for('request.parse')`, JSON) is used when `LLM_PROVIDER` is set, and every disagreement with the rules is shown as an item ambiguity. Constraints the chef typed ("lactose-free") are read from the raw words and restored if the model drops one, with a note.
- With `REVIEW=1` the parse runs through `withReview(requestParseCheckpoint)`: one retry with the critique, any remaining finding shown as an ambiguity, a block stops before lookup.
- Items have stable ids (product key or typed words, plus constraints and variant, `~2` when repeated). Inline answers are keyed by id.
- Units and numbers: "2 x 10 kg" is 20 kg; "for 300 breakfasts" is a cover count, not a quantity.
- `dates.ts`: weekdays, relative words, ISO dates, `16.11.`, "20 December" and "20. joulukuuta", all against the sim clock. Impossible dates are refused, and the model cannot fill them.
- `classify.ts`: occasion words with no named product or physical amount make an event; it also says when a kitchen's seeded event matches.
- `lexicon.ts`: 16 products. `categories` are hard filters; `compound` lets Finnish compounds count (lohi → lohifilee); variants can carry their own search word (salmon fillet → lohifilee).
- `lookup.ts`: hand-set scores (preferred variant, convertible, exact, unit size, reliability). Conversions are rounded to the product's lot step, as `place_order` rounds them.
- `run.ts`:
  - Nothing is placed while any item lacks a pick (`unplaced`).
  - Skip reasons are named.
  - "N cases" asks which case.
  - The size check (`sanity.ts`) holds large orders until `confirmLarge`.
- Idempotency: the place key hashes kitchen, date, lines and page nonce; the commit key is `rq-commit-<planId>-v<version>`.

**Events (`server/menu`).**
- `brief.ts`: the words fill guests, date, style, courses, dietary requirements (with counts, such as `vegetarian:6`) and budget. Then one question at a time asks for what is missing, keyed `brief.<field>`. An answer can add requirements but never removes a typed one. `toEventBrief` validates against the contract.
- `store.ts` (memory) and `pg.ts` (`menu_proposals`): two `MenuStore` adapters with one test suite.
  - Revisions are numbered from 0 with no gaps and never change.
  - `put` stores `proposed` revisions only.
  - `review()` accepts chef sessions only and binds `proposalDigest`; the review record is server-written.
- `rubric.ts`: `reviewProposal(brief, proposal, previous?) → Issue[]`, the seam for E's shared reviewer. It blocks on:
  - covers or date differing from the brief
  - missing courses, or too few dishes for a buffet
  - a typed requirement dropped or not claimed, unless the proposal says it is open
  - an implausible ingredient amount
  - dish or ingredient ids dropped by a model revision

  It warns on grams per guest outside 250–1500 and on unresolved ingredients.
- `proposal.ts`: `proposeMenu` takes dishes from Gemini (zod with bounds, `llm` provenance) or the team templates (`team_estimate`), with yield always absent. Every ingredient goes through `catalog.resolve(query, {diet})`: a resolved one is pinned to the best product, an unresolved one keeps the reason. Revision 0 is stored before it is returned.
- `golden.ts`: the two golden briefs, "5-star 5-course dinner for 50" and "Christmas dinner for 50 on 20 December", each built from its words plus answers.

**Page (`/request`).** Steps Request → Lookup → Order → Approval; cautions turn green once the chef approves or commits. A placed order says it is now in the Kitchen plan (deep link) and creates its task. A passed cut-off is said with the first open date as a one-tap choice (never moved silently). An event shows the brief card (`BriefAsk.svelte`), then the menu review (`MenuReview.svelte`, `/request/menu`): amounts per guest editable (new revision, `user` provenance), accept = server-recorded chef review (refused while the rubric blocks), plan = `plan_event{proposal}`, then the Kitchen link. Data labels and the sandbox live in the shell (`useShell()`).

**Tests.**
- `request.test.ts`, `answers.test.ts`, `cases.test.ts`, `fixes.test.ts`
- `menu/brief.test.ts`, `menu/store.test.ts`, `menu/rubric.test.ts`
- Opt-in live tests: `request/live.test.ts` and `menu/live.test.ts`, run with `DECIDE_LIVE=1 node --env-file=.env node_modules/vitest/vitest.mjs run --project server <file>`. The last menu run returned 402 from Gemini (billing) and fell back to templates.

## Next
1. Rank /request candidates through `find_substitutes`, so the kitchen's `weights` apply; `lookup.ts` still uses hand-set scores.
2. Still open: one delivery date for several items; URL recovery for a review on reload (F16); hard-limit copy "split the order or raise the mandate" (F32).
3. Menu: remove a dish or swap an ingredient's product in review (amount edits only today).

## Needs
- **Register `propose_menu`** (lead): move it from `plannedToolSchemas` into `toolSchemas` and serve `proposeMenuHandler({ ports, llm: (ctx) => createLlmRouter(env).for('menu.propose') or null })` from `$lib/server/menu`.
- **`ports.tasks`** (E): /request and the menu plan call `taskForPlan` (`server/request/task.ts`) with `ports.tasks`; it writes one task per plan once the TaskStore exists. Ledger is left to the store owner.
- **Eval expectations (91):** `B-cutoff-date` in fidelity (butter-4kg-tomorrow, lactose-free-butter-4kg) and paraphrase (order-butter-tomorrow) marks stale `request.plan` expectations: /request now asks for Wed 9 Dec instead of placing for tomorrow. Replace with `checkLate`. Harnesses may pass `now` to `runRequest` (fallback: SCENARIO.start as a lower bound).
- **Catalogue resolver (8d):** the fixture menu resolves pike-perch fillet → a chicken fillet, porridge rice → a carrot-rice mix, carrot → a carrot-potato cube. The review shows them honestly; `Catalog.resolve` ranking needs a look.

## Report
- Sat 14 Nov · done: P1/P2 parser fixes + physical `amount` (cd5868c); polish: green steps, unit words, friendly dates, approver name (6e1407d); cut-off at lookup with one-click open date (4e282ad, a88cf30); menu review → accept → plan_event{proposal} → Kitchen link, golden briefs green (c1b1dc4, b5e40c6); propose_menu handler (a001ddd); task per order/menu plan (f7bb8ce) · stubbed: task store (seam until E) · needs: above · ready to merge: yes after gate

## Run
```bash
cd ../junc26-lanes/request && git rebase main && pnpm i
DATABASE_URL= LLM_PROVIDER=fixture pnpm dev --port 5173 --strictPort   # open http://[::1]:5173 (another process may hold 0.0.0.0:5173)
DATABASE_URL= pnpm vitest run --project server src/lib/server/request src/lib/server/menu
node scratch/request-e2e.mjs http://[::1]:5173      # milk: approve, commit, retry
node scratch/request-brief.mjs http://[::1]:5173    # event brief questions
node scripts/merge-gate.mjs                          # before handing a SHA
```

## Traps
- `search_products` is capped at 50 per query and is ordered differently on pg (productId) and in the fixture (file order), so shortlists can differ.
- Shell edits (sed, heredocs) mangle `\s`, `\p{L}` and `\b` in regexes; use the Edit tool or a node script written with the Write tool.
- Milk's net weight is in kg (1.031), so litres always come from the name.
