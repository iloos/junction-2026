# Round 9: adversarial repository review

Reviewed 14 November 2026. Started at `152e413`; source archive captured at `cbca3a7fffc5b5548c3f6905eee13877dd4afd03`. The shared checkout advanced during the review. The core, chat-turn, task-projection, run-normalization and event-transport files behind the ten new probes were unchanged across those commits. Later changes to the model router are called out below. This review changes only its own documents and ignored scratch artifacts.

## Judgment

The repository has a useful pure core, explicit ports, scoped credentials, transactional state changes and meaningful tests. Keep that architecture. The next work should close purchasing transitions and requirement propagation. Adding another orchestrator, memory feature or visualization would increase the number of surfaces that can repeat the current mistakes.

The trust claim needs qualification. Price-change refusal, scope restrictions and receipt idempotency hold in the exercised cases. A purchase can still contradict the request, purchase a superseded product, resume a cancelled task or be reported complete with an unfulfilled second purchase. Those are correctness issues inside the product's central promise.

The full seven-step merge gate passed. Ten additional observation probes reproduced ten defects. Eighteen earlier probes were rerun against current source, with assertions updated where behavior had improved. Passing an observation probe means the defect was reproduced; it is not a correctness pass.

## New findings

### R9-01 · P1 · Continuation can replay an earlier partial purchase after a later grant

**Observed:** create one plan with an eligible line and a held line. Continue the task: the eligible line commits. Grant the held line, then continue again. The second turn reports a successful `commit_order`, returning the first receipt; the held line remains uncommitted. The task still offers Continue.

**Cause:** `chat/turn.ts:775` uses `task:<id>:commit:<plan.version>`. Partial commit and approval do not bump the plan's terms version. The same routine-agent caller, key and payload therefore replay the first subset's response. Terms version does not identify a purchasing action.

**Correction:** derive a durable command identity for the exact intended open-line set and authority, pass explicit selected line IDs, and retain that identity across retries of that command. A subsequent newly authorized subset is a different command. Do not solve this with a new random key for every HTTP retry.

**Owner:** E + core; lead for any command contract. **Acceptance:** eligible subset → receipt A → grant remaining subset → receipt B; retry either command returns its original receipt; each line appears in at most one purchase. Probe `R9-01`, `scratch/round9/adversarial.test.ts`.

### R9-02 · P1 · A cancelled task can still order through a stale Continue action

**Observed:** cancel a task with a held plan, grant the plan, then send `continue:true` for that task. A receipt is created, while the stored task remains `cancelled`. The earlier cancellation message promised that nothing more would be ordered for it.

**Cause:** cancellation at `chat/turn.ts:253` updates task state, but the action branches at `:331–351` do not check terminal task state. This also matters for a stale button in another tab. Cancellation is not an execution fence.

**Correction:** refuse actions on cancelled tasks unless the user explicitly reopens them. Serialize/reserve the turn before effects and check cancellation at the command boundary. A cancellation racing an already-started atomic commit must report the actual receipt and what was stopped.

**Owner:** E. **Acceptance:** stale continue, resize and concurrent follow-up after cancellation create no new order; explicit reopen has clear semantics. Probe `R9-02`.

### R9-03 · P1 · Resize silently changes dimensions and preserves obsolete demand

**Observed:** a task needs 4 l. Send “make it 20 kg.” The line changes to 20 sales units = 20 l; the need remains 4 l. The ledger reports the old requirement and allocates only 4 l of the enlarged purchase toward it.

**Cause:** `resizeLine`, `chat/turn.ts:681–707`, recognizes a unit, scales g/dl, then divides the number by the line's physical content without checking its dimension. It edits purchase quantity without changing the durable need. The same need/purchase mismatch also exists for a valid same-dimension resize.

**Correction:** use a typed physical-amount amendment. Validate unit compatibility, preserve any required weight basis, update demand and re-size dependent purchase lines together. Ask a question for kg↔l; never invent a density. Define zero explicitly instead of clamping it to one sales unit.

