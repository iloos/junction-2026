# Mandate: adversarial review — GPT-6

Review snapshot: Sat 14 Nov 2026, using the supplied ~00:30 situation. This is a concept/readiness review, not a runtime code audit. Foundation notes may arrive after this snapshot. Estimates below are solo lead hours; savings overlap.

## Verdict

At the **Valio table**, the narrowed concept could contend; today its documented working evidence is zero. At **peer review**, I expect a middling score: “AI ordering assistant” is generic and the payoff arrives too late. On the **grand jury**, breadth will lose to a smaller, undeniable demonstration. The memorable part is an agent rescuing a kitchen while visibly refusing an invalid purchase. Keep Valio; replace the platform ambition with that proof. No alternative challenge in the supplied material clearly justifies a pivot now.

## Ranked findings

### 1. LOSE — You are scheduling a platform before proving a purchase

**Evidence:** [STATUS:7](../STATUS.md#L7) reports no end-to-end path or deployment; [ARCHITECTURE:15](../concept/ARCHITECTURE.md#L15) still has empty contracts. [CONCEPT:39](../concept/CONCEPT.md#L39) promises a kitchen app, control room and external interface; [LESSONS:8](../LESSONS.md#L8) records this team's recurring failure: strong disconnected pieces. Foundation completion is another gate before contracts ([foundations:5](../foundations/README.md#L5)). Thirty elapsed hours are not thirty rested integration hours.

**Fix — 0.5 h to cut; 4–6 h for the first deployed slice:** one kitchen, one delivery, one reviewed recipe, 15–30 verified SKUs, one shortage, one mandate, one receipt. Keep Request → Lookup → pending order → authorization → committed simulated order. Cut arbitrary menus, 20 restaurants, photo/voice input, fridge diagnosis, recalls, whole-catalogue web enrichment, 500 agents and the separate control room. Search may cover the catalogue; automatic quantity conversion need not. Require the deployed slice by Sat 08:00; if late, cancel every stretch integration. Do not spend another night completing foundations for features you should delete.

### 2. LOSE — “Trusted” is currently an audit-log promise, not a commitment protocol

**Evidence:** [SCORECARD:11](../concept/SCORECARD.md#L11) promises fixed-price ordering; [CONCEPT:36](../concept/CONCEPT.md#L36) binds approval to exact lines, but the architecture defines no states or transactions. [DECISIONS:27](../DECISIONS.md#L27) adds concurrent external agents and shared state. An op log explains a double order after it happens; it does not prevent it.

**Fix — 2–3 h:** make the server the sole authority. Commit against a versioned snapshot containing customer, SKU, sales unit, quantity, delivery date, currency and price terms. Changed terms invalidate approval. Enforce mandate limits in code, including cumulative spend so splitting an order cannot evade the cap. Give commits idempotency keys; write order and audit record atomically. Recheck freshness/cut-off before commit; acknowledge that the mock offers no actual stock reservation. Keep approval authority out of purchasing-agent tools; otherwise the agent can approve itself. Show “pending” until authorization, even if the sheet calls this an order. Verify retries, stale approval, changed price and duplicate commits. Model scoring must never decide whether a hard constraint applies.

### 3. LOSE — Your central quantity claim skips the hardest inputs

**Evidence:** [menu-spike:34](../research/menu-spike.md#L34) found wrong ingredient matches and [line 35](../research/menu-spike.md#L35) an inconsistent butter weight. [horeca:7](../research/horeca.md#L7) says kitchens order the gap to stock; [line 49](../research/horeca.md#L49) then proposes a formula that can ignore stock when forecast dominates. A menu and total covers do not specify dish mix, recipe yields, pantry stock or inbound orders.

**Fix — 2–3 h, overlapping the slice:** use one chef-reviewed recipe and explicit synthetic stock/inbound quantities. Compute `max(0, demand + target closing stock − usable stock − confirmed inbound)`, then convert and round to validated sales units/lot increments. Show the arithmetic and assumptions. Conflicting unit data must hold the line, not trigger an LLM guess. From [openapi.json:1](../../data/valio/openapi.json#L1), Terminal availability `999999` means **unknown**, not abundant; earliest delivery can miss the requested date, and either sales-block flag matters. Test those cases. Unknown allergen/origin data cannot satisfy a hard requirement. Compare carbon per purchased mass and prices on a consistent tax/unit basis; missing data is not zero. This is more credible than 17,546 estimated product records.

### 4. WEAKENS — Sponsor stacking is being mistaken for competitive evidence

**Evidence:** [SCORECARD:29](../concept/SCORECARD.md#L29) through line 38 lists nine additional prize paths. Most add capabilities unnecessary to the purchase. Cloudinary's brief explicitly requires more than a CDN ([brief:62](../event/challenges/tech/cloudinary--best-use-of-cloudinary.md#L62)); catalogue media are IDs and files are excluded ([schema:382](../../data/valio/valio_aimo_junction26_product_data_schema.json#L382)), contradicting the raw-image-URL fallback.

**Fix — 0.5 h decision; likely saves 8–15 h:** Valio is essential. Choose **one primary model**, preferably Gemini if its basic call works now; structured intent and recipe-compatible substitution are useful, ordinary weighted arithmetic is weak differentiation. Aiven Postgres is useful shared persistence if already provisioned. Context.dev can supply one sourced menu, but cached input alone is a weak live-web prize entry. Modal, Verda, Nemotron, Gemma and Cloudinary are optional dependencies created by optional features. Drop their prize ambitions unless already working without delaying the slice. If retaining one stretch, choose Nemotron document extraction *or* a Modal batch with measured useful output, not both. A second model's agreement is not a safety guarantee. GPU credits and hardware are not cash; do not optimize prize count as though they were.

### 5. WEAKENS — The scorecard awards evidence you have only named

**Evidence:** every row remains unchecked ([SCORECARD:9](../concept/SCORECARD.md#L9)). Treat these as the actual acceptance gaps:

| Criterion | Where you will lose points | Minimum evidence to replace the promise |
|---|---|---|
| Valio end-to-end, 30 | A basket is not a committed order | Fixed terms, pending authorization, durable receipt after reload |
| User need, 20 | Different baskets do not prove correct fulfilment | All requested quantities/constraints satisfied; corrections counted |
| Controls, 20 | Sliders and trace drawer do not enforce authority | Allowed auto-order plus blocked order; stale approval rejected |
| Exceptions, 15 | Too many scripted anomalies, no demonstrated semantics | Partial stock + late delivery + lot rounding; explicit unsatisfied demand |
| Openness/production path, 15 | Two protocols do not establish interoperability | One external client completes the same gated transaction; schemas and assumptions |
| Context main, five ×20 | Cached/replayed recall is not live reaction or exact exposure | Source/ingestion/action timestamps; honest replay label; batch ambiguity shown |
| Gemini | Scores do not show why Gemini matters | Recipe compatibility example plus comparison with a simple baseline |
| Nemotron, four ×25 | Optional photo and second opinion lack quality evidence | Before/after results on 10–20 labelled cases; required submission text |
| Modal / Verda | Synthetic activity does not prove useful scale | Useful completed work, throughput/cost, working endpoint; Verda process summary |
| Aiven / Cloudinary / Context tech / Gemma | Eligibility is not best use | Durable shared state / meaningful media workflow / visibly consequential endpoint / useful model task |

**Fix — 1–2 h within validation:** collect receipts, traces and case outcomes for retained rows. Remove unsupported claims. Recall matching needs batch/best-before evidence absent from the proposed order flow ([horeca:19](../research/horeca.md#L19)); call uncertain matches “potentially affected.” Replayed historical notices cannot establish notice-to-alert latency. Skip AfterQuery: simulated kitchens are not yet a difficult, reward-secure evaluation environment.

### 6. WEAKENS — Your infrastructure fallback is three deployments and two database behaviours

**Evidence:** [DECISIONS:27](../DECISIONS.md#L27) waits for Runtime enablement, then offers VM and Vercel fallbacks, plus Docker/PGlite locally. [ARCHITECTURE:11](../concept/ARCHITECTURE.md#L11) still specifies browser storage. [ORCHESTRATION:34](../ORCHESTRATION.md#L34) makes the solo lead the bottleneck for shared files and contracts.

**Fix — 1 h deployment spike now; 0.5 h contract reconciliation:** deploy to whichever authorized host already works. Do not make Runtime activation a prerequisite for the app. Keep ordinary Postgres tables; remove pgvector novelty checks, custom event infrastructure and long-lived MCP sessions from the critical path. Stream/poll from durable ops with a cursor; notifications alone are not replay storage. Freeze one request/order/op fixture and server mutation contract. Limit active feature lanes to three; integrate the first complete fixture path before adding real adapters. Local fallback must boot without cloud DB or keys, not merely set `LLM_PROVIDER=fixture`. Prove it with networking disabled. Pure core and ports help only if they reduce dependencies.

### 7. WEAKENS — Your opening pitch competes with features Valio already has

**Evidence:** [horeca:8](../research/horeca.md#L8) documents templates, purchase history, recipe-to-cart, carbon reports and A.I.mo. Its competitor-gap claims ([lines 28–34](../research/horeca.md#L28)) are research hypotheses, not proof competitors lack anomaly handling. [CONCEPT:47](../concept/CONCEPT.md#L47) packs multiple scenarios into fifty seconds; [PITCH:4](../PITCH.md#L4) is still blank.

**Fix — 1–1.5 h:** ask one Valio mentor to challenge the proposed rescue against today's workflow and validate one recipe/substitute. Ask who would pay and what a pilot would measure; do not claim proven waste reduction. Use one large before/after order diff with the blocked choice visible. Give peers a resettable isolated demo session: a public no-login URL must not expose unrestricted shared mutation. Do not ask a tired reviewer to configure their own agent or scan a QR before the payoff.

### 8. LOSE — Publication and submission have known unresolved gates

**Evidence:** [STATUS:23](../STATUS.md#L23) explicitly flags credentials/redeem codes in challenge documents/history. [EVENT:23](../event/EVENT.md#L23) lists eligibility, MIT/public-source rules; [PLAN:59](../PLAN.md#L59) leaves video, deck and submission after feature freeze.

**Fix — reserve 1–2 h, plus recording time:** scan the intended public tree and history without printing secret values; remove exposed material and rotate credentials as needed before publication. Confirm redistribution terms for supplied datasets/assets; MIT on your code does not establish those rights. Ask organizers how “related to an existing company” applies to this independent sponsor-challenge prototype; do not infer disqualification merely from using Valio. Verify the existing draft is valid, submit only supported challenges as FINAL, and test public video/source/demo links logged out. Record a usable rough video Saturday 22:00. Check transport and an off-site sleep block: the current shift table assumes four humans ([PLAN:16](../PLAN.md#L16)).

## Ideas to win — proposals, not defects

**Hero: “140 dinners. The salmon is gone. The agent still cannot break your rules.”** Let the reviewer pick a constraint. Reject an appealing invalid substitute, find a valid alternative, reveal its quantity/cost/delivery delta, and authorize the exact purchase. Retry the commit: one receipt. The “no way” is useful autonomy surviving an attempted mistake. A 500-dot animation proves neither intelligence nor trust.

**Two-minute table demo:** 0–15 s: show the shortage and promise. 15–40: add guests to the reviewed recipe; show stock-to-pack arithmetic. 40–75: shortage triggers alternatives, including one visibly rejected. 75–105: reviewer changes a preference, approves the resulting terms, sees receipt. 105–120: optional preconfigured external-client call through the same gate. Keep live mock lookup/model calls visible with a short timeout; label cached responses, deterministic fixtures, synthetic bookings and local order commitment. Never silently substitute replay for live success. Run the full interaction locally offline; keep a labelled recording as the final fallback.

**Three-minute stage pitch:** 0–20 s kitchen problem; 20–110 rescue; 110–140 why agents fail and how this gate catches it; 140–165 independent wholesaler-integration business hypothesis and pilot; 165–180 close. No sponsor roll call or swarm detour. No measured savings claim without a measured comparison.

**Three changes tonight, in order:** (1) freeze the rescue scope and reconcile contracts, **1 h**; (2) deploy its fixture purchase with exact-term authorization and one real narrow lookup, **4–6 h**; (3) build the reviewed quantity/substitute case and rehearse its two-minute demo, **2–3 h**. These overlap findings above; they are not extra work. If there is time afterward, implement a second external client, not a second product. A recall-first product could be sharper visually, but batch identity and live-source uncertainty make it a worse pivot tonight.

## What I would not change

Keep Valio, SvelteKit, the pure core, fixture ports, one mutation service, durable human-readable provenance, and the separation of deterministic permissions from model suggestions. Keep the feature freeze and explicit simulated-order disclosure. Keep open interfaces, but prove one before adding another. Those choices directly support the rubric; sponsor breadth and a swarm do not.
