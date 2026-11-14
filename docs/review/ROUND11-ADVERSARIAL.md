# Round 11: purchasing intent, recovery and truthful projections

14 November 2026. Repository-wide boundary review for the lead and execution agents. Started at `6e2af40`; source snapshot `7a45877`; rendered evidence copied during `79d2029`; final probes at `bfd2c0f`. Final verification `b2dfe9c` changes only documentation after that probe boundary. Main continued changing during this review. Exact results and hashes are in [local evidence](../../scratch/round11/README.md). **New ranked findings: four P1, ten P2; no P0 established.** Earlier open cases are listed separately below.

The highest risk remains **preserving what was asked through every entry and later mutation**. Core authority checks catch many bad commands, but upstream code can lose a requirement or construct the wrong quantity before the gate sees it. Several recovery and read-model paths also declare success without representing the durable state faithfully. D16's common evaluator is the right direction; it needs journey acceptance, not only predicate tests.

Review only: no app source changes, commits, branch changes, production mutations or paid provider calls. Other sessions' working files were preserved. Evidence uses real handlers and PGlite with synthetic catalogue facts, fake fault boundaries where stated, and an explicit local fixture production server. A passing **observation** probe reproduces a defect; it is not a passing correctness regression.

## New findings, in execution order

### R11-01 · P1 · Unknown explicit units can become a much larger purchase

`server/request/lexicon.ts:161` supports litres, decilitres, kilograms and grams, but not `ml`/`cl`. `parse.ts:325` converts an unrecognised unit to `sales` and says “no unit given”. The lookup may then pick a product and proceed despite that warning. The core receives a valid sales-unit quantity and cannot recover the original intent.

The focused case asks for **250 ml** of a 1 l milk and buys **250 ST = 250 l** through the real Request pipeline and commit handler under a synthetic permissive mandate. Acceptance: support the common units, and distinguish an absent unit from an explicit unsupported token. Unknown units must ask a question before creating a purchasable quantity. Check `ml`, `cl`, `g`, joined forms, multipacks, and a genuinely unknown unit through Request and Chat. Owner: **B/E**, shared parser/quantity contract with core.

### R11-02 · P1 · Pack/case requests still lose hard requirements

`server/request/run.ts:515` creates requirement-bearing demand only for physical `kg/l/pcs` inputs. A supported “4 packs lactose-free milk” request selects the right initial product, then `orderLine` emits only product/quantity/unit. There is no need carrying the lactose-free requirement. A later substitute can therefore buy ordinary milk.

This extends R10-03 beyond menus. Fixing menu compilation alone is insufficient. Acceptance: preserve hard intent for **every supported input unit**, including case and sales units, through edit, replacement, quote and commit. Keep physical sizing when known; preserve the requirement without inventing content when it is unknown. Owner: **B + core/lead**, D16.

### R11-03 · P1 · Request still replays the wrong partial purchase

`server/request/index.ts:175` uses `rq-commit-<plan>-v<version>`. Put an autonomous line and a held line in one plan; commit the autonomous line; grant the remaining approval; commit from Request again. A partial commit and a grant do not change the plan version. The second command consequently replays the first receipt while the newly approved line remains unpurchased.

R10 fixed separate key constructors in Chat and the agent loop; the third entry still has the same class of defect. Acceptance: **one command-identity rule** across Request, Chat, loop and Kitchen. Bind exact intended lines and accepted terms; a transport retry replays the same result, while a newly authorised remainder is a deliberate new command. Assert receipt line IDs and remaining committable lines, not only a success response. Owner: **B/E + core/lead**.

### R11-14 · P1 · Mobile decisions push the chat composer out of reach

`ui/chat/ChatDock.svelte:410` gives the mobile aside only `max-height:75dvh`. Its decision region uses `max-height:45%`, which does not resolve against a definite parent height. On a planned buffet at **390 × 844**, the aside is 633 px tall but its decision region grows to 815.5 px. The composer starts at **y=1121.75**, below the viewport; a normal pointer click fails. The committed mobile sweep also times out trying to click content outside the viewport.

