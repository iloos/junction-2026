# Round 6: from a credible foundation to a distinctive product

14 November 2026. Review began at `4c6b156` with T0 staged; T0 subsequently landed as `9cefdf2`, followed by STATUS `da09d47`. Recommendations address the current domain, agent and product direction, not only fan-out mechanics. Application inspection was read-only. No new test run, live-provider trial, production UI inspection or competitor survey was performed.

Companion reviews: [foundations](ROUND6-FOUNDATIONS.md), [agent product](ROUND6-AGENT-PRODUCT.md), [product interactions](ROUND6-PRODUCT-INTERACTIONS.md), [shared vocabulary](../../concept/VOCABULARY.md). The first two describe T0 as staged because that was its state during inspection; those same contracts are now committed, not proof of implemented handlers.

Final concurrent update: `91f034a` added hybrid substitute candidate retrieval behind `CATALOG_RETRIEVAL`, with tests and a labelled evaluation set. Credit this as progress on retrieval, not an absent capability; this review did not run that evaluation or verify its production flag. Better candidate recall remains distinct from sizing, feasibility, task completion and truthful explanation.

## Judgment

The concern is justified: a correct ordering flow, a bounded agent and an Operations board establish credibility. They do not by themselves establish a memorable product advantage. The user reports about 150 people in this track; that increases the importance of a clear distinction, but does not tell us what competing teams have built. No review can promise a win.

The strongest direction already exists in the repo's [PRODUCT](../../concept/PRODUCT.md): **help a kitchen keep service possible when plans and supply change, with less manual rework and a precise account of what can be promised.** Make that the organizing product outcome. Keep the platform: chef workspace, internal operations and open agent interface. Their value comes from carrying one task through different roles, not from the number of screens.

Ring labels are secondary. The repo now dispatches Ring 1 while the user still experiences foundation-building. Both descriptions are understandable: a deployed Ring 0 spine exists, and important semantic foundations are still being completed. Judge readiness by completed user journeys and evidence, rather than declaring a ring finished because its modules exist.

## What would make this stand out

### 1. Demonstrate a changing task that the agent actually completes

The central proof should be a task with a perturbation the presenter did not hide: a changed guest count, a different dietary/origin requirement, a new shortage, an expired offer or a missing ingredient. The system should preserve the request, recompute consequences, choose or propose a materially useful repair, ask the necessary human decision and resume the exact plan.

This is stronger than a long trace or a menu generator. The fixture/script remains useful for reliable demonstrations; label it honestly. A model-driven run earns its place by handling variations better under the same gate. Do not turn every calculation into a model decision merely to make the product seem more agentic.

**Proof:** change one consequential input and show what changed, what stayed, what cannot be satisfied and why. The external agent and the UI must reach the same domain result. A human should be able to follow the result without reading the tool trace.

### 2. Show meaningful alternatives with measurable consequences

The existing ranking and mandate can support a more useful decision than “candidate 1 scored highest.” Compare feasible strategies: same product in another pack, a suitable replacement, prepare in-house, accept a partial quantity, or change delivery where supported. Show consequences in physical demand, purchase excess, money, timing, evidence gaps and human decisions required.

The domain must distinguish AND dependencies from OR alternatives: all necessary ingredients are required for make-in-house; two candidate products are alternatives until selected. Preparation feasibility also assumes labor, equipment and time unless those resources are modeled. State that assumption rather than claiming ingredient stock proves dinner can be made.

**Proof:** a judge changes a preference, and the result changes for an intelligible reason; a hard requirement remains binding. When no feasible option exists, identify the blocking facts and offer permitted next steps. Never suggest relaxing an allergy or a forbidden rule as an ordinary trade-off.

### 3. Make evidence and human handoffs part of the purchase

Exa/Context.dev should answer a specific consequential uncertainty or introduce a precise incident, then link to the affected need and plan. An evidence panel disconnected from the purchasing decision is still a checkbox, even if its API is real.

The strongest sponsor demonstration is source → uncertain fact or recall match → impacted plan → proposed action → human review, with live/cache/replay labels. A source citation can support identity or a field; it does not automatically establish safety, supply or authority. The existing suggestions boundary is valuable.

