# Round 10: composed journeys and release evidence

14 November 2026. Started at `6af9c1b03951320c5006a55344f7d5e28130bcd3`; final source/probe pass at `9513abb6a8a755ac58725fc0e043990cb66ea8fa`. Final verification at `1d1e72f` adds documentation changes only. The checkout is shared and advanced during this review. Only this report, its handoff and ignored scratch evidence were written by this reviewer. Application changes, commits, production writes and paid provider calls were outside this pass.

## Judgment

Keep the pure core and ports. The previous review has produced substantial fixes and a useful adversarial suite. Its original reproduction cases mostly pass as correctness checks now. The remaining release risk is **composition**: a corrected individual operation does not yet preserve the purchasing intent across another operation, a retry or a concurrent cancellation.

The highest priorities are command identity across both execution paths; cancellation at the purchase boundary; menu requirements surviving planning and substitution; replacement strategies surviving edits; and exact product identity in the newly merged question flow. These warrant one coordinated E/core/lead integration batch before further expansion.

Sixteen findings are ranked below: six P1, nine P2 and one P3. No P0 was established in this pass.

**Validation is mixed:** the seven-step gate passed, but the full committed browser suite was **4 passed / 4 failed**. Twelve additional observation probes reproduced defects. Two corrected scratch browser guards passed. Observation probes passing means a defect was reproduced, not that the application is correct.

## Purchasing and task findings

### R10-01 · P1 · Chat cannot continue after material terms change

**Reproduced:** draft four litres; change the fake supplier price; Continue returns `TERMS_CHANGED` and saves a new quote/version. Continue again on the current terms returns `DUPLICATE`, creates no order and still offers Continue. Its final sentence is “Nothing new to order,” concealing the failed attempt.

`chat/turn.ts:1407` derives the command key from task, plan and selected line IDs, omitting the terms/command generation. `orders.ts` correctly hashes the complete input, including version, and remembers the failed command. The same line set on the new version therefore collides with a different payload.

**Fix:** one durable purchase-command identity binding the intended line subset and accepted terms/authority. An unchanged transport retry reuses it; a deliberate attempt on changed terms gets a new command. Surface the failure rather than replacing it with a no-op sentence. **Owner:** E + core/lead. **Acceptance:** price drift → re-quote → review/grant if required → Continue succeeds once; retry returns that receipt.

### R10-02 · P1 · Cancellation during a reserved Continue is undone after purchase

**Reproduced with controlled scheduling:** pause Continue at its first `get_plan`, after its task reservation but before any commit. Another turn successfully cancels the task and promises that nothing more will be ordered. Release Continue: it buys, then reconciliation changes the task from cancelled to done.

The reservation (`chat/turn.ts:570`) is a versioned write, not exclusive ownership of an execution. Cancellation writes independently at `:379`; the final conflict reconciliation spreads the old task over the latest row at `:863`, overwriting its terminal state. The purchase command never checks that cancellation.

**Fix:** give an executing turn durable ownership/generation and fence its effects against cancellation. Preserve terminal state during reconciliation. If cancellation cannot stop an already executing atomic purchase, return that precise outcome; this probe pauses before purchasing starts. Do not hold a database transaction across a model call. **Owner:** E + lead/core boundary. **Acceptance:** pause before commit → cancel → resume; no new receipt and no resurrection. Also attempt a second turn after the first reservation has succeeded, rather than only racing two initial reads.

### R10-03 · P1 · A reviewed menu loses its lactose-free requirement before substitution

**Reproduced:** a chef-reviewed lactose-free milk soup pins lactose-free milk. `plan_event{proposal}` creates a need with the claim in prose but no `requirements`. Applying a substitute selects ordinary milk, and the shared commit gate purchases it under the mandate.

`core/demand/menu.ts` retains claims only in provenance. The new deterministic requirement check works when `Need.requirements` exists, as it does for direct Request orders; the menu path never supplies it.

