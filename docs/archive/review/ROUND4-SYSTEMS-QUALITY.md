# Round 4 — systems quality and growth architecture

Code/document review at `c834e98`, with overlapping Kitchen/live changes rechecked at `451a713`, 14 Nov 2026. Read-only inspection; no real DB/network actions and no application edits. Findings describe this moving snapshot. The companion agent-authority and UX reviews own detailed tool/security and screen design. This report asks whether the parts can remain correct and understandable as the project grows.

## Direction

Keep the modular monolith, Postgres, typed contracts, domain services and one public tool registry. **Do not rewrite into microservices.** The sound architecture is a small authoritative purchasing engine with several clients and read models. Today some clients still implement a second purchasing engine, some services hold transactions around external reads, and national-scale concepts are being represented as demo kitchens. Those boundaries—not more folders or SDKs—determine maintainability.

“All Finland” should mean progressively broader **discoverable, mapped and operationally supported kitchens**, with the coverage of each capability visible. It must not mean that every public venue becomes an autonomous buyer because the map contains its coordinates. The 3,560 venues are public locations, not customers; only 15 have extracted menus and most covers are estimated ([venues.md:5](../../research/venues.md#L5), [field coverage](../../research/venues.md#L24)).

## Quality findings

### 1. Transaction purity is documented but violated in important paths

The store locks a workspace, then loads its state and runs service logic ([drizzle-store.ts:202](../../../src/lib/server/store/drizzle-store.ts#L202)). `plan_event`/`edit_line` call `requote` from inside that transaction, and `requote` performs catalogue queries through the non-transactional port ([events.ts:100](../../../src/lib/core/services/events.ts#L100), [143](../../../src/lib/core/services/events.ts#L143), [251](../../../src/lib/core/services/events.ts#L251)). The simulator also calls `catalog.offers` while consuming stock in a transaction ([stock.ts:24](../../../src/lib/server/adapters/simulator/stock.ts#L24)).

**Implication:** the ordinary API is fast enough to hide this, but three transactions can occupy the three pooled connections while waiting for catalogue work requesting another connection ([client.ts:39](../../../src/lib/server/db/client.ts#L39)). Workspace-lock waiters themselves hold connections. This is a code-inspected pool-starvation/deadlock risk, not a reproduced load result. Wiring remote Decisions/web calls into the same pattern would make it worse.

**Fix:** prepare offers/products/model judgements outside the transaction; enter with immutable prepared inputs, re-read plan/mandate versions and authoritative stock inside, apply the command or return a conflict. Local queries that truly need the transaction must use its handle. **Now: 1–2 h** for event/edit/stock boundaries plus a tiny-pool concurrency regression. **Gate:** three concurrent edits/commits complete or return bounded typed conflicts without waiting for a spare DB connection; no external network call occurs while a business lock is held.

### 2. Live Kitchen is now real; fallback still changes the domain engine

**Credit `451a713`:** live is now the default, calls are mediated server-side without a browser secret, and the new `live-view.ts` renders real plan/ranking facts. The previous “refresh always reads the browser fixture” gap is resolved. A separate browser planner/ranker/approval implementation remains in `fixture-plan.ts`/`fixture-server.ts`; [backend.ts:16](../../../src/lib/kitchen/backend.ts#L16) catches any live snapshot failure and switches the rest of the session to that engine.

**Implication:** a labelled offline path is useful, but a transient 500 after a successful commit can switch the screen to an unrelated basket. “Retry” might then retry a different engine, and later state/rule changes still require parallel implementations. Separate “network unavailable,” “command outcome unknown,” and “start an isolated fixture demonstration.”

**Fix:** keep fixture **data/adapters**, retire fixture **business logic** from the served purchasing journey. Offline mode should run the same application/service with PGlite; entering a separate browser demonstration must be explicit and isolated. Keep the new presentation transform separate from policy. **Now: 0.5–1 h for explicit fallback/reconciliation; pilot cleanup: 0.5 day. Gate:** identical commands against fixture server and real server produce equivalent normalized plans/receipts; losing a commit response leads to read/retry with the same key, never a different basket.

**Additional live boundary:** [live.ts:43](../../../src/lib/server/kitchen/live.ts#L43) `ensurePlan` creates a plan and proposes rescues; [snapshot:80](../../../src/lib/server/kitchen/live.ts#L80) calls it while serving a snapshot read. The module's selected kitchen/preset/contention state is global ([line 24](../../../src/lib/server/kitchen/live.ts#L24)). Make initial planning an explicit command, keep snapshot GET side-effect free, and scope UI selection by session/site. Otherwise polling/preview can initiate model work and one visitor can change another's kitchen. **Before public multi-user use: 1–2 h; gate:** refreshing a snapshot adds no ops/model calls and two sessions keep independent selections.

### 3. Full-workspace reconstruction will become the national bottleneck

Every mutation loads all plans for the active run, all workspace approvals and orders, and relevant ops, then iterates all resulting plans/approvals/orders to persist differences ([drizzle-store.ts:31](../../../src/lib/server/store/drizzle-store.ts#L31), [50](../../../src/lib/server/store/drizzle-store.ts#L50), [98](../../../src/lib/server/store/drizzle-store.ts#L98)). Workspace-wide locking provides a simple safe sequence today; putting every Finnish kitchen in one Valio workspace serializes their writes and makes each write more expensive as history grows.

**Fix now:** keep this simple lock for Ring 0, instrument transaction duration/loaded row counts, cap the active demo dataset. **Before a multi-site pilot:** command repositories should load the affected plan, approval, kitchen-week budget and stock rows only; update affected records explicitly. Keep a small per-workspace event-sequence transaction if needed, rather than using full-world reconstruction as the command unit. Read dashboards from paginated/materialized summaries, not `WorkspaceState` for the whole country. **Pilot: 1–2 days. Gate:** loading an old year of orders does not materially increase the latency/row count of editing one new plan; two independent kitchens can make progress concurrently.

### 4. Reset recovery is not yet a durable run lifecycle

The new reset correctly creates a new run without deleting audit history. But current run is an in-process map loaded from newest run on boot ([run.ts:16](../../../src/lib/server/demo/run.ts#L16), [33](../../../src/lib/server/demo/run.ts#L33)); simulator overrides are also product-keyed in-process maps ([overlay.ts:19](../../../src/lib/server/adapters/simulator/overlay.ts#L19)). A second instance may retain an old run/overlay. Quotes lack run scope even though consumed stock has it. Budget rows intentionally include run ID ([schema.ts:150](../../../src/lib/server/db/schema.ts#L150)); this is right for independent experiments, not a production mechanism for resetting real weekly spend.

There is also a concrete replay trap: `catchUp` limits the workspace's old ops **before** filtering by current run ([bus/index.ts:101](../../../src/lib/server/bus/index.ts#L101)). Once 1,000 old-run events precede the current run, a client starting at zero can see no current events and never advance.

**Fix now: 0.5–1 h:** filter run in the SQL reader before pagination; test >1,000 historical ops plus a fresh run. Keep one app instance for stage and cancel/refuse stale in-flight commands after reset. **Pilot:** durable `activeRun`/run status/version with cross-instance invalidation; scope overlays by workspace/run; separate `simulationRunId` from operational budget/accounting identity. **Gate:** reset/restart/reconnect yields the same current run on both clients; an old agent cannot write into the new run; a demo reset cannot erase pilot spend.

### 5. Enrichment has an op type, not yet a complete data product

`RecordEnrichment` adds suggestions to reducer state ([state.ts:259](../../../src/lib/core/state.ts#L259)), but store load/persist do not reload/persist that suggestion projection and catalogue reads only `products.doc`. Adding an API around the op is insufficient to make a reusable enriched catalogue. `Jobs.enqueue` also has only a name and unknown input, with no status, attempts, idempotency or partial-result contract ([ports.ts:99](../../../src/lib/core/ports.ts#L99)).

**Fix before a useful batch:** define job lifecycle `queued|running|partial|succeeded|failed|cancelled`, schema version, deduplication key, scope, attempt and progress denominator. Store field-level suggestion/evidence records; review/publish into a new catalogue version through an authorized command. A model's inferred pack/allergen value must not become a verified fact merely because a job succeeded. **Ring 2: 2–4 h for minimal durable job/results seam; pilot review/publishing: 1 day. Gate:** restart midway, retry the job and reload—the same validated suggestions remain, no duplicates; accepted changes affect new plans, never silently rewrite an approved order.

### 6. Contracts validate shape, but domain invariants and document evolution need explicit ownership

The shared registry and output validation are valuable ([serve.ts:95](../../../src/lib/server/tools/serve.ts#L95), [115](../../../src/lib/server/tools/serve.ts#L115)). They cannot establish invariants such as “these units are compatible” or “this is the only active replacement.” Domain validation belongs in one function reused by prepare/commit/ranking and covered by invariant tests. Persistence currently casts JSONB documents using `as any` rather than validating/upgrading stored versions ([drizzle-store.ts:45](../../../src/lib/server/store/drizzle-store.ts#L45)); no document/event schema version is present.

**Fix now:** retain the lead-owned validator and regression repairs from round 3; do not introduce a general rule engine. **Pilot:** add document/event schema versions, checked deserialization with a migration/upcast path and actionable corruption errors. Review stable facts vs derived projections explicitly. **Gate:** a previous-release plan can be loaded or produces an intentional migration error; changing one constraint does not require divergent edits in three rule implementations. Do not mistake a passing schema parse for a valid purchase.

### 7. Provenance needs to drive policy and freshness, not merely a chip

The provenance schema gives source, optional time/ref/note ([primitives.ts:67](../../../src/lib/core/contracts/primitives.ts#L67)). Production PG catalogue uses one configured customer and intentionally ignores the requested date for the static mock ([pg.ts:50](../../../src/lib/server/adapters/catalog/pg.ts#L50), [92](../../../src/lib/server/adapters/catalog/pg.ts#L92)); `Catalog.offers(ids, deliverBy)` has no authenticated buyer/location/delivery-agreement context. That cannot safely become customer-specific national ordering by swapping one URL.

**Fix now:** honest cached/simulated labels and expiry guards. **Pilot:** `OfferContext {buyerAccountId, deliverySiteId, requestedDate, supplierContractId}` server-derived from membership, explicit freshness/validity, field source and verification status. Separate observed supplier availability from simulated ATP and customer-order promises. **Gate:** the same SKU can return different valid offers for two buyers without cache leakage; expired evidence cannot satisfy a required fact; a web source cannot override supplier price authority. Availability, supplier acceptance, delivery and receiving must remain distinct states.

### 8. A national venue catalogue is not a tenancy or purchasing model

`Kitchen` currently conflates profile, physical location and purchasing policy; the DB has no venue/organization/site membership or service-area entities ([schema.ts:42](../../../src/lib/server/db/schema.ts#L42)). Research proposes seeding kitchens directly from OSM IDs ([venues.md, app use](../../research/venues.md#L51)). This is useful for simulation, but nationally it mixes discovered businesses, hypothesized kitchens, onboarded customers and contracted delivery sites.

**Minimal evolution:** `Venue` (public place and source identity) → `Organization`/chain → `KitchenSite` (operational location) → `BuyerAccount` and `SupplierAgreement` → memberships/policies. Add external identity mappings so a changed OSM record or chain menu URL does not become a new customer. `DataReadiness` is per site and capability: located, menu verified, recipe mapping reviewed, delivery configured, mandate verified, shadow-ready, act-enabled. Real records and synthetic demand stay distinguishable in every export.

**Now:** show nationwide coverage as a labelled discovery/readiness view over the dataset; purchase only for the verified demo sites. **Pilot/national: evolve the entities when real onboarding begins, 1–3 days initially. Gate:** an operator can explain why a venue is not yet orderable, resolve its missing evidence and see it progress; merely adding a point never grants authority or manufactures recipes/covers.

## A quality ladder for systems, not a presence checklist

| Stage | Necessary quality proof |
|---|---|
| Hackathon Ring 0 | One authority and one purchasing semantics across UI/MCP; no silent production stubs; deterministic offline path; hostile input and retry checks; exact persisted receipt and explicit unresolved demand |
| Rings 1–2 | Web/job signals have scope, stable IDs, lifecycle and durable replay; deduplication and provenance; useful batch results survive restart and do not modify approved terms |
| 3–5 site shadow pilot | Explicit buyer/site identities; versioned policies/data; per-plan transactions; source freshness; operational receiving/short-delivery loop; discrepancy repair and human ownership |
| Multi-region Finland | Coverage/readiness admission, buyer-specific delivery/service agreements, paginated operational read models, isolated quotas, measured load/failure recovery, cross-instance run/config consistency |

“Maintainable” means a new request input, supplier adapter or customer surface can reuse the same command semantics, and its owner can predict which contract and test changes are required. It does not mean maximizing abstractions, comments or test count.

## Work packages for the lead

1. **Before the next broad merge:** transaction prepare/commit boundary and the run-filter replay regression (1.5–3 h total). Keep these changes narrowly owned by core-db/ops; no redesign of the entire store.
2. **Finish live Kitchen as a semantics consolidation:** credit the new server view model/default live path; separate read snapshots from planning commands, scope session selection and make engine fallback explicit (1–2 h incremental). Agent/UI parity tests must use the served tool registry at least once, not only direct service calls.
3. **Before the first enrichment job:** durable job/suggestion API, schema versions and scoped retry/deduplication (2–4 h). No direct Modal DB writer and no new model-derived safety authority.
4. **Write a short growth contract before national UI:** venue/site/buyer/readiness concepts and source IDs; agree which are actual records versus simulation (1–2 h design, not implementation). Parent roadmap/UX review supplies the user journeys.
5. **After the hackathon:** targeted repositories/read models and versioned document evolution, following measured load and pilot incidents. Do not split into services until independent scaling/ownership actually requires it.

## Rechecked round-3 changes and limits

At this snapshot, the ordinary-suite DB guard is explicit both in `dbMode` and `sql` ([client.ts:15](../../../src/lib/server/db/client.ts#L15), [52](../../../src/lib/server/db/client.ts#L52)); do not repeat the old isolation failure as open. Production tools now serve real handlers without stub fallback ([handlers.ts:82](../../../src/lib/server/tools/handlers.ts#L82)). `createDecide` is wired in `realHandlers` ([handlers.ts:62](../../../src/lib/server/tools/handlers.ts#L62)); served impact and batching quality still need evidence, but “adapter never constructed” is stale. The new current-run/reset infrastructure is real progress; the replay and multi-process boundaries above are what remain. At `451a713`, event delivery now subtracts two days and normal product substitutes resize after portion edits; make-in-house ingredients are excluded from that resize. The new `events → substitutes → events` import cycle is a small refactor signal: move shared pure sizing into `core/demand`, not another service wrapper. Transaction/catalogue boundaries in finding 1 are unchanged.

No benchmark, real-Postgres race or UI observation was performed for this systems report. Load/latency numbers above are proposed checks, not measured results. Preserve the existing pure core, typed ports, explicit order authority, op provenance and single deploy; strengthen their semantics rather than replacing the stack.
