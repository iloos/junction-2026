# Ring 5 checkpoint: one gate, one reading, one surface

_Lead, Sat 14 Nov late. Inputs: every lane's checkpoint (docs/lanes/*.md: core-db, kitchen, ops, f-evals, agent-door-v2, menu-v2, site, site-design, kitchen-profiles, request, o-obs, u-usual, web), Round 11 ([review](../../review/ROUND11-ADVERSARIAL.md)), the user's steers ([USER-DIRECTIVES](../ring4/USER-DIRECTIVES.md)), prod smokes on b10cd43 and 494bd09. Round 12 ([prompt](../../review/ROUND12-PROMPT.md)) amends this when it lands. Steer: converge on the ideal shape; each step lands green and deploys; the freeze only times the video and submission._

## Where we stand
- **The shape moved from patches to invariants.** The four rounds of adversarial review (R9–R11) kept finding three bug classes at each entry: wrong quantity, lost requirement, wrong replay. They are now core invariants:
  - **D16:** one requirement vocabulary plus `meets()` over `facets()`. The 68-product labelled set has 0 unsafe oks.
  - **D18:** every entry makes a need carrying the ask; lines are bound to it (`exceeds_need` forbids, `need_rounding_large` holds); one `commandKey`.
  - **D20:** words read into a general intent shape, with the `request.reading` judge (9/10 reading defects caught), and Flash-Lite plus a 3.8-flash re-read for unsure cases (both 44/45 on held-out paraphrases).
- **Product shape.**
  - Seven joinable kitchens, each with its own event and profile.
  - The request page: editable steps, a date control, a dish path (ready-made vs raw, meat-ratio reasoning), over-limit options, remembered choices.
  - The right rail: Decide on top, collapsed, highlighting its lines; the chat keeps at least 50%.
  - Chat: follows the page's plan, never ends silent, no raw ids, one dish reading shared with /request.
  - The usual order (D14) with simulated history.
  - The product card with verified Valio Aimo listings and photos.
  - Ops: Orders, Demand, rules counts, honest refusal causes.
  - The agent door: absolute links, pairing, refusals that name the failing requirement, one ranking preference across doors.
  - Observability: persisted traces (Postgres, 7 days), request ids, JSON logs (Runtime keeps 24 h). Aiven refuses log shipping from the Runtime app to OpenSearch on our project (403 service_integration_not_allowed for both logs and external_opensearch_logs), so the user held it and is removing mandate-logs; claim no OpenSearch.
- **Prod.**
  - b10cd43 is smoked: 11 passed, the only failures being the /agents prose and a fixed mobile test.
  - 494bd09 (batch 2, with migration 0005 applied) is deploying.
  - Batch 3 is gating: the commit-retry fix, the 5 l hold, the rail rework, the covers sweep, the basket projection and Plan.origin, one ranking.
- **Process.**
  - Lanes now run `--only check,lint` plus targeted tests, and merge-gate enforces it. The lead's main gate is the only full gate.
  - The gate lock queue had 15 waiters; it is cleared.

