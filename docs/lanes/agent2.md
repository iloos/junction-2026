# Lane: agent2 (Track E: agent door, agent quality)

**Branch:** `lane/e2-chat` (Ring 2; was `lane/e-agent`) · **Worktree:** `../junc26-lanes/agent2` · **Dev port:** 5177

## Goal
An agent, ours or a judge's, completes a purchasing task through the same gated tools as the kitchen, and says truthfully what is done and what remains.

## Owned paths
`src/lib/server/agent/**`, `src/lib/server/review/**`, `src/lib/server/adapters/llm/router.ts`, the serving and presentation layer of the tools (`tools/serve.ts`, `tools/mcp.ts`, `tools/present.ts`, OpenAPI text), `src/routes/agents/**`, `src/routes/api/agent/**`, `evals/agent/**`. Registry and contracts are the lead's.

## What is where
- **Run:** `runGoal` (`agent/index.ts`): `bootstrapContext(source, principal, goal)` → `resolveIntent` → unsupported stops before any model call → `runAgent` (`loop.ts`) with the intent's tools ∩ scopes and the kitchen grant → `computeOutcome` from `get_plan`. The outcome rides on the `done` trace. `runRoutineAgent` wires env: scripted planner unless `AGENT_PLANNER=llm` and a real `LLM_PROVIDER`.
- **Principal** (`principal.ts`): starting needs `agent:run` (scopes). The run acts as `kitchen_agent/routine-agent` with initiator ∩ service scopes; the context carries `initiatedBy` and `kitchenIds`.
- **Context** (`context.ts`): granted kitchens, open plans, the plan the request names (id, then event, then kitchen, then shortage lines, then the only one; otherwise the intent asks which), an optional default kitchen.
- **Intents** (`intent.ts`): `seeded_event`, `routine_order` (request parser for quantity, unit and date; refuses a missing unit or date, a past date or several items; no verb needed when an amount is stated), `adjust_need` (“cured salmon to 160 g per guest”), `shortage_repair`, `inspect`, `unsupported` (+ `clarify`).
- **Routine candidates** (`routine.ts`): ranked by `request/lookup.rankCandidates`, converted by `request/convert`. The scripted pick is the convertible candidate that overshoots the ask least. `place_order` lines carry the physical `amount`.
- **Facts** (`facts.ts`): the planner reads typed, bounded facts only; capped lists carry `truncated: {field: fullCount}`.
- **Outcome** (`outcome.ts`): reads the plan's FulfilmentView. Supplier confirmed only when receipt-backed (D10), unresolved when any required quantity has no line.
- **Stops** (`loop.ts`): 8 steps, deadline (timer flag, or `deadlineSignal`), cancel. The run signal goes to `llm.generate`.
- **Review** (`review/`): `review(checkpoint, case, deps)` → pass | revise(feedback) | block(reason). Deterministic checks first, then an optional `decide.score` (a rules fallback score never revises). `withReview` gives the producer one retry with the critique. Traced as `decision` events with `job: review.<checkpoint>`, model calls capped by `ReviewBudget`. Checkpoints: `agent.outcome_text`, `request.parse`. The agent uses it behind `REVIEW=1`; it never authorises or touches state.
- **Model routing** (`adapters/llm/router.ts`): `createLlmRouter(env, trace).for(job)`. Each job has a provider, model and token ceiling; every model trace carries `job`. `LLM_PROVIDER=fixture` keeps every job on the fixture.
- **Agent door:** `get_context` (`agent/get-context.ts`); MCP `instructions` (`mcpInstructions`); `meta` (summary, nextAction, approvalUrl) on every successful output, built in `serveTool` from typed fields (`tools/present.ts`); `/agents` shows this browser's judge-key MCP URL (G's `JudgeKeys`), the external tool list and the instructions.

## Suites (`pnpm eval:agent` runs every “suite: agent goal trials…” and “suite: adversarial authority”)
| File | Proves |
|---|---|
| `goals.test.ts` + `evals/agent/goals.json` | 7 goals against PGlite state, incl. injection and an early “done” |
| `seams.test.ts` | F4 (4 kg butter tomorrow), refusals, plan picked by request, truncated facts, signal |
| `perturbed.test.ts` | r6-5: salmon resized mid-plan, ham rescue kept, grant voided, residual dishes open |
| `adversarial.test.ts` | 10 escalation attempts refused with no effect |
| `stop.test.ts`, `intent.test.ts`, `principal.test.ts`, `get-context.test.ts`, `review.test.ts`, `review/review.test.ts`, `tools/present.test.ts`, `adapters/llm/router.test.ts` | unit level |

