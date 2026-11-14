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