## Round 12 (landed; [review](../../review/ROUND12-ADVERSARIAL.md), [handoff](../review-adversarial-r12.md))
Four P1s, eight P2s, no P0. The hotel journey completes at 1440 and 390: 18 lines, €933.92, 7 confirmed and 11 awaiting, and a retry keeps one receipt. Outside-agent approval is refused, and the human-then-agent commit works. The P1s share a root: the ask and the requirements are stored but not enforced at every boundary.
| Id | Finding | Owner | Routed |
|---|---|---|---|
| R12-01 | Need.ask doesn't bind quote/commit (a 250 ml ask can buy 250 l through the core); "2 buckets" becomes 2 × 10 l | 8d (core), B (unknown units ask) | yes |
| R12-02 | `meets()` misses UW and the other cereal codes; one fact table shared by the gate, marks and answers | 8d | yes |
| R12-03 | "vegan milk" becomes cow's milk with only a warning; the diet ask never reaches Need.requirements | B | yes |
| R12-04 | Contention repair adds the full need, not the residual (6 l for 4 l), = R10-05 | 8d | yes |
| R12-05 | Establishment choice blocked until the hotel plan; basket not on the canvas | c3 (1f reviews) | yes |
| R12-06 | Usual order UI dev-only; four profiles have no history | c3, 0d | yes |
| R12-07 | ProductToken had no consumers at the review's cutoff | closed: Request (RequestFlow, DishCard) and Kitchen (1f 8f48df5) | closed |
| R12-08 | `revise_menu` not registered | da with 41 | yes |
| R12-09 | Ops doesn't read stored traces or the summary | 9c | yes |
| R12-10 | A cancelled task still offers Continue | E | yes |
| R12-11 | /proof 15/3 vs receipts 7/11; €400 vs €800; generic CTAs; PITCH known-stock line | d0, 91 | yes |
| R12-12 | Four obsolete test oracles; stale OPEN flags (R11-05, R11-15) | 91 | yes |
Next batch per the handoff: core binding (R12-01/02/04) and the request reading (R12-03), then the entries (R12-05/06/08/09). Rerun all nine journeys on the deployed build before filming.

## Open, by owner (from the lane checkpoints)
- **Core (8d):**
  - `facets()` dairy and gluten by category or name, so "declared but empty" is never lactose-free;
  - an idempotent "already ordered" replay in `commit_order`;
  - R11-04 (replay without a fresh quote), R11-10 (classifier), R10-05/06/08;
  - every place_order line makes a need;
  - the "Valio suggests" contract (K7);
  - a glance at da's substitutes.ts rebase.
- **Conversation (B + E + 41, to merge into one session):**
  - **TOP, from the user's chat test on prod 4752d00 (an event menu through the dock).** The questions and chips worked well (guests, day, service, courses, diet, budget). Then it broke:
    1. **"Working · step 1…" means nothing.** Narrate what it is doing ("Writing a gluten-free 3-course menu for 20, about 15 s"), and show steps as they happen; a single 18 s step with no progress is poor affordance.
    2. **No menu card.** "Review it, then say 'plan it'" appears, but the transcript shows no menu to review. Render the MenuReview card (dishes, ingredients, products, open items) in the chat, with its review link working.
    3. **The wrong plan's decision.** The reply "great lets do it" got the "Buy 3 new products €410.32" decision card from the user's earlier /request milk/juice/cream order, not the menu. The dock's plan scope leaked across tasks. An affirmative reply to an offered next action ("plan it") must take that action (D20 reply rule), on this task's menu.
    4. **"Show on the page" doesn't work**, and "Only a chef approves, on the page" contradicts D13 (the chef approves in the dock).
    5. **The old fallback is back:** "I did not recognise this request" (agent/intent.ts:363) appears after the ledger, and the ledger text repeats twice. Remove the fallback per E's earlier invariant (never contradict an understood reading) and dedupe the closing.
    Acceptance: a chat-only journey (event, then menu card, then "plan it", then the plan in the basket with decisions in the dock, then approve in the dock, then order) as an e2e on prod, plus a trial for "great lets do it" after a proposed menu.
  - **First, from the user's prod test:** "i want a no meat meal but it should be very filling and nutritious. i also want to use a peach in the dinner" was answered on /request with "reads as a question, ask in the chat". It is the D20 `menu` kind: route it to brief → menu (requirement vegetarian, include peach, guidance "filling, nutritious") from both doors. Collapse the 8 warnings into one sentence; debug lines ("the model read ?, the rules 1 sales") go behind System.
  - **The request page is text-heavy (user).** The Lookup step becomes one line per item: qty token, product (ProductToken), packs, total, supply chip, plus one "why" chip ("semi-skimmed: your usual"). Expanding it shows a compact comparison table instead of prose: candidates as rows; columns for price per l/kg, total for the ask, supply, origin, carbon, and why picked or not; sortable. This is the matrix view the user asked for earlier. "Not needed: an earlier match was picked" goes. Filtered-out items collapse to one line ("33 not milk: chocolate, cocoa drinks, powders…"). Formulas like "50 l ÷ 5 l per KI = 10 KI" only with System.
  - **Whole-page text pass (user: "other parts of this page and some components… the text can be formatted better").** On /request (Request, Order and Approval steps, warnings, the over-limit and dish cards) and in shared components (DecisionCard, the Order summary, the rail), apply one typographic system:
    - a short headline per block, then a single line of facts as tokens (qty · product · price · supply), then details on demand;
    - no paragraphs inside steps, numbers in tabular columns, one warning style;
    - ids, formulas and model or rule internals only with System.
    Model it on the Kitchen's bill (the Order summary and line list): the same layout, structure and qty/item formatting everywhere a product appears. One line component:
    - a qty token (mono chip, "10 × 5 l"), then the readable name (ProductToken), the unit price, the line total right-aligned, and one state chip;
    - grouped under short headings with a subtotal;
    - shared by /request, the rail's Decide lists, the Basket, the usual order and the dock cards.
    Run impeccable's critique and polish on /request and the Kitchen before and after, with screenshots at 1440 and 390.
  - **Choice quality:** prefer the plain variant unless one is named (unsweetened orange juice over "sokeroitu"), and say why a variant was picked (lactose-free cream).
  - **D15 stage 2:** chat calls the request pipeline for order readings. Today "50 eggs" differs between chat and /request.
  - RequestFlow cards in the transcript, and /request redirecting into chat.
  - The menu-v2 contract (A) and wiring (B), with pins persisted through MenuStore.
  - The dinner-replay eval with live Gemini.
  - Exa grounding in the dish card.
  - Splitting a line across products when stock is short.
  - max_available is seen only via a stand-in model, never live.