**Owner:** E + core. **Acceptance:** incompatible unit refused with a question; 4 l → 20 l changes the need and purchase consistently; lot excess remains separate; the previous grant becomes invalid. Probe `R9-03`.

### R9-04 · P1 · Multi-purchase task status and continuation consider only the primary plan

**Observed:** task plan A is fully committed, plan B awaits approval. The task projects as `done`, its pending decision is `none`, and its ledger has `decisionsLeft:1` while saying “Every need is supplier confirmed.” Approving B and continuing still does not buy B.

**Cause:** `tasks/project.ts:18–43`, `tasks/ledger.ts:77` and `chat/turn.ts:323–351` choose the first/primary plan for state, next action, decision and continuation. Quantities and money already aggregate multiple plans. `splitGoals` now creates this shape for ordinary multi-item chat requests.

**Correction:** derive task state/actions from every active purchase obligation. Distinguish active, superseded and historical touched plans. Select the plan for each pending decision and continue all authorized outstanding subsets under their own durable commands.

**Owner:** E; lead if plan roles change. **Acceptance:** two-item request with one committed, one held; opposite order; two grants; one unresolvable item; reload and continue. No state or sentence may claim completion while an active obligation is outstanding. Probe `R9-04`.

### R9-05 · P2 · Partial reason-group grants are invisible to continuation

**Observed:** grant one group while another remains pending. `get_plan` correctly marks the granted line committable. The task says `canContinue:true`, but Continue makes no commit call.

**Cause:** `continueTask`, `chat/turn.ts:760–767`, reads only the single current approval. `currentApproval` prioritizes the remaining pending approval, concealing other grants from this code. The canonical line views already know which lines are committable.

**Correction:** select from the complete current authorization projection and coordinate the command identity with R9-01. **Owner:** E + core. **Acceptance:** each granted group can proceed independently while the others stay held. Probe `R9-05`.

### R9-06 · P2 · The kitchen delivery calendar is advisory at the shared gate

**Observed:** a kitchen configured for Mondays alone quotes and commits a Thursday order. The supplier offer in the probe is known and priced, so this specifically tests the kitchen's own calendar.

**Cause:** `Kitchen.deliveryDays` is shown as a note by Request; `validateLine` and commit do not enforce it. The same order through REST/MCP has no equivalent decision step.

**Correction:** decide whether the calendar is an actual receiving constraint or background information. For a constraint, enforce it at plan/commit and offer a deliberate reschedule or explicit exception. Document the choice consistently. **Owner:** core + B. **Acceptance:** all entry points agree on a non-receiving day. Probe `R9-06`. This is an operational contract gap; the current seeded hotel may receive on the demonstrated date.

### R9-07 · P2 · Valio's concurrency bound applies to one invocation, not the adapter

**Observed:** twelve concurrent calls to one `ValioLive` instance produce twelve concurrent HTTP requests despite its stated four-call bound.

**Cause:** `valio-live.ts:150` constructs a new four-worker pool inside each `fetch`. Concurrent visitors and the price/availability pair each get another pool.

**Correction:** share an adapter-level semaphore across endpoints and callers. Coalesce identical in-flight cache misses; preserve per-batch bounds and breaker behavior. **Owner:** catalogue/core adapter owner. **Acceptance:** multiple callers and endpoints never exceed the configured aggregate bound; an outage cannot fan out retries without limit. Probe `R9-07` used a fake fetch, with no supplier calls.

### R9-08 · P1 · Run normalization keeps a context stale even when the new run is known

**Observed:** register `run-new` for a valid visitor workspace and normalize a context carrying `run-old`. `onCurrentRun` returns `run-old`.

**Cause:** `demo/reset.ts` returns early when `hasRun` is true. Reads use the context run; transactions use the store's current run. Existing Ring 3 M2 remains open. The new `withCallScope` helper loads the run but closes over the original context; it does not return a refreshed context to its callback. At the archived SHA it had no call sites.

**Correction:** normalize the context for every relevant workspace, then pass that context to handlers and trace construction. Validate the active run/generation under the mutation lock. Reset and command execution need a defined ordering; a five-second refresh window alone is not a fence against writes from old work.

