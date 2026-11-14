# Preparation for the holistic interactive roadmap

14 November 2026, repo snapshot `75cc674`. **Preparation only:** no complete scope audit, final taxonomy, schedule, roadmap JSON or viewer implementation was produced. This note preserves context for the next turn while implementation continues elsewhere.

## Confirmed deliverable and boundaries

- The roadmap is separate from Mandate's product UI. The user already has a deployed roadmap viewer; produce compatible repo-local JSON next turn for opening there, with Codex as the working environment.
- The reference is `C:/Users/jiaqi/Downloads/Roadmap 2026-11 Working plan.json`. It was parsed to inspect its structure, not copied into this repo. Its unrelated project content and roster are not inputs to Mandate's roadmap.
- Recurring work matters, but must not become the organizing assumption for everything. Inventory the whole product: direct requests, recurring operations, one-off events, disruptions, evidence, decisions, execution, client/company experiences, agents, underlying systems, evaluation and growth.
- The next turn should reconcile current code, active dispatch, tests and future vision. A proposal in a document, a schema in core, an implemented handler, a passing fixture and a deployed journey are different evidence states.

## What the repo intends, and what the scan established

| Area | Existing source / structure | What it means for the next review |
|---|---|---|
| Product and personas | [PRODUCT](../concept/PRODUCT.md), [CONCEPT](../concept/CONCEPT.md) | Kitchen purchaser, exec chef, company/account operations and outside agent developer have different jobs over related data. Some historical scope/status claims need reconciliation. |
| Interaction model and sitemap | [SURFACES §§4–8](../concept/SURFACES.md) | Already proposes Kitchen → Week → standing order/layers/lines; Decisions, immutable Orders/receipts; company Cases. Includes Inbox, Week, Orders, Standing, Mandate, Activity and Ops detail pages. This is vision, not an inventory of shipped routes. |
| Actual navigation | [root layout](../../src/routes/+layout.svelte), route tree | Current global nav is Kitchen, Request, Operations. Kitchen is largely event-centered; proposed site/period navigation is much broader. Agent routes/tools and visitor work are in flight. |
| Routine context | [Kitchen contract](../../src/lib/core/contracts/kitchen.ts), [kitchen seeds](../../fixtures/seeds/kitchens.json) | Delivery days, menu-cycle metadata, weights, constraints, mandate and `usualProducts` exist. `usualProducts` is SKU familiarity for policy, not a recurring schedule with quantities, occurrences and exceptions. |
| Baseline presentation | [fixture-plan](../../src/lib/kitchen/fixture-plan.ts), [live-view](../../src/lib/kitchen/live-view.ts) | `NORMAL_WEEK` contains scenario totals/quantities used for comparison. Do not mark a recurring-order engine complete merely because a baseline appears on screen. |
| Period variation | [calendar JSON](../../fixtures/seeds/calendar-factors.json), [factors](../../src/lib/core/demand/factors.ts) | Factors have date ranges, affected cover keys, source/value kind and sensitivity; closures override demand. Useful primitives; their existence does not prove full period-to-period forecasting or scheduling. |
| Events and physical demand | [event seed schema](../../src/lib/core/demand/event-seed.ts), [event calculation](../../src/lib/core/demand/event.ts), [new menu contract](../../src/lib/core/contracts/event.ts) | Seeded event → physical need → rounded purchases exists; arbitrary menu proposal/review/plan and stable identity are being expanded. Keep demand, sales quantities and evidence separate. |
| Durable facts | [DB schema](../../src/lib/server/db/schema.ts), core contracts/store | Workspaces, kitchens, plans, approvals, orders, ops, run-scoped simulator stock and evidence projections support the current spine. Discovery/Organization/Site/BuyerAccount and production recurrence are not interchangeable with demo workspace/run identity. |
| Future growth | [GROWTH](../concept/GROWTH.md) | Distinguishes venue, organization, kitchen site, buyer account, agreement, grants and capability readiness. Discovery/estimation first, connected purchasing later. |
| Active delivery | [STATUS](../STATUS.md), [SYNTHESIS §8](../handoff/SYNTHESIS.md), lane dispatches | T0 and A–G are the current execution context. Preserve their decisions; do not create a competing lane plan in the roadmap. |
| Quality evidence | [evals](../../evals/README.md), [F lane](../lanes/f-evals.md), tests, prior reviews | New evals include explicit expected-failure markers; some retrieval/live/real-Postgres checks are conditional. A green aggregate cannot be treated as proof every criterion passed without qualification. |

## Holistic questions to carry into the full pass

These are review dimensions, not a finalized menu of pages or a commitment to build them all now.

1. **Work lifecycle:** capture intent → clarify → propose → compare/edit → review/authorize → submit → supplier result → receiving/reconciliation where supported. Include rejection, cancellation, retry and resume.
2. **Patterns of demand:** one-off purchase, event/menu, standing template, recurring occurrence, expected variation, drift and sudden disruption. Distinguish an intentional plan change from an anomaly.
3. **Time/context:** client/site, selected operational period, service date, delivery date, cutoff, offer validity, policy version, scenario time, model run and history. These are distinct axes.
4. **Client usefulness:** see what is due, what changed from expected, what needs a decision, what remains unconfirmed and what can be delegated; revisit older plans and upcoming periods without losing context.
5. **Company usefulness:** monitor affected customers and causes, coordinate recovery, resolve catalogue/evidence gaps, inspect agent failures and readiness. Ops casework, account administration and internal development/evaluation should have deliberate boundaries.
6. **Progressive disclosure:** portfolio/site overview → period/work queue → task/decision → need/line → evidence/calculation/audit. Define stable identities/deep links and allowed actions at each level, not merely more pages.
7. **Foundations:** units, requirements, dependency composition, authority, provenance, freshness, persistence, integrations, agent context, recovery, cost/performance and accessibility.
8. **Growth:** onboarding, connected-account authority, learned preferences with review, receiving feedback, multi-site work, discovery/enrichment and future providers. Mark assumptions and readiness gates.

