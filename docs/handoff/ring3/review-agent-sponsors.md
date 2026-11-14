# Review: agent and sponsor integrations (ring 3)

_Independent read-only review, Sat 14 Nov evening, main at `c8bfa32` (prod `/healthz` reports `70c30e2`). Scope: `server/agent`, `server/chat`, `server/tasks`, `server/review`, `server/tools`, `adapters/{catalog,decide,llm}`, `server/external`, `server/web`. No paid API was called. One read-only prod probe: `fx-chef` on `/api/tools/get_context` returns 401, so the public fixture keys are off on prod._

## Verdict
**The guarantees are real, the agent is narrow.** I found no authority bypass on chat, MCP, REST or the Kitchen. Every door ends in `serveTool`, scopes are intersected and never unioned, external commits need a chef grant (`core/services/orders.ts:545-548`), and outcomes come from domain state rather than model text. The agent is not theatre: chat can take "4 kg lactose-free butter for Wednesday" to a held plan, a decision card, a chef approval in the Kitchen, `continue` and one receipt per `task:<id>:commit:<version>`. It is still mostly **scripted in coverage**:
- intent is a deterministic regex router (`agent/classify.ts`, `agent/intent.ts`);
- the only event it plans is the seeded 140-guest buffet (`intent.ts:246`). Every other event brief is refused with "use New request" (`intent.ts:319-326`), even though A4 (reviewed menu → `plan_event{proposal}`) is on main;
- the model only orders tool calls inside a fixed per-intent tool list (`agent/types.ts:151-165`).

The weak spots are not in the gate. They are in the **read models around it** (the next-action rule disagrees with core after an approval), **model-minted idempotency keys** in the live chat planner, and **trace and cap parity**: Valio, chat Gemini text, MCP `propose_menu` and Decide-inside-chat never reach the trace drawer.

## Ranked findings
Severity: **H** fix before the video · **M** fix before freeze if cheap · **L** cleanup or docs. Size S/M/L. Owner: E = agent/chat, D = sponsors, 8d = core, lead.

1. **H · `nextActionFor` is blind to granted approvals and to core's line view.** Approving does not change line states (`core/services/orders.ts:379-385`), so held lines stay `held`. `nextActionFor` then reports "N held lines wait for a chef" (`agent/next-action.ts:72,85`) after the chef has approved. Core's own `LineView.nextAction` says `commit` for a granted held line and `find_substitute` for a held recall line (`core/mandate/view.ts:121-127`). The wrong sentence reaches MCP `meta.nextAction` (`tools/present.ts:52`), `get_context` (`agent/get-context.ts:16`), the ledger (`tasks/ledger.ts:78`) and therefore Gemini's chat answer. `tasks/project.ts:30-45` already patches around it with a local `granted` check, and no test covers the case. **Fix:** count lines with `view.committable === true` as commit candidates and take substitute/requote from `view.nextAction`; delete the patch in project.ts; add a test. One rule, built on core's. S · 8d.
2. **H · The live chat planner invents its own idempotency keys.** Chat uses the Flash-Lite planner whenever `LLM_PROVIDER≠fixture` (`chat/turn.ts:393-397`), which is the case on prod. `place_order` and `commit_order` keys are then whatever the model writes. Only the script derives keys (`agent/loop.ts:547-550,650`). The same request retried, or asked again in a new task, can open a second plan and commit within the mandate twice: caps still bound it, but "no double orders" is a promise about keys we don't own here. A model that reuses a key with another payload gets `DUPLICATE`. **Fix:** in `runAgent`, before `serveTool`, overwrite `idempotencyKey` for those two tools with a server key (task or run id + intent digest, or the script's `routine:` key). S · E.
3. **H · Outside calls that skip the trace drawer, the caps or both** (Q3). Decide, Exa and Context.dev go through `createExternalCall`; these do not:
   - **Valio live**: `onCall` only `logTrace`s to stdout (`store/server-ports.ts:41`). It has its own breaker (`valio-live.ts:69-94`) and is not on the bus. Our headline sponsor is invisible to a judge except through the offer label.
   - **Chat Gemini text** (`chat.understand`, `agent.plan`, `explain`): the router's trace only `console.warn`s errors (`routes/api/chat/turn/+server.ts:67-69`). The dock shows "via Gemini · ms" but no model, tokens or job (rule 7).
   - **Decide inside chat**: the chat routes use `realHandlers()` (`chat/turn/+server.ts:56`, `chat/task/+server.ts:27`), not the scoped `handlers` (`tools/handlers.ts:128-140`). `find_substitutes` from chat therefore traces to nowhere, and its spend key is null, so only the global cap applies (`adapters/decide/index.ts:213-214`).
   - **MCP/REST `propose_menu`** (gemini-3.8-flash, 4,000 tokens): `createLlmRouter(env)` has no trace (`tools/handlers.ts:77`), and any judge key can repeat it.
   - **No daily cap on any text-LLM job.** The only limits are `max_tokens` and a 30 s timeout (`adapters/llm/index.ts`). There is no ledger, breaker or `ExternalCallTrace` shape for text calls, unlike Decide.

   **Fix:** route `traced()` through `createExternalCall({api:'gemini', name:'gemini-text', cache:false, guard})`. Pass `currentScope()?.trace` into the Valio `onCall` and the menu router. Swap `realHandlers()` for `handlers` in both chat routes. S–M · D.