**Owner:** 9c + lead. **Acceptance:** restart, reset from another process, reset during prefetched work, old tab, old agent run and stage/shared-room calls. A stale call is refused or deliberately rebound before computation; it never mixes old read authority with new-run writes. Probe `R9-08` confirms the normalization bug, not the complete cross-process race.

### R9-09 · P1 · Large-op reference hydration can make the live stream lose an earlier event

**Observed with a mocked SQL driver:** notification 1 names a large op by reference and waits for its database read. Notification 2 carries an inline op and is delivered immediately. The transport delivers `[2, 1]`. Applying the exact high-water filter used by `/api/events` streams only `[2]`.

**Cause:** `bus/pg.ts` starts `void this.receive(payload)` for each notification. Reference hydration awaits SQL; inline delivery does not. `api/events/+server.ts` discards every sequence at or below the highest one already sent, with no gap-repair on ordinary live delivery. The durable op still exists, but the connected client misses it until a later catch-up/refetch. A large CreatePlan followed by a smaller mutation is a relevant trigger.

**Correction:** preserve notification order per workspace across asynchronous reference loads, and make a notification a prompt for ordered durable catch-up where practical. Preserve the cursor only through events actually delivered in order. Add disconnect/reconnect and mixed inline/reference tests. **Owner:** 9c. **Acceptance:** delay the earlier referenced read; every op still reaches the live client once in order. Probe `R9-09`, `transport-probes.test.ts`. This pass reproduced transport ordering and the route's filtering behavior, not a live Postgres/SSE deployment.

### R9-10 · P2 · Notification size is counted in characters rather than UTF-8 bytes

**Observed at the mocked PostgreSQL boundary:** a trace with 3,000 CJK characters produces a 3,103-character wire payload and is sent inline, despite encoding to 9,103 bytes. The fake driver's byte-limit check rejects it.

**Cause:** `bus/pg.ts` uses `text.length` before `notify`. Multilingual product/menu/model text is valid input. The actual limit is already described as bytes in the source comment. Additionally, `server-ports.ts` detaches `busPublish` without a rejection handler, so post-commit notification failure can become an unhandled rejection; process termination was not tested.

**Correction:** compare `Buffer.byteLength(text, 'utf8')`, use references or bounded summaries for oversized events, and contain post-commit publish failure with logging and durable replay/recovery. **Owner:** 9c + lead. **Acceptance:** ASCII/Finnish/CJK payloads around the threshold, oversized traces, and a rejected notify after a committed order. Probe `R9-10`.

## Earlier findings: current disposition

These are carried findings with fresh observations, not eight new discoveries. See [Round 7](ROUND7-CODE.md) and [Round 8](ROUND8-ARCHITECTURE.md) for the original analysis.