For recurrence specifically, inspect the future distinction between **template**, **effective-dated template revision**, **dated occurrence**, **local override** and **approved baseline update**. A shortage substitution this week should not silently rewrite all future periods. Conversely, do not force an ad-hoc request or one-off event into a recurring template. This is one domain seam among the others above.

## Reference JSON format: observed schema 3

Root fields: `schema`, `title`, `subtitle`, `lanes`, `items`, `columns`, `zBands`, `milestones`, `savedViews`, `meta`, `roster`. Both `schema` and `meta.schemaVersion` are `3` in the working example.

| Structure | Observed fields / purpose |
|---|---|
| Lane | `id`, `title`, `color` — presentation grouping |
| Item identity/content | `id`, `title`, `detail`, `notes`, `link`, `epic`, `laneId`, `parentId` |
| Item planning/classification | `status`, `owner`, `tags`, `scope`, `effort`, `confidence`, `parked`, `rank` |
| Item relations | `parentId` for nesting; `dependsOn` array of string IDs for prerequisites. Do not use dependency arrows merely to mean “related to.” |
| Item layout | `collapsed`, `start`, `span`, `track`, `emphasis`, `visibility`, `color`, `altitude`, `structX`, `stackOrder` |
| Columns | `label`, `sublabel`, `start`, `span` — example uses Promise/Intent/Direction horizons |
| Altitude bands | `label`, `min`, `max` — example distinguishes Task/Epic/Vision |
| Milestone | `id`, `label`, `start`, `kind`, `visibility`, `dependsOn`, `decidedOn`, `criteria` array |
| Saved view | `id`, `name`, `author`, `status`, `savedAt`, `config` |
| Metadata/roster | `meta` has version/timestamps/author/owner/archive fields; roster entries have name/fullName/role/team/email. Use Mandate roles or known owners as appropriate; no unrelated personal data. |

Observed item statuses: `proposed`, `exploring`, `planned`, `started`, `done`, `deferred`. Emphasis: `normal`, `minor`, `highlight`; visibility: `internal`, `external`; effort: empty or S/M/L; confidence includes `defended`, `estimated`, `unknown` and null. Treat these as observed values, not an independently verified exhaustive renderer schema.

Saved views support layouts `summary`, `quarter`, `timeline`; grouping by lane, owner, scope, family, altitude or tag; coloring by lane/scope/status/tag; filters on lanes/owners/scopes/statuses/tags/altitude/focus/gaps; depth, density, details and dependencies. Window configuration includes `anchorMode`, `{year, month}` start and month count. Focus includes `lens` and `root`.

**Compatibility cautions for next turn:** `start` can be fractional, not just integer; item time coordinates and horizon-column offsets use different scales in the example. Resolve time encoding and month indexing against the actual viewer before assigning dates. `altitude` is a presentation/abstraction dimension, not completion percentage. Do not infer additional accepted enum values or promise arbitrary extra fields will render. An older Downloads editor brief describes a different shape, so the working schema-3 file is the stronger reference. The deployed viewer was not opened or tested in this preparation turn.

## Proposed content discipline, to decide next turn

- **Title:** a concise capability or user outcome; avoid vague names such as “agent stuff,” technology-only labels or a long acceptance checklist.
- **Detail:** what problem this scope solves, for whom, its boundaries and its relation to the parent outcome.
- **Notes:** structured labelled prose for Current evidence; Missing/uncertain; Acceptance/quality criteria; Dependencies/integration; Future extension. Preserve the existing string field unless the viewer supports a richer shape.
- **Status:** implementation state; keep delivery evidence and confidence explicit in notes/tags. “Done” must have a source and an applicable quality gate.
- **Parent vs lane vs scope vs tags:** decide their independent meanings before filling hundreds of items. Nesting expresses composition; lane provides a primary view; tags can express secondary personas/surfaces/domain/ring/quality attributes.
- **Link:** a concrete repo evidence/spec anchor. Decide how the deployed viewer resolves repo-local links; a local filesystem path is not automatically usable on a hosted page.
- **Milestone criteria:** observable cross-scope quality gates, with honest pending/conditional evidence. Distinguish decisions, deadlines and acceptance gates.
- **Dependencies:** small, justified prerequisite edges; cross-cutting relations may be represented by shared tags/notes if the format has no separate relationship type. Validate IDs, parent chains and dependency cycles.
- **Saved views:** candidate lenses include product vision, client journeys, company journeys, foundations/quality, current execution and future growth. They must be different projections of one inventory, not duplicate copies with diverging statuses.

Keep the development roadmap's time axis separate from the product's kitchen/delivery timeline. The viewer's month-based presentation may suit longer horizons better than hour-by-hour hackathon execution; do not manufacture precise dates to fill it.

## Next-turn starting procedure

1. Re-read latest STATUS/dispatch and git changes; this repo is moving quickly.
2. Inventory completed, partial, active, proposed and parked work from code plus evidence. Reconcile older vision/sitemap documents against current decisions without treating either as wholly disposable.
3. Agree a small scope hierarchy and field conventions, then map journeys, entities, surfaces, components, systems, quality and dependencies onto it.
4. Generate schema-3-compatible JSON in the repo, validate structure/references and preserve uncertain timing/status honestly.
5. Open/import it in the user's existing viewer and inspect nesting, filters, saved views and links. Refine the artifact based on that result; do not build a replacement viewer.

This note is the handoff for that work, not the roadmap itself.
