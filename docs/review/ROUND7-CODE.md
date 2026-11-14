# Round 7: correctness and agent guarantees

**Verdict:** The authority boundary is substantive. The larger weakness is that it authorizes purchases without consistently preserving the outcome the buyer requested. I reproduced wrong substitutions, excess purchasing, stale supply assumptions and incomplete recipe edits through the real handlers and PGlite. Repair these before expanding autonomous planning.

Reviewed 14 November 2026. Execution snapshot: `7dd9a0956d97a6dce05483d5fef236c534116130`, exported under `scratch/round7/snapshot/`. The checkout was changing during review; all twelve key implementation files in `scratch/round7/source-comparison.json` remained byte-identical at `ab3a5573`. References below describe that snapshot. S = roughly <=1 hour; M = 1–3 hours; L = longer or substantial integration risk. Estimates include a focused regression check.

## What was actually checked

- **10 adversarial observation probes passed on PGlite.** They assert the observed defects, alongside working counterexamples; green here means reproduced, not correct behavior. Most use a three-product synthetic catalogue, real core handlers, schemas, reducer, SQL store and stock adapter. The porridge probe uses the actual seeded event and cached catalogue. No live model calls.
- **7 existing cutoff/authority tests passed**, and **15 existing auth/visitor/judge-key/reducer tests passed**, using isolated configuration with private environment replaced by an empty fixture.
- Logs and reproduction commands: [evidence README](../../scratch/round7/README.md), `review-probes-pglite.log`, `baseline-isolated.log`, `security-isolated.log`.
- I did not complete the full merge gate or rerun Aiven races. The initial normal Vite-config test attempt was interrupted before results. Production browser evidence is separate in [ROUND7-PRODUCT-UI.md](ROUND7-PRODUCT-UI.md).

The successful counterexamples matter: an external agent's approval call was refused; a changed price returned `TERMS_CHANGED`; the same commit key replayed its result; a fully committed plan refused another repair. The existing cutoff tests cover before/at/after the deadline. **A3 is present and tested in this snapshot**, despite STATUS/DISPATCH/PITCH still describing it as open.

## 1. R7-01 · P1 · A request's requirements do not become enforceable purchasing requirements

**Verified.** `request/lookup.ts:55` filters lactose-free, organic, Finnish and gluten-free requests. But `request/run.ts:493` sends only product, sales quantity and unit into `place_order`. The resulting plan has `needs: []`, no physical demand and no request constraints. Even supplying `amount` through the tool creates only an amount/label/provenance need (`core/services/orders.ts:231`); `Need` has no dietary requirement field (`core/contracts/plan.ts:92`). Validation reads the kitchen's constraints (`core/mandate/validate.ts:87`).

Probe `R7-REQUEST` parsed “10 litres of lactose-free milk for December 10” correctly. Its durable plan had no needs. A subsequent substitute lacking `LACTOSE` clearance was selected, and an explicit commit of that substitute succeeded (`R7-DIET-LOST-COMMIT`). The permissive kitchen and alternative products are synthetic; this is a demonstrated missing contract, not a claim about a particular Valio milk SKU.

There is a second consequence today: `agent/outcome.ts:71` treats committed lines as confirmed when no fulfilment need exists. `R7-EMPTY-NEED-OUTCOME` produced a receipt awaiting the supplier but `computeOutcome` returned `fulfilled` and one `confirmedNeeds` entry. Adding a Task record alone will not repair either gap.

**Why it matters:** “within the mandate” can be true while “what the buyer asked for” is false. This directly targets Valio's user-need criterion, not an edge-case compliance requirement.

**Recommendation — M, lead + B/E/A:** Store typed task/need requirements and physical demand, carry their identity through edits and substitutes, and intersect them with kitchen policy at quote and commit. An approval must not erase a hard requirement. Make missing fulfilment evidence remain unconfirmed; remove the committed-equals-confirmed fallback. Send physical `amount` from Request immediately, but recognize that this fixes quantities only. Test request → substitution → approval/commit, not just the initial basket.

## 2. R7-02 · P1 · “Replace” can buy both the original and its replacement

**Verified.** `services/substitutes.ts:110` calls only existing substitute lines `saved`; `:317` removes those lines, while `:370` retains the original. `state.ts:188` appends the proposed substitute. The original is effectively suppressed for a recall or an already-unorderable product, not for an ordinary orderable product. The Christmas outages hide this distinction.

Probe `R7-REPLACE`: place a direct 10-litre need → apply a valid alternative to its orderable original → commit the default selection. **Both 10-litre lines committed under the mandate, costing 2,000 cents instead of 1,000.** Fulfilment correctly reported 10 litres confirmed plus 10 litres excess. Idempotency cannot prevent this: the duplicate purchase is inside one successful order, not a retry.

**Recommendation — M, A + lead:** Make the active fulfilment strategy explicit. Replacing a strategy must supersede its uncommitted purchase lines atomically; keep the original as history, not a purchasable line. If buying both is intentional, require a separately represented split allocation whose quantities sum to the outstanding need. Forbid repairing an already-satisfied need in a partially committed plan. Add an in-stock-original regression as well as the current out-of-stock cases.

**Buys:** A meaningful “no double buying” guarantee beyond unique receipts. Stop treating idempotency as protection against this class of error.

## 3. R7-03 · P1 · Supply certainty can change without voiding approval or updating the line

**Verified.** `core/hash.ts:19` hashes product, quantity, unit, price and delivery date. Availability is absent. At commit, `orders.ts:509` compares that hash; `:520` notices eligible → held demotion, but not a held approved line gaining a new uncertainty. When the hash matches, no fresh `RecordOffer` is persisted. Committed line actions use the old offer (`mandate/view.ts:67`).

