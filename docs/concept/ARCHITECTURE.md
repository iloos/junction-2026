# ARCHITECTURE

_Lead-owned. Implements D3–D6. The contracts named here are in `main`. Lanes code against them and raise **Needs** instead of changing them._

## Shape
```
browser  routes (kitchen, ops, why drawer) ──SSE── /api/events
            │ fetch                                   ▲
server   /api/tools/<name> · /mcp · /api/openapi.json │ NOTIFY / in-memory bus
            │ one tool registry (core/contracts/tools.ts)
         command handler: authorise (scopes) → idempotency → store.transact(lock ws) → services → applyOps → persist state + ops
            │ ports (core/ports.ts)
adapters catalog (Valio cache-through + simulator) · decide (Gemini → replay → rules) · llm · web · jobs (Modal) · store (Drizzle: Aiven | PGlite)
```
`src/lib/core/` is pure TS (lint-enforced: no Svelte, Node built-ins, vendor SDKs or `$lib/server`). Services that need I/O take `Ports`.

## Contracts (files)
| File | What |
|---|---|
| `core/contracts/primitives.ts` | `ProductId` (six digits), `Cents` (int), `SalesQty`, `Measure` (+ weight basis), `Source`/`Provenance`, `Actor` (server-derived), `Scope` (workspaceId + runId) |
| `core/contracts/errors.ts` | D6 `ErrorCode` + `RETRYABLE`, `DomainError` (`sub` carries "weekly" etc.), `Result<T>` |
| `core/contracts/product.ts` | normalised `Product` (valio-data.md §6), `AvailabilityKind`, `Availability` (raw kept), `Price`, `Offer` |
| `core/contracts/kitchen.ts` | `Kitchen` (matches `fixtures/seeds/kitchens.json`), `Mandate` (versioned caps + never-delegate), `Weights` |
| `core/contracts/plan.ts` | `Plan`/`Line`/`Approval`/`Order`/`Receipt`/`Anomaly`, state enums, `Tier`, `LineReason` (error codes ∪ `out`/`undeliverable`/… ∪ policy reasons; matches evals/README) |
| `core/contracts/ops.ts` | the closed `Op` union (8 types) and `OpEnvelope` (seq, actor, via) |
| `core/contracts/events.ts` | `SimEvent` (5 kinds), `ServerEvent` (op · sim · trace) for SSE |
| `core/contracts/tools.ts` | the tool registry schemas, scopes per actor (external agent: no `approve`, no `mandate:write`) |
| `core/ports.ts` | `Clock, Catalog, Simulator, Decide, Llm, Web, Jobs, Store, Ops`, `CallContext` |
| `core/state.ts` | `WorkspaceState`, pure `applyOps` (version checks, approval invalidation, external approval refused, commit once) |
| `core/hash.ts` | canonical JSON, `termsHash` (deliverBy + sorted lines), `requestHash` |
| `server/db/schema.ts` + `drizzle/0000_init.sql` | tables below; first migration creates `vector` |
| `server/db/pglite.ts` | `createFixtureDb()`: PGlite + pgvector + the same migrations |

## State machines (D6)
- **Plan** `draft → quoted → ready | held → committed`. Edits (`EditLine`, `ProposeSubstitute`) → `draft`, terms hash cleared, approvals `invalidated`.
- **Line** `proposed → eligible | held{tier, reasons} | rejected | unorderable → committed`.
- **Approval** `pending → granted | denied | expired | invalidated`, bound to plan version + terms hash + mandate version.
- Eval vocabulary: an *order* in s5 is a plan (`quoted → held{sign_off, external_agent_needs_approval} → ready → committed`) plus its approval (`pending → granted`).

## Command flow (one server function per tool)
1. Resolve `CallContext` from the bearer key (scopes, actor, workspace, run). Body never sets the actor.
2. Validate input (zod). Unknown product ids → `NOT_FOUND` before any Valio call.
3. Outside the lock: fetch offers, run Decide/LLM (never hold DB locks across them).
4. `store.transact(workspaceId)`: idempotency check (replay / conflict → `DUPLICATE`), re-read the plan, compare versions/terms, lock the budget row, `simulator.consume` for commits, compute ops, `applyOps`, persist rows + ops, bump `workspaces.last_seq`.
5. After commit: publish `ServerEvent`s (NOTIFY on Postgres, in-memory bus on PGlite).