The dedicated browser probe temporarily sets the aside's height to `75dvh`: the decision region then scrolls at 284.4 px, the composer moves to y=795.25, and a normal click succeeds. No app source was changed by that diagnostic. The late `c6d0baf` change to this component is a comment, so this layout path remains current.

Acceptance: a definite mobile panel height with bounded, independently scrollable decision/history regions and a reachable composer; test 390 × 844, shorter screens, opened details, and the virtual keyboard. Keyboard resizing on desktop already exists; preserve it. Owner: **1f**; `$impeccable adapt`, then `$impeccable polish`.

### R11-04 · P2 · A saved purchase result still depends on a fresh supplier quote

`core/services/orders.ts:194` and `:431` fetch catalogue/offer data before the idempotency transaction. After a partial commit succeeds, make quotes for the remaining line unavailable, then retry the **identical** command: the handler returns `INTERNAL` rather than its saved receipt. Retrying `place_order` has the same preflight dependency.

Fault injection is at the catalogue port; this is not a claim that the deployed Valio adapter failed. Its cache may mask some outages. Acceptance: retrieve a completed command result without redoing unrelated provider work; retain the locked idempotency check for a genuinely new command. Include lost-response, supplier outage and same-key/conflicting-payload cases. Owner: **core**.

### R11-05 · P2 · Zeroing a direct need makes it impossible to restore

`core/services/events.ts:450` skips any draft whose quantity is zero, alongside superseded drafts. Edit a 4 l direct need to zero, then back to 4 l: the need becomes 4 l but its only line stays at zero/rejected. The edit succeeds, leaving no purchase for the restored demand.

Distinguish an inactive replacement from a zero quantity in the active strategy. Acceptance: `4 → 0 → 4` restores one active purchase; superseded originals remain inactive; splits keep their intended ratios. Combine with R10-04/05 rather than adding another resize special case. Owner: **core**.

### R11-06 · P2 · Stream repair treats a failed read as proof that missing events do not exist

`server/bus/ordered.ts:54` catches a durable-read failure, then emits later held events and advances the high-water cursor. If seq 2 arrives first and the gap read fails once, seq 2 is sent; seq 1 later arrives and is discarded. A short/capped read followed by a higher held event has the same loss mechanism. `/api/events` caps catch-up at 20,000 events, so the reader cannot promise unlimited completeness.

The new ordering fix correctly repairs normal out-of-order notifications. It must also preserve gaps on errors and distinguish a proven absent sequence from a read that stopped early. Acceptance: transient read failure, capped pagination and lost final notification recover without a reset. A retry, explicit stream error/reconnect, or durable coverage watermark is preferable to silently moving past the gap. These are deterministic schedules, not a live Postgres race observation. Owner: **9c**.

### R11-07 · P2 · The new UI event bridge has bootstrap and invalidation gaps

`ui/shell/plan-events.svelte.ts:61` polls after the page's initial read, adopts `last`, and ignores the events returned. An approval landing between that initial snapshot and the poll is skipped permanently until another relevant change or manual reload. The probe returns an op in that first poll and observes no callback, with the stream opening after it.

`planOf` also returns null for `RecordAnomaly`, although recall ops change affected plans and invalidate approvals in `core/state.ts`. There is no `run` listener. The bridge requests no workspace, so it follows the browser's own sandbox even when a page is showing a selected shared/stage room. Kitchen's subscriber excludes every `via:kitchen` op, including another Kitchen tab's edits. These latter paths are source findings; the two dock-sync happy paths passed in the browser.

Acceptance: bootstrap from the snapshot's cursor, or apply/re-read after the initial poll; follow the selected workspace/run; invalidate by affected product/plan for recalls; distinguish this command from another tab's command. Test an approval during subscription startup, recall, reset in another tab, shared room and two Kitchen tabs. Owner: **1f + 9c**.

