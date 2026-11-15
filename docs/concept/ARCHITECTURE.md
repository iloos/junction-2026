# ARCHITECTURE

_Lead-owned. Implements D3–D30 (with D8a and the D3/D6 amendments; D23 and D22 in part, see Agents). The contracts named here are on `main`. Track code against them and raise **Needs** instead of changing them; who owns which path is in [DISPATCH.md](../DISPATCH.md#seams-one-owner-each)._

## Shape
```
browser  /  (kitchen + chat dock) · /request · /ops · /agents · /pair ──SSE── /api/events
            │ fetch (/kitchen-api/*, /api/request, /request/{run,menu}, /api/chat/{turn,task}, /api/agent/run, /api/web/*)
server   /api/tools/<name> · /mcp (+ /mcp/k/<key>) · /api/openapi.json · /.well-known/agent.json        ▲ NOTIFY / in-memory bus
         calendar feeds: /kitchen-api/calendar.ics · /api/calendar/<kitchen>.ics (+ /api/demo/calendar-link)
            │ one tool registry (core/contracts/tools.ts) · one gate (serveTool)
         command handler: authorise (scopes) → idempotency → prepare outside the lock → store.transact(lock ws) → services → applyOps → persist state + ops
            │ ports (core/ports.ts)
adapters catalog (Valio cache-through, file | Postgres, hybrid retrieval) + simulator · decide (Gemini Decisions → replay → rules) · llm router per job (Gemini | Verda | Featherless | fixture) · web (Exa, Context.dev | fixture) · menu store · task store · store (Drizzle: Aiven | PGlite)
```
`src/lib/core/` is pure TS (lint-enforced: no Svelte, Node built-ins, vendor SDKs or `$lib/server`). Services that need I/O take `Ports`. Browsers never hold a key: pages act server-side through the same handlers REST, MCP and the agent use.

## Contracts (files)
| File | What |
|---|---|
| `core/contracts/primitives.ts` | `ProductId` (six digits), `WorkspaceId`, `VisitorWorkspaceId` (`ws-j-…`), `Cents` (int), `SalesQty`, `Measure` (+ weight basis), `Source`/`Provenance`, `Actor` (server-derived), `Scope` (workspaceId + runId) |
| `core/contracts/errors.ts` | D6 `ErrorCode` (12 codes) + `RETRYABLE`, `DomainError`, `Result<T>` |
| `core/contracts/product.ts` | normalised `Product`, `AvailabilityKind`, `Availability` (raw kept, `closingTime`), `Price`, `Offer` |
| `core/contracts/kitchen.ts` | `Kitchen` (matches `fixtures/seeds/kitchens.json`), `Mandate` (versioned caps, `hardLimitCents` ceiling, never-delegate), `Weights` |
| `core/contracts/plan.ts` | `Plan` (optional `taskId`)/`Line`/`Approval`/`Order`/`Receipt`/`Anomaly`, state enums, `Tier`, `LineReason`; `Need` (with `source` lineage and direct physical amounts); `SupplyTier` (D8/D10: `known_stock`, `make_in_house`, `unknown_stock`, `none`); read models `LineView` (`physical`, `unitPrice`, `comparisonPrice`), `FulfilmentView` (exact partition of a need: supplier confirmed, awaiting supplier, planned known, planned unknown, unresolved, plus excess) and `PlanView` (`asOf`, `mandateVersion`, `validUntil`, fulfilment); `TermsDiff`; `LineAuthority` |
| `core/contracts/event.ts` | `EventBrief`, `DishTemplate`, `DishIngredient` (stable ids, amount per cover, exactly one of productId / query / unresolved), `MenuProposal` (revisions, server-recorded `review`, `open` questions) |
| `core/contracts/task.ts` | D11 procurement `Task` (requirement, typed `slots`, linked plans, run history, `pending` clarify or decision, `TaskState`), `TaskLedger` (server-computed, never model-written), `ExternalCallTrace` (one shape for every Valio, Gemini, Exa, Context.dev and Featherless call) |
| `core/contracts/ops.ts` | the closed `Op` union (9 types, incl. `RecordRefusal`) and `OpEnvelope` (seq, actor, via, `initiatedBy`) |
| `core/contracts/events.ts` | `SimEvent`, `ServerEvent` (op · sim · trace) for SSE |
| `core/contracts/tools.ts` | the tool registry `toolSchemas`, `ResultMeta` (`summary`, `nextAction`, `approvalUrl`, always our own words), `WebFact`, `ToolScope`, `SCOPES_BY_ACTOR` |
| `core/ports.ts` | `Clock, Catalog` (incl. optional `resolve` for menu queries), `Simulator, Decide, Llm, Web, Store, Ops, MenuStore, TaskStore`, `CallContext`, `WebExecutionContext`, `JudgeKeys`, `ToolHandlers`, `Ports` |
| `core/state.ts` | `WorkspaceState`, pure `applyOps` (version checks, approval invalidation, external approval refused, commit once) |
| `core/hash.ts` | canonical JSON, `termsHash` (deliverBy + sorted lines), `requestHash` |
| `core/command.ts` | D18 `commandKey(plan, version, termsHash, exact line ids)`: the one commit identity for Request, Chat, the agent loop and the Kitchen |
| `core/mandate/meets.ts` | D16 `meets(product, requirements, kitchenConstraints)` → ok / unknown / no with why: the one evaluator for ranking, the validator, substitutes, the request filter and diet marks |
| `core/stock/` | D27 pure stock model (Valio's level, simulated drain and restock, scenario), feeding Ops' Forecast |
| `server/db/schema.ts` + `drizzle/*.sql` | tables below; migrations `0000_init`, `0001_enrichments`, `0002_menu_proposals`, `0003_agent_tasks`, `0004_web_state`, `0005_traces` |
| `server/db/pglite.ts` | `createFixtureDb()`: PGlite + pgvector + the same migrations |

Registered but not served: `set_mandate` answers `PROVIDER_UNAVAILABLE` (mandates come from the kitchen seed, or the sample `create_kitchen` copies), never a made-up result.

## State machines (D6, D11)
- **Plan** `draft → quoted → ready | held → committed`. Edits (`EditLine`, `ProposeSubstitute`) → `draft`, terms hash cleared, approvals `invalidated`.
- **Line** `proposed → eligible | held{tier, reasons} | rejected | unorderable → committed`.
- **Approval** `pending → granted | denied | expired | invalidated`, bound to plan version + terms hash + mandate version + expiry.
- **Menu proposal** `proposed → chef_reviewed → planned`; each edit is a new revision; only the server writes `review`.
- **Task** states `open`, `running`, `awaiting_clarification`, `awaiting_chef`, `awaiting_supplier`, closed as `done`, `cancelled` or `failed`. Writes are compare-and-set on `version`; the ledger, pending decision and state are recomputed from the task's plans on every read and write.
- Words for these states on screen and in tool text: [VOCABULARY.md](VOCABULARY.md) (D10). "Supplier confirmed" only for receipt-backed quantities.

## Command flow (one server function per tool)
1. Resolve `CallContext` from the bearer key, visitor cookie or in-process actor (scopes, actor, workspace, run). The body never sets the actor.
2. `serveTool` (`server/tools/serve.ts`): known tool, scope check, input validated against the registry (zod). Unknown product ids → `NOT_FOUND` before any Valio call.
3. Outside the lock: fetch offers, run Decide/LLM (never hold DB locks across them).
4. `store.transact(workspaceId)`: idempotency check (replay / conflict → `DUPLICATE`), re-read the plan, compare versions/terms, lock the budget row, `simulator.consume` for commits, compute ops, `applyOps`, persist rows + ops, bump `workspaces.last_seq`.
5. Output validated against the registry; `ResultMeta` added from typed fields. After commit: publish `ServerEvent`s (NOTIFY on Postgres, in-memory bus on PGlite).

## Call scope
Every outside call (Gemini, Valio, Exa, Context.dev) belongs to one caller: it traces into that workspace's drawer and charges that workspace's daily caps. Two places set this up:
- **`serveTool`** for every tool call (REST, MCP, the agent loop, the chat turn, Kitchen, `/request`): it moves a judge key onto its sandbox's current run, runs the handler inside the workspace's simulator overlay (`inWorkspace`), and the handlers (`server/tools/handlers.ts`) wrap each call in `withExternalScope(scopeFor(ctx))`.
- **`withCallScope`** (`server/scope.ts`) for code that calls ports or handlers outside `serveTool`: loads the workspace's run, then the overlay, then the external scope, in one call.

The plumbing per outside call lives in `server/external/`: response cache, spend guard charged before the network call (never on a cache hit), half-open circuit breaker, one `ExternalCallTrace`.

## Rules the handlers enforce
- **Partial commits.** `commit_order` commits `lineIds` (default: eligible act-tier lines + lines covered by a granted approval). A plan has several orders, one per idempotency key; it becomes `committed` only when no line is proposed/eligible/held. Committed lines can't be edited or re-quoted away.
- **Per-line authority.** Each `Order.lines[]` names its own `authority`: `mandate` (act-tier eligible, never for an external caller or an externally created plan) or `{approvalId}` (granted, same plan version + terms hash, lists that line). No grant covers a line it did not list. The order-level `authority` is a summary.
- **Approval by reason group.** `approve{lineIds}` decides only those lines; the rest move to a new pending approval (`remainingApprovalId`) bound to the same version and terms. A denied group doesn't void other grants.
- **Re-approval.** Any `RecordOffer` that leaves lines held emits a new `RecordApproval(pending)` bound to the new version and hash. `get_plan` returns the current approval with what it is bound to, and `lastVoided` (the voided approval and its `TermsDiff`).
- **Cut-off at commit.** Lines whose ordering cut-off has passed on the scenario clock can't be bought. Named in `lineIds`, or with no act-tier line left, the commit is `FORBIDDEN` (sub `cutoff`); otherwise the re-quote is recorded and the commit goes on with the lines the mandate still covers.
- **Unknown supply.** Terminal lines can be committed: `Simulator.consume` returns `{lotId: null, confirmed: false}`; the receipt lists them in `awaitingSupplier` and they never count as supplier-confirmed cover. `UNKNOWN_REQUIRED` is an error only when a must-cover need would be covered by unknown supply alone.
- **Caps and ceiling.** Caps gate the `act` tier; a granted sign-off can exceed them, but never the hard limit (`hardLimitCents`): above it an order is forbidden until the mandate is raised. `CAP_EXCEEDED` at commit applies to mandate-authorised lines. Budget week = ISO week of `deliverBy`; tiering reads the locked budget row inside `transact`.
- **Mandate version and expiry** are checked at commit on the scenario clock: kitchen `mandate_version` must equal `approval.mandateVersion` and `expiresAt` must be in the future, else `TERMS_CHANGED`.
- **Idempotency** is keyed (workspace, caller, tool, key) + request hash, scoped to the run.
- **Need edits.** `edit_line` with `needId` + `gramsPerGuest` emits one `EditLine` carrying the new `need` and its recomputed lines. Zero demand buys nothing.
- **Make in house.** `ProposeSubstitute{kind: 'make_in_house', lines[], labourNote}` with team-estimate provenance; sign-off tier; the dish is covered only when every ingredient is (AND).
- **Menus.** `plan_event{proposal}` plans only a revision whose server-stored review names a chef; planning is deterministic and never calls a model.

## Ranking (D6, D8, D8a, D10)
Lexicographic: **supply tier first** (`known_stock` or `make_in_house` from known ingredients > `unknown_stock` > `none`), then the weighted score. D8a: a recipe whose ingredients are all orderable (known stock or ≥ 999999-unknown) beats a product no better than unknown supply; it reads as unknown supply and is held at propose. Within a tier: hard constraints first (availability kind, lot, origin `require`, tender list, allergens), candidates from Valio's `substitutions` then hybrid domain retrieval. Score = Σ wⱼ·utilityⱼ (price, carbon, Finnish origin, reliability, organic label; the kitchen's weights, normalised) + w_fit·fit/4 (Decide.score 0–4). Missing value = utility 0. Tie-break on productId. Unknown-stock candidates stay visible and labelled, never recommended over known ones. Returns components, exclusions and residual.

## Demand
Event needs: (gServed × guests ÷ yield) + target stock − usable stock − confirmed inbound, rounded up to the lot step in sales units (`SalesQty.rounding` says how). Factors from `calendar-factors.json`, `1 + (v − 1) × sensitivity`, clamped [0.5, 2]; a closure is a mask (0). Direct orders (`place_order` with a physical `amount`) become a direct need sized by the product's printed content, so 1 L of milk in 0.5 L packs is 2 packs.

## Models (D12)
One routing table (`server/adapters/llm/router.ts`, `llm.for(job)`) picks provider, model, thinking level and token ceiling per job. Every call is traced with its `job` and counted against daily caps per workspace and per instance (`LLM_CAP_PER_WORKSPACE`, `LLM_CAP_GLOBAL`); `LLM_PROVIDER=fixture` keeps every job on the fixture.

| Job | Model | Used by |
|---|---|---|
| `request.parse` | `gemini-3.5-flash-lite`, minimal thinking, 600 tokens | `/request` parser after the rules |
| `agent.plan` | Flash-Lite, minimal, 600 | the agent's LLM planner (opt-in, see below) |
| `agent.review_rewrite` | Flash-Lite, minimal, 200 | one bounded rewrite of an outcome text that failed review |
| `menu.propose` | `gemini-3.8-flash`, low, 4,000 | `propose_menu` |
| `explain` | Flash-Lite, minimal, 400 | the chat's reply about a task, checked against the ledger |
| `chat.understand` | Flash-Lite, minimal, 400 | reading a chat message, guarded by the deterministic classifier |
| `request.parse.escalate` | `gemini-3.8-flash`, low, 800 | the parse's second pass when the first reading is unsure |
| `establishment.match` | Flash-Lite, minimal, 300 | "Describe your kitchen" → the nearest sample kitchen (`server/establishment.ts`, rules fallback) |
| `image.read` | NVIDIA Nemotron 3.5 Super VL on Verda, 1,500 | `read_image`; not live: the Verda endpoint isn't deployed, so the tool is advertised only with `VISION_LIVE=1` |

`agent.plan` runs only with `AGENT_PLANNER=llm`; otherwise, and on the deployed app, the agent uses the deterministic scripted planner.

Decisions (recipe fit in substitute ranking, rubric scores in review) go through the Decide port: `gemini-decision-1` → recorded replay → rules.

## Identity and workspaces (D9)
| Workspace | Who | How it is reached |
|---|---|---|
| `ws-demo` | the stage and presenters | Presenters only (dev, `DEMO_RESET_OPEN=1`, or a presenter session signed in on `/ops` from `MANDATE_KEY_CHEF`/`MANDATE_KEY_APPROVER`); default for env keys without a workspace |
| `ws-judges` | shared room (D24) | `?ws=ws-judges`; `MCP_KEYS` entries default here; overflow once `MAX_VISITORS` (5,000, `VISITOR_CAP`) sandboxes are seeded in the process. Each visitor joins as their own store (`create_kitchen`); writes to an owned kitchen come only from its owner (`notOwner` in `core/services/handlers.ts`, `FORBIDDEN` sub `store_owner`) |
| `ws-j-<id>` | one per browser | signed cookie `mandate_visitor` (HMAC with `JUDGE_KEY_SECRET`, 14 days), seeded lazily with the seed kitchens and a fresh run; `?ws=mine` returns to it; a phone joins it by pairing (`/pair`, single-use QR or short code, `server/pair/`). Another visitor's id in a link, cookie or query never selects it. Persists (D26): a reset starts a new run and re-seeds the sample kitchens, keeping the visitor's own |

- One resolver (`server/demo/visitor.ts`) serves Kitchen, `/request`, `/ops`, `/agents`, the chat, `/api/events`, web actions and the sandbox reset. A sandbox reset starts a fresh run in that workspace only (cooldown per workspace); the stage resets from presenters only.
- **Judge keys** (`server/demo/judge-key.ts`): `jk_<ws-j-id>.<expEpochS>.<base64url HMAC-SHA256(JUDGE_KEY_SECRET, "jk|ws|exp")>`, verified in constant time. `/agents` shows the visitor's own key with its MCP URL (`/mcp/k/<key>`), client configs, the tools an external agent sees and that key's recent calls; `/api/demo/judge-key` mints it too. A key acts as `external_agent` (read, plan, order; never approve) in that workspace's current run, so a reset keeps it working; it expires with the event (`JUDGE_KEY_EXPIRES`). No secret, no judge keys.
- Other keys (`server/auth`): `MANDATE_KEY_{CHEF,KITCHEN_AGENT,EXTERNAL_AGENT,APPROVER}`, `MCP_KEYS=label:actor:key[:workspace]`, fixture keys only in dev or with `MANDATE_FIXTURE_KEYS=1`. Keys arrive as `Authorization: Bearer` or in the path `/mcp/k/<key>`.
- **Approval links locate, never authorise.** `ResultMeta.approvalUrl` opens the exact plan in the Kitchen screen; approving still needs a chef session in that workspace.

## Tenancy: account → establishment → kitchen → basket (ring 6 foundation 1)
- **Inside a workspace** the shape is: account → establishment(s) → kitchen (one store or site) → basket. A basket belongs to **one kitchen and one delivery day**; there is never one basket across sites. A chain with several sites has one basket per site. Carrying lines to another site is an explicit copy that makes new plans there.
- **Saved things are per kitchen:** usual orders, rules (mandate), menus, pins. Something shared between kitchens is copied, never linked, so editing one kitchen's rules never changes another's.
- **The demo sandbox seeds seven kitchens as seven separate customers**, not one chain. The picker says so.
- **Choosing a kitchen plans nothing.** The establishment picker and the header selector call `join`; a plan exists only after an event, a usual order, a request, the chat or an outside agent asks for one.
- **Every surface names the kitchen it acts for:** the Kitchen header, the chat dock, Ops filters, and the agent door (`get_context` lists the kitchens a key may act for; each tool call names one).
- **One shortage, many kitchens.** Valio stock is shared across every kitchen in the workspace. A shortage re-plans each affected kitchen's open plan inside *that kitchen's* mandate, so the same event gives different answers per kitchen.

## Agents
- **Agent loop** (`server/agent/`): at most 8 steps, as the routine agent (`kitchen_agent`) with the intersection of its scopes and the starter's, so it never approves or changes the mandate. The planner reads typed, length-bounded facts about tool results, never raw supplier text; the gate (scopes, intent's tool list, kitchen grant, mandate checks) is what stops damage.
- **Approval stays with a person (D9, D11, D13, D22).** The chef approves in the Kitchen or from the chat dock's DecisionCard: the same exact terms, hold-to-confirm and Kitchen approve command bound to the rendered plan version. In their own dock the chef may also say "approve all" or "reject the herring": it acts on the lines the last turn showed, on that version (D21), through `approve` (`server/chat/turn.ts`); sign-off lines still need the confirm card. An outside agent gets `approvalUrl` (D17); the MCP elicitation for a chef's own key (D22) is not built.
- **`/api/agent/run`** starts a run with a chef key (`agent:run`), streams traces as NDJSON and to `/ops`; one run per workspace; `/api/agent/run/<id>/cancel` stops it.
- **Chat** (`server/chat/`, `/api/chat/turn`, `/api/chat/task`): a dock on every page (`ChatDock` in the layout; `/agents/chat` opens it over the Kitchen). One turn on a procurement task runs the agent as the visitor's chef ∩ the agent's scopes: understand the message (rules guard the model), clarify a typed slot, plan and order within the mandate, show the decision left for a chef, report the ledger. An event brief runs its own flow: brief questions as chips → `propose_menu` → a menu card linking to its review on `/request` → `plan_event{proposal}` once a chef has reviewed it. The task is written back each turn, so a reconnect reads the task, not a transcript. `/request` is still its own step page (`ui/request/RequestFlow.svelte`), with the dock following its kitchen and plan; D23's full-width conversation there is not built.
- **Tasks** (`server/tasks/`): `TaskStore` on `agent_tasks` (compare-and-set), the pure ledger from plans, receipts and approvals, and `get_outcome`.
- **Review** (`server/review/`): validator passes at model-output checkpoints (request parse, outcome text): deterministic checks always, plus an optional rubric score through Decide. It answers pass, revise or block; it never authorises or changes state.

