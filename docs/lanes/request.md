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
- Others import from this lane: the agent (`parseRules`, `baseId`, `rankCandidates`, `ParsedItem`, `ReqUnit`), evals (`runRequest`, `contentPerSalesUnit`, `orderAmount`). Keep those signatures stable.

## State
**Purchase requests (`server/request`).**
- `parse.ts`: two parsers, one shape. Rules (EN and FI) always run. The model path (Gemini, JSON) is used when `LLM_PROVIDER` is set, and every disagreement with the rules is shown as an item ambiguity. Constraints the chef typed ("lactose-free") are read from the raw words and restored if the model drops one, with a note.
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
- `store.ts`: an in-memory `MenuStore`.
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

**Page (`/request`).** Steps Request → Lookup → Order → Approval. An event shows the brief card with question chips (`BriefAsk.svelte`) and ends at "Brief complete. Menu proposal: next." The workspace label and tooltip come from G's resolver.

**Tests.**
- `request.test.ts`, `answers.test.ts`, `cases.test.ts`, `fixes.test.ts`
- `menu/brief.test.ts`, `menu/store.test.ts`, `menu/rubric.test.ts`
- Opt-in live tests: `request/live.test.ts` and `menu/live.test.ts`, run with `DECIDE_LIVE=1 node --env-file=.env node_modules/vitest/vitest.mjs run --project server <file>`. The last menu run returned 402 from Gemini (billing) and fell back to templates.

## Next
1. Chef review UI: show the proposal and rubric issues, allow amount edits (each edit a new revision with `user` provenance), then `review()` from the chef actor. After review, show "planning from a menu: next" until A4's `plan_event{proposal:{id, revision}}` lands, then call it.
2. A Postgres `MenuStore` on the `menu_proposals` table (applied on Aiven), and wire `Ports.menus`.
3. Rank /request candidates through `find_substitutes`, so the kitchen's `weights` apply; today `lookup.ts` uses hand-set scores and ignores them.
4. Still open: one delivery date for several items; URL recovery for a review on reload (F16); hard-limit copy "split the order or raise the mandate" (F32).

## Needs
- **`Ports.menus`**: wire `menuStore()` (memory now; the pg adapter after Next 2) into the server ports, so `plan_event` reads the store /request writes.
- **One home for pack content.** `core/demand/sizing.ts contentPerSalesUnit` and `request/convert.ts contentPerSalesUnit` parse differently:
  - Core trusts a net weight in the asked unit.
  - Request reads "NxM" packs and cross-checks the net weight.
  - For 464076 ("4x5 kg", net 20 kg, KI of 4), core says 20 kg per ST and request says 5 kg; the price (€37.33/ST) supports 5.
  - Proposal: core adopts the request rules (the case reading and the cross-check), and request's `convert` calls core.

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
