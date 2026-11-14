# Round 8: useful flows and measured expansion

Companion to the [architecture findings](ROUND8-ARCHITECTURE.md), based on snapshot `50575b357d8eca076063d739991f80c795af15b9`. “More stores” means kitchen locations and customer accounts. This is a proposed implementation sequence, not a claim that onboarding or live purchasing is already supported.

## Start with a second kitchen's entire journey

The most useful expansion is a non-seeded kitchen reaching a truthful shadow purchasing task. It should exercise identity, account-specific terms, measured requirements, evidence, human review and recovery. Adding only another kitchen fixture would leave the important boundaries untested.

1. **Connect a site.** An owner/admin names the organization, kitchen, delivery location and responsible people. Record a supplier buyer-account mapping and delivery calendar, or state that they are missing. Give each person explicit site permissions. A copied public venue record is a suggestion awaiting an owner connection.
2. **Establish context.** The owner supplies a menu, covers, service date and known constraints. Preserve the original document/input and field-level provenance. Ask for missing quantities or dates before resolving a purchasing task. Public estimates can fill a shadow preview only with visible uncertainty.
3. **Build and review a measured proposal.** Normalize dishes into ingredients with amount, unit, yield/basis and dietary requirements. Resolve products with those requirements attached. Leave unresolved ingredients visible. The chef reviews a stored proposal revision; planning consumes that revision deterministically.
4. **Quote in the site's context.** Associate offers with buyer account, agreement, requested delivery and freshness. If only the sponsor mock's scenario terms are available, show a simulation/shadow result. A live HTTP response is evidence of retrieval, not proof of deliverability for this kitchen.
5. **Create one durable task.** Show required quantities, proposed quantities, excess, missing supply, money and decisions. The same task ID opens from Kitchen, chat, Request, MCP and Ops. The user can compare, amend and return later.
6. **Progress from shadow to execution deliberately.** Connect valid account terms and mandate authority, then review the effect of switching modes. Reviewed data does not itself authorize purchasing. Preserve the receipt, remaining needs and supplier-confirmation status when execution becomes available.

The core modeling vocabulary already exists in [GROWTH.md](../concept/GROWTH.md): Venue, Organization, KitchenSite, BuyerAccount, SupplierAgreement, Mandate, Membership/Grant and DataReadiness. Start by storing the few relationships used by this journey. Avoid empty repositories and management screens for every future entity.

## Make readiness explain an available action

A single opaque readiness score would hide which missing fact matters. Record a small set of concrete facts and reasons:

| Dimension           | Example evidence                                                                  | Resulting capability                               |
| ------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------- |
| Identity            | Public venue observed; owner connection verified separately                       | Discovery preview; then private site workspace     |
| Requirement quality | Menu/recipe revision, covers, measured ingredient amounts, unresolved constraints | Estimate or measured shadow plan                   |
| Commercial context  | Buyer-account mapping, delivery location/calendar, agreement                      | Site-specific quote where the provider supports it |
| Authority           | Active membership and versioned mandate                                           | Read/plan/order/approve according to the grant     |
| Operational truth   | Fresh offer/stock evidence, current cutoff, receipt/confirmation                  | Commit or wait/re-quote, with an exact reason      |

Expose the next missing fact and the action it enables. Readiness can improve as an owner replaces estimates, without changing the person's grant. Freshness expiry may require re-quoting; it should not erase the user's requirement or hide the existing task.

## Live data should improve a decision

Three source-to-action flows have more value than broad provider fan-out:

**Account-specific terms.** Fetch current terms when previewing or rechecking an affected plan. Retain source, fetched time, requested delivery and account/agreement identity with the result. Keep scenario transformations in demo composition. The existing Valio live/cache-through adapter is a useful base; per-account selection and truthful delivery context are the missing pieces.

**A missing product attribute.** For an unresolved catalog field, find an identity-matched source, retain the exact claim and citation, surface conflicts, and let a qualified reviewer accept a versioned fact. Reassess affected plans and show which reasons changed. A name match, search summary or absent allergen mention must never silently clear an unknown. Keep source assertions, accepted facts and purchasing approval as distinct objects.

**A relevant incident.** Accept a notice durably, identify the affected product and scope, attach it to the precise plan/need, and show the resulting action or review. The existing recall ingestion, matching and application identities should be reused after queue durability is fixed. Measure whether a task changes correctly, rather than only counting successful web requests.

Public venue discovery is a separate useful track: source → venue identity → menu observation → estimated demand → shadow basket → owner invitation/context. Its visible denominators are observed venues and connected kitchens. Public observations do not become customer accounts. Sampling a few diverse venues and inspecting their failures will teach more than increasing raw enrichment volume first.

Provider availability should also be independent. `webMode()` currently defaults live only when both Exa and Context.dev keys exist in production. Give each capability an explicit availability/source status so one configured provider can serve its supported work. Do this as runtime composition, with equivalent fixtures and clear fallback labels.

