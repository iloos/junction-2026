# Review: agent (checkpoint step 1)

Base: `main` f2edb21 merged into `lane/agent2`. Read-only review; nothing here is fixed. Evidence was gathered with `DATABASE_URL` empty and `LLM_PROVIDER=fixture`.

## 1. Own scope: loop, intent, outcome, facts, principal, serving, adapters

**Solid, with evidence**
- Stops: deadline and cancel are checked before and after each planner call and right before every handler (`loop.ts` guardHandlers). Proven by `stop.test.ts` 7/7: a slow planner gets 0 dispatches; a hung planner is released at the deadline; cancel before commit leaves no `CommitOrder` op on PGlite; `cancelAgentRun` works.
- Authority: `pnpm eval:agent` shows 10/10 adversarial attempts refused with no effect, and 8/8 goal trials pass (`goals.test.ts` plus `evals/agent/goals.json`). The trials assert GoalOutcome against store state (approvals, mandate versions, orders inside the caps, op actor and `via`). After the merge, `src/lib/server/agent` passes 51/51.
- Unsupported goals stop before any model call: g4 (a wedding) gets 0 planner calls and 0 ops. If the planner says "done" first, the outcome is `blocked`, not fulfilled (g7).
- MCP and REST both go through `serveTool`. The MCP tool list is filtered by scope (`mcp.ts:30`), so an external key never sees `approve` or `set_mandate`.

**Fragile or half-wired (contract Needs landed, my side not yet)**
- `llmPlanner` races `llm.generate` with `abortable` (`loop.ts:500`) but does not pass `signal` into the request. The adapter now accepts one (`adapters/llm/index.ts` withTimeout), so cancel stops our wait but not the provider call. This is a one-line fix.
- `principalContext` (`principal.ts:53`) does not set the new `CallContext.initiatedBy` or `kitchenIds`. No service writes `OpEnvelope.initiatedBy`: a grep of `src/lib/core/services` finds no use. The initiator therefore lives only in the `via` string.
- `mayStartAgent` still checks the actor kind (`principal.ts:14`, `AGENT_RUN_ACTORS`) instead of the `agent:run` scope that is now in `SCOPES_BY_ACTOR.chef`. The result is the same today, but two sources of truth can drift.
- The kitchen grant is enforced only in the agent loop. `/api/request` takes `kitchenId` from the request body (`routes/api/request/+server.ts:41`) and keys have no grants (finding B is still open).

**Known limits and bugs**
- The outcome reads only the newest plan the run touched (`index.ts:72`). In g5 that is the 900-unit plan; the eligible kerma plan is not reported.
- Need coverage ignores residual quantities. It also counts committed lines as confirmed even when the receipt has them awaiting the supplier (`outcome.ts:57`).
- The intent resolver is EN/FI regex (`intent.ts:10-20`). It is deterministic but misses paraphrases. Routine orders take the top search hit: "voi" finds savoy cabbage, "kerma" finds cream-powder sticks.
- The default stage goal ends `awaiting_user` with 14 held lines, 0 eligible and nothing committed. "Order what the mandate allows" therefore orders nothing. That is honest, but it must not be pitched as "ordered the buffet".

**Untested paths**
- The live LLM planner (`AGENT_PLANNER=llm`) has no recorded trial against Gemini.
- Cancel over HTTP against a live run: fixture runs finish before the cancel arrives, so only the 403/404 paths were seen.
- `serverContextSource` on Postgres.
- `reader.test.ts` failed once under full-suite load (it looks like a 5 s timeout) and passed when rerun.

## 2. Adjacent scopes: tool contracts and the core gate

- The gate holds. FORBIDDEN by scope comes before input parsing (`serve.ts` run). The core refuses commits of held lines and over-cap lines (adversarial cases 2 and 3). A replayed key with a changed payload gives DUPLICATE.
- Contract drift: `get_plan.approval.requestedBy/decidedBy` are typed `{kind: string}` (`tools.ts`), not `Actor`. The rest of the code uses the closed `ActorKind`.
- `find_substitutes` now has `apply`, with the default "apply when the dish has no substitute yet". That makes a read-looking call mutate state. My fixture planner relies on that default.
- `set_mandate` is still `notYet` (`services/handlers.ts:42`). Its "refused" only proves the scope check; the handler path is untested.
- There are two agent pipelines with separate gates on top of `serveTool`: `/api/agent/run` (intent → loop → outcome) and `/request` (parse → lookup → order, `server/request/run.ts`). Only the first has GoalOutcome, a cancel endpoint, and kitchen grants.

