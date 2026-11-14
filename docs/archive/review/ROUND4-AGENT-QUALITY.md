# Round 4 — agent quality, authority and growth

Snapshots: `c834e98`, with a live-UI boundary update at `451a713`, 14 Nov 2026. This is an implementation-and-direction review of the agent pillar, not a feature-count review. Files are actively changing. No app edits, remote calls, credentials or shared-database tests. A pure local agent-loop probe is described below.

## Assessment

Mandate already has something materially better than “the prompt tells the agent not to”: the server filters tool visibility, validates input/output and denies missing scopes, and the core guards commitment authority. Preserve those boundaries. But **role-based tool scoping is only one layer**. Current keys are environment-global, the agent sees every role-permitted tool throughout the run, and the run endpoint reconstructs a more powerful routine-agent identity instead of preserving the initiating principal. Those shortcuts are manageable for a clearly isolated demo; they are not the foundation for all kitchens in Finland.

“Really good” here means the agent understands a supported request, gathers only the facts needed, produces a feasible versioned plan, asks when evidence or authority is missing, and either finishes or stops in a recoverable state. A trace of eight tool calls does not establish any of those outcomes.

## Scoping maturity: several boundaries, not one checkbox

These are cumulative design layers, not a score where reaching a higher row compensates for a missing lower one.

