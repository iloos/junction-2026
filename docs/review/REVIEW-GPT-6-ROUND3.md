# Mandate — adversarial implementation review, round 3

Reviewed main as it moved from `0951365` through `7970d79` to `aec4a4b` (14 Nov 2026). Read current contracts, services, adapters, tests, evals, pitch, deployment notes and newly landed commerce/sponsor research. No application files changed. Local probes used fresh in-memory PGlite databases or pure functions, not Aiven. In-flight lane changes may supersede individual findings; recheck their acceptance cases before closing them.

## Verdict

The larger shape is now justified by working components. Keep Kitchen, Operations and the external interface. **Ring 0 is not yet ready to claim an enforceable mandate:** I reproduced duplicate quantities under one approval, a confirmed €0 purchase with missing price, and ignored dietary/origin constraints. The current five scenarios miss these failures. Fix the transaction and constraint cases alongside the live UI; then the same Christmas rescue can be a strong Valio demonstration.

## Ranked findings and executor handoff

### 1. P0 — Repeating a line ID buys twice what was approved

**Reproduced through the real handlers on fresh PGlite:** create one `470418` unit, grant its exact approval, then call `commit_order` with `lineIds: [lineId, lineId]`. It succeeds with the ID twice, consumes twice, and charges **5,040 cents instead of the approved 2,520**. One receipt does not mean one authorized purchase.

