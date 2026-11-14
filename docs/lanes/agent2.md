# Lane: agent2 (agent quality)

**Branch:** `lane/agent2` · **Worktree:** `../junc26-lanes/agent2` · **Dev port:** 5177

## Goal
The agent's limits can't be talked away and its "done" means a domain outcome: round-4 agent review findings A, C, D, E, G ([docs/review/ROUND4-AGENT-QUALITY.md](../review/ROUND4-AGENT-QUALITY.md), triage row 7).

## What is where
- `src/lib/server/agent/types.ts`: `RunPrincipal`, `Intent`, `AgentContext`, `GoalOutcome`, `TOOLS_BY_INTENT`, `AGENT_RUN_ACTORS` (local until promoted to contracts).
- `principal.ts`: `buildRunPrincipal` (chef keys only, or the /ops presenter button); scopes = initiator ∩ `kitchen_agent`; ops carry `via: "agent:<runId> by <kind>:<id>"`.
- `intent.ts`: deterministic `resolveIntent` (seeded_event, routine_order, shortage_repair, inspect, unsupported + `clarify`). `context.ts`: `bootstrapContext` (granted kitchens, current plan, seeded events, today).
- `facts.ts`: tool result → typed, bounded facts for the planner (names ≤40 chars, no vendor/brand/labels/explanation prose).
- `outcome.ts`: `computeOutcome` from `get_plan` after the loop. Rides on the final `done` trace event as `data.outcome`.
- `loop.ts`: deadline + cancel checked before and after every planner call and immediately before every handler; intent tool list and kitchen grant checked before dispatch. `runs.ts`: one-at-a-time registry with an AbortController (bus/agent-runs.ts re-exports it).
- Routes: `POST /api/agent/run` (chef key; 403 for approver/agents), `POST /api/agent/run/<id>/cancel` (chef key; 404 if not running). Closing the run stream only stops watching.

## Suites
| Suite | Where | What it proves |
|---|---|---|
| domain invariants + scripted journeys | `src/lib/server/evals` (`pnpm eval`) | the handlers, unchanged |
| agent loop | `agent.test.ts`, `stop.test.ts`, `intent.test.ts`, `facts.test.ts`, `principal.test.ts` | stops, intents, outcome, facts, principal |
| agent goal trials | `goals.test.ts` + `evals/agent/goals.json` | 7 goals (incl. unsupported, injection, early "done") asserted against PGlite state |
| adversarial authority | `adversarial.test.ts` | 10 escalation attempts, counted, all refused with no effect |

## Needs (lead / contract owners)
1. **contracts/tools.ts:** `ToolScope` gets `'agent:run'`; `SCOPES_BY_ACTOR.chef` gets it. Then `mayStartAgent` checks `ctx.scopes.includes('agent:run')` and `AGENT_RUN_ACTORS` goes. The service actor never holds it, so a run cannot start runs.
2. **ports.ts `CallContext`:** `initiatedBy?: Actor; kitchenIds?: readonly string[]`. **contracts/ops.ts `OpEnvelope`:** `initiatedBy: Actor.optional()`, set by services from `ctx.initiatedBy`. Until then `via` carries the initiator.
3. **ports.ts `Llm.generate` req:** `signal?: AbortSignal`; adapters pass it on (`AbortSignal.any([signal, AbortSignal.timeout(30_000)])` for the AI SDK; the Gemini call too). Today the loop stops waiting at once, but the provider call runs on and may be billed.
4. **contracts:** promote `GoalOutcome` (zod) from `agent/types.ts`; document `trace.done.data.outcome`.
5. **package.json:** `"eval:agent": "vitest run --project server src/lib/server/agent -t \"suite: agent goal trials|suite: adversarial authority\""`.
6. **docs/foundations/deploy.md:** `POST /api/agent/run` takes a chef key only (was chef, kitchen-agent or approver); add the cancel endpoint.
7. **ops UI:** TraceDrawer shows `done.data.outcome.status` + `nextAction` instead of only `stopped`; labels for `cancelled` and `unsupported`; a Stop button posting to the cancel endpoint.
8. **auth (finding B):** kitchen grants on key entries → `buildRunPrincipal({ kitchenIds })`. The loop already enforces `kitchenIds`.

