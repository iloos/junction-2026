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
- Sat ~19:30 · Ring 2 Track E (on main bb7a8d4): 1 chat-safety e6fc411, cut-off date clarify c21cc63, 5f4866b, 4332cac · 2 ledger + get_outcome + TaskStore 5d9e146 · 3 chat turn + route e90df4e, projected task reads 02f351a · 4 chat dock 9389dfd, 1f's DecisionCard/Receipt e930c28 · 5 planner schema + retry, /agents configs + your changes 837f9af · stubbed: get_outcome not in the registry (Need 4), schema not yet sent by the Gemini adapter (Need 5), own nextActionFor until 8d's core one lands · chat trials c1, c2 green; c3 red on the driver's edit call (Need 8), c4 red on samePlan only (Need 10) · ready to merge: after Needs 8 and 10 (or with those keys expectFail)
- Sat ~10:45 (14 Nov) · chat v2 on main 858852d: d672e3b (#8 new request never fills an open slot; dock remembers its task per kitchen and restores cards via GET /api/chat/task; approval links /?kitchen&plan&v), 0dfb61e (Finnish authority imperatives refused in the chef's words), 6c5ab83 (Gemini understanding with rules guard, ledger-checked answers, model planner with script fallback, several products per message, 'too' additions, 'make it N kg', 'cancel that', small talk), f62ff71 (dock shows the worded answer) · needs: Gemini adapter to send `schema` as the response schema (the prompt carries it meanwhile); 1f: global dock takes kitchenId, planId?, taskId? · ready to merge: yes after the gate
- Sat ~12:30 (14 Nov) · ring 3 on main d2f397e: 732e1aa (server-owned idempotency keys; several products per routine order), c72cd95 (guard keeps dish changes and stated orders), aef10dd + c7687f9 (one claim checker; per-unit totals), af014e9 (task id pattern for t-<planId>; scoped handlers; withCallScope on chat and /api/agent/run), a0a5f08 (plain chat words, cards once, no ids), 420e2e7 (routine orders via the script in chat, no commit outside Continue, cut-off facts keep their offset, router in the call scope, replays re-recorded; CHAT-add-item and CHAT-two-items fixed) · needs: 91 to judge CHAT-salmon-category; 8d's core nextActionFor (switch when it lands) · ready to merge: after the gate

## Checkpoint (Sat 14 Nov, before a full restart)
**Branch** `lane/e2-chat` · head `f8964e5` (WIP: light gate not yet run on it; chat, agent and evals chat suites green) on main `55219f1`.

### Done (merged to main unless marked)
- R10-02b fence in the commit transaction (7156c45), read through the transaction for PGlite (be13a33, `TaskStore.getIn`, `CallContext.fence(tx)`), /request/menu 400 (7156c45), R10-02b OPEN removed (c204f01).
- Chat bugs (1)–(5): dish-with-a-count question, live intent chips, kept transcript on task switch, "what" re-asks (9a7fa8f).
- Dock scoped to the page's plan (`GET /api/chat/task?planId=`, Earlier conversation), plans named in words, ids and ISO dates scrubbed, every turn ends in words (saysSomething / noRawIds invariants), answered chips carry the order on, no-match words, "Thu 10 Dec" chips (98ea1a9).
- B's `readDish` for dishes, held-out paraphrases c9 (9f10ab7); `reviewReading` on chat order readings (bcbc93c).
- D20 reply rule over offered answers, no phrase lists (a2cbd64); core `commandKey` for chat and agent commits (2a7e9e0).
- Waiting decisions named with products and reason; negated "Not ordered" not an order claim; CHAT-milk-like-request expectFail removed (85808b2).
- **Not yet merged:** f8964e5. Status narration (`type:'status'`, dock "Working · <what>…"); an affirmative reply ("great lets do it") takes the offered action, accepting the shown menu revision as the chef's review (`deps.acceptMenu`, wired in /api/chat/turn); the plan on screen no longer captures a task with a menu or event (the leak behind TOP 2–3); cancelled tasks: canContinue false and cancelled words (R12-10 core); unclear words on a task with a plan answer its standing plus "If you meant something new…".

### In flight
- Nothing half-written. f8964e5 needs `pnpm gate --only check,lint` and a dock screenshot of the menu flow.

### Next (priority order, with acceptance)
1. **TOP (docs/handoff/ring5/SYNTHESIS.md, Conversation TOP), the user's chat menu flow on prod:**
   1. Narrate the work instead of "Working · step 1" — *done in f8964e5*; acceptance: Playwright screenshot shows "Working · Writing a gluten-free 3-course menu for 20, about 15 s".
   2. MenuReview card in the transcript (dishes, ingredients, products, open items) with a working review link — the `menu` card exists; acceptance: after an event brief the card stays in the transcript through "plan it" (leak fixed in f8964e5) and shows ingredients/products/open items, link opens /request menu review.
   3. "great lets do it" plans this task's menu, never another plan's decision — *done in f8964e5*; acceptance: a chat trial "event → menu → great lets do it" ends with this task's plan and decisions (add `evals/chat/trials/c10-menu-yes.json`; the menu needs the fixture proposer, it works on the dev server).
   4. "Show on the page" works, and the decision note follows D13 (chef approves in the dock) — note reworded; acceptance: clicking "Show on the page" focuses the card (shell.locate) in a Playwright run; decide with 1f/lead whether page-plan decisions get the dock's own approve control.
   5. No "I did not recognise this request" after an understood reading, no repeated ledger closing — *done for tasks with a plan in f8964e5*; acceptance: no done text contains "did not recognise" in any chat trial; the closing never repeats the ledger line.
   6. Acceptance journey: chat-only e2e on prod (event → menu card → "plan it" → plan with decisions in the dock → approve in the dock → order), e.g. `evals/ui/chat-journey.e2e.ts`.
   Also on the TOP list (other owners, for context): the D20 `menu` kind from both doors ("no meat meal… use a peach"), /request text pass and Lookup one-liners, whole-page typography, choice quality, D15 stage 2 (chat calls the request pipeline; "50 eggs" differs), RequestFlow cards in the transcript and /request redirecting into chat, menu-v2 contract and pins, the dinner-replay eval with live Gemini, Exa grounding in the dish card.
2. **R12-10** (docs/review/ROUND12-ADVERSARIAL.md): cancelled task emits no continuation CTA — *core done in f8964e5*; acceptance: cancel.test's final event has canContinue:false and no "can be ordered now"; add "what" after a held order (answers the task's standing, no "What would you like to do?") and "all your apples" on a milk task (asks how to proceed or names a new task) as chat trials.
3. Hide a refused-then-retried `plan_event` step ("Not done: menu m-… has no chef review") when the acceptance then succeeds; reword routine "Not ordered: … (470585: 2 kg ÷ 2 kg per ST …)" into words.

### Risks
- `acceptMenu` from chat treats "plan it"/a yes after the card as the chef's review; the card must show enough of the menu for that to be an informed review (TOP 2).
- GO_AHEAD now accepts bare affirmations ("ok", "great") as Continue when a task has a plan or menu and no open question; watch for false Continues (Continue never buys outside the mandate, but it can commit eligible lines).
- The dock edits (status line, decision note, plan-keyed memory) touch 1f's ChatDock shell.

### How to resume
`cd ../junc26-lanes/agent2 && git checkout lane/e2-chat && git merge main` (or rebase), `pnpm i`, then `DATABASE_URL= LLM_PROVIDER=fixture pnpm dev --port 5187`. Probes: `node scratch/turns.mjs "<text>" '{"answer":{...}}'` (turns against the dev server), `scratch/dock-probe.mjs` (copy to the worktree root to run; Playwright dock screenshots). Tests: `DATABASE_URL= LLM_PROVIDER=fixture npx vitest run --project server src/lib/server/chat src/lib/server/agent src/lib/server/evals/chat.test.ts src/lib/server/evals/chat-free.test.ts`; lane gate `pnpm gate --only check,lint`.