**Proof:** a person can explain why the exact order was held and how to resolve it, including when the evidence is insufficient. The operator sees the same facts as the chef, with a different work queue.

These three demonstrations can share one underlying model. They should not become three new products.

## Foundations to strengthen before the overhaul

### A. Preserve a requirement-to-purchase graph

The T0 addition of stable proposal, dish and ingredient IDs is good. Carry those identities into needs, chosen fulfilment strategies, purchase lines, approvals and receipts. Do not reconnect them later using labels or array order. Persist source proposal revisions and the original requirements.

This enables independent editing of identical dish names, a precise Why chain, correct recalculation, scoped agent context and meaningful Ops grouping. It also enables future sourced menus and nationwide estimation without conflating a discovered venue with an authorized buyer.

**Acceptance:** two dishes share an ingredient/SKU; editing one changes only its intended demand and the appropriate combined purchase. Reload and an external client can still explain each allocation.

### B. Have one physical calculation and allocation authority

T0's direct physical needs, explicit units/bases and exact fulfilment partition are the right foundation. Complete the calculation from requirement → content/yield → sales quantity → lot rounding → excess, then allocate receipt-backed quantities to needs. Reject inconsistent physical versus sales inputs. Preserve unresolved conversions.

Do not let a shared SKU be counted twice, or one ingredient “cover” an entire recipe. Join receipts to immutable order-line identity. Planned known stock is neither reserved nor supplier confirmed. The companion foundations report gives concrete tests.

### C. Make review and continuation real state transitions

`chef_reviewed` in a submitted JSON document cannot establish who actually reviewed it. Record acceptance of a scoped proposal revision/digest server-side. Keep menu review separate from purchasing approval and from verification of dietary facts.

Likewise, an agent run ending is different from a purchasing task finishing. Store a recoverable task/plan reference and the necessary decisions; subsequent bounded runs re-read current state and continue. This does not require a workflow engine or a transcript-based memory system.

### D. Make one coherent read model usable by every surface

Kitchen, Request, Ops and MCP should consume the same physical fulfilment, authority and freshness facts. T0's `PlanView`/`FulfilmentView` moves in that direction. Carry version, as-of, expiry, projection completeness and typed next actions. Avoid assembling an old plan with approval metadata loaded after a concurrent edit.

Business state and projection state are different: a board that missed events should say stale and resync rather than silently presenting incomplete state as current. A correct op log is necessary, but it is not automatically a correct user-facing view.

### E. Unify vocabulary as a semantic contract

Adopt the [vocabulary proposal](../../concept/VOCABULARY.md). Reserve supplier confirmation for receipt evidence; distinguish planned, ordered, awaiting supplier and delivered. Separate need quantity from pack count; approval from product evidence; task from agent run from scenario run.

There is still a transitional inconsistency: T0's fulfilment partition uses `supplierConfirmed`, while the legacy `LineView.confirmedCover` and `SupplyTier.confirmed` refer to observed stock before commitment. Fix through deliberate adapters/compatibility, not a simultaneous uncontrolled rename across all lanes. A glossary without shared computations and examples will not solve the problem.

## Agent quality: what to improve next

The repo already has useful controls: delegated principals, resource grants, intent-scoped tools, bounded facts, cancellation/deadline guards and goal/adversarial trials. Preserve them. The next improvement is task competence:

- Explicit task/kitchen/plan selection and continuity through clarification, approval and retry.
- Semantic discovery: who may act, on which resources, what is supported now, and the correct next action after failure.
- A bounded repair agenda prioritizing unmet demand and useful actions; detect repeated no-progress attempts.
- Exception-first context with counts/completeness, not silently truncated first-N data.
- Quantified truthful outcomes across every touched plan: confirmed, waiting, unresolved, money committed and human decisions remaining.

Evaluate scripted and model-driven policies on the same perturbed tasks. Measure useful progress, invalid actions, truthful residual reporting, unnecessary questions, latency and external-call cost. An eight-step loop is a safety limit, not a quality measure. More tools and more tokens are not evidence of better reasoning.

## UI/UX overhaul: define the work before the visual world

