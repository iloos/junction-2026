# Round 12: the product works in slices; the ask still escapes the gate

14 November 2026. Review only. **Four P1 findings, eight P2 findings; no P0 established.** The hotel journey completes at both sizes, but the target is not yet a complete product. The strongest remaining risks are purchases that disagree with the original amount or a hard requirement. Several substantial modules also have no production-facing entry.

## Evidence boundary

| Boundary | Exact revision / evidence |
|---|---|
| First `main` source read | `42dc25bc1f0e6ae97228089f38a0a3f7d66db2ba` |
| Initial archive / local runs | `b02de0b30d75df54b3eafef021ac2d76f1b0c5ce`; main advanced between the first read and archive capture; verified from the ZIP's embedded commit |
| Final source cutoff | `95d944730f6f7e084dbc4b24d085de1e89df9be2`, separately archived and probed; later changes are outside this review |
| Full production walkthrough | `b10cd4385122a9d9859c1b6e3d6d7aee7fb25c56`, `/healthz` at 17:23:39 UTC; still this revision at 17:54:46 UTC |
| Later production deployment | `494bd09fadb0574cda5d46065e6e2997e3461b25`, `/healthz` at 18:00:54 UTC; **spot checks**, not a second complete walkthrough |
| Browser | Headless Chromium, **1440 × 844 and 390 × 844**; independent visitor sandboxes per width |
| Local execution | Archived initial source, production build on PGlite, `DATABASE_URL=` blank, `LLM_PROVIDER=fixture`, `WEB_PROVIDER=fixture`, `VALIO_LIVE=0`; final-source tests use the separate final archive |

Times above are UTC; add two hours for the user's Europe/Kyiv time. Source references below refer to the **final source cutoff** unless explicitly qualified. Main and production both advanced during the review. A source fix is not automatically a deployed fix, and the earlier screenshots do not describe every detail of `494bd09`.

Only this report, the handoff and ignored `scratch/round12/` were written by this reviewer. No application edits, commits, branch changes, pushes, `.env` reads or shared/stage data mutations. Production planning, approvals and simulated orders occurred only in the reviewer's own visitor sandboxes. Provider work was through the app's existing capped paths. Synthetic offers, faults and scheduling are identified below; they are not reports of actual supplier failure.

Evidence index and commands: [scratch README](../../scratch/round12/README.md). Useful machine records: [pins](../../scratch/round12/pins.json), [full kitchen/order evidence](../../scratch/round12/order.json), [latest deployment checks](../../scratch/round12/latest.json), [final-source results](../../scratch/round12/final-results.json).

## What is demonstrably working

- All seven kitchens expose distinct events and plans after the initial hotel plan unlocks selection. Switching, navigating away with decisions held, and returning preserved the plans. Both hotel flows approved the reason groups and ordered **18 lines for €933.92**. Receipts survived reload; “Send the same order again” kept **one order and the same receipt**. These receipts say **7 supplier confirmed / 11 awaiting supplier**, with simulated ordering disclosed. See `order.json`, `followup.json`, `order-receipt-{1440,390}.png`.
- An outside agent's approval was refused. A safe lactose-free order was signed by the human's hold control and then committed over REST: one €6.24 receipt, awaiting supplier. A requirement-breaking milk plan was unorderable. See `outside-complete.json`, `outside-human-terms-390.png`, `ops-external-{1440,390}.png`.
- The mobile dock composer is reachable: its bottom was **832.75 px in an 844 px viewport**. The old R11-14 layout failure is closed on the observed production build.
- At `494bd09`, Arla whole milk remained Arla; “everything you have in apples” became `max_available`; an uncertain reading actually escalated from Flash-Lite to Flash. Persisted trace and summary routes and the usual-order API now return 200. These were missing on the earlier deployed build.
- Initial-source Svelte check: **0 errors / 0 warnings**; formatting and ESLint passed; the production build completed. The final source received focused probes, not another full gate. Source cleanliness does not establish purchasing correctness.

## Ranked findings

### R12-01 · P1 · The core accepts a preserved 250 ml ask and purchases 250 l

**Failure:** D18's `Need.ask` exists and is persisted, but it does not constrain the purchase. Through the real handlers, submit one line with `ask: {words:'250 ml milk', qty:250, unit:'ml'}`, `amount:{value:250,unit:'l'}`, and `qty:250` of a 1 l product. Quote and commit both succeed under a permissive fixture mandate. The receipt purchases **250 l, 1,000× the preserved ask**. This reproduces on both source snapshots.

