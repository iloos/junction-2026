# History, memory and tenancy: the temporal shape of the system

_Sat 14 Nov, design session. A proposal for the lead; not claimed as built. Builds on [concept/GROWTH.md](../concept/GROWTH.md) ("authority comes from grants, never from data", "runs are for simulation") and the mockups `scratch/ux-mock/rhythm.html` (Usual order) and `engine.html` (Forecast). Memory here is not one feature: it is how the system keeps and uses time._

## Where we are
- **Isolation is good.** Every record and op carries `workspaceId` + `runId` and a server-derived actor; tools pass one gate; keys are hashed and scoped; judge keys are bound to one visitor workspace.
- **The record exists, little reads it back.** The op log holds plans, edits, offers, substitutes, approvals, commits, anomalies and enrichments with actor, door and seq. Per kitchen the system reads back only `Kitchen.usualProducts` (a seed list) and orders in the current run (`orderedBefore` in `core/mandate/tier.ts`). Chef corrections, declined substitutes and what people said in chat are not used again. A sandbox reset starts a new run and the past is out of reach.
- **A run is both simulation and history.** GROWTH rule 5 wants them apart.
- **One clock.** Records carry when they were written, not separately when they were true (a recall valid from 1 Dec but learned on 7 Dec).
- **Tenancy is one level.** A workspace is a demo sandbox, not a tenant; `Kitchen` mixes the site and its policy; Organization, BuyerAccount and Membership exist only in GROWTH.md.
- **Mandate changes are not ops.** The `Op` union has 8 types; `kitchens.mandate_version` bumps outside it, although the schema comment says mandate history lives in the op log. Passed to core (8d).

## The shape: five layers over time
| Layer | What it holds | Examples | Grants authority |
|---|---|---|---|
| **Record** | What happened. Immutable. | Ops; outside events: deliveries, short deliveries, recalls, price changes | No |
| **Patterns** | What usually happens. Derived from the record, recomputed, never edited. | Usual order and how settled it is; supplier reliability per product; seasonality; how far ahead a kitchen plans; which substitutes kitchens accept | No |
| **Knowledge** | What people told us. Each fact has a source and a scope. | "The school never serves pork" (chat); "120 g of ham per guest for buffets" (an edit); a supplier spec (document); a cited web fact | No |
| **Commitments** | What was agreed. | Mandate versions, the standing order, approvals bound to terms | **Yes, only this layer** |
| **Expectations** | What's coming. | Booked events, cut-offs, projected demand, Valio's Forecast | No |

Every fact keeps two times, **when it was true** and **when we learned it**. That gives honest answers to "as of when?", lets any screen show the plan as it was at an earlier version, and lets a summary say "what changed this week".

Every fact has a **scope**: a person (this chef's habits), a kitchen, an organization (the hotel group's policy), or Valio-wide (collective patterns across kitchens, shown in aggregate).

## How a fact moves
Said or seen → **suggested** (with its source) → **confirmed** by a person → optionally made a rule through `set_mandate`. Nothing skips a step, and nothing below Commitments changes what the agent may do alone (GROWTH rule 1). People can see, correct and forget facts about themselves and their kitchen; forgetting matters most for person-scoped facts.

## How agents use it
Agents get the relevant slice, never the whole store. `get_context` (read scope) returns facts chosen by scope, subject and time window for the task at hand: for a buffet plan, the buffet corrections and the usual order; for a ham shortage, which substitutes this kitchen and similar kitchens accepted. Each fact used is cited in the agent's outcome ("using your 120 g from the last buffet"). The in-app agent and outside MCP agents read the same slice through the same gate.

## Insights from history
Summaries computed over the record and patterns, shown where they help a decision rather than on a dashboard of their own:
- Kitchen: "Your usual order settled at about €2,900 a week; oat drink joined it this month."
- Kitchen: "Valio short-delivered this product twice in six weeks; the agent now plans one pack of spare."
- Valio: "Kitchens that lost whole ham mostly chose Palvikinkku; stock for it ran out first."

## Data shape (a sketch, not a contract)
- **Record:** the op log as is, plus outside events as ops (`RecordAnomaly` already covers recalls).
- **Patterns:** pure functions over the record (`usualOrder`, `supplierReliability`, `acceptedSubstitutes`), cached per scope; never stored as truth.
- **Knowledge:** `Fact { scope, subject, claim, source (op seq | chat turn | document | web), validFrom, validTo, learnedAt, confidence, status: suggested | confirmed | retracted }`.
- **Commitments and Expectations:** today's mandate, approvals, events and plans; Forecast as the sum of projections with summed variance.

## What to do, in order of value (nothing changes after Sun 06:00)
**For the demo, if the lead pulls it in.** Each step is additive and pure or read-only:
1. Patterns over the current record: `usualOrder` and `acceptedSubstitutes` as pure functions with tests on the seeded run.
2. The relevant slice in `get_context`, with facts cited in the agent's outcome line.
3. A seeded history labelled "simulated history", so Usual order and Forecast have weeks to read.
4. Forecast from summed projections (feeds ui-mockset-to-prod.md #13).
5. A "what we know about this kitchen" panel: facts with their source, "confirm" and "forget", and "suggest for the standing order" → `set_mandate`.

**After the hackathon:**
6. Facts from chat (suggested, confirmed by the chef) and from documents.
7. Two times on every fact; "as of" views on every screen.
8. History that outlives runs, with simulation runs flagged.
9. Mandate changes as ops.
10. Contract types for Organization / KitchenSite / BuyerAccount / Membership; person-scoped facts tied to memberships.

## Open questions
- How long should a correction last: for one event, for every event of its kind, or until changed?
- Which collective patterns may one kitchen see about others (aggregate only, minimum group size)?
- Is a seeded history honest enough for the pitch if it is labelled "simulated history"?
