# Lane: request

**Branch:** `lane/request` · **Worktree:** `../junc26-lanes/request` · **Dev port:** 5185 (5175 is taken by the ops lane) · **Owner:** lead / request lane agent (track R0-c)

## Goal (one sentence, user-visible)
A chef types a short purchase request ("1,000 L lactose-free milk by Monday") and gets a priced, availability-checked, mandate-tiered order to approve: Valio's Request → Lookup → Order → Approval.

## Context to read first (≤4 files)
- docs/event/challenges/main/valio-aimo--trusted-trade-agents.md (the flow they score)
- evals/scenarios/s1-milk-over-cap.json
- src/lib/core/contracts/tools.ts (search_products, quote, place_order, get_plan, approve, commit_order)
- docs/handoff/review-request.md, docs/handoff/SYNTHESIS.md (F3, F7, F16, F17, F32)

## Owned paths (only these may be edited)
- src/lib/server/request/**
- src/routes/request/**, src/routes/api/request/**
- src/lib/ui/request/**
- tests beside them

## Contracts used (read-only)
- The tool registry through `serveTool` (no direct store access).
- `presenterOpen` (`server/demo/presenter.ts`), `POST /api/demo/sandbox/reset`, `hardLimitCents` (`core/mandate/validate.ts`).

## Report
- Sat 02:00–05:30 · rounds 1–5 merged (6a1a00b … 6ba72e5) · review 8c4cf37.

## Handoff (Sat 14 Nov)

**Owned paths and branch.** As above. Last code commit 6ba72e5; review 8c4cf37; main 5615a58 merged in.

**State.**
- *Works deployed:* Valio's example in EN and FI → 1,000 ST of 464201 → sign-off (line + order cap + new_sku) → approve as head chef → commit as chef → retry gives the same receipt.
- *Questions answered inline:* case questions (cards) and "how much?" (an amount box).
- *Size check:* runs before placing; the hard limit gives an unorderable line and no approval.
- *Workspaces:* ws-judges on prod and ws-demo in presenter mode, with a sandbox reset and a 429 cooldown.
- *Tests:* 36 lane tests in `request.test.ts`, `answers.test.ts`, `cases.test.ts`, plus `live.test.ts` (opt-in).

**How it is built (non-obvious).**
- *Two parsers, one shape* (`parse.ts`).
  - `parseRules` is deterministic, EN + FI. `parseRequest` uses the Llm port with JSON output when `LLM_PROVIDER` is gemini or featherless.
  - Dates are always resolved by the rules against the sim clock (`dates.ts`). The model only fills a missing date.
  - Every disagreement between the model and the rules becomes an item ambiguity. Bad model JSON falls back to the rules with `parser.fallback` set.
- *Lexicon* (`lexicon.ts`).
  - 16 products. An English word maps to a Finnish catalogue word, because the catalogue is Finnish.
  - `categories` are hard filters; only 5 products have them. `prefer` is a visible default ("semi-skimmed, the usual kitchen default"), not a constraint.
  - A word not in the lexicon is "searched as typed" and flagged.
- *Ranking* (`lookup.ts`).
  - Hand-set scores: +3 preferred variant, +2 convertible, +1 exact, +0.5 for content ≥ 1 per unit, + reliability × 0.5. The kitchen's `weights` are **not** used.
  - The shortlist is 5. One `quote` call covers every shortlist plus Valio's rule targets.
  - The pick is the first candidate that is priced, deliverable and convertible.
- *Conversion* (`convert.ts`).
  - Content comes from the name ("1 l", "0,5 l", "4x5 kg", "20 x … 500 g") × the pack hierarchy, cross-checked against Valio's net weight within 10 %. Net weight is the last resort.
  - "NxM" where N equals the KI pack's count is the case: one base unit holds M. Valio's net weight on such products is often the whole case (464076).
  - A disagreement refuses the conversion and asks (464205: name gives 20 kg, net weight says 80).
  - Milk's net weight is in kg (1.031), so litres always come from the name.
- *Case cards* (`run.ts` askCase, `convert.ts` caseBreakdown).
  - "N cases" never auto-picks. Up to 4 deliverable candidates become cards.
  - The headline (`caseHeadline`) and the conversion line come from one `caseBreakdown`, and `cases.test.ts` checks that they agree.
- *Size check* (`sanity.ts`).
  - Flags more than 10 kg/l per daily cover, where covers are the sum of the `*Covers` size keys (380 for k-hotel). The 10 is a team estimate.
  - Also flags more than 2× the weekly cap, and anything over `hardLimitCents`.
  - When flagged, nothing is placed until `confirmLarge`.
- *Idempotency.* The place key is `rq-` + hash(kitchen, date, lines, page nonce): same words on the same page load replay the same plan. The commit key is `rq-commit-<planId>-v<version>`.
- *Actors.* All are server-side contexts (`index.ts` `actors`). The browser never holds a key.
  - The kitchen agent places, `approver:head-chef` approves, the chef commits.
  - `/api/request` instead runs as the bearer key's actor.

**Open threads (from SYNTHESIS, owner req).**
1. **F3 (P0).** On the model path, constraints come only from model output, and `sameItem` (parse.ts ~360) doesn't compare them. Fix: union the rules' constraints into the model item, and flag any constraint the model dropped.
2. **F7 guard.** Classify event or menu requests ("dinner for 50", "courses", "menu") before item parsing, and answer "this is an event: plan it?" instead of searching the catalogue.
3. **F17, top 3 bugs.**
   - "salmon fillets" → cheese tart: add categories to every lexicon entry, and let leftover words narrow the search.
   - "2 x 10 kg": add multipack parsing in `parseItem`.
   - "for 300 breakfasts": recognise covers phrases.
   - Then: the specific skip reason in run.ts:216, "20 December" dates, and rejecting impossible ISO dates.
4. **F16.** Review state lives only in component state. Add URL recovery (`?plan=`) with ops/kit.
5. **F32.** Hard-limit copy should offer "split the order or raise the mandate".
6. **Track B, menu module (ruling 1).** `src/lib/server/menu/**` sits behind `plan_event{brief,dishes}`. /request becomes classify → `AnswerSpec` question chips → menu → plan. Rank ingredients through `find_substitutes`, so the kitchen's weights apply.

**Traps.**
- Inline answers are keyed by **item index**. If the model parser splits items differently between runs, an answer lands on the wrong item. Key them by item text before the menu work.
- `search_products` is capped at 50 per query and ordered differently on pg (productId) than in the fixture (file order), so local and prod shortlists can differ.
- The sim clock is Mon 7 Dec in all modes now, so Valio's "by Monday" means 14 Dec (flagged: "today is Monday").
- Cached `closingTime`s are November dates. The page hides any earlier than the sim clock (`cutoffText` in +page.svelte); remove that once offers are re-dated.
- The ws-judges tooltip says "Your own sandbox". That is false until the per-visitor workspace (F1, track G) lands.
- Edits with sed or Python in Git Bash mangled ` ` and backslashes in regexes; JS `\s` already covers nbsp. Use node scripts or the Edit tool.

**How to resume.**
```bash
cd ../junc26-lanes/request && git merge main && pnpm i
DATABASE_URL= LLM_PROVIDER=fixture pnpm dev --port 5185 --strictPort   # PGlite, ws-demo (dev = presenter)
DATABASE_URL= pnpm vitest run --project server src/lib/server/request
node scratch/request-e2e.mjs http://localhost:5185            # milk: approve, commit, retry
node scratch/request-answers.mjs http://localhost:5185 dev    # case cards and inline amount
# prod-mode check (ws-judges): pnpm build; PORT=5187 HOST=127.0.0.1 node build; scripts against http://127.0.0.1:5187
DECIDE_LIVE=1 node --env-file=.env node_modules/vitest/vitest.mjs run --project server src/lib/server/request/live.test.ts   # one Gemini call
```
`localhost:5186` resolves to IPv6 and the web lane's vite, so use 127.0.0.1 for prod builds. Never read `.env` values.

**Only this lane knows.**
- The judge probe results (review §1): salmon, multipack, covers, chicken.
- 464076's case reading is backed by price: €37.33 per ST is plausible for 5 kg of butter, not for 20 kg.
- The 402 "prepayment credits depleted" from Gemini in round 3 was a billing failure, not a code failure.