| Finding | This pass | Execution consequence |
|---|---|---|
| R7-01: request constraints disappear after selection | **Still reproduced.** Request now keeps `10 l` as a direct need, but a lactose-free request can be substituted with ordinary milk and that substitute committed. | Carry typed hard requirements into the need and through edits, ranking and commit. A requirement stored only in task metadata does not constrain core. |
| R7-02: replacement buys both products | **Still reproduced.** One 10 l need buys 10 l original plus 10 l substitute, with 10 l excess. | Supersede the original purchase strategy atomically, or represent an intentional split. Receipt deduplication does not prevent this double buying. |
| R7-03: known supply becomes unknown after approval | **Still reproduced.** Commit succeeds at the same price; the grant remains; the stored line still says known and no next action, while the receipt says awaiting supplier. | Reassess material supply changes and persist fresh evidence. Decide which changes need renewed acknowledgement. |
| R7-04: dish dependency closure | **Still reproduced.** Rice need doubles from 1.68 to 3.36 kg; dependent milk remains 10.5 l. The explanatory rice formula has improved. | Update the complete dish dependency closure. Apply the same rule to arbitrary menus. |
| R7-05: culinary fit 0/4 remains a recommendation | **Still reproduced.** Synthetic model scores of zero leave eligible recommended candidates. | Decide a suitability/uncertainty policy. A model may hold or request review; it must never override deterministic hard constraints. |
| R7-11: partial receipt quantity | **Still reproduced in a cloned-state probe.** A one-unit confirmation marks the whole ten-unit line confirmed. | A future partial-acceptance supplier adapter must allocate receipt quantities by line. The current simulator confirms whole lines. |
| R8: independent identical new tasks | **Still reproduced.** Two task IDs share one plan/order. | Separate new purchasing intent from retry identity. |
| R8: task save fails after effects | **Still reproduced.** One order exists, zero saved tasks; the user is told to reload/retry. | Persist a recoverable task/turn before effects. Reconcile an effect that succeeded before its acknowledgement failed. |
| R8: web-state write failure | **Still reproduced.** Failed upsert is logged/acknowledged; unchanged value is never retried. | Required durability must fail visibly and remain retryable. A 202 must mean durable acceptance. |
| R8: queue claim without local record | **Still reproduced.** Claimed work absent from the local map produces no read/work. | Return durable work payloads from the claim and operate on them. Avoid treating startup-hydrated maps as shared truth. |
| R8: kitchen grant mismatch | **Still reproduced.** Restricted context reads/creates outside its site grant; outcome reader refuses. | Enforce resource access at the common service boundary before adding restricted memberships. No cross-visitor exploit was demonstrated. |
| R8: projected detail versus open list | **Still reproduced.** Detail becomes done; list still shows awaiting chef. | Project/filter current task state consistently, with bounded query cost. |
| Request physical amount | **Improved:** the direct need retains its physical amount. | Preserve this change while adding hard requirements. |
| Request awaiting-supplier outcome | **Improved:** outcome is partial/unconfirmed, rather than fulfilled. | Keep the receipt-backed distinction. |
| Mixed-unit ledger summary | **Improved:** “2 kg + 3 l” stays separate. | `ledgerTotals` still exposes a dimensionless aggregate; avoid reusing it as a physical total. |

Three working counterexamples were retained: a fully committed plan refuses a new repair; same-key commit replays its receipt and outside-agent approval is refused; changed price returns `TERMS_CHANGED`. Existing gate tests also cover caps and cut-off boundaries. This is useful evidence for those particular guarantees.

## Wiring and deployment findings from source inspection

These findings were inspected in code; they were not all exercised as HTTP or container failures.

| Priority | Location and issue | Concrete next step |
|---|---|---|
| P1 | `request/task.ts` creates `t-<planId>` tasks; both chat routes accept only `^task-…`. A Request task can be joined by plan and then rejected on restore/continuation. | One task ID parser/generator; never silently discard an invalid supplied task ID. Test Request → Kitchen → Chat → reload. E + B/lead. |
| P1 | Chat routes still pass `realHandlers` and enter only `inWorkspace`. The new call-scope helper exists without adoption at the archived SHA. | Wire every direct port/model entry through the refreshed scope; make unwrapped handlers private. Verify workspace, run, spend key and trace on each door. Lead + E/B/9c. |
| P2 | `agent/loop.ts:754` sends an extra `schema` field via a cast. `Llm.generate` has no schema contract; `adapters/llm/index.ts:70` forwards JSON MIME mode only. | Describe the implementation as validated JSON plus bounded retry until the schema is part of the port and actually forwarded by each adapter. Use an adapter-boundary request assertion. E + model owner. |
| P2 | `tools/handlers.ts:73` loads replay JSON from `src/…`; the final Docker stage copies no `src` or replay file. `loadReplay` silently returns `{}`. | Package replay as a bundled/static runtime asset and verify its hash/entry count from the final image. Rules fallback still exists. Lead/deploy + model owner. |
| P2 | `RankingStrip.svelte:71` renders every `llm` fit as “Gemini,” including recorded replay. Seen under the fixture provider in this pass. | Carry live/replay/rules as a typed field to presentation and label replay at the point of use. D + 1f. |
| P2 | `tools/mcp.ts:66` marks every tool `destructiveHint:false`, including commitment, despite the planned registry distinction. | Derive annotations from tool effect semantics; ensure MCP and OpenAPI agree. This metadata does not bypass server authorization. E/lead. |
| P2 | `createServerPorts` retains its rejected initialization promise on `globalThis`; `realHandlers` resets only its own promise. | Clear failed initialization safely so a transient startup failure can recover. Verify fail-once/succeed-next with a fake builder. Lead. |