## Rules the handlers enforce (from the contracts review, 8d)
- **Partial commits.** `commit_order` commits `lineIds` (default: eligible act-tier lines + lines covered by a granted approval). A plan has several orders, one per idempotency key; it becomes `committed` only when no line is proposed/eligible/held. Committed lines can't be edited or re-quoted away.
- **Authority (also checked in `applyOps`).** `mandate` = only act-tier eligible lines, never for an external caller or an externally created plan. `{approvalId}` = granted, same plan version + terms hash, covers the line.
- **Re-approval.** Any `RecordOffer` that leaves lines held emits a new `RecordApproval(pending)` bound to the new version and hash (s4: pending → granted → invalidated → pending → granted). `get_plan` returns the current approval with what it is bound to.
- **Unknown supply.** Terminal lines can be committed: `Simulator.consume` returns `{lotId: null, confirmed: false}`; the receipt lists them in `awaitingSupplier` and they stay unconfirmed cover. `UNKNOWN_REQUIRED` is an error only when a must-cover need would be covered by unknown supply alone.
- **Caps** gate the `act` tier only; a granted sign_off approval authorises exceeding them. `CAP_EXCEEDED` at commit applies to `authority: 'mandate'`. Budget week = ISO week of `deliverBy`. Tiering reads the locked budget row inside `transact`.
- **Mandate version and expiry** are checked at commit with the Clock: kitchen `mandate_version` must equal `approval.mandateVersion` and `expiresAt` must be in the future, else `TERMS_CHANGED`.
- **Idempotency** is keyed (workspace, caller, tool, key) + request hash.
- **Need edits.** `edit_line` with `needId` + `gramsPerGuest` emits one `EditLine` carrying the new `need` and its recomputed lines.
- **Make in house.** `ProposeSubstitute{kind: 'make_in_house', lines[], labourNote}` with team-estimate provenance; sign_off tier (new SKUs + allergen check).

## Tables (`server/db/schema.ts`)
`workspaces` (last_seq) · `runs` · `kitchens` (doc, mandate_version) · `products` (doc, embedding vector(768)) · `offer_cache` (per product, like the Valio cache) · `sim_stock` (atomic consume) · `plans` (doc, version) · `approvals` · `orders` (unique per plan + idempotency key, receipt) · `budgets` (locked row per kitchen-week) · `idempotency` (workspace, caller, tool, key, request hash) · `ops` (workspace, seq) · `api_keys` (hashed, scopes).

## Ranking (frozen, D6)
Hard constraints first (availability kind, lot, origin `require`, tender list, allergens), candidates from Valio's `substitutions` then domain search. Score = Σ wⱼ·utilityⱼ (price, carbon, origin, reliability; weights normalised) + w_fit·fit/4 (Decide.score 0–4). Missing value = utility 0. Tie-break on productId. Returns components, exclusions and residual (`ProposeSubstitute.candidates`).

## Demand
need = (gServed × guests ÷ yield) + target stock − usable stock − confirmed inbound, then round up to the lot step in sales units (`SalesQty.rounding` says how). Factors from `calendar-factors.json`, `1 + (v − 1) × sensitivity`, clamped [0.5, 2]; a closure is a mask (0).

## Lanes (Ring 0)
| Lane | Owns | Done when |
|---|---|---|
| **core-db** | `src/lib/core/{demand,mandate,rank,services}/**`, `src/lib/server/store/**`, `src/lib/server/adapters/{catalog,simulator}/**`, seed loader | tools `quote`, `plan_event`, `place_order`, `edit_line`, `find_substitutes`, `approve`, `commit_order` work on PGlite and Aiven; evals s1–s5 pass via the runner |
| **agent** | `src/lib/server/agent/**`, `src/lib/server/adapters/{decide,llm}/**`, `src/routes/mcp/**`, `src/routes/api/tools/**`, `src/routes/api/openapi.json/**` | registry served as MCP + REST + OpenAPI with scoped keys; the routine agent plans the Christmas event in ≤8 steps with traces; Gemini fit scores with replay fallback |
| **kitchen** | `src/routes/(kitchen)/**`, `src/lib/ui/**` | the chef journey of PITCH.md's table demo, with labels (real/cached/simulated) and the Why drawer; screenshots |
| **ops** | `src/routes/ops/**`, `src/routes/api/events/**`, `src/lib/server/bus/**` | SSE op stream (subscribe → catch up → dedupe), held-lines board across kitchens, op log with provenance |
| **deploy** (9c) | Dockerfile, `src/routes/healthz/**`, `src/lib/server/db/client.ts`, `scripts/deploy/**`, `docs/foundations/deploy.md` | public HTTPS URL with DB health; one-command redeploy |
| **evals** (8d) | `evals/**` | `pnpm eval` plays s1–s5 through the tool registry on PGlite and reports per-key pass/fail |
| jobs (Ring 2) | `jobs/**`, `src/lib/server/adapters/jobs/**` | enrichment writes via `RecordEnrichment` through the API |

Shared and lead-only: `src/lib/core/contracts/**`, `core/ports.ts`, `core/state.ts`, `core/hash.ts`, `server/db/schema.ts`, `drizzle/**`, `package.json`/lockfile, `docs/concept/**`, `docs/DECISIONS.md`.