**Reproduction:** `ask.test.ts` → [final-ask-boundary.json](../../scratch/round12/final-ask-boundary.json). This is an intentionally inconsistent command at the core boundary, **not** a claim that today's normal “250 ml” parser still makes the original R11 error. `core/services/orders.ts:217` stores the ask; `core/mandate/validate.ts:78` still uses broad plausibility thresholds rather than the ask/need lot bound. The newer Request rounding question improves one entry but cannot establish the core invariant.

The upstream generalisation hole remains visible on production too. At `b10cd43`, “2 buckets milk for Friday” became two sales units and a 10 l plan. At `494bd09`, the stronger model re-read it as **two pieces of a 10 l Arla novobox**, producing a 20 l plan, rather than asking what a bucket means. `server/request/parse.ts:147` recognises selected unknown units and otherwise treats longer unknown words as product words. `intent.log`, `requests.json`, and `latest.json` preserve both outcomes. No such production plan was purchased by this reviewer.

**Owner:** 8d + lead (core contract/enforcement), B/E (readings).

**Acceptance invariants:** every entry creates an ask-bearing need; a known physical ask and every serving line remain dimensionally and quantitatively consistent at quote **and** commit, with only explicitly permitted lot rounding. An unsupported explicit unit produces a question, never an invented purchasable quantity. Edits, substitutions, contention and outside tools cannot bypass that bound.

### R12-02 · P1 · “No gluten cereals” accepts a product explicitly declaring wheat

**Failure:** `meets()` and the diet marks interpret different allergen vocabularies. The real cached catalogue record **460082, Kikkoman 150ml Soijakastike**, declares `contains:['AY','UW']` and has no gluten-free claim. `meets(product,{excludes:['gluten_cereals']})` returns **ok**; a fixture quote and commit purchase it under the mandate. The UI correctly lists wheat and omits G.

**Reproduction:** `intent.test.ts`, “real wheat-declared soy sauce…” → [final-wheat-gate.json](../../scratch/round12/final-wheat-gate.json). Real product facts, synthetic known stock/price and kitchen; not a production purchase. `core/mandate/meets.ts:46` checks `AW/GLUTEN/WHEAT`, omitting `UW` and the other cereal codes that `ui/diet.ts` handles. The same failure survives the final-source pass.

A second, synthetic conflict probe returns ok and paints M for an explicit milk-free claim alongside declared AM. No such milk-claim conflict was found in the cached catalogue. This demonstrates missing conflict handling, rather than an observed live product defect. Wheat allergen declarations and gluten content are not interchangeable; the concrete failing need here explicitly excludes **gluten cereals**.

**Owner:** 8d (facets/evaluator), 1f/da (marks and answers consuming it).

**Acceptance invariants:** the gate, marks, lookup and answers derive from the same normalised facts and requirement semantics. A declared wheat/cereal fact cannot satisfy this cereal-exclusion need merely because an aggregate code is absent. Contradictory evidence never authorises a free-from claim. Preserve the valid distinction between lactose-free milk and milk-free products.

### R12-03 · P1 · A vegan Request becomes cow's milk, with the warning providing no protection

**Failure:** “4 l vegan milk for Friday” produces **Valio vapaan lehmän kevytmaito** with no diet requirement. It happened on both deployed revisions. At both widths, the request page offers approval for that dairy product. With declared milk and known stock in a normal fixture kitchen, the same Request pipeline makes the line eligible and commits it **under the mandate**, without human approval.

**Reproduction:** `/request`, enter those words and Find and price; `request-vegan-{1440,390}.png`, `latest.json`; local `intent.test.ts` / `intent.log` and `final-probes.log` (`VEGAN_REQUEST`, `VEGAN_COMMIT`). `server/request/reading.ts:57,187` calls vegan/vegetarian unsupported and emits a **revise** warning; `server/request/lookup.ts:87` still compiles only lactose-free, gluten-free, Finnish and organic. The gate can enforce `diet:['vegan']` when supplied, but the producer does not supply it.

**Owner:** B + E, with 8d/lead enforcing the contract.