**Fix:** translate the reviewed dish/ingredient requirements into durable constraints and validate every subsequent product against them. Preserve counted-diet scope and ingredient relevance; indiscriminately requiring a lactose-free label on every vegetable is not a suitable conversion. Unknown evidence must stay visible. Chef acceptance of estimates must not erase a dietary requirement. **Owner:** core/lead contract + B/E propagation. **Acceptance:** menu proposal → chef review → plan → substitute → edit → commit cannot buy ordinary milk for this need. Extend to vegetarian/vegan and unknown allergen data.

### R10-04 · P1 · A menu amount edit revives the original alongside its replacement

**Reproduced:** replace an in-stock milk ingredient; the original correctly becomes zero/superseded. Change the menu ingredient from 100 to 200 ml per guest. Its need becomes 8 l, but the original and substitute each become 8 l. Commit purchases 16 l. Fulfilment correctly exposes 8 l excess; it does not prevent the wrong purchase.

`events.ts:483–489` sizes every line of the menu need to its entire new amount, including the superseded original. The seeded-event edit branch similarly restores fresh base drafts before resizing replacements; it needs the same strategy-level acceptance check.

**Fix:** amend the active fulfilment strategy. A superseded original stays superseded; a split is resized as a split, and a recipe through its ingredient ratios. **Owner:** core + E/B acceptance. **Acceptance:** substitution → amount edit → grant → commit buys the amended requirement once, plus only legitimate pack rounding. Add a seeded-event variant too.

### R10-10 · P1 · The agent loop still collides different purchase subsets

**Reproduced on current source:** commit line A using `withServerKey`, then line B of the same plan/version. Both receive `agent:commit:<plan>:v<version>`; the second is `DUPLICATE`. This is the original partial-commit identity problem surviving in the other execution path (`agent/loop.ts:300`), while Chat received a separate fix with the different R10-01 failure.

**Fix:** use the same command-identity implementation in the loop and Chat. **Owner:** E/lead. **Acceptance:** mixed eligible/held plan → purchase eligible subset → later grant → purchase remaining subset; transport retries of either remain safe. Run this through both the loop and Chat.

### R10-15 · P1 · A named-product question answers for the generic default

**Late merge, reproduced at `9513abb`:** ask where “Arla whole milk” comes from, with Arla whole milk and Valio semi-skimmed milk both in the fake catalogue. The answer selects Valio and says Finland, even though the named Arla product says Sweden.

`agent/intents/questions.ts` uses the known “milk” lexicon entry, discards the brand/variant when searching, applies the default preference, then takes the first hit. Whole-word filtering runs only for queries outside the lexicon. The same picker serves recall and allergen questions, so product identity must precede those checks.

**Fix:** preserve explicit brand, variant, size and product code; ask which product when they do not establish a unique match. Defaults are appropriate for an unspecified purchase, not evidence about an explicitly named product. **Owner:** agent-door + B resolver seam. **Acceptance:** two brands/variants with different facts; answer the named SKU or ask, never silently answer the default. The read-only allowlist is useful and should remain.

## Other reproduced boundary failures