### R11-08 · P2 · MCP executes a hidden tool before answering “not found”

`server/tools/mcp.ts:198` sends any real but unlisted tool through `serveTool` to log a refusal. Unlisted does not necessarily mean forbidden: with `VISION_LIVE` off, an external caller still has `read` scope. Calling unadvertised `read_image` executes its handler once, then the SDK answers `-32602 Tool read_image not found`.

Reproduced through the real MCP endpoint with a counted fake image handler, without a vision call. Acceptance: gate/log forbidden calls without invoking a permitted-but-disabled handler. Centralise availability policy across list, call, REST, OpenAPI and agent card. No handler work or provider spend should occur for a call returned as absent. Owner: **agent-door/lead**.

### R11-09 · P2 · “Rank by price” compares unlike packs when comparison prices are missing

`server/request/rank-by.ts:35` falls back to unit price. A 100 g pack at €2 ranks above a 1 kg pack at €10, despite a 1 kg request needing ten of the small packs (€20). This is valid catalogue data with missing comparison prices; the physical content and requested quantity are available.

Acceptance: rank by a common physical basis or total cost to satisfy the requested amount, including lot rounding. State when a basis is unavailable rather than comparing incompatible pack prices. Test missing and mixed comparison-price coverage. Owner: **B + core ranking**.

### R11-10 · P2 · The substitute classifier overstates product equivalence

`core/demand/basekey.ts:195` treats Finnish suffix/head matches as the same base. Same-brand `juusto` and `vuohenjuusto` in one category become `pack`, with no material change explained by `whatChanges`. The relation is a heuristic, not evidence of an identical product in another pack. Brand removal also uses substring replacement despite its whole-word comment.

This label does not itself bypass the mandate. It does misdescribe what a chef is approving. Acceptance: reserve pack/brand equivalence for supported identity; qualified head-noun matches should be uncertain or functional/form changes with their difference stated. Include species/material qualifiers and short brands inside other words. Owner: **core + 1f**.

### R11-11 · P2 · Ops invents an out-of-stock cause for non-stock refusals

`core/services/stages.ts:199` labels every newly unorderable line as `out` unless its reason is `undeliverable`. A line rejected for `requirement_unmet`, with 10,000 units available, is displayed as “out of stock at Valio”. Unit, origin, cut-off and hard-limit refusals can also take this branch.

Acceptance: derive the cause from typed reasons and preserve who imposed it. Never attribute a kitchen rule to supplier stock. Check the new Demand/Orders story with forbidden, fact-gap, waived and genuinely out-of-stock examples. Owner: **9c + core projection**.

### R11-12 · P2 · Ops repeatedly replays the entire workspace for every plan

`core/services/stages.ts:386` calls `orderStages(id, ops)` once per plan; each call replays the entire log and rebuilds workspace state. A diagnostic seeded run measured 3 plans/36 ops at 37 ms, 30/360 at 62 ms, and 100/1,200 at 1,812 ms. These are local samples under shared-machine load, not latency guarantees. The algorithmic repetition is source-confirmed.

Both Orders and Demand rebuild this projection. Acceptance: one replay with per-plan accumulators, or a projection cached by workspace/run/cursor, plus an explicit bounded/paginated history policy. Benchmark warm and cold projections; retain a 10× demo test. Owner: **9c/core**.

### R11-13 · P2 · Sponsor smoke can pass without a Gemini live answer

`evals/ui/services.e2e.ts:68` requires a configured Gemini key and rejects only `failing`/`breaker_open`. `idle`, `fixture`, `rules` and `replay`, including no successful live call, satisfy those assertions. Valio's “recent successful call” is process-wide, so another visitor's call can satisfy the time window.

Source-confirmed oracle gap; the live smoke was not run here. Acceptance: link the exercised request to a successful provider trace with job, workspace/run and source. Keep configuration, recent process health and this journey's live evidence as separate claims. Owner: **91 + D/9c**.

