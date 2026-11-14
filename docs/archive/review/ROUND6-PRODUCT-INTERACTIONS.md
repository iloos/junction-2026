# Round 6: product interactions before the redesign

Source review, 14 November 2026. Started at `4c6b156` plus the lead's staged T0 contracts; T0 was committed during review and the final checkout was `da09d47`. No rendered interface, network journey or live database was inspected. This is product direction and contract guidance, not a visual/accessibility certification. Authoritative dispatch is [SYNTHESIS §8](../handoff/SYNTHESIS.md#8-dispatch-authoritative-from-t0); older SURFACES proposals are direction, not additional active assignments.

## The opportunity

The strongest product is **a purchasing workbench in which any agent can prepare work, the kitchen delegates within explicit boundaries, and every exception has an intelligible next action**. That is a platform: shared identity, authority, state and evidence behind several useful surfaces. SaaS is a distribution/business model, not what makes this a platform. It need not mean a separate app for every persona.

The reported crowded track increases the importance of a judge changing something and seeing a meaningful consequence. An extra dashboard or model logo cannot establish this. The product's existing proposition is stronger: exceptions repaired under the customer's mandate ([PRODUCT:87–95](../concept/PRODUCT.md#5-value-proposition-and-story)). Make that behaviour visible across the agent, Kitchen and Ops. The following six opportunities support that proposition without reopening old round-5 bug lists.

## 1. Give objects one meaning and verbs one consequence

Adopt one content dictionary across headings, buttons, tools, traces and pitch. **Request** is what someone wants; **menu proposal** is an estimated interpretation awaiting chef review; **plan** is the calculated purchasing proposal; **decision** is a human judgement about a reason group; **approval** grants bounded authority over exact terms; **commit** creates a durable order; **receipt** records its result. **Supplier-confirmed** describes supply evidence, never merely a completed tool call.

T0 provides the right separations: `proposed → chef_reviewed → planned` ([event.ts:5](../../src/lib/core/contracts/event.ts)), `reviewable` versus `committable`, and the exact fulfilment partition ([plan.ts:129](../../src/lib/core/contracts/plan.ts)). Current Request calls its third pre-commit step “Order” ([request page:699](../../src/routes/request/+page.svelte)); a future content pass should call this “Review plan”, reserving “Order” for the durable outcome. This is a naming decision, not a request for a redesign now.

**Gate:** five unfamiliar readers correctly distinguish “chef-reviewed menu”, “approved terms”, “committed order” and “confirmed supply” from representative cards. No “all done” headline may hide an unresolved requirement.

## 2. Demonstrate delegation through meaningful restraint

A compelling first screen says “Routine within your mandate; two decisions need you before 17:00”, rather than making every line look equally actionable. The chef's job is protecting service, not inspecting a tool transcript. SURFACES already identifies baseline familiarity and reason-group Decisions as the mechanism ([§3–4](../concept/SURFACES.md#3-what-the-current-build-shows-deployed-14-nov)).

**Journey:** a familiar item stays inside delegated authority; a new event product needs purchasing judgement; missing dietary evidence requests resolution rather than a permissive approval. Explain what will happen if the chef does nothing. Group only lines that share the same judgement, preserving line-level terms and authority.

**Gate:** a three-group scenario proves that approving one group cannot grant another; edits show which permission became stale; an evidence gap never becomes acceptable just because a human pressed approve. Measure decisions per plan and unnecessary interruptions, alongside safety failures. Fewer clicks alone is a poor success metric.

## 3. Make the judge perform a causal experiment

The distinctive interaction is not “watch an agent think”. It is **same shortage, different mandate, explainable outcome**. The Kitchen already exposes an event diff, editable dish demand, rescue and Why ([KitchenScreen:363–604](../../src/routes/(kitchen)/KitchenScreen.svelte)); deepen that chain instead of adding detached showcase panels.

**Journey:** judge changes Finnish origin from preference to requirement, or changes guests/portion. Show demand, packs/excess, candidate eligibility, cost and decision changes together. Explain one attractive rejected alternative with its actual rule. Changing quantities invalidates exact terms visibly. Why should let the chef correct the originating assumption, not merely read it.

**Gate:** three representative kitchens produce justified different outcomes under one disruption; an independent reader can trace a displayed number back to input and evidence. Measured latency and fallback mode remain inspectable; do not fabricate carbon precision or savings.

## 4. Keep one task continuous across several doors

Keep Kitchen as the workbench, Request as an entry/interpretation path, and the external agent as another entry path. Ops is oversight. Approval is an action on the same plan, wherever the person arrived from. T0's `ResultMeta`, exact-plan locator and planned `get_context` support this direction ([tools.ts:27](../../src/lib/core/contracts/tools.ts), [tools-next.ts:29](../../src/lib/core/contracts/tools-next.ts), SYNTHESIS §8).

**Journey:** outside agent requests milk → chef opens the exact plan on a phone → approves → agent resumes → both see one receipt. Separately, an arbitrary dinner becomes a chef-reviewed menu, then deterministic demand; edits stay attached to stable dish/ingredient ids. The active dispatch retains approval in Kitchen this weekend; a standalone approval page and ubiquitous composer are later options, not prerequisites.

**Gate:** reload, handoff, stale revision and retry preserve task identity and expose a recoverable next action. The human should never need to reconstruct context from a trace. Agent scope and menu-review authority must be server-enforced rather than inferred from a submitted status label.

## 5. Separate operating work from administering the platform

Ops asks: **which service is at risk, why, who acts, by when?** Admin asks: **who may buy, which buyer agreement applies, and which facts are ready for use?** An activity wall is useful evidence, but neither question is answered by event volume alone. Existing Ops presents workspaces, kitchen cards and “What just happened” ([ops page:162–345](../../src/routes/ops/+page.svelte)); evolve toward cause-centred cases without inventing purchasing authority for the operator.

**Journey:** one recall affects several kitchens → one case lists affected plans, evidence, owners and resolution state → operator opens the exact kitchen decision. Later, a steward resolves an ingredient-mapping gap through a versioned review queue.

**Gate:** one source incident does not become dozens of indistinguishable tasks; acknowledgement is distinct from resolution; Ops visibility never implies chef approval rights. Platform admin is a later permissioned surface, not an Ops tab with universal powers.

## 6. Make Finland exploration valuable before purchasing is ready

National exploration and honest simulation deserve their own coherent mode. The repo currently records 3,560 metropolitan venues and 15 menus, not national operational coverage ([venues](../research/venues.md)). Start with searchable list/map, region/segment filters, evidence freshness and venue drilldown. Show observed venues and connected kitchens as separate denominators ([GROWTH](../concept/GROWTH.md)).

**Journey:** explore a venue → inspect public menu and estimated demand → adjust a simulation assumption → see resulting category demand; later its owner supplies context, then completes buyer/delivery/mandate onboarding. Discovery must remain useful without an “Order” button.

**Gate:** an observed venue never gains buyer authority; missing menus remain visible; estimates carry field-level evidence and cannot silently become verified recipes. Nationwide coverage expands by measured ingestion/readiness, while purchasing admission is independently gated.

## Sequence

**Now:** protect T0 semantics and the dispatched three integration waves; use their fixtures as future card contracts. **Hackathon:** prove one causal Kitchen experiment plus one external-agent handoff, with consistent vocabulary and explicit simulation labels. **Pilot:** validate interruption rate, accepted-unedited plans, receiving outcomes and recovery with real chefs. **Later overhaul:** shared live-by-id cards, Inbox/Week/Orders navigation, contextual composition, cause-centred Ops and readiness stewardship. This permits a bigger platform whose surfaces each earn their place through a complete user job.