| ID / priority | Evidence and consequence | Correction / owner |
|---|---|---|
| **R10-05 · P2** | Contention on a 4 l direct need with 2 l left keeps those 2 and adds a full 4 l substitute: 6 l planned, 2 l excess. `contention.ts:79` computes retained coverage only in kg; `substitutes.ts:267` sizes direct needs to their full amount. This generic function is broader than the current ham-specific UI toggle. | Use a typed residual amount in the need's own unit, with lot-safe retention. Core. Prove kg, l and pieces before describing contention as general. |
| **R10-06 · P2** | The direct partial-receipt fix does not apply to recipes. Pure probe: 10-unit ingredients A/B, only 1 of A confirmed; recipe reports all 10 kg supplier confirmed. `fulfilment.ts:162–172` ignores `confirmedQty` in the recipe branch. | Allocate confirmed and awaited recipe portions using each ingredient's confirmed quantity, with the recipe's limiting ratio. Core. Current simulator confirms whole lines; this is an adapter-readiness gap, not an observed partial Valio receipt. |
| **R10-07 · P2** | Ground a dish, then change its ingredients without changing its name. The second proposal inherits the first comparison, including an ingredient it no longer contains. `web/grounding.ts:167,192` keys the complete comparison only by slugged dish name. | Cache retrieved source recipes by query, but key comparisons by proposal/revision or canonical ingredient digest. Recompute after edits; retain source age/mode. D + B. |
| **R10-08 · P3** | A Thursday-only receiving profile emits a recurrence whose `DTSTART` is Saturday 7 November, the arbitrary feed-window start (`core/calendar.ts:230`). | Anchor the series on the first receiving day inside the window; check it in a calendar client. Core/calendar. No client import was exercised here. |
| **R10-09 · P2** | The fixed receiver serializes arrival order, which need not be op-sequence order. Two concurrent `PgTransport.publish` calls with a delayed first fake NOTIFY arrive `[2,1]`; the actual SSE high-water rule streams only `[2]`. Post-commit publishing is detached, and run checks catch up only when the run changes. | Treat notifications as hints and fetch durable ops in sequence, or prove ordering across every publisher/process and recover gaps before moving the cursor. 9c/lead. This is a mocked scheduling test, not a demonstrated production Postgres failure. |
| **R10-16 · P2** | Late merge: `toolsFor` hides `read_image` without `VISION_LIVE=1`, while `/.well-known/agent.json` builds `skills` from scopes alone and advertises it. Direct route probe confirms disagreement. | Generate MCP, OpenAPI, Agent API page and card capabilities from the same advertised-tool policy. Agent-door/lead. |

## Interface and verification findings

### R10-11 · P2 · Recipe supply wording contradicts the canonical fulfilment

Seen in the local planned Kitchen: lanttulaatikko says “5 of 5 can be bought with a known quantity” and “Make it from in-stock ingredients,” while its dish sentence and order summary correctly say supply is unknown and not covered. `StrategyCard.svelte:27` checks state/block details but not unknown supply; `kitchen/live-view.ts:311` hardcodes the recommendation sentence.

Read ingredient certainty from the same canonical supply/fulfilment facts as the dish and receipt. Do not equate “can be approved” with “known stock.” **Owner:** 1f + core. **Acceptance:** introduce one unknown ingredient and show the same uncertainty in the card, dish, order summary and receipt.

### R10-12 · P2 · Request envelopes still accept malformed task references or throw on null

Local production-build HTTP probes, with actual request bodies: JSON `null` returns 500 from both `/api/chat/turn` and `/request/menu`; a malformed supplied `taskId` plus text is silently dropped and returns a normal 200 turn. The routes cast JSON to an object without validating the envelope. The task-ID helper fixed valid Request IDs, not this invalid-ID behavior.

Use a route input schema, reject non-object bodies and invalid supplied identifiers with 400, and never reinterpret a bad continuation reference as a fresh task. **Owner:** E/B. Probe artifacts retain the response/status; no production endpoint was contacted.

### R10-13 · P2 · The browser release gate is red and two guards do not reach their assertions

All eight committed e2e tests ran against a local production build after `/healthz` verified a fixture database:

- **Passed:** cross-surface clocks; chef approval/ordering from the dock; receipt totals and reload; agent approval link.
- **Failed:** both 1440/390 wording sweeps on unwrapped API tool names in `/agents`; idle and visitor-isolation guards waiting for removed `#event-h` after a successful plan. The current heading is `#task-h`.

Decide how developer instructions on `/agents` fit the System-layer policy; the sweep already excludes semantic code samples. Preserve readable, copyable API instructions rather than deleting useful tool names just to pass.

Fix the selectors in both guards. Also fix the idle guard's reader: it uses Playwright's separate `request` fixture instead of the browser's authenticated context and never checks status/schema. A 403 error body can yield `undefined` before and after and satisfy equality. Use the page/context request client and assert finite cursors and successful responses.