## Give the in-app agent bounded, useful interactions

The new task/chat layer is a strong starting point: it uses existing tools, derives a ledger rather than allowing model-written accounting, and hands approval to the chef. The next work should make these interactions reliable:

| User intent                                | Useful interaction                                                                                             | Required durable result                                                  |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| “I need ingredients for Thursday's lunch.” | Ask the smallest missing question: site, covers, menu or date. Retain already answered constraints.            | Typed requirement and unresolved slots under a task ID                   |
| “What changes if we use this alternative?” | Compare quantities, cost, waste, dietary uncertainty and authority implications; make no selection implicitly. | Two referenced proposal revisions and an explicit active choice          |
| “Make this 180 portions.”                  | Resolve which dish/need, preview all affected ingredients and refreshed terms, then apply the bounded change.  | Versioned amendment with a diff and approval invalidation where required |
| “Why is this waiting?”                     | Explain missing fact, mandate boundary, expired terms or supplier response from current typed state.           | Same next action as the task page and tool metadata                      |
| “Do that again.”                           | Distinguish repeating a previous explanation, retrying an interrupted turn and creating another purchase.      | New intent or retry identity explicitly chosen                           |
| Return after interruption                  | Recover the task, operation result, pending review and receipt; offer the currently valid continuation.        | No transcript-dependent reconstruction or duplicate purchase             |

Use typed active task/site/plan references rather than resolving context from the nearest seeded name. Keep the original user wording, parsed requirement, answered slots and later amendments separate. The current `requirement: Record<string, unknown>` holding `{goal: text}` is a temporary envelope; introduce a versioned task-requirement type based on existing request/menu contracts, rather than making `seeded_event` the universal domain model.

MCP should expose the same task outcome and safe continuation capabilities through the existing registry. The snapshot's `get_outcome`/`propose_menu` schemas were staged; a late source check through `825874d` confirms `get_outcome` is now registered and composed. Build on that integration and verify the complete slice before describing cross-door task parity as finished. Suggested actions should include identifiers, expected versions, available authority and an exact target link. Tool annotations should describe real effects. Capability discovery should reveal what this principal can actually use.

For research assistance, the agent needs more than “three options found.” Give it bounded evidence summaries with identity match, claim type, source/freshness and unresolved conflicts. Preserve external content as untrusted data; deterministic commands, schema checks and grants remain the action boundary. Add bounded research only where it changes the next decision.

## Sequence the work around observable outcomes

| Slice                                               | Concrete completion condition                                                                                                                                  | Main work                                                                                |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **1. Make a task recoverable**                      | Retrying a turn yields one operation; a second explicit task remains independent; a post-commit interruption recovers its receipt                              | Persist/claim turn before effects; operation identity; consistent list/detail projection |
| **2. Admit one extra site in shadow mode**          | A restricted principal sees only its site; absent account/delivery facts prevent operational claims; another site's configuration yields its own quote context | Shared resource checks; access/business context; explicit readiness and mode             |
| **3. Carry one owner-supplied menu through review** | An arbitrary menu becomes measured needs with retained constraints and visible gaps; one approved revision creates the plan                                    | Reuse menu proposal contracts; typed task requirement; recipe/enrichment promotion       |
| **4. Complete the same task through each door**     | Kitchen, chat and MCP agree on quantities, pending decisions, allowed actions and recovery                                                                     | Canonical task query; registry wiring; context and trace parity                          |
| **5. Increase live enrichment and sites**           | A sourced update changes the correct task; failure/retry is durable; no account or mandate is inferred                                                         | Web repository semantics; reassessment; several diverse pilot sites                      |

Slices can overlap by owned paths, but their evidence should follow the dependency order. Discovery enrichment can proceed alongside them because it remains a sourced preview. Generalize only when another real requirement demonstrates that the existing contract cannot express it.

## Verify shape with meaningful variation

Use permutations that cross boundaries: two sites sharing a buyer account, two accounts under one organization, a person allowed at only one site, a non-seeded dish, mixed units, a changed delivery date, partial approval, conflicting evidence and a disconnect after commit. Assert properties: authorized resource only; conserved physical demand; one operation per retry identity; distinct explicit intents; current projection parity; untrusted data never grants authority.

Compare the bounded agent against the scripted baseline on these same tasks. Measure successful useful completion, unnecessary clarification, user corrections, duplicate operations, valid evidence use, cost and recovery. More tool calls, a longer transcript or a model review score alone do not establish usefulness.

The immediate cleanup should support these slices: extract pure decision grouping, remove the small facts/routine import cycle, inventory obsolete stubs, and simplify fixture behavior around canonical projections. Preserve the current modular core and fixture ports. No new framework, microservice split or broad provider abstraction is needed to learn whether the next kitchen works.