## Tools (`core/contracts/tools.ts`)
20 tools in the registry. An outside agent sees 18 (no `approve`, `set_mandate`), and 17 while `read_image` isn't advertised (`advertised()` in `server/tools/serve.ts`).

| Tool | Scope | What |
|---|---|---|
| `get_context` | read | Start here: who you are, kitchens and events you may plan for, scopes, scenario date and cut-off, open plans with their next action |
| `search_products` | read | Search the static catalogue (no Valio call), with provenance |
| `quote` | read | Live price and availability for up to 200 known ids (cache-through); unknown ids → `NOT_FOUND` |
| `propose_menu` | plan | Propose a menu for an event brief: dishes with amounts per guest, each ingredient resolved or visibly unresolved; estimates labelled; stored as revision 0 for a chef to review |
| `revise_menu` | plan | One change set on a menu proposal → the next revision (pin an ingredient, change an amount, add or remove); every other ingredient keeps its product; a chef accepts it (`reviewUrl`) before planning |
| `create_kitchen` | plan | A new kitchen owned by the visitor who asks: copied from the nearest sample of `profile` (rules, usual order, history; copied, never linked) or blank with default rules |
| `plan_event` | plan | Expand a seeded event, or a chef-reviewed menu proposal revision, into needs, lines, rounding and anomalies |
| `place_order` | order | Create and quote a plan from explicit lines or physical amounts; idempotent per key |
| `edit_line` | plan | Change one line or need (qty, g/guest, product); invalidates the quote and approvals |
| `find_substitutes` | plan | Rank substitutes under the kitchen's weights: supply tier, then Valio's rules, then domain retrieval; preview or apply |
| `get_plan` | read | The plan with lines, states, reasons, views, the current approval and the last voided one |
| `explain_line` | read | The Why drawer for one line: ordered steps with sources |
| `approve` | approve | Grant or deny an approval, or one reason group of it (`lineIds`), bound to the exact plan version and terms hash |
| `commit_order` | order | Revalidate, check cut-off and caps under lock, consume simulated stock, write one order + receipt; same key → same receipt |
| `get_outcome` | read | What is true for a plan or task now, in numbers: per need confirmed / awaiting / planned / unresolved, money committed, receipts, decisions left, next action |
| `set_mandate` | mandate:write | Registered, not served (`PROVIDER_UNAVAILABLE`): mandates come from the kitchen seed |
| `lookup_facts` | read | Web facts about a catalogue product (Exa), cited; records nothing; counts against the daily web budget |
| `find_outside` | read | Options outside the Valio catalogue for an unresolved need, with sources; never ordered |
| `check_recall` | read | Watched recall notices (Context.dev monitor) against a product: GTIN match, name match or none |
| `read_image` | read | A photo of a prep list, delivery note or label → its reading (router job `image.read`). Advertised to outside agents only when the vision endpoint is live (`VISION_LIVE=1`) |