Corrected scratch checks passed: authenticated idle sequence **12 → 12 over 60 s**, and two visitors, a judge key, forged cookie, cross-workspace reads and a scoped reset remained isolated. These checks are evidence for the behavior; they do not turn the committed full gate green. **Owner:** 91 + 1f/agent-door.

### R10-14 · P2 · The live vision check can pass when all model calls fail

Source inspection: `images/live.test.ts:48` records failures as rows, then its only expectation is `rows.length === 3` at `:66`. Three unavailable-provider errors satisfy that. Matching also ignores units and does not enforce one-to-one line matches.

Retain diagnostic artifacts, but make success require successful readings and explicit quality thresholds. Test the scorer with wrong units, duplicates and three errors. No live vision call was made in this review. The documented endpoint failure must not become a green evidence claim through this harness. **Owner:** vision/evals.

### Technical UI audit

**Integrity verdict:** the interface expresses a coherent kitchen purchasing workflow. Certainty and capability descriptions fail consistency checks in R10-11/16; the committed wording gate also remains red. These are concrete truth issues within the existing design system.

Sixteen captures cover Kitchen, Request, Ops, Agent API, offline, a planned buffet, a priced milk draft and a Chat decision at 1440/390 px. No document-width overflow, unnamed visible buttons or page exceptions occurred in those captured states. The mobile decision is visible above the fold. Receipt and dock behavior also have browser-test evidence.

Impeccable source detection returned six side-border advisories; inspected grouping/evidence uses do not justify six defect reports. The rendered detector failed with a protocol-connection error. Playwright screenshots/DOM checks provide the rendered evidence instead.

| Dimension | Score / 4 | Bounded assessment |
|---|---|---|
| Accessibility | 2 | Labels and meaningful states are present. Full focus traversal, measured contrast and screen readers remain unchecked. Small Chat icon controls measured 23.5 px; the recipe expander was 16 px high. Check spacing exceptions before calling these WCAG failures. |
| Performance | 2 | Build and observed journeys completed. No 10× workload, CPU profiling or interaction-percentile measurement. |
| Theming | 3 | Consistent semantic tokens and readable dark Ops in inspected captures. Contrast still needs measurement. |
| Responsive | 3 | Captured layouts fit both widths. No physical-device gesture or text-zoom verification. |
| Integrity | 2 | Shared decisions/coverage vocabulary helps; recipe certainty, failure wording and tool-capability descriptions still diverge. |
| **Total** | **12 / 20** | **Acceptable, significant work needed; a scoped technical audit, not conformance certification.** |

Suggested order: `$impeccable harden` for task/error recovery, `$impeccable clarify` for supply and failure wording, `$impeccable adapt` for keyboard/spacing/zoom, then `$impeccable polish`. Re-run the audit after fixes. These passes are recommendations; no UI changes were made here.

## What changed since Round 9

The committed adversarial suite now covers the original partial Continue, stale-cancelled Continue, incompatible-unit resize, multi-plan status/continuation, partial grants, delivery calendar, Valio concurrency, run normalization, requirement persistence on direct orders, original supersession, supply drift, dependent rice/milk edits, model-fit holds, direct partial receipts, kitchen grants, separate intents, task-before-effect persistence, next action and projected task lists. The transport suite covers reference hydration and UTF-8 sizing. Their original cases are no longer listed open.

Two earlier web failures remain explicit expected failures: **`R8-web-write`** (failed write acknowledged/not retried) and **`R8-queue-claim`** (database claim absent from the process map does no work). Keep them in the release risk record; a green test run does not establish those guarantees. D owns the correction.

Other improvements seen in source: Chat and agent routes adopt call scope; the store checks current run under the workspace lock; replay JSON is copied into the final image; detached bus failures have a catch; unused stub fallback was removed. The late `VISION_LIVE` advertisement gate is helpful, but R10-16 shows the new agent card bypassing it.

Source-only remaining cautions from Round 9: `createServerPorts` still caches a rejected initialization promise; MCP still marks commitment `destructiveHint:false`. New question/outside Chat steps also stamp web calls `source:'live'` regardless of cache/replay/fixture results. Preserve actual evidence mode through presentation. These are narrower follow-ups than a new architecture.