**Late improvement:** Gemini text calls now pass through the external-call helper with per-workspace/global caps in `llm/router.ts`. The early “text calls have no daily cap” observation is superseded. Unscoped callers still charge the global counter only, and Chat supplies a custom callback that does not publish successful traces. The remaining issue is entry-point adoption and observable attribution. The new router tests should accompany the next gate; the initial full gate ran before that merge.

The clean checkout/container boundary also needs an explicit acceptance case. Server fixture mode expects gitignored Valio data; the deployment notes document a mount requirement. `/offline` is a separate browser fixture with a separate implementation. Test that fallback's promised journey independently rather than assuming that the real-handler evals prove it. A successful `/healthz` in fixture mode does not establish catalogue readiness.

The seed script upserts products and offers in separate batches without a dataset activation boundary. It is retryable, but interruption can expose a partially refreshed catalogue; the in-process retrieval index also lives until restart. For future data refreshes, validate a versioned dataset before activation and carry its version into diagnostics. The app accepts `PROJECT_CA_CERT`, while the standalone migration/seed scripts read only `PG_CA_CERT`; keep that difference explicit in deployment instructions or consolidate their connector options. Venue/probe scripts received source inspection only and were not run against providers.

## Interface observations

Playwright exercised the local fixture-backed server with the real handlers and empty `DATABASE_URL`. Twelve captures cover Kitchen, Request, Ops and Chat at 1440/390 px, plus planned Kitchen and a priced Request. No document-width overflow or browser exceptions were observed in those states. The buffet planned, and the milk request reached its Kitchen handoff. This was Chromium viewport emulation; physical-device touch, screen readers and the complete keyboard journey were not tested.

Provisional Impeccable technical audit scores:

| Dimension | Score / 4 | Evidence and limit |
|---|---:|---|
| Accessibility | 2 | Forms have labels, state has words/icons and the approval control handles keyboard input. Chat's small icon controls and the full focus/contrast behavior need measured checks. No WCAG conformance claim. |
| Performance | 2 | Build and fixture flows completed; viewport inspection showed no failure. No browser CPU, interaction percentile or 10× data profiling was performed. |
| Theming | 3 | Shared semantic tokens and a coherent dark Ops surface are present. Review small muted dark text with measured contrast. |
| Responsive behavior | 3 | No horizontal document overflow in the captured states. A small viewport alone does not prove touch gestures or text zoom. |
| Implementation integrity | 2 | Shared components and coverage vocabulary help. Raw workspace/run IDs and request keys remain outside System; replay is labelled Gemini. |
| **Total** | **12 / 20** | **Acceptable, with significant work needed. Provisional, scoped to observed states.** |

The source detector returned five side-border advisories. They map to operational grouping/evidence components and are not treated as five defects. The rendered detector failed with a protocol-connection error; Playwright captures and DOM checks provide the rendered evidence for this pass.

High-value UI work is to show one consequence and the action that changes it, keep a task's decision/receipt current after navigation, and make “what remains” truthful across all purchases. Move technical identifiers behind System. On Request, the observed small valid order is still a draft followed by a chef commit button; its copy correctly says “not placed yet.” Judge-facing descriptions should distinguish preparing a basket from autonomously committing it.

Recommended UI passes: **P1 `$impeccable harden`** on task recovery/terminal states; **P2 `$impeccable clarify`** on remaining work, replay and supply wording; **P2 `$impeccable adapt`** for focus, text zoom and physical touch checks; then **`$impeccable polish`**. Re-run the audit after the behavioral fixes. These are implementation recommendations, not work performed by this review.

## Execution guidance

### Batch 1: close task and command transitions