Scopes per actor (`SCOPES_BY_ACTOR`): `chef` all six (read, plan, order, approve, mandate:write, agent:run) · `kitchen_agent`, `external_agent`, `system` read, plan, order · `approver` read, approve · `job` read. One registry serves MCP, REST and OpenAPI and feeds the agent loop; MCP lists only the tools inside the caller's scopes (`toolsFor`). Core serves most tools; `get_context` (agent), `get_outcome` (tasks), `propose_menu` and `revise_menu` (menu), `read_image` (images) and the three web tools are composed in `server/tools/handlers.ts`.

Beside the tools, MCP serves **resources** (`mandate://<kitchen>`: a kitchen's mandate in words and numbers; `decisions://open`: plans waiting on something, with the next step) and **prompts** (`plan_event_in_mandate`, `check_open_before_cutoff`, `order_for_date`), read through the same gate with the caller's scopes and never with an approve affordance (`server/tools/mcp-extras.ts`). Outside-agent keys are metered per minute (120 calls, 30 writes, 20 quotes; `server/tools/key-limits.ts`). `/.well-known/agent.json` describes the agent door (MCP URL, scopes, tools, resources, prompts); it holds no key.

## Server modules (`src/lib/server/`)
| Module | What |
|---|---|
| `adapters/` | `catalog` (file and Postgres catalogues, shared hybrid retrieval and `resolve`; `valio-live.ts`: Valio's API on a cache miss, ≤ 200 ids per call, retries with backoff, breaker, one trace per call; the Postgres catalogue refetches availability older than 15 min and prices once per product, and stores what comes back in `offer_cache`), `decide` (Gemini Decisions → recorded replay → rules), `llm` (Gemini, Verda, Featherless, fixture; the router per job; every call traced), `simulator` (scenario stock, per-workspace overlay) |
| `agent/` | agent loop (≤ 8 steps), shared intent classifier, planner facts, `get_context`, next-action rule, outcome from `FulfilmentView`, agent runs |
| `auth/` | bearer key → `CallContext`; env keys, `MCP_KEYS`, judge keys |
| `bus/` | `ServerEvent` publish and catch-up: in-memory and Postgres NOTIFY, synthetic and stress streams |
| `calendar.ts` | the kitchen's iCalendar feed: decisions, deliveries, receiving days and holidays, per sandbox; a signed calendar token or an agent key reads one sandbox's feed |
| `chat/` | one chat turn on a task, message understanding (model + rules guard), ledger-checked replies |
| `db/` | Drizzle client (Aiven TLS, `SQL_TRACE` tally), schema, PGlite fixture |
| `demo/` | visitor resolver and signed cookies, judge keys, presenter session, stage reset, sandbox reset, run-scoped idempotency |
| `evals/` | eval adapter over the real handlers, fidelity suite, chat and live-planner diagnostics |
| `external/` | one outside call: response cache, daily spend caps per caller and instance, circuit breaker, trace; `withExternalScope`/`scopeFor` carry the caller through async code |
| `images/` | `read_image`: a picture (JPEG, PNG or WebP, ≤ 4 MB) to the `image.read` job, daily caps per workspace and instance; the picture is never stored |
| `kitchen/` | the Kitchen screen's server side: acts as the chef through the tool handlers, builds the snapshot |
| `establishment.ts` | "Describe your kitchen" → nearest sample kitchen (`establishment.match`, rules fallback) |
| `obs/` | structured logs, redaction and the `traces` table store behind the trace drawer and `/api/ops/traces` |
| `pair/` | device pairing (single-use QR link or short code, 10 min, minted only for the owning browser's cookie) |
| `patterns/` | usual orders (D14): detected per kitchen and day, planned through `place_order` (`/kitchen-api/usual`) |
| `products/` | product cards and the photo ladder (recorded listings, findings, brand logos; live warm-up within web caps) |
| `menu/` | event-brief questions, `propose_menu` (model + rubric), the menu flow for `/request`, and the `MenuStore` (`menu_proposals`) |
| `request/` | `/request`: classify, parse (rules, then the LLM), convert units, dates, lookup, run |
| `review/` | validator checkpoints for model output (`request.parse`, `agent.outcome_text`) |
| `scope.ts` | `withCallScope`: run, overlay and external scope for one caller |
| `store/` | ports per process (`server-ports`: Aiven or PGlite, Valio cache-through when `VALIO_API_KEY` is set and `VALIO_LIVE≠0`), `db-ports`, `fixture-ports`, the Drizzle store with per-run state cache |
| `tasks/` | `TaskStore` adapters (Drizzle, memory), the projection that recomputes derived fields, the ledger, `get_outcome` |
| `tools/` | handler wiring, `serveTool`, MCP endpoint and instructions, REST serving, OpenAPI, result `meta` |
| `web/` | Exa lookups and evidence, Context.dev recall monitor and webhook, news leads, make-in-house recipes, findings and per-run applications, web state in Postgres |

## Tables (`server/db/schema.ts`)
`workspaces` (last_seq) · `runs` · `kitchens` (doc, mandate_version) · `products` (doc, embedding: column only, not populated, D19) · `offer_cache` · `sim_stock` (atomic consume) · `plans` (doc, version) · `approvals` · `orders` (unique per plan + idempotency key, receipt) · `budgets` (locked row per kitchen-week) · `idempotency` · `ops` (workspace, seq) · `api_keys` · `enrichments` (web facts, never overwriting catalogue facts) · `menu_proposals` (per workspace and revision, with review) · `agent_tasks` (per workspace, versioned doc) · `web_cache` (outside-call responses) · `web_spend` (calls per UTC day, API and key; `*` is the instance counter) · `web_queue` (recall work, claimed with `FOR UPDATE SKIP LOCKED` and a lease) · `web_findings` · `web_applications` · `traces` (one row per outside call or step).

Web state lives in Postgres so a redeploy loses nothing and several instances share caps and work; without a database it falls back to JSON files under `WEB_CACHE_DIR`.

Shared and lead-only: `src/lib/core/contracts/**`, `core/ports.ts`, `core/state.ts`, `core/hash.ts`, `server/db/schema.ts`, `drizzle/**`, `package.json`/lockfile, `docs/concept/**`, `docs/DECISIONS.md`.