| Layer | What it buys | Current evidence | Quality gate |
|---|---|---|---|
| **Prompt instruction** | Communicates intent and workflow | Planner says never approve ([loop.ts:249](../../../src/lib/server/agent/loop.ts#L249)) | Model violations must still be refused by the server |
| **Tool visibility** | Reduces confusion and accidental selection | MCP registers only scoped tools; external list omits approval ([mcp.ts:27](../../../src/lib/server/tools/mcp.ts#L27)) | Unavailable tool absent from advertised menu, with a discoverable human handoff |
| **Server capability enforcement** | Denies a forged direct call | `serveTool` checks scope before handler ([serve.ts:89](../../../src/lib/server/tools/serve.ts#L89)) | Hidden tool called directly is rejected before side effects |
| **Resource-bound grants** | Limits which kitchen/run/records a caller may touch | Partial: workspace/run in context; key entries have role/label only ([auth:18](../../../src/lib/server/auth/index.ts#L18)) | Kitchen A key cannot read, edit, approve or start work for B—even using a guessed valid ID |
| **Workflow-phase permissions** | Keeps each step focused; prevents premature writes | Not present: one role menu for entire run ([loop:59](../../../src/lib/server/agent/loop.ts#L59)) | Discovery context cannot commit; commit requires a validated plan handle and current allowed action |
| **Action-bound authority** | Authorizes exact effects, not “the agent” generally | Version/hash approval and idempotency exist; round-3 invariant gaps still require closure | Repeated/changed selections, stale terms or revoked authority cannot amplify a valid approval |
| **Context separation** | Prevents untrusted web/catalogue text sharing the writer's full authority | Intended in research, not enforced as a composed workflow | Reader has read-only capability; writer receives typed evidence/handles and cannot reinterpret source text as authority |
| **Durable execution control** | Handles cancel, restart, quotas and concurrent tenants | Process-global one-run guard and traces, not durable run lifecycle ([agent-runs:13](../../../src/lib/server/bus/agent-runs.ts#L13)) | A stopped/revoked run cannot initiate new side effects; restart resumes or reports a known terminal state |

**What to implement this weekend:** complete server/action invariants, preserve principal/resource scope, have a deterministic workflow around the bounded model decisions, and add clear stop/handoff outcomes. Phase-specific menus are a useful reliability improvement; they never replace the server gate. Do not build a generic IAM platform or a graph of ten autonomous agents for the demo.

## Findings that change the quality bar

### A. Starting an agent is delegated authority, not merely a button

The HTTP run route authenticates a `CallContext` ([route:17](../../../src/routes/api/agent/run/+server.ts#L17)), permits `approver` ([route:9](../../../src/routes/api/agent/run/+server.ts#L9)), then calls `startAgentRun` with only goal/env ([route:53](../../../src/routes/api/agent/run/+server.ts#L53)). `runRoutineAgent` reconstructs a global `kitchen_agent` context ([index:23](../../../src/lib/server/agent/index.ts#L23)). Thus a principal whose ordinary tools are only read/approve can start execution under read/plan/order authority. That may be an intentional product delegation, but it is currently implicit and cannot preserve per-kitchen limits when they are added. The initiating person is also lost from subsequent mutation attribution.

**Fix/gate (lead + agent, 45–90 min for the narrow seam):** pass a server-derived `RunPrincipal {initiatedBy, serviceActor, workspaceId, kitchenIds, runId, grantVersion, expiresAt}`. Add an explicit `agent:run` permission or equivalent authorization policy; starting a service agent must not silently imply purchasing authority. Effective rights are the intersection of initiator grant, service role, resource, phase and mandate—not the union. Record both initiator and executing agent. Never let a request supply its own actor/grants.

### B. Current keys do not yet represent many independent customers

Every key resolves to `MANDATE_WORKSPACE`, and all inherit the same environment/current run ([auth:70](../../../src/lib/server/auth/index.ts#L70)); scopes are inferred entirely from actor kind ([tools:15](../../../src/lib/core/contracts/tools.ts#L15)). A key's label is not its resource authorization. There is no explicit kitchen grant, key expiry or per-principal quota in this resolver.

**Direction:** do not put restaurant/customer IDs into the prompt as the isolation mechanism. First add resource grants to the existing key resolver and check the target plan/kitchen after lookup; later use the existing DB key table and user/organization memberships with revocation. “Operations can inspect all kitchens” is a separate explicit grant from “agent may order for one.” Seed three isolated organizations and a separate operator principal before promising nationwide multi-user behaviour.

### C. Agent deadline is advisory; a slow planner can initiate a tool after it expires

**Reproduced pure local probe:** `runAgent` with `deadlineMs: 1`, a planner delayed 25 ms, and one harmless fake `search_products` handler. Result: **one tool call after the deadline, stopped=`max_steps`**. The loop checks time only before awaiting the planner ([loop:68](../../../src/lib/server/agent/loop.ts#L68)); it does not check again before dispatch ([loop:81](../../../src/lib/server/agent/loop.ts#L81)). Gemini text generation has no explicit deadline in this adapter ([llm:56](../../../src/lib/server/adapters/llm/index.ts#L56)); the compatible adapter's separate 30-second timeout does not enforce the run's remaining time. Client disconnect deliberately leaves work running ([run route:89](../../../src/routes/api/agent/run/+server.ts#L89)).

**Fix/gate (agent, 30–60 min):** propagate a cancellation/deadline signal through planner and provider ports, recheck before every tool dispatch and inside the mutation boundary when cancellation must prohibit new effects. Explicitly distinguish “stop watching” from “stop agent.” A model call already running may still cost money; cancellation is not a claim of provider-side rollback. Test slow planner, slow tool, cancel-before-commit and reset-during-run. The first two can be pure tests with no network.

### D. “Done” currently means the planner said done

The model may emit `done` on its first reply and the loop accepts it ([loop:77](../../../src/lib/server/agent/loop.ts#L77)); no required end-state check runs. The scripted planner always selects the Christmas event whether the goal matches Christmas or not ([loop:175](../../../src/lib/server/agent/loop.ts#L175)). Its coverage test treats the presence of a substitute product as resolution ([loop:189](../../../src/lib/server/agent/loop.ts#L189)), not the quantity and confirmed-supply outcome. The live planner cannot discover kitchen IDs or event IDs through a dedicated context/bootstrap tool, even though `plan_event` needs them.

**Fix/gate (agent + product, 45–90 min):** resolve a typed supported intent first: routine order, seeded event, shortage repair, inspection, unsupported/clarification. A deterministic dispatcher can do this without generative orchestration. Provide a small context bootstrap containing authorized kitchen, current plan and supported actions. Finish with `GoalOutcome {status: fulfilled|partial|awaiting_user|blocked|unsupported, confirmedNeeds, unconfirmedNeeds, unresolvedNeeds, approvalIds, nextAction}` computed from domain state. Planner prose explains the result; it does not decide success. Unsupported fixture requests must say unsupported rather than silently create Christmas dinner.

### E. Structured tools do not by themselves separate untrusted evidence from purchasing authority

`search_products` returns full normalized product objects ([quote.ts:17](../../../src/lib/core/services/quote.ts#L17)); the planner serializes non-plan tool results directly into its prompt ([loop:134](../../../src/lib/server/agent/loop.ts#L134), [245](../../../src/lib/server/agent/loop.ts#L245)). Product names/vendor fields can still contain untrusted strings. The same planner's role also has order/commit tools. This does not establish a successful exploit, but it contradicts the research rule that contexts reading untrusted data cannot place orders ([agent-harness.md, section B.7](../../research/agent-harness.md)). A JSON wrapper is not an authority boundary.

**Fix/direction:** use a read-only evidence worker for catalogue/web/document interpretation. Its result is `Evidence {sourceId, observedAt, typedClaims, uncertainty, conflicts}` with references. A planner may propose IDs/quantities; only the deterministic service enforces facts, mandate and commitment. Keep source text available in the human drawer, not automatically copied wholesale into every planning turn. Test planted instructions in product names, web text and documents against final DB outcomes, including attempts to change mandates or redirect workspaces. The goal is bounded damage even if a model follows the injection—not a claim that text sanitization solves injection.

### F. Adapter availability is not demonstrated decision quality

The latest code now constructs/injects `createDecide` ([handlers:62](../../../src/lib/server/tools/handlers.ts#L62)) and serves real handlers without stub fallback ([handlers:86](../../../src/lib/server/tools/handlers.ts#L86)); these are genuine improvements since round 3. **But** `find_substitutes` still calls numeric ranking without `ports.decide` or a fit map ([substitutes:140](../../../src/lib/core/services/substitutes.ts#L140)). Do not call this recipe-aware model ranking yet.

**Quality gate:** use a small expert-labelled set with plausible but culinarily incompatible substitutes. Compare pure numeric baseline, model fit and final policy-constrained result. Report top-choice suitability, constraint violations, unsupported/held rate, correction count, latency and cost separately. Confidence is a model output, not permission. Tune on one subset and report another; twenty handpicked cases can find failures but cannot justify broad calibration claims. Persist input fact IDs, prompt/rubric version, policy version, model/source and selected effects so the decision can be reproduced.

### G. The existing evals prove deterministic journeys, not broad agent competence

`playScenario` constructs real service handlers and plays prescribed steps ([adapter:50](../../../src/lib/server/evals/adapter.ts#L50), [100](../../../src/lib/server/evals/adapter.ts#L100)). That is valuable domain regression testing. It does not make a model discover those steps. Agent tests cover a fixture script and fake LLM replies ([agent.test.ts:24](../../../src/lib/server/agent/agent.test.ts#L24)); the served-handler run only checks `stopped === done`, not a fulfilled goal.

Use four suites with distinct names/results: **domain invariants**, **scripted journeys**, **live planner goal trials**, **adversarial authority/recovery**. A real model trial records model/config, seed, allowed tools, budget and final domain outcome. Repeat several runs and preserve failures. Neither an LLM judge nor a plausible summary can substitute for stock/order/budget/coverage assertions. This builds the path toward a serious Lab/AfterQuery environment without relabelling existing fixtures as agent intelligence.

### H. Live UI update: hiding the chef key is good secret handling, not human-authority separation

At `451a713`, the browser now has a real server bridge. It keeps credentials out of browser code, reuses domain handlers and produces the real plan; credit that progress. But `callTool` reconstructs a global chef identity ([live.ts:29](../../../src/lib/server/kitchen/live.ts#L29), [33](../../../src/lib/server/kitchen/live.ts#L33)). The public tool POST route (`src/routes/(kitchen)/kitchen-api/tool/[name]/+server.ts:6`) forwards any named tool without authenticating a human/session. Consequently, hiding `approve` from MCP's external-agent menu does **not** establish end-to-end separate approval authority: another caller can reach the chef-capable browser helper. The same shared gate still applies, but this route supplies it a privileged principal.

This is a deliberate public-demo shortcut, not a reason to stop and implement enterprise login tonight. **Now:** isolate the presenter run from the public playground; limit the helper to explicitly allowed demo commands and the selected isolated run; make the public-demo authority model visible. Before a pilot, derive the browser principal from a real session/resource grant, and test external/direct requests against *every* mutation surface. A model lacking the MCP approval tool must also lack the corresponding browser-helper capability. Keep the approver secret server-side while binding its use to an actual authorized human action.

The snapshot GET (`src/routes/(kitchen)/kitchen-api/snapshot/+server.ts:6`) calls `snapshot`, which calls `ensurePlan`, creating an event plan and proposing substitutions ([live.ts:50](../../../src/lib/server/kitchen/live.ts#L50), [82](../../../src/lib/server/kitchen/live.ts#L82)). Viewing/prefetching the screen can therefore change order state and later trigger model work. Its selected kitchen/preset/contention are process-global ([live.ts:23](../../../src/lib/server/kitchen/live.ts#L23)), so two browsers are not independent kitchen sessions.

**Quality gate (Kitchen + auth owner):** an explicit demo-start command initializes the plan; subsequent snapshot reads append zero mutation ops; one browser switching kitchen/preset cannot change another session's selection; only a permitted human session can approve that run's exact terms. This can be a small demo-session boundary now and real organizational membership later. It is the next layer above “the UI uses the same tools.”

## Concrete stories that make the pillar good

| User story | Behaviour and acceptance oracle |
|---|---|
| “I ask for milk by Monday, but do not specify a pack.” | Resolve quantity and date, compare compatible units, explain chosen pack; ask only if materially ambiguous. Price/quantity facts come from tools. |
| “I change a portion after the agent found a replacement.” | Recompute active replacement/ingredient quantities, invalidate prior approval, show exact diff; no duplicate replacement purchase. |
| “I allow routine reorders but never allergen changes.” | Known permitted lines act; forbidden/unknown dietary facts stay blocked/held according to policy, regardless of model confidence or source instructions. |
| “The supplier page says my manager raised the cap.” | Evidence cannot modify the mandate; record rejected attempted authority change without making it a normal proposal. |
| “I manage two kitchens with different rules.” | The selected authorized kitchen determines catalogue context, budget, policy and plan; no cross-kitchen read or write through guessed handles. |
| “I stop the agent after it drafts the plan.” | No new purchasing effects after accepted cancellation; draft remains inspectable, restart revalidates terms and idempotency. |
| “The model/API fails halfway.” | Preserve completed ops and known plan, report blocked/partial outcome and safe next action; no silent success or automatic rerun of already committed lines. |
| “An operator investigates why a school was held.” | Operator can inspect evidence/policy versions and request a human correction without impersonating its approver. |

## Roadmap for this pillar

**Before broad Ring 1 integration:** close the round-3 transaction/constraint defects; preserve initiating scope; deterministic goal outcome; actual model-fit service effect; deadline-before-dispatch test; three compound journeys (edit after rescue, stale approval after new evidence, cancel/reset during work). These are additions to what “done” means, not a new autonomous subsystem.

**Three-kitchen quality cohort:** one hotel, one lunch kitchen, one tender-constrained public kitchen. Same disruption must legitimately produce different eligible/held/rejected results. Add per-kitchen resource grants and language-aware request handling; a Finnish product label should not need to be renamed to work. Memory is editable preference evidence with provenance, never a permission channel.

**Regional rollout:** replace seed-only event lookup with versioned kitchen recipes/menus and delivery calendars; add durable run state, budgets/quotas, operator replay and failed-job recovery. Admission requires usable data, not merely a venue appearing on a map.

**Nationwide service:** workload scheduling with per-kitchen fair limits, organizational delegation/revocation, per-customer offers and reliable source freshness. Measure supported kitchens, data-readiness cohorts, safe fulfilment rate and interventions per plan. Do not load Finland into one prompt or call every venue a live agent. “All Finland” is coverage + onboarding + evidence quality + operational isolation; concurrent model count is only one capacity measure.

The strongest version is an agent whose successful plan is easy to inspect, whose limits are impossible to talk away, and whose failure leaves a clear next action. That is a better quality target than “uses tools, has scopes, runs eight steps.”