**Acceptance invariants:** an explicit hard dietary ask is either retained on every need and enforced throughout the purchase, or blocks for clarification before a purchasable plan exists. A warning, unknown stock or unrelated new-product approval never substitutes for that requirement. Test Request, chat, menu and outside tools with the same facts.

### R12-04 · P1 · A contention repair buys six litres for a four-litre need

**Failure:** the original R10-05 still reproduces and now has a purchase-level observation. Plan 4 l; change the first product's available amount to 2; run the real contention rescue. It keeps **2 l** and adds **4 l**, not the 2 l remainder. Commit buys both lines, €6 at the probe's €1/l price, while the need remains 4 l.

**Reproduction:** `contention.test.ts` → [final-contention.json](../../scratch/round12/final-contention.json). `core/services/contention.ts:113` passes coverage through `coveredServedKg`; the direct-litre need does not retain a typed residual through that path. This is controlled catalogue contention, not a claimed live multi-kitchen race.

**Owner:** 8d.

**Acceptance invariants:** the active fulfilment strategy conserves the need across retained stock and every added contribution, in the need's own unit. Only the remainder is added; supplier consumption and the receipt equal that strategy plus legitimate lot rounding. Test litres, kilograms, pieces, recipe AND contributions and split edits together.

### R12-05 · P2 · The first establishment choice and the shared basket are not the delivered home

**Failure:** a fresh visitor sees the hotel buffet and a **disabled kitchen selector**. They must plan that event before choosing their own kitchen. `/join` is 404 in production and in the local production build; its source explicitly makes it a dev preview. The one composer → canvas flow is absent.

The Kitchen still renders one focused/event plan with “Also open” links. The final source adds a useful basket projection and route, but neither `KitchenScreen` nor its store consumes that basket. Requests, usual orders, chat and outside-agent plans therefore have no combined purchasing view on the chef's canvas yet.

**Reproduction:** fresh `/` at both widths, `kitchen-selector-disabled-*.png`, `latest-home-*.png`; `/join`; `routes/(kitchen)/KitchenScreen.svelte:683`, `routes/join/+page.ts:4`, `server/kitchen/live.ts` `findPlan`, `core/services/basket.ts`, and a reference search for its route/consumer. Seven distinct events themselves passed (`kitchens-verified.json`).

**Owner:** 1f + lead; c3/0d for establishment selection.

**Acceptance invariants:** choosing an establishment creates no unrelated plan; the selected establishment, chat context and visible purchasing scope agree. Every active source is reachable and represented in the canvas with its origin, date and decision state. Editing or deciding on either surface updates the other without duplicate decisions. If stage 2 is deferred, the entry must truthfully expose the narrower scope.

### R12-06 · P2 · Usual order exists behind an API, with four kitchens having no history

**Failure:** there is no usable usual-order panel in the production Kitchen. `UsualOrder.svelte` is mounted only under the dev-only `/dev/usual`. The new deployment exposes `/kitchen-api/usual`, but users cannot reach its window, rhythm, joined/dropped, top-up or “Plan this order” workflow.

Only P1–P3 have history recipes. Local production reads returned hotel/lunch/central line counts **5 / 5 / 3**, and **0** for à la carte, care home, café and ski resort. `simulateHistory` deliberately returns an empty history for an absent profile.

**Reproduction:** `/`, `/dev/usual`, `/kitchen-api/usual?kitchen=k-hotel`; `local.json`, `latest.json`; `fixtures/seeds/usual-history.json:5`, `core/patterns/history.ts` `simulateHistory`, and component-reference search.

**Owner:** U (history/planning), 0d (profile seeds), 1f (mount/interaction).

**Acceptance invariants:** each promised seeded kitchen has its own labelled simulated history and a reachable day/window view. Rhythm overrides and joined/dropped changes affect the displayed suggestion. Nothing is ordered or granted until the chef confirms; confirmation creates an ordinary gated plan and leaves its resulting decisions reachable. Empty history explains why and offers a useful next step.

### R12-07 · P2 · The product card and verified listing/photo are not reachable from a product

**Failure:** the product names in the exercised Request and Kitchen views do not open the new shared card. `ProductToken.svelte`, its loader and the product API exist, but a final-source reference search finds **no ProductToken consumers**. There was no product-card button to click in the attempted desktop/mobile Request journey.