4. **M · The chat model can widen what the rules read.** The guard only stops read → order (`chat/understand.ts:181`). If the rules read `adjust` ("cured salmon to 160 g per guest") and the model returns `order` with an amount, the goal becomes "160 g cured salmon" and runs as a routine order that may commit within the mandate. If the rules read an order and the model says `smalltalk`, the order is dropped with a greeting (`turn.ts:303`). Neither case is tested (`understand.test.ts:70-96`). **Fix:** the model may fill items only when the rules read `order` or `other`; otherwise the rules' kind wins. Add two tests. S · E.
5. **M · Two claim checkers with different rules.** `chat/explain.ts:73-91` checks numbers, "ordered", "supplier confirmed" and "approved". `review/outcome.ts:40-60` (dark) checks "delivered", "fulfilled" and "I approved". Chat lets "your butter is confirmed" and "delivered" through, because `CONFIRMED` (`explain.ts:50`) requires "supplier". `factsOf` also passes `ledgerTotals`, which sums kg and l together (`tasks/ledger.ts:99-109`), so "6 needed" across kg + l passes the number check. **Fix:** run explain's text through the outcome checkpoint's deterministic checks too, and send per-unit totals. S · E.
6. **M · Two planner policies for one goal.** `/api/agent/run` and the presenter run scripted unless `AGENT_PLANNER=llm` (`agent/index.ts:166`); prod has it unset. Chat runs Flash-Lite with the script as a per-step fallback. The same words give different step sequences (and keys, see #2) on REST and in chat. Fidelity has no chat entry (`server/evals/fidelity.ts`, cases × `/request`, agent, REST). **Fix:** pick one policy per environment, and add chat as a fidelity entry on the replay book (`chat/messy-replay.ts`). S · E/91.
7. **M · Two model parsers for the same words.** `/request` uses `request.parse` reconciled against the rules (`request/parse.ts:576-600`). Chat uses `chat.understand` → `itemWords` → `parseRules` (`understand.ts:99-110,186-192`). REST/MCP agents are rules-only. "The same words give the same basket" is measured on three entries, and the fourth (chat) has its own model reading. **Fix:** chat keeps `understand` for the kind only and gets items from `parseRequest` (the same code as `/request`). M · E.
8. **M · "Schema-constrained" is not true.** `llmPlanner` and `understand` pass `schema` through an `as` cast (`agent/loop.ts:748-756`, `understand.ts:150-157`). The `Llm` port has no such field (`core/ports.ts:117-131`), and `geminiLlm` sends only a JSON mime type (`llm/index.ts:69-71`). The retry-on-parse covers it in practice, but the comments at `loop.ts:682,717` and `turn.ts:54` overclaim. **Fix:** add `schema?` to the port and send it as the Interactions response schema, or fix the comments. S · D.
9. **M · Decide's fit question hard-codes "a Finnish Christmas buffet"** (`core/services/substitutes.ts:93,150`) for every rescue, including a routine milk or butter substitute. The score's meaning drifts off the seeded event, which matters because a model caution can hold a line. **Fix:** pass the occasion from the plan's need or event, or "a professional kitchen" when there is none. S · 8d.
10. **L · Dead and duplicate paths.**
    - `tools/stub-handlers.ts` (739 lines) and `withStubFallback` (`tools/handlers.ts:40`) are unused.
    - Valio has its own breaker beside `external/breaker.ts`.
    - Three things are called "replay": the Decide book `replay.json`; `evals/replay-llm` with `chat-messy.replay.json`; and web fixtures traced as `replay`. Decide's rules fallback is traced as `cache:'fixture'` (`decide/index.ts` `fallback`).
    - The chat turn reads `get_plan` straight off the handlers, outside the gate (`turn.ts:199,386`). These are reads under the chef's context, so harmless.

    S · lead.
11. **L · Docs overclaim or under-show** (Q4):
    - PITCH says "Exa: no judge-facing UI yet" (`PITCH.md:58`), but the Why drawer serves Exa facts and make-in-house (`web/evidence.ts:1-10`, `ui/why-evidence.ts`).
    - CLAIMS says "chat … entry not built", but `/api/chat/turn` is live with Gemini.
    - PITCH says Context.dev runs hourly; STATUS says every 5 min.
    - The PITCH table row "Gemini Decisions **scores recipe fit**" still contradicts CLAIMS' "narrow it".
    - **pgvector:** the extension and a 768-dim `products.embedding` exist (`drizzle/0000_init.sql:1`, `db/schema.ts:66`) but nothing writes or queries them, and retrieval is lexical (`catalog/retrieval.ts`). Never say "vector search on Aiven".

## Q2: bypass attempts (none succeeded)
- **Approve via chat:** the chef context ∩ `kitchen_agent` scopes leaves read/plan/order (`agent/principal.ts:52`), and `serveTool` re-checks scope (`tools/serve.ts:117`). The authority wording is refused by rules before any model sees it (`understand.ts:134`).
- **Approve via MCP or REST:** the tool is not registered for the key's scopes (`tools/mcp.ts:217`), and REST is the same gate. External commits need a grant (`orders.ts:545-548`), and external lines are tiered `sign_off` (`core/mandate/tier.ts:137,220`).
- **Kitchen:** an allowlist, chef only in the visitor's own signed sandbox, and the rendered `{runId, planId, version}` must match (`server/kitchen/live.ts:74-123`). A visitor approving their own sandbox is by design (D9).
- **Cross-tenant:** a judge key is bound to its workspace by HMAC; chat tasks are read per workspace; the run's kitchen grant is checked in the loop (`loop.ts:285-312`).
- **Soft spots, not bypasses:**
  - model-minted keys (#2) and model widening (#4) act inside the mandate;
  - `DEMO_RESET_OPEN=1` would let anyone run the presenter as `system` (read/plan/order in `ws-demo`), so confirm it is unset on prod;
  - the fixture keys are confirmed off on prod.

## Q4: sponsor value and visibility (short)
| Sponsor | Real value | Judge sees it? |
|---|---|---|
| Valio | Live cache-through, 15 min TTL; each offer is labelled `valio_live`/`valio_cache` (`catalog/pg.ts:217-277`) | Label only; the calls are not on the trace bus (#3) |
| Gemini Decisions | Batch fit / violates / Finnish p per rescue; a caution holds a line; caps in Postgres | Yes, `decision` traces and p in the UI (not from chat, #3) |
| Flash-Lite | request.parse, chat.understand, explain (ledger-checked), chat planner | `/request` traced; chat shows only "via Gemini" |
| 3.8-flash | `/request` menu proposal (rubric-checked) | `/request` traced; the MCP tool is untraced; chat never proposes a menu |
| Aiven | Runtime, Postgres race proof, PgBouncer, web state, shared caps | `/healthz` commit + db; pgvector unused (#11) |
| Exa / Context.dev | Why-drawer facts and make-in-house; recall monitor and drills, labelled | Yes; PITCH under-sells it (#11) |

## Highest-value next moves
1. **One next-action rule on core's line view** (#1). It fixes "wait for chef" after approval on MCP, `get_context`, the ledger and the chat answer. S, 8d.
2. **Server-owned idempotency keys in the agent loop** (#2), plus the understand guard and its tests (#4). Together these make the live chat as safe as the script. S, E.
3. **Trace and cap parity in one pass** (#3): Gemini text on `createExternalCall` with a daily cap, the Valio `onCall` on the bus, scoped handlers in the chat routes, and a trace on the menu router. Then a judge can watch every sponsor call in Ops. S–M, D.
4. **Event briefs in chat:** a new `event_brief` intent with `propose_menu`, a chef "review menu" card (same pattern as the decision card), then `plan_event{proposal}` and the existing flow. This is the biggest capability gain, it keeps every guarantee (the chef reviews and approves, the plan is deterministic), and it shows 3.8-flash in the agent. M, E.
5. **A docs truth pass** (#11, #8): un-stale the PITCH and CLAIMS rows, show chat and the Exa Why drawer, never claim pgvector or schema-constrained output. S, lead.