## 3. The product: what is provable, and what a judge breaks first

**Honestly provable today:** the agent cannot approve, change the mandate, commit over cap or commit held lines, even when a model obeys injected catalogue text (g5 plus the obedient-LLM test). Every run ends in a domain outcome with a next action. Unsupported requests say "unsupported" instead of producing Christmas. Stop really stops new effects.

**Not provable:** that the agent plans anything except the one seeded event. `plan_event` resolves only seeded ids (`services/events.ts:139`), and the planner's competence beyond scripts is unmeasured (there is no live trial).

**What a judge's own MCP client breaks first:**
1. **Discovery.** The MCP server has no instructions, resources or a list tool for kitchens or events (`mcp.ts:27-60`). A client cannot learn `k-hotel` or `event-xmas-140` and gets NOT_FOUND from `plan_event`. The agent's context bootstrap exists but is not exposed.
2. **Open goals.** "Dinner for 50" has no path: it is unsupported in the agent and parsed item by item in `/request`.
3. **Search quality** on Finnish one-word queries (see "voi").
4. **Grants:** a judge key can name any kitchen in its sandbox.

## 4. Continuation: next tasks for the agent pillar

1. **Close the half-wired seams (≈30 min):**
   - pass `signal` into `llm.generate`;
   - set `initiatedBy` and `kitchenIds` in `principalContext`, and have the services write `OpEnvelope.initiatedBy`;
   - switch `mayStartAgent` to the `agent:run` scope.

   Test: goal trials assert `op.initiatedBy`.
2. **MCP discovery (≈45 min):** a read-scoped `get_context` tool returning `bootstrapContext` (granted kitchens, current plan, supported events, intents), plus server `instructions`. This is the cheapest fix for the judge-client failure above. Test: an MCP `tools/list` then `get_context` then `plan_event` succeeds with no prior knowledge.
3. **Open requests to menus to ingredients** (PLAN track), built on the existing gate rather than beside it:
   - (a) A `requirements` intent: when the resolver finds an event it doesn't know (today `unsupported`), return `awaiting_user` with one focused question at a time. The criteria are occasion, covers, courses, budget, diets, origin and date, stored as a typed `EventBrief`.
   - (b) An LLM menu proposal (Gemini through the Llm port, `max_tokens` capped). Output: dishes → ingredient templates with g/cover and yield, each labelled `estimate`. The planner never writes the template unchecked: a zod schema plus sanity bounds (g/cover 5–400, yield 0.3–1).
   - (c) A dish/ingredient knowledge base, seeded from `christmas-buffet-140.json` dishes plus accepted plans. A lookup comes before the LLM, so repeat dishes are deterministic.
   - (d) Feed `plan_event` with an ad-hoc event, i.e. a contract Need: `plan_event` accepts `{eventId} | {brief, dishes}`. Ingredient → product matching goes through the existing ranking and mandate.
   - Trials to add: "5-star 5-course dinner for 50 at k-hotel" ends `awaiting_user` (a question) and then `awaiting_user`/`partial` with a plan, never `fulfilled` without commits; injection inside an LLM-proposed dish name stays bounded.
4. **Model routing per job:** a server table `decide | parse | plan | menu | documents` → `{provider, model, maxTokens, fallbacks}`, read through `llm.for(job)`. `LLM_PROVIDER=fixture` stays the global kill switch, and every trace carries `job` (the request parser already tags `purpose: 'request.parse'`). Suggested starting routes:
   - `plan` and `menu`: Gemini Flash-Lite;
   - `decide`: Gemini Decisions → replay → rules;
   - `parse`: rules first, then Flash-Lite;
   - Featherless Gemma as the fallback.
5. **A live goal-trial suite:** the same `goals.json` with `AGENT_PLANNER=llm`, 3 repeats per goal. Record model, tokens, steps and outcome; keep the failures. Opt-in like `test:live`, never in CI. This is the evidence that "agent competence" claims currently lack (review finding G).

**Disagreement:** do not merge the two pipelines before the deadline. Do route the open-request work through the `/api/agent/run` intent + outcome path (task 3), not through `/request`. Only the first has the outcome, cancel and grant layers.