**E + core + lead.** Handle R9-01 through R9-05 together with independent-task identity, task-before-effect persistence and the Request task-ID mismatch. Define one command identity, one terminal-state rule and one task projection over active obligations. Acceptance is a journey, not separate unit checks: create two items → commit eligible subset → grant one held group → reconnect → continue → cancel outstanding work → retry an old message. Check durable rows, receipts and the final visible account of what remains.

### Batch 2: enforce the purchase the chef actually requested

**Core + lead; B/E preserve intent.** Persist hard need requirements, supersede replaced strategies, amend complete dish dependencies, and reassess material supply changes. Acceptance combines request → substitute → edit → approval → commit. Include lactose-free milk becoming ordinary milk, an in-stock original, a recipe with two ingredients and known supply becoming Terminal. Neither a happy-path parser test nor a receipt-uniqueness test covers these cases.

### Batch 3: make context and durability real at every door

**Lead + 9c + D/E.** Adopt the refreshed call scope, fence resets, retry durable web writes, process database work records directly, and preserve event ordering across reference hydration. Add an entry matrix for Kitchen, Request, Chat, REST, MCP, Ops reads and webhook/job paths. Assert the same workspace/run/clock, access check, spend attribution and trace destination. Validate the final container, including replay and the documented offline route. Use the shared gate lock; do not launch parallel memory-heavy gates.

### Batch 4: prove the hero and publish only its evidence

**1f + 9c + 91 + lead.** Rehearse one precise task from need to exception to decision to receipt, reload it, then show the matching Ops case. Pin source SHA, deployed SHA, fixture/live/replay mode, expected result, artifact and owner for each claim. Refresh STATUS, DISPATCH and CLAIMS from that record. Rebase acceptance criteria when another lane changes the shared seam.

Defer memory, forecasts and additional sponsor surfaces until these journeys are green. A second kitchen should first run in shadow mode with explicit buyer account, receiving calendar and authority. The current catalogue port captures one buyer account and re-dates availability onto the demo scenario; additional seeded kitchens do not establish a second operational customer.

The main architectural opportunity is a small application-command boundary around the existing core: authenticated and refreshed context → durable task turn → exact domain command → canonical task outcome → presentation. Keep model interpretation and explanation replaceable at the ports. The model should never supply authorization, derive business retry identity or declare completion independently of outstanding obligations.

## Coverage and verification limits

| Area | Work in this pass |
|---|---|
| Product, orchestration and claims | Read rules, status/dispatch/plan, concept/architecture/scorecard, decisions, current synthesis and earlier reviews; mapped findings to owners and landing order. |
| Core and persistence | Traced handlers, validation/tiering, quote/approval/commit, reducer, store locks/idempotency, receipts, fulfilment, event edits and substitute application. |
| Request/menu/chat/agent | Traced parse/lookup/conversion, menu review/storage/planning, task store/projection, continuation, resize, cancellation, principal and loop. |
| Credentials and entry points | Inspected auth, visitor/presenter rooms, judge keys, Kitchen helper, REST/MCP gates, reset and SSE paths. Earlier public isolation evidence was read; no new production isolation run. |
| Providers and web | Inspected catalogue/live/cache, LLM/Decide routing and traces, external scope/caps, webhook/queue/write-through behavior. Provider HTTP was faked where probed. |
| Build/deploy/publication | Ran the gate, inspected Docker/runtime assets, env names, ignore rules and license. A narrow tracked-content secret-pattern search found a documentation URI match; it is not a complete history secret audit. No secret values were read or printed. |
| Interface | Local screenshots/DOM checks at two widths and two meaningful states; source detector checked and false positives separated. |

`pnpm.cmd gate`: green, seven steps; 618 unit tests passed / 39 skipped; eval checker self-tests 24/24; build, eval and agent eval passed. The full Playwright gate, production Postgres races, live providers, cross-process failure injection, physical touch and a complete public-history audit were not run. Later router changes received a targeted check, recorded in the evidence README. Do not interpret these limits as a production-readiness certificate.

Evidence, commands, source archive, logs and scratch probes: [scratch/round9/README.md](../../scratch/round9/README.md). Lead handoff: [review-adversarial-r9](../handoff/review-adversarial-r9.md).