**Reproduction:** `/request`, submit the Arla/Valio milk cases, click the result product; `request-brand-*.json/png`, `local-request-brand-390.png`; reference search across `src/` for `ProductToken`. `ui/ProductToken.svelte` documents and implements the missing entry. Public-listing and photo verification were source-read, not verified as a live user journey.

**Owner:** D (card/listing), 1f/B (Kitchen and Request adoption).

**Acceptance invariants:** a quantity token and independently named product affordance open the same facts at both sizes. The card's amount, pack, price, availability, diet and delivery basis match the line. Only an exact verified barcode match supplies a public listing/photo; an unmatched image is never shown as that SKU. Missing facts are visible, useful and honest.

### R12-08 · P2 · An outside agent still cannot revise a menu into a reviewed plan

**Failure:** `revise_menu` is not in the advertised registry and returns tool-not-found. The final source has `ReviseMenuInput` and a handler local to `server/menu/tool.ts`, but no registered tool or serving wiring. The journey stops when one ingredient must be pinned or corrected without regenerating the proposal.

The earlier deployed build also returned relative approval links and a menu next step without a review URL. Those link defects have source fixes; the later deployment's links were spot-checked separately in `latest-mcp.json`. Do not keep them labelled as current source defects. Device pairing worked locally; a second-device production approval was not exercised.

**Reproduction:** `/agents` → own judge key → MCP `get_context`, `plan_event`, `propose_menu`, then `revise_menu`; `external.json`, `latest-mcp.json`, `server/menu/tool.ts:29` and absence from `core/contracts/tools.ts`/`server/tools/handlers.ts`. The later held-plan response provides an absolute `https://app.mandate.kitchen/` approval URL. Human approval and one safe external commit did complete (`outside-complete.json`).

**Owner:** da + menu-v2/41; lead owns registry/contracts.

**Acceptance invariants:** propose → revise one ingredient → human review → plan → human approval if required → one receipt converges without losing unrelated product picks. Results provide absolute, workspace-correct locations and requirement-specific next actions. Agent channels never receive pairing/approval authority, and hidden tools perform no handler/provider work.

### R12-09 · P2 · Persisted observability is an API, not the Ops experience

**Failure:** persisted traces and per-source summaries now work, but `TraceDrawer` and Ops do not read `/api/ops/traces` or its summary. A person cannot use the intended Ops surface to retrieve those stored calls or a per-sponsor summary after reopening it. The in-memory live view and process-wide service status are different evidence.

**Reproduction:** exercise Request with `x-request-id`, read trace routes, then reopen Ops/Engine room. `local-more.json` has 5 persisted tool traces per fixture request with the supplied id. `latest.json` captures live trace/summary responses after `494bd09`; the routes were 404 on `b10cd43`. Reference search of `routes/ops/{TraceDrawer,+page}.svelte` finds no history/summary fetch. Persistence across an actual production restart was not fault-tested.

**Owner:** O (trace contract/writer) + 9c (Ops consumer), 91 (job-linked evidence).

**Acceptance invariants:** reopening Ops recovers stored calls in the selected workspace/run; live and stored rows deduplicate. Each exercised provider call can be followed by request id from input to tool/model/outside trace and outcome. Per-sponsor counts distinguish live/cache/replay/fixture, and absence of this journey's successful call cannot be presented as its success.

### R12-10 · P2 · A cancelled task is safe but still offers Continue

**Failure:** the cancellation fence now prevents a purchase even when cancellation lands at the commit boundary. However the final `done` event says `state:'cancelled'` **and** `canContinue:true`, with “1 line can be ordered now”. It offers continuation on a terminal task whose next continuation cannot perform that action.

**Reproduction:** `cancel.test.ts` pauses the real commit wrapper, asserts that the boundary was actually reached, cancels, releases and records zero orders. [final-cancel.json](../../scratch/round12/final-cancel.json) preserves the contradictory end event. `server/chat/turn.ts` `continueTask` and final ledger/answer composition need the same terminal-state rule.

On `b10cd43`, “what” after a held order instead asked “What would you like to do?”, and unsupported “all your apples” retained the previous milk task title. Those follow-up observations (`chat-turns.json`) were not re-run on `494bd09`; treat them as follow-up acceptance cases, not proof they remain unchanged.

**Owner:** E + 1f.

**Acceptance invariants:** cancelled tasks emit no continuation CTA and cannot be resurrected. Final words, state, pending decision and buttons describe the same task. A question about the current task stays in its context; an unrelated new goal either creates a clearly named task or explicitly asks how to proceed. Every turn ends with useful words.

