# Round 5 — surfaces, read models and end-to-end state

Source-based review, begun at `2d8ce0f` and checked through `dd600e5`, 14 Nov 2026. Current main includes the major post-round-four fixes. No UI rendering claim, application edit, live database access or network call. Two small coverage probes exercised pure production code with synthetic objects. Parent owns the full suite, provider and web-ingestion review.

## Verdict

The shape is substantially better: Kitchen has explicit start/read separation, session selection, separate offline mode, actual preview/apply, server-derived line views and recovery; Operations now has a queue and links. The next risk is **different projections of the same business object disagreeing**. Keep the multi-surface product. Make a shared plan/coverage/context read model the boundary that each surface consumes, instead of rebuilding business truth independently in Kitchen, Request and Ops.

## Progress to retain, not re-review as unfixed

- Live errors preserve the last Kitchen state read-only; `/offline` is a separate basket. The earlier automatic live→fixture switch is gone ([backend.ts:14](../../src/lib/kitchen/backend.ts#L14), [kitchen.svelte.ts:324](../../src/lib/kitchen/kitchen.svelte.ts#L324)).
- GET Kitchen snapshot reads; planning/rescue are explicit commands with progress counts ([live.ts:185](../../src/lib/server/kitchen/live.ts#L185), [backend.ts:47](../../src/lib/kitchen/backend.ts#L47)).
- Recommendations and saved choices are separate; applying rules mutates proposals and invalidates approval. Current sources expose `recommended`/`saved`/`applied` semantics, and the view no longer calls preview rank 1 the saved choice ([live-view.ts:124](../../src/lib/kitchen/live-view.ts#L124)).
- `Line.view` explicitly models committability, blocked reason and supply state, computed at read time ([plan.ts:108](../../src/lib/core/contracts/plan.ts#L108)). That is the right seam; the findings below concern clients which still infer something else.
- Production uses a judges' sandbox and presenter workspace split; reset creates a new audited run instead of deleting orders. Operations queue replaces the prior passive-only wallboard.

## Findings that remain user-visible

### P1. The comparison read model still labels sales units as kilograms

At [live-view.ts:139](../../src/lib/kitchen/live-view.ts#L139), `perKgCents` falls back to `price.unitCents` whenever the comparison unit is not kg. The candidate panel labels this column `€/kg`. A per-case or per-piece price therefore becomes an apparent per-kilogram comparison. At [148](../../src/lib/kitchen/live-view.ts#L148), `coverValue` is `line.qty.value` (or available sales units); the UI renders it in kg. The demo ham's 13 × 1.5 kg purchase is **13 ST**, not 13 kg. `ProductFacts` currently lacks net quantity/yield sufficient to do this conversion.

**Fix, Kitchen/core, 45–90 min:** return `comparisonPrice: {value, basis}` and `coverage: {value, unit, basis, source}` from the server. Only show €/kg when established; otherwise show €/case or “not comparable on this basis.” Coverage needs the recipe-compatible served mass/portions, not the pack count. Do not add more name parsing in the UI.

**Acceptance:** a KG item, a 1.5 kg ST ham, a six-unit case and a liquid show consistent price bases and demand coverage; unsupported conversions remain unknown. Recommended-but-not-applied candidates must also be sized, or explicitly say “coverage not computed,” rather than 0 kg/full cover together.

### P1. Ops “covered” is not supply coverage, and a single ingredient covers an entire recipe

`coverage()` counts any eligible or committed line as coverage and uses `some()` for an entire need ([cases.ts:157](../../src/routes/ops/cases.ts#L157)). Two pure probes returned **covered 1 of 1** for:

1. A committed Terminal line with confirmed cover 0 and unconfirmed cover 10.
2. A make-in-house need with one eligible ingredient and another unorderable ingredient.

The board then says “Covered: all … needs are ordered or orderable” ([ops page:304](../../src/routes/ops/+page.svelte#L304)). It cannot establish full meals/dishes supplied. `Line.view` is computed on tool reads and not stored; the op reducer does not automatically inherit those projections. Simply reaching for `line.view` in Ops is not a complete fix.

**Fix, shared read model + Ops, 1–2 h:** derive need fulfilment from required quantities, substitutions, ingredient dependencies and receipts. Separate planned/committable, committed-known, awaiting supplier and unresolved quantities. Use the same projection in Kitchen, Request status and Operations. Rename the current count to “needs with at least one eligible/ordered line” until quantitative coverage is correct.

**Acceptance:** unknown supply never raises confirmed coverage; a recipe is constrained by its missing ingredient; committed stock-backed quantities and remaining demand add up; a partial commit does not turn the whole dinner green.

### P1. Queue links carry a plan ID, but Kitchen cannot open that plan

`kitchenHref()` emits only `kitchen`, `plan`, version and need ([cases.ts:171](../../src/routes/ops/cases.ts#L171)). It omits workspace/run. Kitchen reads those query parameters only to choose its kitchen and focus a dish ([KitchenScreen:36](../../src/routes/(kitchen)/KitchenScreen.svelte#L36)); the server finds only that kitchen's seeded Christmas `EVENT_ID` ([live.ts:118](../../src/lib/server/kitchen/live.ts#L118)). A milk/request plan, an external client's plan or a case from a different workspace opens the current Christmas plan, or an unstarted screen. The mismatch banner is honest ([KitchenScreen:302](../../src/routes/(kitchen)/KitchenScreen.svelte#L302)), but the operator still cannot finish the linked task.

**Fix, lead route contract + Kitchen/Ops, 1–2 h:** a read-only plan route takes validated workspace/run/plan identity and retrieves that exact plan; selecting a different kitchen is not a substitute for loading a plan. Offer explicit “open current version” for a stale version. Dispatch plan kind to event review or direct-order review. Authority remains server-derived; a link never grants a foreign workspace.

**Acceptance:** follow a queue case for a milk request and a Christmas event in both public workspaces; each displays its exact original plan/need and current approval. Invalid/stale/foreign links produce an explicit unavailable view, not another editable order.

### P1. Durable request plans have no durable request-review entrance

The Request page stores its plan, approval and commits only in component state ([request page:73](../../src/routes/request/+page.svelte#L73)); its loader retrieves kitchens, not a named plan. Reloading loses the review/receipt even though the server keeps them. A newly generated nonce can make re-entering the same words a different logical order. Idempotency protects a retry of the same key, not the user's lost task context. This is a recovery gap, not a claim that every re-entered order must deduplicate semantically.

**Fix, Request + route owner, 45–90 min:** after placement, put the plan identity in the URL and provide a recent-drafts/receipts return path. Persist request intent metadata associated with the plan if it is needed to reconstruct the explanation. Reload recovers the server order and compares any now-stale approval, rather than requiring a fresh parse/place flow.

**Acceptance:** request → held order → reload → same plan/approval; commit → reload → same receipt; editing the request creates a clearly identified new draft. No browser private-state storage is needed to retain authoritative truth.

### P1. Catch-up stops after 1,000 events but declares the projection live

The event route catches up once with limit 1,000 then switches to live subscription ([events route:113](../../src/routes/api/events/+server.ts#L113)). `catchUp` applies the same limit, and the client treats `ready` as fully live. Existing events beyond that page are not fetched before readiness. After a long demo/simulation or reconnect, the board can omit later state until a new high-sequence event arrives; then it may lack the prerequisite plan/approval ops needed to reduce it.

The client advances `last` **before** applying each op ([stream:186](../../src/routes/ops/stream.svelte.ts#L186)); reduction errors are logged as rejected but the cursor is already past them. Recovery therefore needs more than retrying SSE. This is source-path analysis; no live overload test was run here.

**Fix, Ops/event owner, 1–2 h:** page replay until a captured high-water cursor is covered, then drain buffered live events in order. Mark projection integrity separately from transport connectivity. On a reducer failure, stop applying later dependent ops and reload a versioned snapshot/correct replay; do not silently skip the failed business change. Reset clears queued events/traces or filters them by current run.

**Acceptance:** boot/reconnect with 1,001+ persisted events, a reset during reconnect and a deliberately malformed/missing-predecessor op. “Live” requires a complete projection, not merely an open socket. Compare rendered state with authoritative store state after the test.

### P2. “Your own sandbox” is a shared-room promise

Request help says “Your own sandbox” ([request page:342](../../src/routes/request/+page.svelte#L342)); every public visitor actually uses `ws-judges`, and anyone can reset that shared workspace on the cooldown ([sandbox.ts:1](../../src/lib/server/demo/sandbox.ts#L1)). Kitchen sessions store separate selected kitchen/preset, but they still edit the same kitchen/event plan in the shared run. This can be a deliberate collaborative sandbox, but peers should know that another judge can change or reset their order.

**Fix, demo/UI owner, 20–40 min:** label it “Shared judges' sandbox; others may edit or reset it,” show the active run, and notify a user when a different client changes the run. If per-visitor ownership is desired, allocate distinct browser workspaces and an explicit join link later; don't describe shared state as private today.

**Acceptance:** two browsers demonstrate the intended collaboration/isolation behaviour. Reset elsewhere produces an explicit run-changed state; old approval/commit controls become unavailable before a stale action.

### P2. Visible clock and server clock use different workspace anchors

Kitchen builds its displayed clock using `currentRunStartedAt(ctx.workspaceId)` ([live.ts:311](../../src/lib/server/kitchen/live.ts#L311)). `createDbPorts` builds the global `ports.clock` from the initially configured workspace ID, ordinarily `ws-demo` ([db-ports.ts:60](../../src/lib/server/store/db-ports.ts#L60)). Request `simNow/simToday` and transaction timing use that global clock. Resetting `ws-judges` can therefore reset the displayed Kitchen clock while request interpretation/expiry still follow the stage anchor. The Request page's `data.now` also stays fixed after sandbox reset.

**Fix, core/context owner, 45–90 min:** make clock selection part of request context, or pass `clockFor(workspace, run)` into every served operation/projection. Reset must return context/clock metadata to all pages, and loader state must refresh. Do not replace this with a different page-local timer.

**Acceptance:** offset two workspaces' start times; reset only one; relative “tomorrow,” approval expiry, deadline and op timestamps agree within that workspace while the other workspace remains unchanged.

### P2. Web findings have API/ops projections, but no complete operator evidence view

There are recall/facts/outside/findings API routes and generic `RecordAnomaly`/`RecordEnrichment` log summaries. The current frontends do not consume `/api/web/findings`; enrichment logs say “Added field … (source),” not whether a sourced suggestion has been verified ([labels.ts:104](../../src/routes/ops/labels.ts#L104)). A source-linked recall holding orders is valuable only if the operator can see which notice, what matched, which batch is uncertain and which action resolves it.

**Fix, Web/Ops, 1–2 h for one end-to-end slice:** a Finding detail read model links source URL/excerpt, observed/provider/cache/replay status, match basis and uncertainty, workspace/run and affected plans/lines. The existing queue opens that finding and its exact order. Catalogue enrichment remains a suggestion awaiting verification. Parent reviews ingestion/authority; this finding is the missing human handoff.

**Acceptance:** trigger a labelled recall fixture or real monitored change → queue case → source evidence → exact affected plan → required review. A fact suggestion reloads with its evidence and never masquerades as a verified product fact. A finding from another run/workspace cannot be shown as this kitchen's current incident merely because a process-wide cache retains it.

## Trace the journeys before adding another surface

| Journey | Desired identity/data chain | Current broken seam | Gate |
|---|---|---|---|
| Chef event rescue | session scope → run → event plan → needs → proposed/saved replacement → approval → receipt → Ops | Sales-unit/mass projection and coverage truth | Same quantities/bases/status in review and queue |
| Typed milk request | parsed intent/answers → shortlist/quote → plan ID in URL → review → receipt | Review exists only in browser memory; Ops links to Christmas | Reload and operator link recover exact request plan |
| Change of rules | preview token/input → recommended lines → explicit apply → new plan version → reapproval | Largely fixed; retain these distinctions in every view | No “chosen” or “approved” label for unapplied recommendations |
| Recall/spec evidence | source finding → match evidence → anomaly/hold → affected plan → operator action | Backend evidence lacks complete human detail route | User can explain why this precise order was held |
| Fresh shared run | reset command → durable run → context/clock → snapshots/cursors → visible run-change | Shared sandbox wording; context clock and replay boundary | Two browsers observe same intended run without stale authority |
| Long reconnect | persisted state/ops → paged replay/high water → valid projection → live deltas | One replay page; cursor advances through rejected op | Final board equals authoritative state after 1,001+ events |

## Minimal shared projection contract

Introduce/refine a `PlanView` alongside `Line.view`, not another independent UI rules engine:

- `context {workspaceId, runId, kitchenId, actorRole, scenarioNow, sourceMode}` and stable plan kind/identity/version.
- `review {approvalId, state, exactTerms, expired/invalidated reason, allowedActions}`.
- `fulfilment {needId, required, confirmed, awaitingSupplier, unresolved, unit/basis, ingredientDependencies}`.
- `purchaseLines {salesQty, salesUnit, packContent, comparisonPrice/basis, lineTotal, saved/recommended, provenance}`.
- `sourceEvidence[]` and `projection {version, lastCursor, complete, staleReason}`.

Kitchen and Request can render different task affordances over it. Ops can aggregate it without redefining “covered,” “confirmed” or “approved.” Public discovery/simulation remains a different entry point and never gains purchasing authority from appearing on a map. This is a small consistency boundary over the existing pure core/store, not a rewrite.

## Executor order

1. **Now:** fix the comparison units and truthful coverage labels; avoid a polished screen presenting numerically false facts.
2. **Next integration:** exact plan route + Request reload recovery + workspace/run-preserving queue links. One route/read model solves three seams.
3. **Before scale/replay claims:** paged catch-up and projection failure recovery; two-browser reset/clock scenarios.
4. **Web demonstration:** complete one finding-to-order-to-review handoff, rather than displaying an endpoint success badge.

Keep the source fixes already landed. The acceptance test is not “each page renders”: it is “the same need, approved purchase and supply uncertainty retain their meaning when a chef, an outside client, a web source and an operator all touch the workflow.”