## Round 10 disposition

| Earlier case | Current judgment |
|---|---|
| R10-01, R10-10 | Original changed-terms Chat recovery and agent subset key fixes landed. R11-03 shows Request still needs the shared identity rule. |
| R10-02 | Original early pause is fenced and task cancellation stays terminal. **R10-02b remains P1**: cancel after the re-read but before purchase still buys. New probe observes a cancelled task whose final text says “Ordered”. An effect-boundary fence/ownership protocol is still required. |
| R10-03 | Menu hard-requirement lineage remains open. The late `36c3d60` guard protects the two seeded vegetarian mains; it does not compile arbitrary menu dietary intent. R11-02 adds the pack/case path. |
| R10-04/05 | Replacement-plus-edit overbuy and direct-unit contention residual remain open. Fix together with R11-05 using the active fulfilment strategy and typed residuals. |
| R10-06 | Partial recipe receipt allocation remains open; simulator currently confirms whole lines, so this is adapter-readiness rather than observed supplier short-delivery behaviour. |
| R10-07 | Ingredient-label changes now get their own grounding comparison and empty/failure results retry after a short TTL. Include resolved product identity in the comparison key too: `groundDish` uses it, while `keyOf` currently hashes labels only. |
| R10-08 | Receiving recurrence DTSTART remains open. |
| R10-09 | Durable gap repair is now on `/api/events`. The old raw-transport probe does not exercise that new layer and remains expected-failing; move the regression to the composed stream. R11-06 tests the new layer's failure behaviour. |
| R10-11 | Recipe card's certainty now reads line views. The general make-in-house summary in `live-view.ts` still says “in-stock ingredients”; remove that remaining contradictory source path. |
| R10-12 | Chat's envelope now rejects null with 400. Rendered HTTP probes still observe `/request/menu` null → 500 and `/request/run` null → 422 with `INTERNAL`. Validate all entry envelopes before property access. |
| R10-13 | Idle guard now reads authenticated status and cursor shape. Wording sweeps still fail on `/agents` prose; see browser evidence below. |
| R10-14 | Live vision check now requires successful readings and meaningful quality scores; the previous all-error pass was corrected. Live endpoint acceptance is still unverified here. |
| R10-15 | Named-product question resolver still substitutes a generic category/default variant. Remains P1 for product-specific recall/allergen/origin answers. |
| R10-16 | Agent card now uses advertised-tool policy. R11-08 finds a different gap in **calling** a hidden tool. |
| R8 durable web cases | Write-through failure acknowledgement and queue-claim integration remain explicitly open. Do not claim that database tables alone make ingestion durable across failures/instances. |

## UI and evidence quality

The local fixture production build produced 16 captures: home, Request, Ops, Agent API, planned Kitchen, open rail, Request result and Ops Demand at 1440 and 390 px. No horizontal document overflow, unnamed visible buttons or page exceptions appeared in those captures. Vertical containment still fails in the mobile rail (R11-14). The decision is above the fold at 390; full terms continue below it. The new stage-specific UI merges after the copied build need a fresh rendered pass.

The Impeccable source detector returned six side-border warnings. They are intentional grouping/evidence treatments, not six verified defects. Its rendered scan failed with a protocol connection error. Provisional technical scores: accessibility 2/4 (labels present; full focus/contrast not checked), performance 2/4 (Ops replay growth), theming 3/4, responsive 1/4 (mobile composer unreachable), integrity 2/4 (projection/cause discrepancies): **10/20**, limited audit. Small controls remain; target-spacing exceptions, screen readers and physical touch were not evaluated.

One additional data-integrity opportunity: `ui/diet.ts:75` lets an explicit/name “milk-free” claim coexist with a declared `contains milk` record and paints the free-from badge. A synthetic conflict probe reproduces that display. No such conflict in the live catalogue was established. D16 should return a visible conflict/unknown result rather than independently rendering green codes. Do not confuse wheat-allergen declarations with gluten content; they are not interchangeable predicates.

