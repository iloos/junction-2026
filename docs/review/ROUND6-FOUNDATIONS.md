# Round 6 — foundations for a coherent purchasing platform

Read-only source review at main `4c6b156` **plus the staged T0 contracts**, 14 Nov 2026. No application edits, network/shared-DB actions or broad test run. This reviews the underlying product model, not another fan-out readiness checklist. Staged types are proposals, not proof their handlers work.

## Direction

Keep the modular monolith and the purchasing domain. The next foundation is a **traceable requirement-to-fulfilment model**: the same requirement should survive interpretation, menu edits, product matching, packaging, approval, ordering and receiving. Kitchen, agent and Operations then become different ways to inspect and act on that model. A larger dashboard or more tools cannot repair meaning lost between those steps.

T0 already improves this substantially: stable proposal/dish/ingredient IDs, explicit estimates, direct physical Needs, separated fulfilment buckets, temporal PlanView and per-line authority. Retain them. Earlier duplicate-selection/null-price/constraint guards, prepare-before-lock, shared sizing and durable enrichment repairs also remain valuable. The following are the next foundations those improvements enable or still require.

## 1. P0 foundation — make the requirement graph explicit

**Evidence:** staged [event.ts:54](../../src/lib/core/contracts/event.ts#L54) adds stable ingredient IDs, but core [Need](../../src/lib/core/contracts/plan.ts#L83) has no proposal/revision/dish/ingredient lineage fields. Event planning still finds a dish by its label ([events.ts:82](../../src/lib/core/services/events.ts#L82)); substitutes identify the original product plus `needId`, not an explicit chosen fulfilment strategy.

**Why it matters:** “same dish, different ingredient,” duplicate dish names and model revisions cannot depend on string matching. Make-in-house and buy-ready-made are alternatives serving a requirement; their ingredient lines are not interchangeable alternatives themselves.

**Before arbitrary menus become active:** preserve `proposalId/revision → dishId → ingredientRequirementId/needId → fulfilmentStrategyId → lineId`. Keep original requested constraints attached to the requirements. One active strategy per requirement; changing strategy supersedes its old uncommitted lines and invalidates affected approvals. Retain immutable order lineage rather than rewriting history.

**Gate:** two identically named dishes and the same SKU used in both can be independently edited, substituted and explained after reload. No array index or label determines which one changes. **Owner:** core + menu; **effort:** 1–2 h contract/fixture work, then implement with the menu track.

## 2. P0 foundation — quantities need one conversion authority

**Evidence:** staged [place_order](../../src/lib/core/contracts/tools.ts#L100) can carry both `qty/unit` and optional physical `amount`. Existing sizing has separate direct/package, dish/yield and make-in-house paths ([sizing.ts](../../src/lib/core/demand/sizing.ts)); [Product](../../src/lib/core/contracts/product.ts#L39) and [Measure](../../src/lib/core/contracts/primitives.ts#L43) hold content and basis, but no contract says what happens when caller-supplied physical amount conflicts with supplied sales quantity.

**Required decision:** physical requirement is the demand authority; sales quantity is its derived proposed purchase, or an explicitly separate manual purchase intent. Reject inconsistent dual inputs instead of choosing whichever field a consumer happens to read. Record conversion content, physical unit, net/drained/served/purchased basis, yield, lot increment and evidence in a calculation result used by all surfaces.

**Gate:** `1 L → 2 × 0.5 L`; drained-weight packs; piece-based recipes; zero demand; excess after lot rounding; and deliberately conflicting `amount`/`qty` inputs. Unknown content produces an unresolved conversion, never a guessed kg value. **Owner:** core/request; **effort:** 1–2 h for the common calculation contract and cases. Avoid an overgeneralized units library or supplier-specific calculations in UI code.

## 3. P0 foundation — fulfilment must compose recipes, not sum unrelated lines

**Evidence:** staged [FulfilmentView](../../src/lib/core/contracts/plan.ts#L194) correctly separates supplier-confirmed, awaiting, planned known/unknown and unresolved demand with excess outside the partition. However, current [Receipt](../../src/lib/core/contracts/plan.ts#L344) identifies product/quantity, not source order line; a make-in-house recipe has several purchase lines for one need. A rule that counts each line once is insufficient if each ingredient is mistakenly treated as independently covering the whole dish.

**Implement one pure allocation function:** alternatives are OR; required recipe components are AND. Recipe-supported portions are bounded by the scarcest required ingredient after conversion/yield. Join receipts through immutable order-line identity; carry that identity on new receipt entries. Allocate required demand once, distinguish oversupply and leave every missing component visible. Receipt confirmation is not physical receiving or food served.

**Gate:** pastry available + filling missing does not fulfil tarts; two partial receipts do not double-count; two dishes sharing a SKU get separate allocations; a Terminal alternative never outranks genuinely available coverage merely by a better numeric score. **Owner:** core/evals; **effort:** 2–3 h. All UI and agent outcome counters consume this function, not local `eligible`/`committed` counts.

## 4. P0 foundation — review status must be an authoritative transition

**Evidence:** staged [PlanEventInput](../../src/lib/core/contracts/tools.ts#L52) accepts a full proposal with `status: chef_reviewed`; [MenuProposal](../../src/lib/core/contracts/event.ts#L100) has stable revision but no reviewing principal, reviewed digest or stored acceptance reference. The current handler still rejects non-seeded planning, so this is an implementation requirement—not a claim of a presently exploitable deployed menu path.

**Required transition:** propose → edit → review an exact revision → deterministic planning. The server records who reviewed which scoped proposal/revision/digest. A caller cannot establish a chef review by submitting that status string. Menu acceptance authorizes using an estimate for planning; it does not verify allergens, grant spending authority or promote it to a trusted recipe KB.

Likewise, staged subset approval now has a useful split/grant/deny description. Implement the complete three-group example from SYNTHESIS §8: sequential grants, one denial, partial commitment, then an edit invalidating remaining grants. **Gate:** no unseen ingredient or order line rides on an earlier review. **Owner:** lead/core/menu; **effort:** 1–2 h for transitions and fixtures before UI consumers depend on them.

## 5. P1 foundation — persist planning documents and their recovery path

**Evidence:** proposal types are staged, but the current [store projection](../../src/lib/server/store/drizzle-store.ts#L31) loads plans, approvals, orders, anomalies and enrichment—not menu proposals or requirement revisions. `Plan` has `eventId` but no proposal-revision link. [withViews](../../src/lib/core/services/handlers.ts#L62) separately reloads current approval state after a command returns its plan, which can mix revisions under concurrent edits.

**Minimal foundation:** persist the planning document and revision before returning a recoverable URL. A plan records the exact accepted source revision. Return a coherent versioned projection with `asOf`, effective authority and typed next actions; if state changed during assembly, retry or return a conflict rather than combine an old plan with new metadata. Add document schema versions and narrow upgrade/validation at stored-JSON boundaries when the first historical schema changes.

**Gate:** reload/open another client resumes the same brief, unanswered questions, accepted menu and exact plan; reset affects only the chosen sandbox; old receipts remain explainable. **Owner:** core/request; **effort:** 1–2 h for minimal document/recovery seam, broader migration tooling after the event. No need to rebuild everything as event sourcing.

## 6. P1 foundation — evidence and capability readiness must constrain actions

**Evidence:** [Provenance](../../src/lib/core/contracts/primitives.ts#L70) names source/time/ref/note; staged `claimedCompatible` correctly avoids treating model output as a diet certificate. `tools-next.ts` keeps planned tools out of discovery until handlers exist—retain that discipline. Yet field source alone does not establish freshness, verification or that a kitchen is operationally ready.

**Product opportunity:** model readiness by capability: location known, menu current, ingredient mapping reviewed, delivery agreement configured, policy accepted, shadow-ready, act-enabled. Evidence status governs each admission. A public venue is discoverable, not automatically a purchaser; a chef-entered number is editable demand, not a safety fact. Keep these statuses visible to admin/Operations and actionable as missing-evidence tasks.

**Gate:** adding a venue or model-derived menu never grants ordering authority; an expired or contradictory required fact blocks only the affected capability and names the resolution. **Owner:** core/catalogue + operator surface; **effort:** 1 h to pin the readiness vocabulary now, implementation during pilot onboarding/nationwide expansion.

## Execution guidance

Do not add these as a second parallel architecture plan. Fold the first four into A's requirement/sizing/fulfilment and B's menu contracts, with F writing independent valid/invalid fixtures first. Let C and E consume those fixtures now; do not make them invent fallback definitions. Keep source adapters, generative proposals, deterministic planning, command authority and projections as distinct modules with one owner each. This provides the foundation for a powerful platform while keeping each new surface a client of the same purchasing truth.