## Report
- Sat ~03:30 · done: C, D, E, A (narrow seam), G suites · server tests, check, lint green · ready to merge: yes
- Sat ~05:00 · done: F4, F25 seams, get_context handler, MCP instructions · stubbed: get_context not in the registry (Need 1), envelope initiatedBy (Need 2) · merge gate green · ready to merge: yes

## Handoff (Sat 14 Nov)

**Owned paths · branch:** `src/lib/server/agent/**`, `src/routes/api/agent/**`, `evals/agent/**`, narrow changes in `src/lib/server/auth/**`. Branch `lane/agent2` (worktree `../junc26-lanes/agent2`, port 5177), level with main 5615a58 plus this commit. Needs 1–3 and 5–7 have landed on main; 4 and 8 are still open.

**State:** green on main. `pnpm vitest run --project server src/lib/server/agent` passes 51/51; `pnpm eval:agent` passes 9/9 (goal trials 8, adversarial 10/10 in one test). Prod runs the **scripted** planner unless `AGENT_PLANNER=llm` (`agent/index.ts:137`), even with `LLM_PROVIDER=gemini`.

**Non-obvious knowledge**
- Run flow: `runRoutineAgent` → `runGoal`: `bootstrapContext` → `resolveIntent` → stop on `unsupported` (no planner call) → `runAgent` with `TOOLS_BY_INTENT ∩ toolsFor(ctx)` and the kitchen grant → `finalize` reads `get_plan` → `computeOutcome` → one `done` trace carrying `data.outcome`.
- Stops come from one internal AbortController that both the deadline timer and the external signal feed. `guardHandlers` is the last check before any side effect. A tool that is already running is never raced: a commit is one transaction, so the trace stays truthful.
- The planner sees `PlannerStep.facts` (`facts.ts`), never `StepRecord.value`. The trace drawer still gets the raw `summarize()`. Keep that split when adding tools: add a `case` to `toFacts`, otherwise the tool's result reduces to `undefined`.
- The initiator is recorded only in `via` (`agent:<id> by <kind>:<id>`). Goal trials assert this exact string, so update them when `initiatedBy` gets written.
- The /ops button runs as `system/ops-presenter` with `presenter: true`. HTTP starts need a chef key. Scopes are always the initiator's ∩ `kitchen_agent`, so `agent:run` never reaches the run itself.
- `trial-harness.ts` gives each test a fresh PGlite with every op captured via `publish`. Use it for any new trial; don't use the global `createServerPorts`.
- Goal trials rely on the catalogue: "kerma" → 460692 (eligible at k-lounas, so g2 is `fulfilled`). If search ranking changes (F18), g2/g5 and the adversarial over-cap case may need a new goal or product id. The over-cap case is qty 100 (above the €400 line cap, below the €10k hard limit).
- `find_substitutes` applies its result by default (no `apply` given and no substitute yet). The fixture event script relies on that.

**Open threads (track E in SYNTHESIS)**
1. F25: pass `signal` into `llm.generate` in `llmPlanner` (`loop.ts:~501`); set `initiatedBy`/`kitchenIds` in `principalContext` and have the services write `OpEnvelope.initiatedBy`; make `mayStartAgent` check the `agent:run` scope; pick `currentPlan` by request, not just "event first" (`context.ts:37`); give facts a `truncated` flag.
2. F4: the routine intent should use `request/parse` + `convert` for units and dates ("4 kg butter tomorrow"), and reject what it can't honour.
3. F6: `get_context` read tool (wrapping `bootstrapContext`) plus MCP `instructions`; `/agents` page. Test: fresh client `tools/list → get_context → plan_event`.
4. F12 (agent part): `computeOutcome` should read A's `FulfilmentView` once it lands (awaiting supplier ≠ confirmed; residuals), and should report every plan the run touched, not only the newest.
5. `llm.for(job)` routing with `job` on every trace; a `requirements` intent calling `plan_event{brief}` from track B.