The current source has several entry points around the Christmas example and direct requests. Before replacing its look, establish their shared navigation and object model:

| Surface | Primary work | Must explain |
|---|---|---|
| Chef workspace | Shape the menu/need, compare a repair, review consequences, approve exact terms | What needs me, what changes if I choose this, what is still unsupplied |
| Operations | Investigate causes across affected tasks, locate the right owner, recover failures | Why this case exists, which plans are impacted, what action resolves it |
| Agent interface | Discover resources/capabilities, act under grants, recover, hand off | Current task/version, permitted next steps, a valid human review entrance |

An eventual visual system should make those relationships legible: a persistent task summary, requirements and consequences, focused decisions, and deeper evidence/calculations on demand. Build a small set of reusable task, decision, evidence and receipt components over the shared read models. Do not make chat history the durable work record.

The overhaul need not wait for every backend feature. Start interaction prototypes once the read-model fixtures and representative states are stable: incomplete request, missing evidence, partial supply, expired offer, revised plan, awaiting supplier and confirmed receipt. Then verify the rendered flow at phone and desktop sizes. This review is product/interaction direction, not a rendered UI audit or a replacement design specification.

## A demonstration that earns the larger scope

Suggested sequence; it is a proposal, not a claim this works today:

1. Open on an already understandable kitchen task, with demand and two consequential problems visible.
2. Let the judge change a requirement or guest count. Show the physical and monetary consequences, not just a spinner.
3. The agent compares a supported repair and exposes a real limitation. The person makes one meaningful decision; no generic “approve everything.”
4. Submit the exact authorized terms and retry deliberately. Show the same receipt and any supply still awaiting confirmation.
5. Open the precise task in Ops, then let an external MCP client inspect or continue it under its own grants. One state, different roles.

The point is not five feature reveals. It is an unbroken chain from a person changing their mind to a trustworthy result. A sourced incident can replace one step if it is genuinely integrated and reliably demonstrable.

Use measured evidence: requirements retained, quantities reconciled, unresolved needs visible, successful recovery, invalid actions refused, duplicate receipts zero in the exercised retry test. Time saved and waste reduced remain hypotheses until measured against a comparable manual baseline; purchase excess is not automatically food waste avoided.

## How this changes the roadmap without restarting it

| Horizon | Deliver | Gate |
|---|---|---|
| Current A/B/C/D/E/F/G integration | T0 semantics implemented end to end; isolated exact-plan recovery; physical fulfilment and clear vocabulary | Same task has the same quantities, authority and uncertainty through UI, MCP and Ops. |
| Next distinctive product increment | Bounded adaptive repair + meaningful strategy comparison + one precise human handoff | Perturbed task completes or stops with a truthful, actionable residual; beats the scripted baseline where adaptive reasoning is claimed. |
| UI overhaul | Persistent task workspace and coherent decision/evidence components | A first-time user can identify the next decision and its consequences without a narrated architecture lesson. |
| Broader platform | More menus/kitchens, sourced estimation, reviewed knowledge and operational work queues | Capability-specific readiness and source provenance; no purchasing authority inferred from public data. |

Attach these gates to existing lanes. Do not launch a new architecture rewrite, agent framework, memory system or nationwide dashboard to answer this review. Keep the broader destination, and make each increment complete enough that the next surface inherits a reliable capability.

## Recommended lead actions

1. Adopt one product promise and a short shared vocabulary; update the active pitch/scorecard from current evidence when the next stable tag is ready. Those documents still contain old implementation claims and sponsor assumptions.
2. Add requirement/strategy/receipt lineage and authoritative proposal-review cases to A/B/F before arbitrary menus expand.
3. Give E one perturbed task to improve against the scripted baseline; prioritize continuation and useful recovery over tool count/model variety.
4. Let C design against stable read-model examples now, then undertake the visual overhaul with browser evidence. It should reveal the purchasing logic, not conceal uncertainty.
5. Capture an unedited rehearsal of the complete task. Where it needs narration or manual intervention, distinguish a product-understanding gap from a missing capability and fix the cause.

The ambition is appropriate. The next step is to make the capabilities reinforce one another strongly enough that the whole product has an advantage a collection of polished endpoints does not.