### R12-11 · P2 · Proof, pitch and landing calls to action do not share one release truth

**Failure:** `/proof` says the buffet has **15 confirmed / 3 awaiting**, while both observed receipts show **7 / 11**. The public chain says Lounas may order alone up to €400 a line while its exercised mandate says €800. Historical cards are usefully labelled with `b2dfe9c`; the unqualified proof and rule statements still need a current release binding. `docs/PITCH.md:16` says the in-house rescues use known-stock ingredients although D8a explicitly permits unstated supply. CLAIMS' top checkpoint and parts of PITCH still describe older freezes and capabilities.

The anonymous **Source link returns 404** at `https://github.com/iloos/junction-2026`, so judges cannot follow the proof links. The review did not publish or inspect secret values. Public availability must follow the lead's scrub/history process. The landing case buttons all go to generic Request/Agents/Kitchen URLs; “See it in the app” does not carry the recorded request, and opens an empty form rather than that case.

**Reproduction:** `/`, `/how`, `/story`, `/proof` at both widths; `site*-*.json/png`, `public-repo.json`, `order.json`; `site/public/proof/index.html:107`, `docs/PITCH.md:16`, `docs/CLAIMS.md`. No broken app/site route among these four site pages was found.

**Owner:** d0 (site), 91 (claims/evidence), lead/pitch owner (presentation and public release).

**Acceptance invariants:** every demo number and built/live/next statement names evidence from a declared release or is explicitly historical. No supply certainty exceeds its receipt/source. Anonymous judges can follow the final source/proof links after the authorised scrub. A case CTA either opens that case with its ask preserved or honestly labels itself as a generic entry.

### R12-12 · P2 · Several regressions fail for obsolete reasons or have stale OPEN flags

**Failure:** the final-source adversarial run is **41 tests: 31 pass / 10 fail**, with `ADV_SHOW=1`. Those are not ten current product regressions. Six are substantive known defects; four exercise obsolete boundaries/contracts:

- R11-06a/b return arrays where `orderedSender` now requires `{events,complete}` and omit `onLost`; the error is `o.onLost is not a function`.
- R11-07a expects forwarded bootstrap ops, but the current bridge intentionally emits `{resync:true}` after 400 ms. The corrected 600 ms probe receives that burst.
- R10-09 still exercises raw transport rather than the composed durable ordered sender.

At the initial snapshot, R11-02 and R11-11 also used “ordinary milk” with a declared **empty** allergen list, making the new evaluator correctly read no milk allergen; they were not faithful reproductions of ordinary dairy. The final shared fixture corrects this, and both cases pass. Mobile's stale failure flag was removed in the later source. Final-source OPEN entries still include passing R11-05 and R11-15, which makes normal expected-failure execution report unexpected passes.

**Reproduction:** `earlier-results.json`, `final-results.json`, `intent.test.ts` corrected stream/bridge probes, final `adversarial-r11.test.ts:254,288`, `adversarial-transport-r10.test.ts`, and OPEN map. D20's kind/cascade tests passed with supplied model shapes, but that is not a held-out language accuracy measurement; production's bucket re-read demonstrates the distinction.

**Owner:** 91, with 8d/9c/1f and B/E supplying current contracts and faithful fixtures.

**Acceptance invariants:** each regression reaches the effect/failure boundary it names and asserts the intended state/receipt, not an incidental exception. OPEN flags reflect current behaviour. Composed recovery is tested with current APIs; fixture facts represent the adversarial claim. Language evaluation measures held-out words through the model, separately from tests supplied with the desired shape.

## Target-shape gap table