**Traps**
- `$env/dynamic/private` is not available in pure tests. Keep env out of `agent/*.ts`, except `index.ts`, which receives `env` as an argument.
- Vitest hides `console.log` unless you pass `--silent=false --reporter=verbose`.
- `bus/reader.test.ts` flaked once under full-suite load (5 s timeout); rerun before blaming a change.
- The intent regex: `EVENT_WORDS` contains "dinner"/"lunch for", so any meal request is `unsupported` until the requirements intent exists. That is deliberate (never silently Christmas).
- Over HTTP, cancel is hard to see in fixture mode: runs finish in ~1 s. Verify cancel with `stop.test.ts`, or with a live planner.

**How to resume**
```sh
cd ../junc26-lanes/agent2 && git merge main && pnpm i
DATABASE_URL= LLM_PROVIDER=fixture pnpm vitest run --project server src/lib/server/agent
DATABASE_URL= LLM_PROVIDER=fixture pnpm eval:agent
DATABASE_URL= pnpm vite dev --port 5177   # fx-chef / fx-approver keys work in dev
curl -X POST localhost:5177/api/agent/run -H 'authorization: Bearer fx-chef' -d '{"goal":"Order 3 kerma for k-lounas"}'
```

**Only I know:** the review findings I left out on purpose:
- No separate read-only evidence worker (E): facts plus per-intent tool lists plus the core gate bound the damage instead.
- No phase menus inside an intent.
- `seeded_event` may still call `commit_order` within the mandate (an LLM planner could commit eligible lines; the script never does).

## Track E (Sat 14 Nov, branch lane/e-agent on main 91f034a)

**Done**
- F4: the routine intent reads the goal with `request/parse.parseRules` (qty, unit, date on the scenario clock), ranks search hits with `request/lookup.rankCandidates` and converts with `request/convert` into sales units; `place_order` lines carry the physical `amount`. Refused with a reason (clarify), never defaulted: no unit, no date, past date, several items, a comma-thousands quantity, qty out of range. Tests: `intent.test.ts` "F4 regression…", "refuses what it cannot honour…"; `seams.test.ts` "F4 regression: 4 kg butter tomorrow…" (end to end on PGlite: butter category 10500, ≥4 kg, deliverBy 2026-11-15) and three refusal trials (0 planner calls, 0 ops).
- F25: `llm.generate` gets the run `signal`; `principalContext` sets `initiatedBy` + `kitchenIds`; `mayStartAgent` checks `agent:run` (ctx scopes, or the actor's role table); `bootstrapContext(source, principal, goal)` picks the plan by the request (named id → event → kitchen → shortage lines → only one; otherwise asks which); capped fact lists carry `truncated: {field: fullCount}`. Tests: `seams.test.ts` F25 block, `principal.test.ts` "F25: …".
- get_context handler (`agent/get-context.ts`, `createGetContext(ports)`, T0 output schema, `meta.nextAction` our own words) + MCP `instructions` (`tools/mcp.ts mcpInstructions`, names get_context once the registry serves it). Tests: `get-context.test.ts`, `mcp.test.ts` "initialize returns instructions…".
- `evals/agent/goals.json`: g2/g5 goals now state a unit and date ("3 packs kerma … by Monday").

**Needs (lead)**
1. Registry: move `get_context` from `tools-next.ts` into `toolSchemas` and wire `handlers.get_context = createGetContext(ports)` (in `core/services/handlers.ts` or the server handler map); add a `TITLES` entry in `tools/mcp.ts` (I can do that line once the name exists).
2. core/services (`orders.ts`, `events.ts`, `substitutes.ts` `pending()` builders): copy `ctx.initiatedBy` onto `PendingOp` (`...(ctx.initiatedBy ? { initiatedBy: ctx.initiatedBy } : {})`). The run context already sets it; envelopes don't carry it yet.
3. `src/routes/api/agent/run/[id]/cancel/+server.ts`: call `mayStartAgent(ctx)` (scopes) instead of `mayStartAgent(ctx.actor)`; the actor form still works via the role table.
