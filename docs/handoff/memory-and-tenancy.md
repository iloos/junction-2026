# Kitchen memory and tenancy: steps toward a clean SaaS shape

_Sat 14 Nov, design session. A proposal for the lead; not claimed as built. Builds on [concept/GROWTH.md](../concept/GROWTH.md) (entities, "authority comes from grants, never from data", "runs are for simulation") and the mockups `scratch/ux-mock/rhythm.html` (Usual order) and `engine.html` (Forecast)._

## Where we are
- **Isolation is good.** Every record and op carries `workspaceId` + `runId` and a server-derived actor; tools pass one gate; keys are hashed and scoped; judge keys are bound to one visitor workspace.
- **Memory is thin.** Per kitchen the system knows `Kitchen.usualProducts` (a seed list, 4 ids on `k-hotel`) and orders in the current run (`orderedBefore` in `core/mandate/tier.ts`). A sandbox reset starts a new run and forgets the rest. Chef corrections (ham 135 → 120 g per guest), declined substitutes and chosen candidates are in the op log but nothing reads them back.
- **A run is both simulation and history.** GROWTH rule 5 wants them apart.
- **Tenancy is one level.** A workspace is a demo sandbox, not a tenant; `Kitchen` mixes the site and its policy; Organization, BuyerAccount and Membership exist only in GROWTH.md.
- **Mandate changes are not ops.** The `Op` union has 8 types (CreatePlan, EditLine, RecordOffer, ProposeSubstitute, RecordApproval, CommitOrder, RecordAnomaly, RecordEnrichment); `kitchens.mandate_version` bumps outside it, although the schema comment says mandate history lives in the op log. Check `set_mandate` before relying on it.

## Proposal
### 1. Memory is a projection of the op log
A pure function in `core/` (no new write path, so `applyOps` stays the only writer):

```
kitchenMemory(ops: OpEnvelope[], kitchenId, asOf) → MemoryFact[]
MemoryFact = { kind: 'usual_item' | 'correction' | 'preference' | 'rejection',
               subject: productId | needId | dishId, value, sentence,
               evidence: seq[], confidence: 0..1, firstSeen, lastSeen }
```
- `usual_item`: from committed lines across delivery dates, scored with the Usual order maths (comes back × steady amount × enough history, recency-weighted).
- `correction`: an `EditLine` by the chef that changes g/guest or quantity on a need the agent sized.
- `preference`: an `EditLine` that swaps to a lower-ranked candidate (the chef chose against the ranking).
- `rejection`: a `RecordApproval` with `denied`, or a substitute replaced by the chef.

Because it is derived, it is reproducible in evals, explainable (every fact names its ops) and costs no migration. Cache it per kitchen if it gets slow.

### 2. Learned facts never grant authority
GROWTH rule 1 holds: a `usual_item` with high confidence is a **suggestion** to add the product to the standing order. Only the chef's `set_mandate` (a new mandate version) changes what the agent may do alone. `orderedBefore` keeps reading the mandate baseline, not memory. The UI says this in one line: "Learned from your orders. Add it to your standing order to let the agent order it alone."

### 3. One memory for every agent
`get_context` returns a short memory summary (usual items with confidence, recent corrections, rejections) under the `read` scope, so the in-app agent and any MCP agent plan from the same facts. Corrections apply as defaults (ham at 120 g for buffets) and are shown as such ("using your 120 g from 7 Dec").

### 4. History outlives runs
Keep runs for simulation. Mark ops and orders from a seeded or synthetic run as `simulation`, and let memory read only non-simulation history plus the current run. For the demo, a "seeded history" run can supply 16 labelled weeks so Usual order and Forecast have data.

### 5. Tenancy seams, types first
Add contract types only: `Organization → KitchenSite → BuyerAccount`, and `Membership { principal, resource, permissions, expiresAt }` (GROWTH's grant list). Map today's records onto them: workspace stays the isolation key, a visitor sandbox is an organization with one site, `Kitchen` splits into `KitchenSite` and its `Mandate`. Keys resolve to a membership instead of a global actor kind when onboarding starts.

### 6. Forecast reads the same memory
Valio's Forecast is the sum over kitchens of ordered + planned + projected demand per product and delivery date, with variance summed across kitchens and a probability of running short against stated stock. Unknown-quantity supply gets no probability ("Valio hasn't said").

## Order of work (nothing changes after Sun 06:00, so the demo parts land before it)
**Wave 2 (~18:00 → ~02:00), if the lead pulls it in; each step is additive and pure or read-only:**
1. `kitchenMemory` + tests on the seeded run (pure core).
2. Memory summary in `get_context` (read scope).
3. Seeded-history run, labelled "simulated history", so Usual order and Forecast have weeks to read.
4. Forecast from summed projections (feeds ui-mockset-to-prod.md #13).
5. Usual order panel: facts with evidence and "Suggest for standing order" → `set_mandate`.

**Post-hackathon:**
6. Simulation flag on runs, history that outlives runs.
7. Mandate changes as ops, if they aren't.
8. Contract types for Organization / KitchenSite / BuyerAccount / Membership.

## Open questions
- Does `set_mandate` write an op today, and should memory facts cite it?
- How long should a correction last: per event type (buffets), per dish, or until changed?
- Is a seeded 16-week history honest enough for the pitch if it is labelled "simulated history"?