Probe `R7-SUPPLY-DRIFT`: an external-agent plan is quoted with known supply and human-approved; the adapter then returns unknown Terminal supply at the same price. Commit succeeds, the approval remains granted at v1, and the receipt says 10 litres awaiting supplier. Yet the persisted line still says `availability: known` and `nextAction: none`. Its FulfilmentView correctly says awaiting supplier. Two projections disagree about the same purchase.

The same probe also checks Ops: `routes/ops/cases.ts:161` excludes `plannedUnknown` from covered needs but omits `awaitingSupplier`. It counts this entirely unconfirmed 10-litre need as **1/1 covered** after commit. Moving uncertainty into an order must not make it disappear from the remaining service risk.

**Recommendation — S–M, A:** Define which supply changes are material to the decision. At least known → unknown, loss of requested-date coverage and changed delivery conditions should re-quote and require acknowledgement. Persist the fresh evidence even when commercial price terms are unchanged. Derive postcommit supply actions from the receipt. Keep volatile stock counts out of the hash if appropriate, but add an explicit assessment of material changes; hashing timestamps would merely cause needless reapprovals.

**Buys:** Approval of the risk actually presented, and truthful behavior when Ring 2 introduces live refreshes. Until fixed, narrow “any change voids approval” to the fields actually protected.

## 4. R7-04 · P1 · Portion edits fail to propagate through an existing recipe dependency

**Verified on the real seed.** `demand/event.ts:63` documents cooked-dish dependencies and computes them. But `services/events.ts:248` keeps recomputed drafts only for the edited need; `:278` emits only its line changes, and `:342` replaces only that need.

Probe `R7-RECIPE-EDIT` doubled rice-porridge portions from 100 to 200 g/guest. Rice need went **1.68 → 3.36 kg**; dependent milk stayed **10.5 litres**, although the seed's 0.75 l/kg cooked-porridge factor requires 21 litres. The displayed formulas were also false: “100 g × 140 = 1.7 kg”, then “200 g × 140 = 3.4 kg” (`events.ts:76`). The missing step is the 0.12 rice/kg-porridge conversion. The independent live UI reviewer saw the first false equation too.

**Recommendation — M, A/C:** Recompute and persist the affected dependency closure in one edit: every ingredient need and line attached to that dish, with approvals invalidated together. Use stable parent/ingredient identities rather than family-name matching. Emit the same typed calculation steps for the formula, Why view and future waterfall. Gate A4 on this property before applying it to arbitrary proposed recipes.

**Buys:** The chef's existing “change one thing” interaction produces a complete amended purchase. This is more urgent than drawing a prettier waterfall over the current numbers.

## 5. R7-05 · P1 · “Unsuitable” culinary scores never prevent recommendation or autonomous purchase

**Verified with injected Decisions answers, not a live Gemini result.** `substitutes.ts:59` defines 0 as unsuitable. `rank/rank.ts:117` mixes fit into a weighted score; no fit floor changes eligibility. `substitutes.ts:249` picks the highest survivor regardless. Probe `R7-FIT` returned 0/4 for both alternatives; both remained ranked, and one was chosen as an eligible act-tier line. With only one survivor, no fit call is made (`substitutes.ts:183`). The question also assumes a Finnish Christmas buffet for every request.

**Recommendation — S, E/D/A:** Separate suitability assessment from optimization. A negative or absent suitability assessment should prevent autonomous substitution or escalate to a clearly explained chef choice; model evidence may make the system more conservative, never clear a hard rule. Rank by supply tier among acceptable options. Ask about the actual task and preparation. Give the single remaining candidate an assessment too.

**Buys:** Gemini changes a real decision rather than supplying a decorative score. Do not add three model questions per candidate while a 0/4 answer has no meaningful consequence.

## 6. R7-11 · P2 / future adapter blocker · Receipt-backed coverage ignores receipt quantities

**Verified projection limitation.** `services/views.ts:53` asks whether any matching confirmation exists; it ignores its quantity. `mandate/fulfilment.ts:106` uses the entire line's physical quantity. In `R7-PARTIAL-RECEIPT`, I changed a cloned 10-unit receipt to confirm one unit: the projection still confirmed 10 litres. The current simulator confirms an entire consumed line, so this is **not a demonstrated live partial-shipment failure**. The existing `r6-2b-partial-receipts` scenario tests two subset commits, not a supplier partially accepting one line.

**Recommendation — S to narrow claims now; M before a real supplier adapter:** Put line identity on every new receipt entry and allocate confirmed/awaiting quantities, not boolean receipt presence. Do not present the current projection as supporting short acceptance, receiving or short shipment. These flows are already parked; keep them parked.

## Architecture judgment and open questions

The pure core, shared registry, scope-derived principal, transactional reducer and fixture twins are worth preserving. The defects cluster in **what is represented**, not a need for a workflow engine or another agent. A model reviewer sees text and a rubric; it cannot recover a dietary constraint or recipe dependency that the transaction discarded.

The already-listed global agent-run lock and unscoped cancellation (`agent/runs.ts:39`, `:67`) remain source-confirmed prerequisites before public chat. I did not attack another visitor's run. Preserve the separate approval authority and keep the production planner scripted until live comparison shows an improvement.

Questions for the team:

1. Which task requirements are hard promises at commit, and where will their typed identity live?
2. Is substituting an orderable product supported? If yes, what operation makes the original non-purchasable?
3. Does approval cover supply uncertainty and delivery feasibility, or only commercial line terms? Make that choice explicit.
4. Can A4 demonstrate one edit propagating to every dependent ingredient, including a shared ingredient and an unresolved one?