| Target | Judgment | Evidence and remaining boundary |
|---|---|---|
| 1. One gate, vocabulary, needs, amount binding, command identity | **Partial** | `serveTool`/`applyOps`, scoped authority, terms and receipts work. Final source adopts `commandKey` in Request/chat/loop and fixes unknown-pack lineage. R12-01/02/03/04 violate the promised ask/requirement invariants; UI marks still compute separately. Kitchen's remaining identity integration needs its own check. |
| 2. Intent shape, reading judge, cascade, generalisation | **Partial** | Source has exact/range/max/people kinds and cascade; 28 targeted request/pair/obs tests passed on the initial archive. Latest production demonstrated Arla retention, max_available and escalation. The escalated bucket reading still invents pieces; vegan is merely warned. Fixture “between 4 and 6 l” split into two items; the rules fallback does not establish language coverage. |
| 3. Chat/canvas, one basket, decisions once, human approval, words each turn | **Partial** | Human-only sign-off and reachable phone composer passed; held decisions persist, both order journeys complete. Establishment/chat-first entry and aggregate canvas are unwired; cancelled task CTA disagrees with state. Latest chat menu rendering was source-read, not re-walked end to end. |
| 4. Seven establishments, per-kitchen memory/usual order | **Partial** | Seven distinct event plans passed. Only three profiles have history; usual-order UI remains dev-only/unmounted. API now deployed and honestly says simulated history. Window/override/joined/dropped confirmation journey cannot be completed through production UI. |
| 5. MCP/REST same guarantees, absolute links, pairing, named refusals | **Partial** | Approval refusal and human-then-agent purchase passed. Local pairing worked; later production has new link/tool presentation. `revise_menu` is still absent; early deployed schemas silently stripped newer diet/excludes fields. Second-device production sign-off and the complete revised-menu chain remain unverified. |
| 6. Persisted request traces, structured logs, sponsor summary | **Partial** | Local and latest production trace APIs work; supplied request ids persist. Structured logging exists. Ops does not consume trace history/summary, and this review did not restart prod, exhaust provider budgets or inspect its platform logs. |

## R10/R11 disposition at the final source cutoff

“Source pass” below is deliberately narrower than “closed on the deployed build”. All invariants remain required at every entry. Previous reports retain the full original reproductions.

