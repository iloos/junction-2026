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
In priority order, for the Conversation session that takes over B, E and 41 (ring 5 SYNTHESIS):
1. **Menu-ask routing (D20 `menu` kind).** "a no-meat meal, very filling, use a peach" must go brief → menu with requirement vegetarian, include peach and the guidance, from both doors. Today the parse calls it a question. Add `menu` to the intent shape and route it to `draftBrief`. Collapse the warnings into one sentence; debug lines go behind System.
2. **D15 stage 2.** Chat calls `submitRequest` for order readings ("50 eggs" differs between chat and /request today). `RequestFlow.svelte` cards render in the transcript (it is self-contained: props `{text, kitchenId, nonce, now?, onresult?, onnew?}`). /request redirects into chat; /request/menu stays as the API.
3. **Lookup as one-line rows plus a comparison table.** One line per item: qty token, ProductToken, packs, total, supply chip and one "why" chip. Expanded, it shows a sortable table: price per l/kg, total for the ask, supply, origin, carbon, why picked or not. Remove "Not needed: an earlier match was picked". Filtered hits collapse to one line. Formulas only with System.
4. **Bill-style line component**, modelled on the Kitchen's Order summary: qty token, name, unit price, line total right-aligned, one state chip, grouped with a subtotal. Shared by /request, the rail's Decide lists, the Basket, the usual order and the dock cards. Run impeccable critique and polish on /request before and after (1440 and 390).
5. **Choice quality.** Prefer the plain variant unless one is named (unsweetened over "sokeroitu"), and say why a variant was picked.
6. **days.ts leak (BUGS.md:77).** `days.ts:95` shows Valio's logistic-model label: "past every match's cut-off (Stock, 17:00 Mon)". Say it in words ("orders close 17:00 Mon") or drop the model.
7. rank-by.ts becomes a re-export once da's core/rank/presets.ts lands. Swap DeliveryDays for c3's DayPicker. Exa grounding in the dish card. Split one line across products when one product's stock is short. Menu-v2 contract and wiring.

## Needs
- **Register `propose_menu`** (lead): move it from `plannedToolSchemas` into `toolSchemas` and serve `proposeMenuHandler({ ports, llm: (ctx) => createLlmRouter(env).for('menu.propose') or null })` from `$lib/server/menu`.
- **`ports.tasks`** (E): /request and the menu plan call `taskForPlan` (`server/request/task.ts`) with `ports.tasks`; it writes one task per plan once the TaskStore exists. Ledger is left to the store owner.
- **Eval expectations (91):** `B-cutoff-date` in fidelity (butter-4kg-tomorrow, lactose-free-butter-4kg) and paraphrase (order-butter-tomorrow) marks stale `request.plan` expectations: /request now asks for Wed 9 Dec instead of placing for tomorrow. Replace with `checkLate`. Harnesses may pass `now` to `runRequest` (fallback: SCENARIO.start as a lower bound).
- **Catalogue resolver (8d):** the fixture menu resolves pike-perch fillet → a chicken fillet, porridge rice → a carrot-rice mix, carrot → a carrot-potato cube. The review shows them honestly; `Catalog.resolve` ranking needs a look.