- **Kitchen and basket UI (1f + c3, to merge into one session):**
  - mount c3's Basket view and empty state on 9c's basketFor;
  - ProductToken on rows, chips and cards;
  - K7/K8 on Line.unmet[] with diet marks via meets();
  - the Kitchen PRESETS read core rank presets;
  - risks: dishes without lines aren't highlighted, a dock approval shows no "Approved" chip, the rail is untested at 320 px.
- **Ops (9c):**
  - the 'usual' door's origin, now that 7b37e83 is on main;
  - the Sponsors panel on the traces summary;
  - R11-06a/b and R11-07a (with 1f);
  - d0's Ops brief once the user answers.
- **Agent door (da):** Ring 2 (reasoning, report_issue, compact detail); ProductToken listing on lookup_facts/get_product; the risks are PUBLIC_ORIGIN unset, a proxy IP for limits, and in-memory pairing.
- **Evals and claims (91):**
  - the OPEN maps: R11-04a/b, 05, 06a/b, 07a, 10, 15; R10-05/06/08, 09; R8 web;
  - a CLAIMS pass on the deployed batch;
  - the services check turning strict on traces.
- **Site (d0 + 73):** re-record the one-receipt card after the retry fix and the chain after the seed titles; the Ops brief and the app-pages design wait on the user.
- **Lead:**
  - merge batch 3 and deploy;
  - fold in Round 12;
  - the comment sweep;
  - the stray worktrees (`.claude/worktrees/agent-…`, `../agent2-gate`, `junc26-lanes/request-gate`): check them for links before removing;
  - history rewrite and placeholder prices before going public (user).

## Waiting on the user
- PUBLIC_ORIGIN in the Aiven console.
- The Nemotron endpoint (404).
- SMOKE_KEY.
- The history rewrite and placeholder prices before public.
- d0's Ops brainstorm answer and the app-pages design.
- Whether to also reword "cover" in its supply sense ("3 dishes lose cover").

## Session plan for the next ring (proposal)
Peer sessions own durable areas; subagents take bounded jobs.
1. **Core** (8d).
2. **Kitchen and basket UI:** 1f absorbs c3.
3. **Conversation:** a fresh session taking over B, E and 41: chat plus request plus menus, D15 stage 2.
4. **Ops and deploy** (9c).
5. **Evals and claims** (91).
6. **Agent door** (da).
7. **Site** (d0 absorbs 73).

0d retires after the covers sweep. The lead compacts after Round 12 is folded in.
