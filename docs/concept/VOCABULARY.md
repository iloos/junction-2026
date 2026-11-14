# Round 6: a shared purchasing vocabulary

_Adopted by [D10](../DECISIONS.md) as the semantic contract for code and copy (written as the round-6 review)._

14 November 2026. Review proposal, not a rename patch. Read against main `4c6b156` plus the in-progress T0 contracts and SYNTHESIS §8. The lead owns adoption. Keep historical documents intelligible; change active types, semantics and projections deliberately rather than replacing words throughout git.

## Why this belongs before a UI overhaul

Names encode business promises. `FulfilmentView.supplierConfirmed` now correctly distinguishes receipt-backed supply from planned stock, but `SupplyTier.confirmed` and `LineView.confirmedCover` still refer to known stock before commitment ([contracts](../../src/lib/core/contracts/plan.ts)). The agent has `confirmedNeeds` and `fulfilled`; Request has its own order/approval views. These are different certainty levels using similar names.

T0's new partition is a substantive fix. Finish the language around it so a model, a UI component and an operator cannot accidentally make a stronger claim than the domain evidence supports.

## Proposed canonical entities

| Term | Precise meaning | Distinguish from |
|---|---|---|
| Purchase request | The buyer's expressed intent, including unresolved requirements | An order or an accepted model interpretation |
| Requirement | Something the requested outcome must satisfy | A preference that ranking may trade off |
| Preference | A weighted preference or a stated default, visible to the user | A hard dietary/origin requirement |
| Event brief | Occasion, covers, date and explicit requirements | A complete recipe or procurement plan |
| Menu proposal | Versioned dishes/ingredients proposed for a brief, with estimate status and open questions | Verified recipe knowledge |
| Need | Physical demand in a defined unit/basis, including unresolved demand | A supplier's pack count |
| Purchase line | One SKU and sales quantity proposed to satisfy a need | A dish, ingredient, need or committed order line |
| Offer | Supplier/account/date-specific observed price, availability and validity | A permanent product fact or a stock reservation |
| Plan | Versioned proposed purchases and their assessed consequences | An immutable placed order |
| Approval | Human authorization of specified exact terms | Supply confirmation or an override of a hard constraint |
| Order | Immutable simulated supplier submission/commit in this hackathon | The mutable plan or a physical delivery |
| Receipt | Supplier-adapter result for an order: confirmed quantities or awaiting supplier | Proof goods were delivered or usable in the kitchen |
| Incident | A detected shortage, recall or other disruption with evidence and affected targets | A generic log event |
| Case | Operator work needed to resolve an incident or decision | A second source of purchasing truth |
| Mandate | The authority delegated to an agent, with limits and non-delegable decisions | Product preferences alone or evidence of safety |

“Kitchen” remains a useful user term. Internally preserve the longer-term Venue / KitchenSite / BuyerAccount distinction in GROWTH; a discovered venue is not an authorized purchasing account.

## Separate the state axes

| Axis | Example states/facts | User-facing question |
|---|---|---|
| Interpretation | incomplete, needs clarification, resolved | Did you understand what I need? |
| Proposal | proposed, chef reviewed, superseded | Is this the menu/plan I chose? |
| Evidence | source-backed, estimated, unknown, conflicting | What supports this fact? |
| Supply | observed known stock, observed unknown stock, unavailable; confirmed by receipt | Can I rely on receiving this amount? |
| Authorization | within mandate, needs approval, approved, forbidden | May the agent buy it? |
| Execution | not submitted, committed, awaiting supplier, failed | What action actually happened? |
| Need fulfilment | supplier confirmed, awaiting supplier, planned known, planned unknown, unresolved; excess separate | How much of my need is accounted for, with what certainty? |
| Freshness | current as of T, expired, superseded, incomplete projection | Is this still true? |

A single status may summarize a task, but it must not erase these axes. For example, an approved plan can still have unknown supply and an expired offer. A committed order can still await supplier confirmation.

## Naming and copy decisions to adopt

- Reserve **supplier confirmed** for quantities backed by receipt evidence. Prefer **known-stock candidate** for the ranking tier currently named `confirmed`, and **planned against known stock** for pre-commit coverage. Existing wire fields can remain temporarily with explicit adapters/deprecation; no broad rename in the middle of parallel implementation.
- Use **planned**, **ordered—awaiting supplier**, and **supplier confirmed** as distinct labels. Use **delivered** only if delivery evidence exists; the hackathon receipt is not delivery evidence.
- Use **needs your approval** only when human authorization can resolve the blocker. Use **missing product evidence**, **no sufficient stock**, **offer expired**, or **requirement unmet** for other causes. “Held” is too broad to be the whole explanation.
- Use **can submit now** for `committable`, with as-of/expiry and the actual permitted action. Do not call it “safe” or “ready for service.”
- Keep **need** and **purchase quantity** separate: “Need 18 kg edible; buy 13 packs × 1.5 kg; 19.5 kg purchased before yield.” Numbers here are illustrative; each actual view must calculate its own amounts and basis.
- Describe **make in-house** as a preparation alternative with ingredient dependencies. It is not a product with one stock flag. Ingredient supply alone does not establish kitchen labor/equipment capacity; disclose assumptions.
- Use **scenario run**, **agent run** and **procurement task** distinctly. A resettable demo context, a bounded model/tool execution and a durable user objective have different lifetimes. Do not use a bare `runId` across these boundaries without naming the kind.
- Distinguish **request budget**, **delegated spend limit**, and **hard limit**. A chef willing to spend more is not automatically authorized to change policy. Explain which amount blocked which action.
- Distinguish **finding**, **suggestion**, **accepted choice**, and **verified catalogue fact**. Accepting an estimated menu does not verify its dietary compatibility or its pack-size source.

## One display/agent projection, several presentations

Create/refine shared typed facts for `reason`, `effect`, `allowedActions`, quantities/bases and source status. Kitchen can use concise labels, Ops can group causes, and MCP can provide structured explanations. Avoid each surface mapping raw states into different business conclusions. Treat the presenter as localization/copy, not another authority engine.

The useful interface is a decision with consequences: “This product is unavailable; two alternatives meet your rules; this one adds a pack; this one awaits supplier confirmation; approval authorizes the exact selected terms.” The user should not need the glossary to operate the app.

## Adoption sequence and gates

1. Lead ratifies the entity/state distinctions in the contracts; domain owners agree on semantic invariants, not just enum spellings.
2. Add a small fixture matrix spanning known/unknown supply × unapproved/approved × uncommitted/committed × fresh/expired. Include missing ingredient and mixed confirmation.
3. Every presenter and agent outcome consumes that matrix. Assert that no pre-commit line is described as supplier confirmed, and an approval never hides a gap.
4. Migrate active types/wire fields with explicit compatibility where required. Keep old persisted documents readable and old op history replayable.
5. Use the same language in onboarding, Why, review, receipts and agent tools; then design the visual hierarchy around those concepts.

This is a product contract with tests and examples, not merely an editorial cleanup.

## "Covers" (user, Sat 14 Nov night)
Never show the trade word **covers** to a person. Say **guests** for an event ("Christmas dinner buffet, 140 guests"), **lunches** or **meals** for a day's service ("Wednesday lunch buffet, 320 lunches"; "School lunch, 2,000 meals"), and **per guest** / **per meal** for sizing ("15.8 kg per meal"). Code may keep `covers` as an internal field name; rendered text, chat, receipts, the site and the tool descriptions agents read may not.
