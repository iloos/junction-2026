# Round 6: the agent as a procurement teammate

**Snapshot:** main `4c6b156`, including the staged T0 contracts visible during review. Read `CLAUDE.md` and `docs/handoff/SYNTHESIS.md §8`; that dispatch supersedes historical lane proposals. Read-only application inspection; no tests, remote calls or secret reads. **Observed** below means source behavior; **planned** means staged contract/dispatch, not a working feature; **inference** names a product consequence requiring journey verification.

The strongest next product demonstration is a completed purchasing task under changing conditions: understand the requirement, discover a shortage, make a defensible repair, ask for one meaningful human decision, resume the exact task and report what remains unconfirmed. That makes the agent useful beyond producing an order draft. It also gives the client dashboard, internal Operations screen and external-agent interface one coherent purpose.

Credit the foundations already present. Delegated principals, kitchen grants, intent-specific tool sets, bounded typed facts, cancellation/deadline guards and a domain-derived final outcome are implemented (`src/lib/server/agent/index.ts:35`, `:64`, `:67`; `loop.ts:165`, `:188`). Real-handler goal trials and adversarial trials already exist (`goals.test.ts:168`; `adversarial.test.ts:262`). The deterministic fixture planner is useful operational insurance; adaptive behavior should earn its place through better outcomes rather than becoming a prerequisite for every workflow.

T0 moves the right abstractions upstream: stable menu/ingredient IDs, retained requirements, provenance and review stages (`src/lib/core/contracts/event.ts:37` onward); a physical fulfilment partition (`plan.ts:196`); typed result guidance (`tools.ts:32`); and a separately staged `get_context` (`tools-next.ts:22`). These are drafted contracts. Their value depends on computation, persistence and consumption landing together in the dispatched integration waves.

## 1. Give work continuity beyond a single agent run

**Observed:** bootstrap selects a current plan from uncommitted plans, favoring an event then plan version (`agent/context.ts:34`). A run's finalizer examines the latest returned plan (`index.ts:67`). Run orchestration is an in-process active promise and controller (`runs.ts:23`, `:39`). This is a workable demo execution model; it is not yet a persistent purchasing-task identity.

**Opportunity:** link task → original requirements → proposal revision → exact plans → decisions → receipts. A task can pause awaiting a chef while an execution run ends. A subsequent run explicitly resumes the task after re-reading current versions and authority. Store references and confirmed choices, rather than chat transcripts as implicit state. Keep process scheduling simple this weekend; task continuity does not require building a distributed job engine.

**Acceptance:** create two plans in one kitchen, pause one for approval, reload, approve that plan and resume it. The agent explains which requirement it is completing, preserves the other plan and avoids duplicate ordering. Extend G's exact-plan locator and E's planned discovery rather than adding another selector system.

## 2. Make semantic APIs explain decisions and recovery

**Observed:** intent routing and tools are already separated (`agent/types.ts:117`); the planned `get_context` describes identity, kitchens, open plans and next actions (`contracts/tools-next.ts:22`). T0 `ResultMeta` offers a summary, next tool and exact approval link (`tools.ts:32`).

**Opportunity:** consistently expose purchasing meaning: what changed, what is still missing, what decision is needed, and which typed action is safe now. Make errors recoverable with a current plan reference, reason code and allowed next step. A stale version should lead to refresh-and-compare; missing pack evidence should lead to clarification; a hard ceiling should lead to changing the basket. Keep the domain service authoritative. Model-written explanations and supplier text must never manufacture permission.

**Acceptance:** a fresh MCP client discovers context without hard-coded IDs, creates a milk plan, encounters a stale version, recovers by reading the exact plan and returns a working human approval link. These outputs should also drive the UI, preventing separate frontend interpretations.

## 3. Make adaptation depend on progress, not tool variety

**Observed:** the fixture rescue policy chooses the first unorderable line not previously tried and reserves a fixed step margin (`agent/loop.ts:342`). The optional LLM planner sees tools, intent, context and history (`:493`). Neither the presence of a model nor a long trace proves that the agent chose a useful repair.

**Opportunity:** define a small repair agenda from domain facts: unmet demand, valid candidate actions, expected coverage gain, cost and required human decisions. After each action, compare new coverage and reasons with the previous state. Prevent repeated no-progress work by `(need, plan version, action, evidence)`; stop with a useful residual when the budget runs out. Use deterministic policies for obvious cases and bounded model choice for genuinely competing options.

**Acceptance:** an unavailable ready-made dish has two possible repairs; the first fails on stock. The agent tries a materially different feasible route, preserves dietary requirements and reports any remaining ingredient shortage. Across repeated model trials, measure coverage improvement, invalid actions, cost and latency against the fixture baseline. More calls alone must not count as better agency.

## 4. Treat task outcomes as quantities people can act on

**Planned:** T0's `FulfilmentView` partitions required demand into supplier-confirmed, awaiting supplier, planned known/unknown, unresolved and excess (`contracts/plan.ts:196`). Track A computes it; E and C consume it per dispatch. This directly addresses earlier state-versus-supply ambiguity without another UI-specific coverage calculation.

**Opportunity:** make the agent's final answer a compact task ledger: requested, confirmed, waiting, unresolved; money committed; decisions remaining; evidence/time validity. Include every plan touched by the task. An approval waiting state is successful escalation, but not fulfilled supply. Preserve physical units and show purchased overage separately.

**Acceptance:** the same mixed known/unknown-supply basket has identical quantities and status in Kitchen, Request, Operations and MCP. A partial commit never erases unresolved demand. Score trials on confirmed physical coverage and truthful residuals, alongside authority invariants—not on “planner said done.”

## 5. Spend human attention where it changes the purchase

**Planned:** `MenuProposal` separates proposed, chef-reviewed and planned stages; ingredients have stable IDs and unresolved alternatives (`contracts/event.ts:57`, `:98`). Model compatibility is explicitly a claim, not evidence (`:82`).

**Opportunity:** build an exception-first decision queue. Ask the smallest question that changes the plan, show why it matters, and retain the answer against its stable requirement ID. Distinguish preferences, hard requirements, estimates and verified product facts. When evidence changes, identify which answer or approval needs reconsideration instead of restarting the whole conversation. The internal dashboard should expose these exceptions and recovery state; the client view should explain the consequential choice.

**Acceptance:** a chef revises the guest count and replaces one dish. Unaffected answers persist; affected quantities recalculate; only approvals whose terms changed are invalidated. An unknown allergen record remains unresolved despite a fluent menu explanation. Count unnecessary questions and repeated decisions as product-quality failures.

**Execution guidance:** finish the dispatched T0 integrations first. Attach these five gates to E/A/B/G/F rather than opening five new lanes. The winning proof is one robust, visibly adaptive purchasing journey with faithful handoffs and measurable results. Broader catalogue coverage and more interfaces can then reuse that foundation.
