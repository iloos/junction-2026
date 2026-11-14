# ARCHITECTURE

_Lead-owned. Implements D3–D10. The contracts named here are on `main`. Tracks code against them and raise **Needs** instead of changing them; who owns which path is in [DISPATCH.md](../DISPATCH.md#ownership-at-the-seams)._

## Shape
```
browser  /  (kitchen) · /request · /ops ──SSE── /api/events
            │ fetch (/kitchen-api/*, /api/request, /api/agent/run, /api/web/*)
server   /api/tools/<name> · /mcp · /api/openapi.json                 ▲ NOTIFY / in-memory bus
            │ one tool registry (core/contracts/tools.ts)
         command handler: authorise (scopes) → idempotency → prepare outside the lock → store.transact(lock ws) → services → applyOps → persist state + ops
            │ ports (core/ports.ts)
adapters catalog (Valio cache-through, file | Postgres, hybrid retrieval) + simulator · decide (Gemini Decisions → replay → rules) · llm (Gemini Flash-Lite | Featherless | fixture) · web (Exa, Context.dev | fixture) · menu store · store (Drizzle: Aiven | PGlite)
```
`src/lib/core/` is pure TS (lint-enforced: no Svelte, Node built-ins, vendor SDKs or `$lib/server`). Services that need I/O take `Ports`. Browsers never hold a key: pages act server-side through the same handlers REST, MCP and the agent use.

## Contracts (files)
| File | What |
|---|---|
| `core/contracts/primitives.ts` | `ProductId` (six digits), `WorkspaceId`, `VisitorWorkspaceId` (`ws-j-…`), `Cents` (int), `SalesQty`, `Measure` (+ weight basis), `Source`/`Provenance`, `Actor` (server-derived), `Scope` (workspaceId + runId) |
| `core/contracts/errors.ts` | D6 `ErrorCode` + `RETRYABLE`, `DomainError`, `Result<T>` |
| `core/contracts/product.ts` | normalised `Product`, `AvailabilityKind`, `Availability` (raw kept, `closingTime`), `Price`, `Offer` |
| `core/contracts/kitchen.ts` | `Kitchen` (matches `fixtures/seeds/kitchens.json`), `Mandate` (versioned caps, `hardLimitCents` ceiling, never-delegate), `Weights` |
| `core/contracts/plan.ts` | `Plan`/`Line`/`Approval`/`Order`/`Receipt`/`Anomaly`, state enums, `Tier`, `LineReason`; `Need` (with `source` lineage and direct physical amounts); `SupplyTier` (D8/D10: `known_stock`, `make_in_house`, `unknown_stock`, `none`); read models `LineView` (`physical`, `unitPrice`, `comparisonPrice`), `FulfilmentView` (exact partition of a need: supplier confirmed, awaiting supplier, planned known, planned unknown, unresolved, plus excess) and `PlanView` (`asOf`, `mandateVersion`, `validUntil`, fulfilment); `TermsDiff`; `LineAuthority` |
| `core/contracts/event.ts` | `EventBrief`, `DishTemplate`, `DishIngredient` (stable ids, amount per cover, exactly one of productId / query / unresolved), `MenuProposal` (revisions, server-recorded `review`, `open` questions) |
| `core/contracts/ops.ts` | the closed `Op` union (8 types) and `OpEnvelope` (seq, actor, via, `initiatedBy`) |
| `core/contracts/events.ts` | `SimEvent`, `ServerEvent` (op · sim · trace) for SSE |
| `core/contracts/tools.ts` | the tool registry schemas, `ResultMeta` (`summary`, `nextAction`, `approvalUrl`, always our own words), `WebFact`, `ToolScope`, `SCOPES_BY_ACTOR` |
| `core/ports.ts` | `Clock, Catalog` (incl. optional `resolve` for menu queries), `Simulator, Decide, Llm, Web, Jobs, Store, Ops, MenuStore`, `CallContext`, `WebExecutionContext`, `JudgeKeys`, `ToolHandlers` |
| `core/state.ts` | `WorkspaceState`, pure `applyOps` (version checks, approval invalidation, external approval refused, commit once) |
| `core/hash.ts` | canonical JSON, `termsHash` (deliverBy + sorted lines), `requestHash` |
| `server/db/schema.ts` + `drizzle/*.sql` | tables below; migrations `0000_init`, `0001_enrichments`, `0002_menu_proposals` |
| `server/db/pglite.ts` | `createFixtureDb()`: PGlite + pgvector + the same migrations |

Typed but not yet served (see DISPATCH "Contract-only"): `approve{lineIds}` with `remainingApprovalId`, `get_plan.lastVoided`, `plan_event{proposal}`, the cut-off check at commit.

## State machines (D6)
- **Plan** `draft → quoted → ready | held → committed`. Edits (`EditLine`, `ProposeSubstitute`) → `draft`, terms hash cleared, approvals `invalidated`.
- **Line** `proposed → eligible | held{tier, reasons} | rejected | unorderable → committed`.
- **Approval** `pending → granted | denied | expired | invalidated`, bound to plan version + terms hash + mandate version + expiry.
- **Menu proposal** `proposed → chef_reviewed → planned`; each edit is a new revision; only the server writes `review`.
- Words for these states on screen and in tool text: [VOCABULARY.md](VOCABULARY.md) (D10). "Supplier confirmed" only for receipt-backed quantities.

## Command flow (one server function per tool)
1. Resolve `CallContext` from the bearer key, visitor cookie or in-process actor (scopes, actor, workspace, run). The body never sets the actor.
2. Validate input (zod). Unknown product ids → `NOT_FOUND` before any Valio call.
3. Outside the lock: fetch offers, run Decide/LLM (never hold DB locks across them).
4. `store.transact(workspaceId)`: idempotency check (replay / conflict → `DUPLICATE`), re-read the plan, compare versions/terms, lock the budget row, `simulator.consume` for commits, compute ops, `applyOps`, persist rows + ops, bump `workspaces.last_seq`.
5. After commit: publish `ServerEvent`s (NOTIFY on Postgres, in-memory bus on PGlite).

## Rules the handlers enforce
- **Partial commits.** `commit_order` commits `lineIds` (default: eligible act-tier lines + lines covered by a granted approval). A plan has several orders, one per idempotency key; it becomes `committed` only when no line is proposed/eligible/held. Committed lines can't be edited or re-quoted away.
- **Per-line authority.** Each `Order.lines[]` names its own `authority`: `mandate` (act-tier eligible, never for an external caller or an externally created plan) or `{approvalId}` (granted, same plan version + terms hash, lists that line). No grant covers a line it did not list. The order-level `authority` is a summary; old orders without per-line fields read it.
- **Re-approval.** Any `RecordOffer` that leaves lines held emits a new `RecordApproval(pending)` bound to the new version and hash. `get_plan` returns the current approval with what it is bound to.
- **Unknown supply.** Terminal lines can be committed: `Simulator.consume` returns `{lotId: null, confirmed: false}`; the receipt lists them in `awaitingSupplier` and they never count as supplier-confirmed cover. `UNKNOWN_REQUIRED` is an error only when a must-cover need would be covered by unknown supply alone.
- **Caps and ceiling.** Caps gate the `act` tier; a granted sign-off can exceed them, but never the hard limit (`hardLimitCents`): above it an order is forbidden until the mandate is raised. `CAP_EXCEEDED` at commit applies to mandate-authorised lines. Budget week = ISO week of `deliverBy`; tiering reads the locked budget row inside `transact`.
- **Mandate version and expiry** are checked at commit on the scenario clock: kitchen `mandate_version` must equal `approval.mandateVersion` and `expiresAt` must be in the future, else `TERMS_CHANGED`.
- **Idempotency** is keyed (workspace, caller, tool, key) + request hash, scoped to the run.
- **Need edits.** `edit_line` with `needId` + `gramsPerGuest` emits one `EditLine` carrying the new `need` and its recomputed lines. Zero demand buys nothing.
- **Make in house.** `ProposeSubstitute{kind: 'make_in_house', lines[], labourNote}` with team-estimate provenance; sign-off tier; the dish is covered only when every ingredient is (AND).

## Ranking (D6, D8, D10)
Lexicographic: **supply tier first** (`known_stock` or `make_in_house` from known ingredients > `unknown_stock` > `none`), then the weighted score. Within a tier: hard constraints first (availability kind, lot, origin `require`, tender list, allergens), candidates from Valio's `substitutions` then hybrid domain retrieval. Score = Σ wⱼ·utilityⱼ (price, carbon, origin, reliability; weights normalised) + w_fit·fit/4 (Decide.score 0–4). Missing value = utility 0. Tie-break on productId. Unknown-stock candidates stay visible and labelled, never recommended over known ones. Returns components, exclusions and residual.

## Demand
Event needs: (gServed × guests ÷ yield) + target stock − usable stock − confirmed inbound, rounded up to the lot step in sales units (`SalesQty.rounding` says how). Factors from `calendar-factors.json`, `1 + (v − 1) × sensitivity`, clamped [0.5, 2]; a closure is a mask (0). Direct orders (`place_order` with a physical `amount`) become a direct need sized by the product's printed content, so 1 L of milk in 0.5 L packs is 2 packs.

## Identity and workspaces (D9)
| Workspace | Who | How it is reached |
|---|---|---|
| `ws-demo` | the stage and presenters | Presenters only (dev, `DEMO_RESET_OPEN=1`, or a presenter session signed in on `/ops` from `MANDATE_KEY_CHEF`/`MANDATE_KEY_APPROVER`); default for env keys without a workspace |
| `ws-judges` | shared room | `?ws=ws-judges`; `MCP_KEYS` entries default here; overflow once `MAX_VISITORS` (300) sandboxes are seeded in the process |
| `ws-j-<id>` | one per browser | signed cookie `mandate_visitor` (HMAC with `JUDGE_KEY_SECRET`), seeded lazily with the seed kitchens and a fresh run; `?ws=mine` returns to it. Another visitor's id in a link, cookie or query never selects it |

- One resolver (`server/demo/visitor.ts`) serves Kitchen, `/request`, `/ops`, `/api/events`, web actions and the sandbox reset. A sandbox reset starts a fresh run in that workspace only (cooldown per workspace); the stage resets from presenters only.
- **Judge keys** (`server/demo/judge-key.ts`): `jk_<ws-j-id>.<expEpochS>.<base64url HMAC-SHA256(JUDGE_KEY_SECRET, "jk|ws|exp")>`, verified in constant time, minted at `/api/demo/judge-key` for the visitor's own sandbox. A key acts as `external_agent` (read, plan, order; never approve) in that workspace's current run, so a reset keeps it working; it expires with the event (`JUDGE_KEY_EXPIRES`). No secret, no judge keys.
- Other keys (`server/auth`): `MANDATE_KEY_{CHEF,KITCHEN_AGENT,EXTERNAL_AGENT,APPROVER}`, `MCP_KEYS=label:actor:key[:workspace]`, fixture keys only in dev or with `MANDATE_FIXTURE_KEYS=1`. Keys arrive as `Authorization: Bearer` or in the path `/mcp/k/<key>`.
- **Approval links locate, never authorise.** `ResultMeta.approvalUrl` opens the exact plan in the Kitchen screen; approving still needs a chef session in that workspace.

## Tools (`core/contracts/tools.ts`)
| Tool | Scope | What |
|---|---|---|
| `get_context` | read | Start here: who you are, kitchens and events you may plan for, scopes, scenario date and cut-off, open plans with their next action |
| `search_products` | read | Search the static catalogue (no Valio call), with provenance |
| `quote` | read | Live price and availability for up to 200 known ids (cache-through); unknown ids → `NOT_FOUND` |
| `plan_event` | plan | Expand a seeded event (menu × covers) into needs, lines, rounding and anomalies; a reviewed menu proposal once A4 lands |
| `place_order` | order | Create and quote a plan from explicit lines or physical amounts; idempotent per key |
| `edit_line` | plan | Change one line or need (qty, g/guest, product); invalidates the quote and approvals |
| `find_substitutes` | plan | Rank substitutes under the kitchen's weights: supply tier, then Valio's rules, then domain retrieval; preview or apply |
| `get_plan` | read | The plan with lines, states, reasons, views and the current approval |
| `explain_line` | read | The Why drawer for one line: ordered steps with sources |
| `approve` | approve | Grant or deny an approval bound to the exact plan version and terms hash |
| `commit_order` | order | Revalidate, check caps under lock, consume simulated stock, write one order + receipt; same key → same receipt |
| `set_mandate` | mandate:write | Change caps, never-delegate list or weights; bumps the mandate version |
| `lookup_facts` | read | Web facts about a catalogue product (Exa), cited; records nothing; counts against the daily web budget |
| `find_outside` | read | Options outside the Valio catalogue for an unresolved need, with sources; never ordered |
| `check_recall` | read | Watched recall notices (Context.dev) against a product: GTIN match, name match or none |

Scopes per actor (`SCOPES_BY_ACTOR`): `chef` all six (read, plan, order, approve, mandate:write, agent:run) · `kitchen_agent`, `external_agent`, `system` read, plan, order · `approver` read, approve · `job` read. One registry serves MCP, REST and OpenAPI and feeds the agent loop.

## Server modules (`src/lib/server/`)
| Module | What |
|---|---|
| `adapters/` | `catalog` (Valio cache-through, file and Postgres catalogues, shared hybrid retrieval and `resolve`), `decide` (Gemini Decisions → recorded replay → rules), `llm` (Gemini Flash-Lite, Featherless, fixture; every call traced), `simulator` (scenario stock, per-workspace overlay) |
| `agent/` | routine agent loop (≤ 8 steps), intent parsing via the request parser, `get_context`, outcome from `FulfilmentView`, agent runs |
| `auth/` | bearer key → `CallContext`; env keys, `MCP_KEYS`, judge keys |
| `bus/` | `ServerEvent` publish and catch-up: in-memory and Postgres NOTIFY, synthetic and stress streams |
| `db/` | Drizzle client (Aiven TLS, `SQL_TRACE` tally), schema, PGlite fixture |
| `demo/` | visitor resolver and signed cookies, judge keys, presenter session, stage reset, sandbox reset, run-scoped idempotency |
| `evals/` | eval adapter over the real handlers, fidelity suite, live-planner diagnostics |
| `kitchen/` | the Kitchen screen's server side: acts as the chef through the tool handlers, builds the snapshot |
| `menu/` | event-brief questions and the `MenuStore` (`menu_proposals`) |
| `request/` | `/request`: classify, parse (rules, then the LLM), convert units, dates, lookup, run |
| `store/` | ports per process (`server-ports`: Aiven or PGlite + file catalogue), `db-ports`, `fixture-ports`, the Drizzle store with per-run state cache |
| `tools/` | handler wiring, MCP endpoint and instructions, REST serving, OpenAPI |
| `web/` | Exa lookups, Context.dev recall watch and webhook, findings and per-run applications, spend caps |

## Tables (`server/db/schema.ts`)
`workspaces` (last_seq) · `runs` · `kitchens` (doc, mandate_version) · `products` (doc, embedding) · `offer_cache` · `sim_stock` (atomic consume) · `plans` (doc, version) · `approvals` · `orders` (unique per plan + idempotency key, receipt) · `budgets` (locked row per kitchen-week) · `idempotency` · `ops` (workspace, seq) · `api_keys` · `enrichments` (web facts, never overwriting catalogue facts) · `menu_proposals` (per workspace and revision, with review).

Shared and lead-only: `src/lib/core/contracts/**`, `core/ports.ts`, `core/state.ts`, `core/hash.ts`, `server/db/schema.ts`, `drizzle/**`, `package.json`/lockfile, `docs/concept/**`, `docs/DECISIONS.md`.
