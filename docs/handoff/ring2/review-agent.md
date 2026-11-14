# Ring 2 review: agent architecture, tools, in-app chat (main ring1-clean)

_Condensed by the lead from a read-only design review. File refs are under `src/lib/server/` unless noted._

## Today
`runGoal` (agent/index.ts) = bootstrapContext (pickPlan id → event → kitchen → shortage → only) → resolveIntent (deterministic; unsupported stops before any model call) → runAgent with TOOLS_BY_INTENT ∩ scopes → finalize via get_plan + computeOutcome (FulfilmentView). Principal = kitchen_agent with starter scopes ∩ agent scopes, initiatedBy, kitchen grant, 5 min TTL. 8 steps, 60 s deadline, cancel signal. Scripted planner on prod; LLM planner behind AGENT_PLANNER=llm (JSON-in-text, full schemas resent each step). Review on outcome text behind REVIEW=1. llm.for(job) routing.

## Defects found
1. Two event/order classifiers disagree: request/classify.ts vs agent/intent.ts + context.ts ("20 kg salmon for the Christmas dinner" = purchase on /request, seeded_event in the agent; "4 kg butter for dinner tomorrow" refused).
2. Authority regex over-refuses reads ("what needs my approval?", "show the budget") (intent.ts:14-15).
3. Four next-action derivations (get-context.ts, tools/present.ts, outcome.ts, loop.ts) can disagree.
4. Three orchestrators over the same tools: request/run.ts, runGoal, kitchen/live.ts.
5. **One agent run per process globally** (agent/runs.ts): a second visitor gets 409. **Cancel doesn't check workspace** (any agent:run holder can stop another workspace's run).
6. Outcome covers only the newest plan touched; GoalOutcome has no quantities/money/validity.
7. LLM planner: a parse failure or out-of-scope tool ends the run as planner_error (no corrective retry).
8. Scripted special cases: substitutes linked by product id not need id (breaks r6-1); routine idempotency key from goal text; hard-coded k-hotel and the single seeded event.

## Tool surface
- Chat needs no new tools (runs runGoal in-process) but needs task-level reads (ledger, pending decisions, continue).
- External agents: add `get_outcome{planId}` (serve computeOutcome); `place_order` with `amount` only (server sizes packs); `find_substitutes.apply` explicit; `commit_order` destructiveHint true; get_context.openPlans lists pending decision groups.
- Menu: add `propose_menu{brief}` (scope plan); keep menu review a chef act, off agent surfaces. Defer compare_strategies / explain_plan.

## Chat design
- Chat = a third door onto runGoal under the visitor's chef context ∩ agent scopes (never approve). Links to the screen beside it; never re-renders plans.
- **Task record** (lead contract; table `agent_tasks(workspace_id, id, doc jsonb, version)`, migration 0003): id, workspaceId, runId, kitchenId, createdBy, timestamps, version; `requirement` (typed IntentSpec); `slots` (answered clarifications by field); `plans[{planId, versionSeen, role}]`; `proposal?{id,revision}`; `runs[{agentRunId, turn, intent, stopped, at}]`; `pending` = clarify{field, question, options≤6} | decision{approvalId, planId, planVersion, termsHash, groups[{reason, lineIds, totalCents}], approvalUrl} | none; `state` open|running|awaiting_clarification|awaiting_chef|awaiting_supplier|done|cancelled|failed; `ledger` (TaskLedger: per-need FulfilmentView buckets, committedCents, receipts, decisionsLeft, nextAction, asOf/validUntil), recomputed from get_plan, never model-written. PlanPick 'task' beats heuristics.
- `POST /api/chat/turn {taskId?, text? | answer:{field,value} | continue:true}`, visitor-cookie auth, NDJSON lines: step | clarify | decision | ledger | done. Side effects reach screens via /api/events; chat watches the bus for the approval turning granted → offers Continue.
- Clarify returns `{field, options}`; answers fill typed slots (never concatenated goal strings).
- `continue_task` scripted intent: get_plan → commit_order (eligible ∪ granted; key `task:<id>:commit:<planVersion>`) → ledger.
- LLM only for (1) intake of goals the rules can't place → structured IntentSpec → same validators; (2) picking among competing feasible repairs.

## Models
Keep Gemini for menu proposal and parse gaps. Add response schema (zod → Gemini responseSchema) and one corrective retry (S). Stronger model only for agent.plan / menu.propose via one routing line. Per turn ≤ 4 model calls, ~20k in / 1.5k out, p50 < 1 s scripted, < 6 s with model; per-workspace daily model budget (429). Native function calling after the freeze.

## Evals for chat
Multi-turn PGlite trials (clarify → answer → plan → chef approves → continue → commit; ledger = FulfilmentView sums; one receipt per key; agent ops only kitchen_agent with initiatedBy; zero approve/set_mandate). Paraphrase set (~30/intent, EN+FI). Perturbed tasks. Truthful ledger. Adversarial set through the chat endpoint + cross-workspace cancel + "approve it for me". Live k/N vs scripted. One Playwright chat turn.

## Ranked
1 runs per workspace + cancel check (S) · 2 one classifier; order wins when an amount is stated; authority regex refuses only imperatives (S) · 3 typed clarify + slots (S) · 4 one nextActionFor(plan) (S) · 5 TaskLedger + get_outcome (S–M) · 6 task table + /api/chat/turn + continue_task + chat panel (M) · 7 response schema + corrective retry (S) · 8 contract fixes: place_order amount-only, apply explicit, commit destructive (S, lead) · 9 propose_menu + chat event intake (M, needs A4) · 10 model intake only when rules say unsupported (M). Build 1–5 before any chat UI.

**Not this weekend:** native function calling / Llm port rewrite; transcript memory or workflow engine; LLM planner on prod by default; token streaming theatre; approving from chat; plans re-rendered in chat; general Q&A; compare_strategies; new SSE channel; multi-agent; Opus planner.