## Report
- Sat 14 Nov · done: P1/P2 parser fixes + physical `amount` (cd5868c); polish: green steps, unit words, friendly dates, approver name (6e1407d); cut-off at lookup with one-click open date (4e282ad, a88cf30); menu review → accept → plan_event{proposal} → Kitchen link, golden briefs green (c1b1dc4, b5e40c6); propose_menu handler (a001ddd); task per order/menu plan (f7bb8ce) · stubbed: task store (seam until E) · needs: above · ready to merge: yes after gate
- Sat 14 Nov night (b2) · done: cut-off offers name the day that results, days.ts (b109217); ids and keys only in System (94e77df); dish reading, ratio shares, product checks, `interpretDish` (da63e49); /request as an editable step flow: date chips, item edit in place, incremental re-runs with an "Updated" line, dish card ready-made vs from raw, over-limit choices, remembered choices (7b2f570, 9a4cbe3, 615e564) · stubbed: DayPicker (built to its contract in DeliveryDays.svelte, swap when c3 merges); Exa recipe grounding not wired into the dish card (team recipe is the source) · needs: c3 DayPicker on main; core meets() (D16) to replace checks.clashWith · ready to merge: yes after gate
- **Checkpoint, Sat 14 Nov late (b2), before the full restart.** Branch `lane/b2-request`, head in the commit that adds this line (pushed, WIP flagged). Lane gate (`--only check,lint`) GREEN on a0ab741; request and review tests 144 passed, 2 skipped (opt-in live).
  - **Done:**
    - Stage 1 on main: cut-off days b109217, System layer 94e77df, dish, ratio and checks da63e49, editable step flow 7b2f570/9a4cbe3, default day a95935b.
    - R11 on main: units ea47d01, request.reading 5610d20, parser line 12d163d, pack and case needs 3729865, commit lines 34ba117, price basis f743b23, brand and variant 387f211.
    - D20 shape and cascade 191c272, with the escalate route 86b4a2b. Held-out eval 561dfa7: both models 44/45, recorded in models.md §6.
    - D16/D18 switch to commandKey, meets() and the ask on every line: 918e143.
    - need_rounding_large (fit-first ranking, 2× hold): 71f4a16.
    - Commit-retry regression: 7207a57.
    - ProductToken and filler words: c5fb599.
    - R12-03 diet asks as requirements and R12-01 unit-position asks: a0ab741.
  - **In flight:** none. R12-01 and R12-03 are done in the reading; core's ask/lot binding (R12-01 core) is 8d's. The R12 held-out trials are rules-level (r12.test.ts); they were not run live on both models.
  - **Risks:**
    - Without a model, max_available never comes from the rules; "all your X" asks how many.
    - The fixture Valio cache has no prices for many products, so dish options show as partly priced and held.
    - The unit-position heuristic also asks about a plural unknown word before a product word ("3 cherries tomatoes"). It errs toward asking, never toward buying.
    - Vegan milk in the rules path finds only dairy (lexicon category), so it stops with "nothing matched" instead of proposing an oat drink. The model's search words lead when it is live.
    - halal and kosher always stop the reading.
    - The cascade showed no gain on the held-out set.
  - **How to resume:**
    1. `cd ../junc26-lanes/request && git fetch && git rebase main && pnpm i`.
    2. `DATABASE_URL= LLM_PROVIDER=fixture pnpm dev --port 5185 --strictPort`.
    3. Tests: `DATABASE_URL= npx vitest run --project server src/lib/server/request src/lib/server/review`.
    4. Screenshots: scratch/b2-*.mjs. Live eval: `INTENT_LIVE=1 LLM_PROVIDER=gemini node --env-file=.env node_modules/vitest/vitest.mjs run --project server src/lib/server/request/intent.live.test.ts`.
    5. Gate: `pnpm gate --only check,lint`.
    6. For a stuck gate on Windows, find its worktree with the scratchpad cwd.ps1 script (it reads a process's cwd). Stopping the shell leaves node alive.
- Sat 14 Nov 23:55 (S3, ring 6) · done: shares reading on both doors, one-tap likeliest reading (e48dc9e) · stubbed: menu has no per-share dish beyond vegetarian:N · needs: none (BriefDraft.shares added in ui/request/types.ts) · ready to merge: yes

- Sun 15 Nov ~02:40 (S3, ring 6) · done: shares reading e48dc9e; moment 2 brief/menu (diet swaps, named ingredient, counted shares) 67c72be, 08336d4; vegan milk never a sorbet f4478d5; lost tasks ed15d15; visitor at the chat/request doors 564d4d9; hero "plan it" loop 6f70626; F1 reconcile aa4bc21; F6 9be7781; supply-first menu picks 5db260f; one candidate order (D15 st.2) 4df5c9f; chat kitchen fallback 37ede39; OM-8/9 d02d269; short-line replies 57b35a9; D22 approve from the dock fd7d6ae; room P0 8673da2; "order it" 9bd91ad; /request = conversation + ?new=1 e5fdde7 · stubbed: line cards in the transcript (dock store does not load on /request; patch in scratch/dock-linerow.patch) · needs: nav label "Ask the agent" and Kitchen "New order" → /request?new=1 (S2/layout); bold renderer in the dock (S2) · ready to merge: yes

- **Checkpoint, Sun 15 Nov ~02:50 (S3, ring 6).** Branch `lane/b2-request` at the commit that adds this line, rebased on main 0332013; lane gate (`--only check,lint`) GREEN; request+chat+evals+agent 562 pass.
  - **Open, in order:**
    1. Line cards in the transcript (D23 (2)): the dock's own KitchenStore doesn't load on /request, so the decision card is read-only there; typed "approve all" works (D22). Patch offered to S2: `scratch/dock-linerow.patch` (LineRow `decide` + Accept all).
    2. Bold in replies: needs a `**x**`-only renderer in the dock (S2); emit markup only after it lands.
    3. D28 steer words ("something cheaper", "no, a Finnish one", "if no ham then salmon") → find_substitutes `steer` / edit_line, same reading in chat and on the page.
    4. Per-share dishes beyond vegan/vegetarian mains (gluten-free:N etc.) in the template menu.
  - **Traps:**
    - Shell edits and node heredocs mangle `\n`, `\s`, `\b` in TS: use the Edit tool, or write the replacement to a file and splice it.
    - Vitest's server project hides console output on passing tests: probes write to `scratch/*.txt`.
    - Dev here: every browser is a presenter, and the blank-DB store can't add kitchens (`/kitchen-api/kitchen` → PROVIDER_UNAVAILABLE).
    - The chat's decision memory is `task.shown.decision` (what was shown); `task.pending` is refreshed by a listener when the plan moves.
    - Stopping the dev server on Windows can leave node on :5185 (find the PID with netstat and stop it).
  - **How to resume:** `cd ../junc26-lanes/request && git rebase main && pnpm i --frozen-lockfile`; `DATABASE_URL= LLM_PROVIDER=fixture pnpm dev --port 5185 --strictPort`; tests `DATABASE_URL= LLM_PROVIDER=fixture npx vitest run --project server src/lib/server/request src/lib/server/menu src/lib/server/chat src/lib/server/agent src/lib/server/evals`; browser checks `node scratch/s3-hero.mjs <base> 1440|390`, `scratch/s3-d23.mjs`, `scratch/s3-new.mjs`, `scratch/s3-room.mjs`; gate `pnpm gate --only check,lint`.

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
