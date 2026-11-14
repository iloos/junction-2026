# Review: request lane (/request, /api/request)

Branch `lane/request`, main f2edb21 merged. Evidence: 36 lane tests (`src/lib/server/request/*.test.ts`); Playwright scripts `scratch/request-{e2e,answers,big,reset}.mjs`, run against prod builds; a 12-input probe run through `runRequest` on PGlite (sim clock Mon 7 Dec, results below).

## 1. Own scope

**Solid (tested).**
- *Valio's example, EN and FI:* resolves to 1,000 ST of 464201 at sign-off for `CAP_EXCEEDED.line` + `.order` + `new_sku`, then approve → commit → retry gives one receipt (request.test.ts "milk example…").
- *Valio's rule 464201 → 464440:* shown as skipped (undeliverable), never pickable.
- *Valio calls:* only the shortlist is quoted (≤5 ids plus rule targets) in one call; "how much?" items quote nothing (answers.test.ts).
- *Conversion:* refuses when the name and Valio's net weight disagree (464205). "4x5 kg" with a KI of 4 now reads as a 5 kg unit (cases.test.ts). Case cards and conversion lines come from one `caseBreakdown`, and a test checks every card against its own line.
- *Size check:* runs before `place_order`, using covers, the weekly cap and the shared `hardLimitCents`. 1,000,000 l is blocked; confirming gives an unorderable line and no approval.
- *Workspace:* the server picks it via the shared `presenterOpen`, so prod uses ws-judges. Sandbox reset and the 429 cooldown were verified on a prod build.

**Bugs found by the probe (not fixed: review is read-only).**
1. **Wrong product: "50 kg salmon fillets" → 462463 *Lohi-juustotorttu* (a salmon cheese tart).** Cause: `salmon` has no category in the lexicon (lexicon.ts:75), and words after a known product ("fillets") are dropped instead of narrowing the search. The same risk applies to every lexicon entry without `categories`.
2. **"2 x 10 kg wheat flour" → "2 of the sales unit".** `NUM_RE` (parse.ts:97) takes the first number, and the unit check only looks at the next word ("x"). Multipack phrasing loses the 10 kg.
3. **"milk for 300 breakfasts" → qty 300 in sales units.** Covers are misread as a quantity, with only a "no unit given" note. It should ask "how much per breakfast?" or compute per-cover amounts.
4. **The "can't be delivered" question is generic.** run.ts:216 says "None of the N matches can be delivered" even when the skip reason was "no price" or "only X available" ("30 kg Finnish chicken breast" showed it). The real reasons are only inside the collapsed shortlist.
5. **Dates:** "on 20 December" and "20.12" without a trailing dot are not parsed, so the date falls back to today with a flag. On the Mon 7 Dec scenario clock, Valio's own "by Monday" resolves to Mon 14 Dec, a week out (flagged). Expect a judge to notice.

**Fragile.**
- *Search:* `search_products` is substring AND, capped at 50 per query and ordered by productId on pg (pg.ts:87) but by file order in the fixture catalogue (valio.ts:207). Shortlists can differ between local PGlite and Aiven. "maito" hits more than 50 products, so later ids are never seen.
- *Lexicon:* 16 products, 5 with categories. Anything else is "searched as typed" and ranked only by constraints and convertibility.
- *Team estimates:* `PER_COVER_LIMIT = 10` and `WEEKLY_MULTIPLE = 2` (sanity.ts:11,13).
- *Inline answers* are keyed by item index. If the Gemini parser splits items differently between runs, an answer can land on the wrong item.

**Untested.**
- *Gemini parse path:* only `live.test.ts`, which hit 402 (credits). Stubbed-model tests cover fallback and disagreement only.
- *Kitchens:* k-lounas and k-central (different covers and caps).
- *Lines:* Terminal / unknown-quantity picks, multi-line partial placement (one item answered, one not).

**Shortcuts.**
- Ranking weights are hand-set (+3 preferred variant, +2/+1 convertible/exact, +0.5 bigger unit, reliability ×0.5). They are separate from the kitchen's weights (`rank.ts`), so /request does not honour `k.weights`.
- The page has no auth beyond the workspace rule. In ws-judges anyone can approve.

## 2. Adjacent seams
- **core-db `tierLines`:** /request trusts its reasons and states. `new_sku` makes every first order at least *propose*; s1 alignment is pending with the lead.
- **Store clock:** dev and prod both run the scenario clock now, but Valio's cached `closingTime` is from Nov. /request hides cut-offs earlier than the sim clock. 8d is re-dating offers; when that lands, `cutoffText` (+page.svelte) should go.
- **`get_plan` approval fields:** relied on fully since the store fallback was removed. If 8d's optional fields regress, the page shows "—", not an error.
- **ops lane:** /request emits no events itself. Placements and approvals appear in /ops through the tool ops, but parse traces go to the bus only on the model path.

## 3. Valio's required flow
**Proven** for their example on prod: Request (words) → Lookup (static search, one quote for 5 ids) → Order (`place_order`, priced, tiered) → Approval (bound to version, hash, mandate and expiry; one receipt on retry). Their rules hold: not a chatbot (a step list, not a conversation), and APIs queried only when needed.

**Not shown on /request**, though their insight list names them:
- good-better-best: we pick one; alternatives sit in a collapsed shortlist without prices compared;
- partial availability: a short-stocked pick is skipped, never split;
- a link to the audit trail (/ops) from the receipt.

**What a judge types first that breaks it:**
- "salmon fillets" (wrong product, bug 1)
- "2 x 10 kg …" (bug 2)
- "for 300 guests" (bug 3)
- "Christmas dinner for 50 on 20 December": parsed into a garbage catalogue query. This is the most likely second request after the milk example, because it is Valio's deviation case.

## 4. Continuation: open request → menu → ingredients
Build it as a front stage of /request, not a new page. The step list gains a "Plan" step before Lookup.

1. **Classify first:** a cheap Decide `choice` (item list | event/menu | question). Item lists keep today's path. Event requests go to requirements gathering.
2. **Requirements as explicit criteria** (occasion, covers, courses, budget/cover, diets, origin, date). Ask one at a time with the existing `AnswerSpec` chips, which already carry answers through re-runs (`readAnswers`, `applyAnswers`). Pre-fill defaults from the kitchen (covers from `dailyCovers`, origin rule, allergen policy).
3. **Menu proposal by Gemini**, labelled estimate. Each dish carries ingredient templates with g/cover and yield. Feed `plan_event` with a generated EventSeed instead of a seeded id, so tiering, approval and receipt stay identical.
4. **Ingredients → products** via `find_substitutes` ranking (honours `k.weights`), not the request lane's hand-set scores. The lexicon becomes a fallback.
5. **Fix bugs 1–3 first.** The menu track multiplies them: every ingredient line is a "salmon fillets" case.

**Next highest-value tasks:**
- bugs 1–4, small and in my scope;
- a Christmas-dinner request routed to "this is an event; plan it?" with a link to the kitchen's event planner;
- show good-better-best (top 3 priced picks) as answer cards when the request was vague;
- one live Gemini run once credits are restored.