| Case | Disposition / production evidence | Owner · invariant still required |
|---|---|---|
| R10-01, R10-10 | **Source pass.** New commandKey adopted in three entries; original price-drift/subset tests pass. Full production retries passed for the hotel; changed-terms subset sequence not re-run there. | E/B/8d · retry replays; a newly authorised subset/terms gets a deliberate command. |
| R10-02, R10-02b | **Source pass**, including independently asserted commit-boundary arrival and zero orders; terminal CTA defect is R12-10. No production cancellation race injected. | E/8d · accepted cancellation fences effects and remains terminal. |
| R10-03 | **Source pass** for menu requirement lineage; vegetarian guards also exist. Earlier prod's newer `diet/excludes` inputs were stripped. Broader Request diet gap remains R12-03. | B/41/8d · every reviewed hard requirement reaches every serving need and survives replacement. |
| R10-04 | **Source pass** for replacement then amount edit. No production edit-to-receipt replay performed. | 8d · resize the active strategy once; never revive superseded contributions. |
| R10-05 | **Open P1**, strengthened to a committed six-for-four purchase in R12-04, both source snapshots. | 8d · retained + added supply equals the typed residual demand plus rounding. |
| R10-06 | **Open P2**, correctness probe still overstates a partially confirmed recipe (10 vs ≤1). Production simulator confirms whole lines, so adapter-readiness scope. | 8d · an AND recipe's confirmed allocation is bounded by its scarcest confirmed ingredient. |
| R10-07 | Original label-change probe **passes**. Source-only remainder: grounding key hashes ingredient labels, not resolved product ids (`web/grounding.ts:198`). | D · changed grounding inputs, including resolved identity, cannot reuse an incompatible comparison. |
| R10-08 | **Open P2**, Thursday-only recurrence still starts on Saturday (`20261107`). Not imported into a real calendar app. | 8d/9c · DTSTART belongs to the recurrence's receiving weekdays. |
| R10-09 | Raw transport test still fails; **obsolete closure oracle** for the composed repair. Current sender transient-read probe passes. No live multi-process fault schedule run. | 9c/91 · reconnect resumes after the last delivered durable sequence, without loss. |
| R10-11 | Source/observed line supply is honest; receipts distinguish 7 confirmed / 11 awaiting. **Pitch known-stock sentence remains wrong** (R12-11); general recipe summary needs consistency. | 1f/8d/pitch · every recipe certainty equals its least-certain required contribution. |
| R10-12 | `/request/menu` and chat null → **400** on both local and prod. `/request/run` null still **422 INTERNAL**, both. | B · every invalid envelope is a typed input error before property access. |
| R10-13 | Raw codes remain on first-run outage descriptions and order activity outside System; `/agents` prose presentation improved. Current full wording suite not re-run. | 1f/B/da/91 · judge-facing prose contains words; technical identities stay in the declared depth. |
| R10-14 | Live vision quality bar was source-read; **live endpoint unverified**. No vision calls made. | D/91 · success requires an actual successful reading and the declared quality threshold. |
| R10-15 | **Source pass** on named product questions; corrected OPEN tracking. Latest Request brand retention also observed. Actual named-product recall answer not exercised live. | da/B · an answer is about the named SKU, or asks which; never a generic default. |
| R10-16 | **Source pass** on advertised-tool policy; production tool listing checked twice. | da · list, card, REST and call availability agree. |
| R11-01 | Common ml/cl/g and joined ml convert correctly on production. Unknown longer units remain unsafe (R12-01). | B/E/8d · explicit unsupported units never become sales/piece quantities. |
| R11-02 | **Nominal case fixed.** Initial inherited failure used bad dairy facts. A faithful known-content pack probe retained LACTOSE. An unknown-content pack really lost it on initial source; final source now makes a sales need and rejects ordinary milk. | B/8d · every unit/content case retains its ask and requirements. |
| R11-03 | **Source pass** for Request remainder identity; final commandKey adoption improves convergence. | B/E/8d · newly approved remainder is bought exactly once. |
| R11-04a/b | **Open P2**, identical saved-result retries still fail during a fresh supplier quote outage. New replay handling is after provider work. | 8d · retrieving a completed command result does not depend on another supplier call. |
| R11-05 | Failed initially; **source pass at final cutoff**. OPEN flag stale. | 8d/91 · 4 → 0 → 4 restores one active purchase without reviving replacements. |
| R11-06a/b | Inherited probes use obsolete API. Corrected transient-error sender probe passes; production recovery not fault-injected. | 9c/91 · failed/incomplete durable reads never prove a gap absent. |
| R11-07 | Current bridge sends startup resync after 400 ms and routes anomalies; corrected probe passes. Old test expects a different callback. Room/reset/recall/multi-tab combinations not comprehensively browser-tested. | 1f/9c/91 · startup, recalls and run changes cause the correct room's state to refresh. |
| R11-08 | **Source pass**, handler invocation counter stays zero. Hidden image and approve calls were refused on prod. | da · absent tools perform no work/spend before being refused. |
| R11-09 | **Source pass**; total-cost price basis correction landed. Production “Rank by” seen; missing-basis counterfactual rests on tests. | B/8d · compare equal demand cost or state that no comparison basis exists. |
| R11-10 | **Open P2**, cheese/goat cheese remains classified as another pack. | 8d/1f · equivalence labels never conceal a material/species change. |
| R11-11 | Initial suite's empty-allergen milk made it a false reproduction. Corrected final suite passes. Prod Ops correctly said a milk refusal was the kitchen's rule, not Valio stock. | 9c/8d · causes preserve the typed reason and who imposed it. |
| R11-12 | **Source pass**. Initial-source projection samples: 3 plans/36 ops 19.4 ms cold; 30/360 24.5 ms; 100/1,200 117.6 ms; warm samples lower. Diagnostics, not latency promises. | 9c/8d · one replay per projection with a bounded history policy; retain 10× coverage. |
| R11-13 | Per-request provider oracle tightened in source. Latest live trace APIs now supply evidence; full services smoke not run here. | 91/O/D · only this exercised job's successful live trace proves its live claim. |
| R11-14 | **Closed on observed prod** at both widths; source flag subsequently removed. Virtual keyboard and physical touch not checked. | 1f · composer remains reachable with bounded scrolling and opened decisions. |
| R11-15 (added after the earlier report) | Large-rounding question now passes at final source; OPEN remains stale. Latest source not rendered for this exact case. | B/8d/91 · a materially oversized smallest pack needs an explicit decision, and the core still binds the original ask. |
| R8-web-write / R8-queue-claim | Still explicitly OPEN in the source suite; not re-run in this pass. Tables alone do not establish failure-safe ingestion. | D · acknowledgement implies durable work, and another instance's claimed work is actually drained. |

## Nine-journey matrix

The complete browser walkthrough is on `b10cd43`. Later changes and source-only checks are stated in the last column. **Partial/fail is against the requested end-to-end target, not a claim that every step failed.**