## Guidance for execution and orchestration

1. **E + core + lead: close one purchasing-command seam.** Fix R10-01/02/10 together. Define command generation, exact intended subset, accepted terms and task cancellation ownership once. Prove uncertain response → retry; changed terms → deliberate new attempt; partial grant → new subset; cancellation before an effect. Review durable task/order/receipt rows, not only final Chat copy.
2. **Core + B/E: preserve intent and active strategy through every transformation.** Fix R10-03/04, then generalize R10-05/06. The acceptance matrix must include direct Request and reviewed menu, substitution, amount amendment, supply change, partial confirmation and final commit. Plan-size assertions alone do not prove the correct SKU was purchased.
3. **Agent-door + B: establish product identity before answering.** R10-15 blocks confident product-fact answers for named variants. Keep read-only execution, but add ambiguity and identity cases, then carry source mode and shared capability policy to every surface.
4. **D/9c: finish durability and gap recovery.** Close the two expected web failures; make notifications recoverable from the durable op log. Keep the one-container limitation explicit until multi-process behavior is exercised.
5. **91/1f/lead: repair the actual release gate and pin the demo.** Fix R10-11/13/14; rerun all browser tests on the intended build; record source SHA, build SHA, provider mode, expected outcome, artifact and owner. Also verify the peer review's M1 two-store dock/page coupling on Kitchen: the passing dock test starts on Request, so it does not cover that case. Do not substitute the seven-step gate for `--full`, or a fixture recording for a live quality result.

The testing opportunity is a small journey matrix over **entry → mutation → fault → recovery → purchased SKU/amount/authority**. Share builders and command semantics, not just wording helpers. Keep deterministic pure-core checks and provider fixtures. No generic workflow-engine rewrite is needed.

For the demo, show one genuinely known-stock routine line acting alone and one explicit exception needing a person. The ≥999999 mapping now correctly holds many dairy lines, so older recordings of unattended milk ordering are stale. Re-record the site cases after the final deployment and reconcile PITCH/CLAIMS/STATUS with that build. The independent [Ring 4 docs review](../handoff/ring4/review-docs.md) already inventories the broader text drift; retain its “observed versus inferred” distinction, but do not inherit its blanket trust-core conclusion over these new reproductions.

Defer new sponsor features, memory and forecast until these purchasing journeys and the release gate close. A read-only shadow pilot should specify buyer account, receiving calendar, typed requirements and authority before extending the current single challenge customer.

## Evidence and limits

- Seven-step gate: **791 unit passes, 2 expected failures, 42 skipped**; check/lint/self-check/build/eval/agent eval passed. The gate ran before the late agent-door merge.
- Current-source observation suite: **12/12 reproduced**, at `9513abb`; includes actual core/store/task services on PGlite and mocked provider/notification boundaries. Late merge's own focused tests: **32 passed in 5 files**.
- Committed full browser suite: **4 passed / 4 failed**, 4.9 min. Corrected scratch guards: **2 passed**, 1.2 min. Browser evidence uses the local production build; `/healthz` says `commit:unknown`, so it is not evidence of a deployed/freeze SHA. The late question/resource/card merge received source/probe/unit checks, not a new rendered deployment pass.
- Sixteen local captures; bounded HTTP probes; no live provider calls, production Postgres race/reset, calendar-client import, physical touch, full accessibility audit, container rebuild or 10× scale run. Docker/seed/migration and provider code received source review. Final-image replay copying is verified in source, not by launching Docker.
- A filename-only tracked-content scan for common private-key/API-key patterns found no matches in its limited scope. It excluded event/archive docs and does not inspect history. PLAN's public-history scrub remains lead-owned and unverified here.

Source archives, probe definitions, logs, screenshots and hashes: [Round 10 evidence](../../scratch/round10/README.md). Action handoff: [review-adversarial-r10](../handoff/review-adversarial-r10.md).