The combined committed browser suite completed: **8 passed, 3 failed, 12 skipped**, 10.6 min. Its production-only sponsor smoke was excluded from this fixture run. Failures: the desktop wording sweep's `/agents` prose; the mobile sweep's out-of-viewport interaction (R11-14); and the approval link once showing “This link's plan isn't in your sandbox”. That link's exact isolated rerun passed (5.6 s), as did the warmed direct read/link probe. Preserve it as an **unresolved intermittent failure**, with request/cookie/run timing evidence needed before attributing a root cause. The combined run is not made green by its isolated rerun. Authenticated idle and the full visitor-isolation browser test passed.

## Execution guidance

1. **B/E/core/lead and 1f:** close R11-01/02/03/14 and R10-02b/03/04/15 before widening claims. Make command identity and hard requirements shared contracts rather than entry-specific patches. Keep the last cancellation check in the same durable ownership/effect protocol as the purchase; a read immediately before the call still races. Make the mobile composer reachable before the chat-first entry lands.
2. **Core:** active fulfilment strategy, typed residuals, zero restoration and partial recipe allocation as one bounded correction. Confirm exact purchased SKUs/amounts, excess and remaining need after each mutation.
3. **9c/1f:** durable stream recovery and snapshot cursors, selected room/run lifecycle, recalls and multi-tab invalidation; correct Ops causes and remove replay-per-plan work.
4. **Agent-door/D/91:** hidden-tool call policy; durable web acknowledgements/claiming; live provider evidence tied to the exercised job. Then refresh PITCH/CLAIMS/site against one immutable source/deployed SHA.

D15 is staged by the user's instruction. Keep that staging: stage 1 must remain operable while the picker, home and request cards merge. The claimed single UI entry helper is not yet used by every check (`no-raw-ids` retains its own Kitchen/dock bootstrap). Rehearse direct deep links, resumed tasks, standalone Request and the new home at each stage. Preserve the fallback rather than letting an unfinished merge remove a working entry.

The late D17/agent-door-v2 brief preserves the right authority boundary. Add explicit pairing acceptance for single-use replay, expiry, simultaneous consumption, revocation and absence from tool results/logs. Use a configured canonical public origin for returned links. A location link must remain harmless when followed automatically; the human's rendered terms/version still bind the grant.

Use a compact journey matrix: **entry × actor × unit × hard requirement × amendment × fault × recovery**. Each case asserts the actual purchased SKU, quantity, per-line authority, receipt identity and remaining need. “The gate returned success”, text snapshots, expected-fail counts and generic provider health are insufficient substitutes.

## Verification boundary

Final source verification recorded **588 tracked source/config files and zero broken report links** at `b2dfe9c`. Own Svelte check found zero errors/warnings. Across final focused runs, **17 unique observation/diagnostic checks passed** (8 domain, 7 pure, 1 MCP, 1 performance); the mobile layout/pointer probe is separate. The committed R10 suites run plainly were **5 passed / 8 failed**. The browser suite was **8 passed / 3 failed / 12 skipped**, detailed above.

A seven-step lead gate observed earlier in this review passed with 908 unit passes, 11 expected failures, 41 skipped and six TODOs. A later six-step resumed gate also passed; these expected failures are open work, not proof of the corresponding guarantees. No competing full gate was launched by this review. Later profile/event/UI changes are source-reviewed but not covered by the earlier copied browser build.

Production health/site reads were attempted but unreachable through both the external reader and direct HTTPS from this environment. No production or live sponsor claim was verified in this round. The local `/healthz` says `db:fixture`, `commit:unknown`; the copied build has a tree hash, not deployment attestation. No live Postgres races, Docker launch, calendar-client import, full contrast/focus/screen-reader pass or physical touch test was performed. Narrow tracked-file secret-pattern and env-file scans found only `.env.example` in their restricted scope; public-history scrubbing remains lead-owned and unverified.