| Journey | 1440 | 390 | First breaking step / evidence |
|---|---|---|---|
| 1. Kitchen as basket | **Partial** | **Partial** | First establishment choice disabled before the hotel plan. Seven distinct event plans, held return, approvals, receipt/reload/retry passed; aggregated sources are not on the canvas. `kitchens-verified.json`, `order.json`. |
| 2. Request | **Fail** | **Fail** | Vegan requirement discarded; unknown container guessed. Common units work, brand now fixed on later deploy; dish/raw choice and over-limit alternatives are visible. Date changes and edit entry exercised. `requests.json`, `request-ui.json`, `step-edit*.png`, `latest.json`. |
| 3. Chat | **Partial** | **Partial** | “what” resets to generic intent; all-apples falls back to old task on the earlier build. No silent end in captured turns. Cancellation safety passes locally, terminal CTA fails. Dock approval works; composer reachable. `chat-turns.json`, `final-cancel.json`. |
| 4. Diet/requirements | **Fail** | **Fail** | Vegan ask proposes dairy on both production revisions. Gate/mark contradiction demonstrated with real wheat facts locally; original seed vegetarian protection exists. `request-vegan-*.png`, `final-wheat-gate.json`. |
| 5. Usual order/history | **Fail** | **Fail** | No production UI entry; later API works. Local three-profile history only; window/override/joined/dropped user flow cannot be reached. `local.json`, `latest.json`. |
| 6. Product card | **Fail** | **Fail** | Product result does not open ProductToken/card; no consumers in final source. Exact listing/photo user journey unverified. `request-brand-*.json/png`. |
| 7. Operations | **Partial** | **Partial** | Orders and per-day Demand render and reflect the purchase; correct rule-vs-stock cause observed. Stored trace history/sponsor summary not connected to Ops. 10× local projection diagnostic passed. `ops-*.png`, `performance.json`, `latest.json`. |
| 8. Outside agent | **Partial** | **Partial** | Menu revision is not an offered tool; earlier review links incomplete. Own-key planning, authority refusal, human sign-off and external receipt passed. New links checked later, pairing only locally. `external.json`, `outside-complete.json`, `latest-mcp.json`. |
| 9. Public site | **Partial** | **Partial** | Four pages load; chain and cards read. Source/proof target 404, stale unqualified numbers/rules and generic case CTAs break the evidence-to-app chain. `site*-*.png/json`, `public-repo.json`. |

## UI, architecture and demo guidance

The current design is recognisably Mandate and its dense purchasing views remain usable at both widths. No horizontal document overflow appeared in the recorded primary views. The source detector produced six side-border warnings; those are grouping/evidence treatments, **not six established UI defects**. Its rendered scan failed with a protocol-connection error, so there is no automatic contrast certification. Provisional, limited audit: accessibility 2/4 (labels present; full focus/contrast untested), performance 3/4 (projection improved), theming 3/4, responsive 3/4 (composer fixed; physical touch/keyboard untested), integrity 2/4 (state/copy and integration gaps): **13/20**. Use `$impeccable harden`/`adapt` for the verified state/entry issues, then `$impeccable polish` after the purchasing corrections.

Keep the pure core, ports, human authority boundary and explicit supply partition. The architectural problem is unfinished enforcement and integration, not a need for another platform: a stored ask with no validator, multiple fact interpreters, implemented components with no consumers, and read APIs not joined to the user surface. The late commandKey adoption, typed causes, cancellation fence and single-replay Ops projection are improvements worth preserving.

For the demo, rehearse one **pinned** event journey and one explicit item, then the outside-agent refusal and human handoff. Say that orders and supplier receipts are simulated. Say “7 confirmed / 11 awaiting” only while showing that recorded receipt; do not promise the same live basket after a different quote. Do not present establishment onboarding, usable usual orders, product cards, a convergent revised-menu agent flow or full Ops trace history as shipped until their entries work. The new deployment deserves a complete rerun before the final recording; this review's post-deploy checks do not replace it.

Limits: no full final-source gate, live Postgres race injection, supplier-outage production test, provider-cap exhaustion, production restart, real calendar import, physical phone/virtual keyboard, Safari/Firefox, screen-reader/contrast audit, or live vision endpoint. Later-source and later-deployment changes require their own pinned acceptance run. Scratch contains private visitor credentials/state and catalogue evidence; keep it ignored and curate/redact before sharing.