**Cause:** [orders.ts:360](../../src/lib/core/services/orders.ts#L360) accepts repeated selections, maps both into purchase lines and totals/consumes both. `commitAuthority` checks membership in approval, not uniqueness ([state.ts:64](../../src/lib/core/state.ts#L64)).

**Owner: 8d/core-db + lead-owned schema. Fix: 20–40 min.** Reject duplicate `lineIds` in schema **and** at the service boundary; require a unique order-line set and verify selected terms equal approved terms. Do not rely solely on UI deduplication. Add this regression before the planned Postgres race test.

**Done when:** repeated IDs produce `INVALID_INPUT` with zero stock/budget/order changes; a normal commit and identical retry still return one receipt.

### 2. P0 — Approval turns an unknown price into a confirmed free order

**Reproduced:** keep known stock for `470418`, return `price: null`, create a plan, grant its pending approval and commit. Result: success, **`totalCents: 0`, `awaitingSupplier: []`**.

**Cause:** missing price is an approvable `UNKNOWN_REQUIRED` reason ([tier.ts:116](../../src/lib/core/mandate/tier.ts#L116)); commit then uses `lineCents ?? 0` and `unitCents ?? 0` ([orders.ts:377](../../src/lib/core/services/orders.ts#L377), [430](../../src/lib/core/services/orders.ts#L430)). This violates fixed-price commitment, independently of the intentional awaiting-supplier design.

**Owner: core-db. Fix: 30–60 min.** A missing price is a non-committable fact gap. Separate “human may authorize this deviation” from “information required to form an order.” Require valid price, unit and terms for every selected line immediately before commit. Preserve deliberate Terminal commitments as awaiting supply if D6 allows them; never convert unknown price to zero.

**Done when:** approval cannot make the missing-price case commit; obtaining a price produces new terms requiring fresh authorization. A genuinely priced zero-cost item, if supported, is distinguishable from null.

### 3. P0 — The “hard constraints first” claim is false in the server

**Reproduced with pure production functions:** kitchen requires FI origin and excludes allergen `AM`; product is Swedish and explicitly contains `AM`. With generous caps and no new-SKU requirement, `tierLines` returns **`eligible`, `act`, `reasons: []`**; `rankCandidates` gives it rank 1. The same probe passed a `KG` quantity for a product priced/sold as `ST` without refusal.

**Evidence:** tiering checks only whether an allergen record exists ([tier.ts:127](../../src/lib/core/mandate/tier.ts#L127)); it never checks declared `contains`/`mayContain`, stored required-origin rules or unit equality. Ranking exclusions likewise omit the stored origin/allergen rules ([rank.ts:32](../../src/lib/core/rank/rank.ts#L32)). Normalized category groups are numeric prefixes ([normalize.ts:89](../../src/lib/server/adapters/catalog/normalize.ts#L89)), while seed origin rules use words such as `meat`: even a newly added equality check can silently miss them.

**Owner: lead + core-db. Fix: 1–2 h.** One shared deterministic validator for ranking, tiering and commit: declared forbidden allergens, kitchen policy for traces/unknowns, required origin, tender restrictions, sales-unit conversion and purchasable quantities. Define the category-rule mapping explicitly. Distinguish forbidden constraints from preferences a chef may waive. Show blocked reasons before approval; approval must not silently override a prohibited ingredient.

**Done when:** five cases—declared allergen, trace allergen per policy, missing record, wrong required origin, wrong sales unit—are rejected/held consistently in direct REST/MCP inputs and substitution paths. Ordinary data plus an approval must not bypass the validator.

### 4. P1 — The hero interaction changes its explanation, not its purchase

Two **reproduced real-handler** failures:

- Plan Christmas → resolve ham to `476768` → request `requireOrigin: 'se'`. Candidate `476768` is returned as rejected for `origin_required`, **but `chosen` still contains that same Finnish product**.
- Resolve ham → change grams per guest to 60. The need recomputes to 12 kg raw, **but the replacement remains at 13 × 1.5 kg**. The purchased substitute is not resized with demand.

**Cause:** any existing substitute forces preview mode, and the response returns the old chosen lines regardless of the new ranking ([substitutes.ts:87](../../src/lib/core/services/substitutes.ts#L87), [233](../../src/lib/core/services/substitutes.ts#L233)). Edits rebuild original seed line IDs and retain substitute drafts that are absent from that map ([events.ts:202](../../src/lib/core/services/events.ts#L202)). Make-in-house quantities also come from fixed seed order quantities ([substitutes.ts:203](../../src/lib/core/services/substitutes.ts#L203)).

**Owner: 8d/core-db + Kitchen. Fix: 1–2 h.** Separate ranked preview, proposed choice and applied choice. A preview may retain the saved plan, but must identify it as unchanged and return a separate current recommendation; never label a rejected saved choice as the newly selected answer. Applying rules must revalidate, replace the old proposal and invalidate approval. Portion edits must resize active replacement/ingredient lines using the same demand/yield calculation. Do not merely append another substitute and buy both.

**Done when:** rescue → edit portions → apply another rule → review → approve → commit purchases the newly shown quantities/options. Test this sequence, not only edit-before-rescue. Add an increased-demand case so the stale quantity cannot underfeed guests.

### 5. RESOLVED DURING REVIEW — The first database isolation fix was insufficient

**Observed command:** `pnpm.cmd exec vitest run --project server` → **100 passed, 1 failed, 101 total**. The test at [serve.test.ts:182](../../src/lib/server/tools/serve.test.ts#L182) imports production handlers and attempts Postgres `insert into workspaces`; the sandbox blocks the network connection. This run did not mutate Aiven. I did not read `.env`.

The earlier config cleared `DATABASE_URL`, but DB selection reads SvelteKit's `$env/dynamic/private` ([client.ts:5](../../src/lib/server/db/client.ts#L5)). The observed connection proved that guard insufficient. **Commit `71b0fb6` landed during review**, adding an explicit Vitest fixture-mode guard plus a regression test. I reran the full server suite at `aec4a4b`: **102/102 passed across 20 files**, with no reported PostgreSQL connection attempt. Credit this fix; do not reopen it as an outstanding blocker.

**Owner: lead/test infrastructure. Remaining guardrail:** keep `test:pg` an explicit opt-in against a dedicated review workspace/run; do not restore automatic shared-DB testing. The resolved issue is retained here because the headline test count changed during this review.

**Future check:** ordinary tests should also pass with a deliberately set dummy `DATABASE_URL`, without constructing the SQL connector. PostgreSQL races run separately, not by changing the normal suite's defaults.

### 6. P1 — The Gemini Decisions adapter exists, but purchasing never calls it

**Evidence:** `createDecide` currently appears only in its implementation and adapter tests; the substitute service calls `rankCandidates` without a fit map ([substitutes.ts:140](../../src/lib/core/services/substitutes.ts#L140)). Server ports inherit a Decide implementation that throws if called. The LLM planner is a different integration. Deploy notes specify `LLM_PROVIDER=fixture` ([deploy.md:34](../foundations/deploy.md#L34)).

**Owner: agent + core-db. Fix: 45–90 min.** Wire recipe-fit scoring into the actual substitute path using a tested adapter, pass the scores into ranking, retain recorded/rules labels, and expose the resulting trace. The new request box can legitimately use Gemini extraction too; that does not establish the claimed calibrated substitution system. Do not put the 120-question spike metric on screen as current application performance: this adapter presently sends one question per request.

**Done when:** a known live call affects a dish-compatible recommendation; the trace reports actual source/model/latency; provider failure completes through labelled fallback. A scripted agent run must be labelled scripted even if its tool calls and database writes are real.

### 7. P1 — The production boundary still needs a complete rehearsal, not a health check

These are tracked integration gaps, not evidence the active lanes will fail:

- Kitchen defaults to browser fixture, sends no bearer key in its live call, and refreshes from the browser fixture snapshot ([api.ts:11](../../src/lib/kitchen/api.ts#L11), [18](../../src/lib/kitchen/api.ts#L18), [kitchen.svelte.ts:202](../../src/lib/kitchen/kitchen.svelte.ts#L202)). Setting a live flag alone cannot complete the flip. Production MCP/REST keys are not yet configured according to [deploy.md:35](../foundations/deploy.md#L35).
- `set_mandate` is still unimplemented in the real service, then silently falls back to the in-memory stub ([handlers.ts:42](../../src/lib/core/services/handlers.ts#L42), [server handlers:75](../../src/lib/server/tools/handlers.ts#L75)). A successful cap-change response can therefore leave the actual purchasing mandate unchanged.
- `/ops` can start the kitchen agent without authentication ([+page.server.ts:76](../../src/routes/ops/+page.server.ts#L76)); event reads select any workspace from the query string ([events route:20](../../src/routes/api/events/+server.ts#L20)). That may be acceptable for an intentionally public sandbox, but it cannot share the presenter run or become the future paid-provider endpoint by accident.
- **Reset/clock infrastructure landed in `aec4a4b`:** served store/auth now follow the current run and reset creates a new run without deleting history. This addresses the earlier fixed-run wiring gap. Still verify both browsers and stock/budgets move together. Current run selection is process-local after initial DB load ([run.ts:33](../../src/lib/server/demo/run.ts#L33)); keep one app instance for the demo unless cross-instance reset propagation is tested. Reset during an active agent run also needs an explicit cancel/stale-run outcome.

**Owners: 8d Kitchen; 9c demo/deploy; lead auth/contracts. Fix: 1–2 h, overlapping current tracks.** Use server-mediated browser authority, never bundle an approver secret. Disable production stub fallback; unsupported tools must fail explicitly. Persist mandate updates or hide that control until real. Separate public playground and presenter runs; protect privileged agent execution or enforce an isolated sandbox. Reset by creating a fresh scoped run, preserving old audit records.

**Done when:** two browsers see the same plan, approval and receipt; a fresh run has no prior orders/spend; public sandbox activity cannot alter the stage run; the deployed request box can submit, approve, commit and replay under real configured scopes.

### 8. P2 — Cut-off and fulfilment claims are broader than current checks

Tiering/commit do not currently compare the scenario clock with `closingTime`, enforce requested delivery against availability, or validate price expiry. The new shared scenario says delivery **10 Dec** ([scenario.ts:15](../../src/lib/core/scenario.ts#L15)), while `plan_event` still computes event date minus one day—**11 Dec** ([events.ts:45](../../src/lib/core/services/events.ts#L45)). A shared constants file does not fix a caller that never uses its delivery date. Cache-backed offers intentionally ignore requested date ([pg.ts:117](../../src/lib/server/adapters/catalog/pg.ts#L117)). That is workable for the static mock only with simulator-generated dates and explicit labels. A read of existing cached data is not a new live lookup.

The eval's residual calculation treats any non-rejected/non-unorderable line for a need as coverage, including held unknown supply ([adapter.ts:322](../../src/lib/server/evals/adapter.ts#L322)); it tracks unknowns separately but cannot establish quantitative dinner fulfilment. A nominal replacement or one ingredient is not proof the whole dish is covered.

**Owners: 9c clock + core-db/evals. Fix: 45–90 min.** Validate delivery/cut-off/expiry against one labelled scenario schedule; do not interpret stale November values as a December supplier promise. Report confirmed, awaiting-supplier and unresolved portions separately, with all required make-in-house ingredients accounted for. Qualify “never over the cap” as **never auto-orders over its cap**: D6 intentionally permits explicit sign-off above caps ([ARCHITECTURE:52](../concept/ARCHITECTURE.md#L52)).

## Next work: retain the tracks, change their acceptance gates

| Owner | Next handoff | Acceptance evidence |
|---|---|---|
| Lead | Keep the resolved test guard; freeze shared validator and duplicate-ID checks; remove production stubs | Ordinary suite remains 102/102; direct hostile inputs fail |
| 8d/core-db | Findings 1–4, then R0-e | No quantity amplification, no null-price order, constraints enforced, edit-after-rescue correct |
| Kitchen executor | Continue R0-b against those semantics | Real snapshots, visible pending/confirmed differences, no fixture refresh overwriting server results |
| Request executor | Continue R0-c | Text → extracted quantity/unit/date → shortlisted catalogue lookup → priced plan → bound approval → receipt; unsupported/ambiguous requests ask rather than silently loading Christmas |
| Agent executor | Wire actual Decisions use; continue R0-f/g | Actual provider/fallback trace; external key cannot approve; deterministic script labelled |
| 9c | Finish R0-d and deploy smoke | Clean presenter run, consistent clock, authorized browser journey, isolated public sandbox |

**Postgres proof must contain more than a same-key retry:** same plan/key twice concurrently → same receipt; same plan with different keys → only one purchase of each line; two plans competing for one stock lot → no negative stock; two kitchens/plans competing under the same kitchen-week budget → no unauthorized overspend. Assert final orders, stock, spend and ops—not just HTTP status. Use dedicated test runs and cleanup/retention policy, never a destructive reset of `ws-demo`.

Do not hold all parallel work until every issue is fixed. Kitchen, Request and demo isolation can proceed while core fixes land; defer new cross-ring integration until this acceptance sequence passes on the deployed SHA. Capture the browser's full journey and corresponding DB/ops evidence before tagging Ring 0.

## What a Valio judge should see next

**Christmas rescue stays the headline.** Show real outages, a rejected candidate, an actually resized replacement, an honest unknown casserole, exact approval, and a receipt that survives retry/reload. Then: “Your agent uses the same gate,” with a real preconfigured external client. Keep the milk request as the separate required-flow entrance. Natural-language Gemini parsing is useful, but the brief requires an explicit request-to-order workflow; it does not require an elaborate chatbot.

One stronger interaction: let the judge lower the portion or tighten origin **after** the first rescue. Their intervention must change the actual pending purchase and invalidate the previous approval. That proves co-planning rather than a staged animation. Until finding 4 is fixed, do not perform that beat publicly.

## Ring 1–3: preserve ambition, demand the right evidence

The newly landed [sponsor-touchpoints note](../research/sponsor-touchpoints.md) correctly identifies the unwired Decisions path. Its proposed hard drops for several entries are recommendations, not a replacement for the user's D4 scope decision. Preserve those rings while gating each competitive claim on working evidence. The [commerce research](../research/agentic-commerce.md) suggests useful standards-shaped exports, but do not prioritize protocol cosmetics above the reproduced purchase bugs, claim compliance, call cached prices live, or display “0 committed violations” before adversarial assertions actually support it.

- **Context.dev + Exa:** next natural extension after Ring 0. A watched source change or new retrieved fact must alter an existing order; show sources and observation times. Keep discovery and monitoring distinct.
- **AfterQuery:** five deterministic scenarios plus recorded decisions are regression tests, **not yet a competitive entry**. Its brief requires the standard harness, repeated frontier/reference gap, do-nothing/stop-early baselines and reward-exploit resistance ([brief:76](../event/challenges/main/afterquery--break-the-agent.md#L76)). First demonstrate one fair task where the frontier agent reproducibly underperforms. Do not count a packaged replay as this evidence.
- **Modal/Gemma:** useful measured enrichment or actual agent episodes; suggestions cannot overwrite verified pack/allergen facts. Keep the write-back API boundary.
- **Verda:** Gemma works on Featherless in the current evidence; “Gemma on Verda” is still a new deployment/access task. Keep it as a measured spike, not a promised dependency of the existing agent.
- **S-Pankki:** data availability is now progress. A separate mobile transaction-grounded scenario remains the right R3 experience; do not squeeze it into the kitchen pitch.
- **Nemotron/Cloudinary:** retain document input as the shared seam; enter only after actual document-to-plan evidence and required model/tool access.

The valuable architecture is already present: one store, scoped tools, immutable approvals and visible operations. The work now is proving those guarantees survive a judge changing inputs, repeating selections and editing a rescued plan—not adding another diagram or cutting the larger product.