## Env (names only)
`AGENT_PLANNER` (`llm` to let the model plan), `LLM_PROVIDER`, `REVIEW` (`1` turns the outcome review on), `JUDGE_KEY_SECRET` (judge keys on /agents).

## Needs
1. Request lane: wrap `parseRequest` in `withReview(requestParseCheckpoint, …)` behind `REVIEW=1`, and take its model from `createLlmRouter(env, trace).for('request.parse')`.
2. Layout (lead): an “Agents” link to `/agents` in the top nav.
3. Lead: archive `docs/lanes/agent.md` (first agent lane, history only; move its key env table to docs/foundations first if it is not there) and `docs/lanes/agent-door.md` (proposal delivered here: meta, /agents; approval stays in the Kitchen screen per ruling).

4. Registry (lead): move `get_outcome` from `plannedToolSchemas` into `toolSchemas`; handler `createGetOutcome(ports, handlers)` (`src/lib/server/tasks/outcome.ts`), wired like `get_context` in `tools/handlers.ts`, with `ports.tasks`.
5. Ports (lead/8d): `tasks: projectedTaskStore(drizzleTaskStore(db), ports, handlers)` in `createDbPorts` (the chat route builds its own through `tasks/server.ts` meanwhile). `Llm.generate` takes `schema?: object` and the Gemini adapter sends it as the response schema (the planner already passes it).
6. Request lane: import `classifyGoal` / `isQuestion` / `isAuthorityImperative` from `agent/classify.ts` (one classifier); `classifyRequest` stays the event read underneath. A Christmas brief with another guest count is not the seeded event.
7. 1f / lead: mount `<ChatDock kitchenId=… />` (`src/lib/ui/chat/ChatDock.svelte`) on the Kitchen screen (right column ≥ lg, bottom sheet below); it links the decision card to the existing `/?kitchen&plan&v` approval panel. `/agents/chat` hosts it meanwhile.
8. 91: `src/lib/server/evals/chat.test.ts` sends `edit_line` `patch.qty` as `{value, unit}`; the contract takes a number, so c3's edit fails and continue commits the still-granted line. With `patch: { qty: step.qty ?? line.qty.value + 1 }` c3 is green (chat/turn.test.ts covers the same path).
10. 91: c4 `samePlan` at step 1 needs a primary plan on both steps; the chat asks the date before planning (no plan for a passed cut-off), so samePlan reads `undefined → undefined`. Accept "no plan on either step" when the date was asked.
9. `ops/+page.server.ts` (9c): `cancelAgentRun(id, by, workspaceId)` now checks the workspace when given; the presenter button may pass its workspace too.

## Next scope: in-app agent chat (proposal)
A chat panel on the Kitchen and Request screens (and Ops for the presenter) that runs the same `runGoal` under the chef's principal, so it gets the same intents, tool gate, mandate and kitchen grant as MCP and REST. No separate chat toolset. Each turn streams the trace as compact steps: the tool name, our one-line `meta.summary`, and a link that focuses the plan or line in the screen beside it. Plans are never re-rendered inside the chat. A clarifying refusal (`clarify`) becomes a question with chip answers: which kitchen, which plan, a unit or a date, which dish. The answer is resent as an amended goal on the same task, so nothing is retyped. Held lines show as a “needs your approval” card linking to the Kitchen approval panel, and only a chef session approves there. The agent never approves in chat. The end of each run is the outcome ledger: supplier confirmed, ordered and awaiting supplier, planned or held, unresolved, money committed, decisions left. The review checks this text, and Stop maps to the cancel endpoint. Task continuity (resume after approval or retry) needs a task id that links the runs and their plans. That comes first, so “continue” re-reads the exact plan versions instead of the newest plan.

## Report
- Sat ~06:30 · done: F4/F25, get_context + MCP instructions, ResultMeta, review mechanism (REVIEW=1), adjust_need for r6-5, llm.for(job), /agents, F4-pack overshoot, verbless orders, outcome via FulfilmentView, deadline flake · stubbed: request-parse review wiring (Need 1) · gate green · ready to merge: yes
- Sat ~18:30 · Ring 2 Track E (rebased on main 887a0c6): 1 chat-safety c300774, cut-off date clarify 4195ae3, 6806d25 · 2 ledger + get_outcome + TaskStore 1ba31aa · 3 chat turn + route 96eeb3b, projected task reads 9175556 · 4 chat dock 2b9e1e9 · 5 planner schema + retry, /agents configs + your changes 52b95d7 · stubbed: get_outcome not in the registry (Need 4), schema not yet sent by the Gemini adapter (Need 5) · chat trials c1, c2 green; c3 red on the driver's edit call (Need 8), c4 red on samePlan only (Need 10) · ready to merge: after Needs 8 and 10 (or with those keys expectFail)
