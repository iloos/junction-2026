# Round 5 — domain lineage and persistence correctness

Inspected and probed `2d8ce0f` on 14 Nov 2026; overlapping baseline changes rechecked through `f2edb21` (including `a7600f2`) while writing. Ran narrowly scoped pure-function and fresh in-memory PGlite probes with synthetic catalogue data through `createHandlers`. No shared PostgreSQL, network, secrets, application edits or branch changes. This report covers the purchasing domain; the parent report covers integration/UI/Web/Ops and the full suite.

## What is now materially better

The round-3 duplicate-line-ID, missing-price and declared-allergen/origin failures have explicit guards in current code. Event/edit/substitute work now prepares catalogue facts before the transaction; commit passes its fetched offer into stock consumption. Product and make-in-house resizing share `core/demand/sizing.ts`; do not repeat the old circular-import or fixed-ingredient-size finding unchanged. The store now persists/reloads enrichment suggestions. `a7600f2` adds a standing-order baseline and combines eligible in-mandate lines with approved lines in a default commit; this corrects the earlier partial-selection behaviour. It does not change the fresh findings below. These are substantive repairs, not cosmetic additions.

The remaining failures arise where one entity is transformed into another without carrying its original meaning: a volume request becomes a bare sales-unit count, an observed stock amount becomes a purchasing promise, and a displayed deadline never becomes a commitment condition.

## Entity lineage: what must survive every transition

| Entity/transition | Current identity and authoritative role | Required invariant / current limitation |
|---|---|---|
| Request → Need | Direct `place_order` stores explicit product/quantity but `needs: []` ([orders.ts:201](../../../src/lib/core/services/orders.ts#L201)) | Preserve requested physical quantity, unit, dietary/origin conditions, requested-by date and fulfilment goal; direct substitution currently loses physical meaning |
| Event → Need | Seed dish → `needId`, amount, dish grams/guests/yield and provenance | Distinguish served amount, raw ingredient demand, on-hand/inbound offsets and zero demand; formulas must match the represented basis |
| Need → Line | Line ID, `needId`, SKU, sales quantity, substituteFor, provenance | Preserve amount covered and residual in the Need's physical unit; a case is not a litre or portion |
| Product + context → Offer | Product ID, price per sales unit, availability, dates, provenance | Observed supplier cache ≠ remaining simulator stock or fresh customer-specific promise |
| Quoted lines → Approval | Plan/version/hash + mandate version + line IDs + expiry | Exact purchased terms must remain bound; missing facts cannot be authorized into truth |
| Approval/mandate → Order | Immutable order contains source line IDs, amounts, price and authority | Unique lines; exact numeric terms; deadline/price validity; aggregate spend and physical stock under the transaction |
| Order → Receipt | Confirmed/awaiting-supplier quantities, product and optional lot IDs | Confirmation is not receiving or evidence of food served; receipt lines lack their own source line ID, so same-SKU multi-dish attribution needs the Order join |
| Persistent state → LineView | Derived reviewable/committable/cover/nextAction | Must reflect effective policy/clock/stock, not merely a previously recorded line state |

Keep the entity chain rather than inventing a generic “item” object used interchangeably everywhere. An immutable order/receipt and a mutable plan are deliberately different objects.

## Fresh findings, ranked

### 1. P1 — Direct-request substitution preserves package count, not required amount

**Reproduced through fresh PGlite handlers:** synthetic original product is 1 L per `ST`, out of stock; replacement is 0.5 L per `ST`, available. `place_order` requests 1 original `ST` (1 L). `find_substitutes` chooses **1 replacement ST = 0.5 L**, with no residual. The request has lost half its required volume. The same defect generalizes to unequal same-unit packs and the milk example.

**Cause:** direct plans have no Need; [sizing.ts:33](../../../src/lib/core/demand/sizing.ts#L33) returns the original quantity whenever `servedKg === null` and the sales-unit strings match. An equality of technical sales-unit codes does not establish equal physical contents. Event-based sizing avoids this branch, which is why the golden Christmas scenarios do not expose it.

**Fix, core-db/request, 1–2 h:** persist direct Need in its original physical unit with the original product conversion/basis. Size every replacement against that Need, using each candidate's content; refuse/hold unknown or incompatible conversion. Do not infer litres from mass without a justified conversion. The request parser must pass its physical goal into this model, not only a rounded SKU quantity.

**Acceptance:** 1 L → 2 × 0.5 L; 1 kg → sufficient candidate packs after yield; unknown content → explicit unresolved demand. Commit and receipt must preserve the amount actually bought and show any excess/residual.

### 2. P1 — Cut-offs are displayed, but do not constrain commitment

**Reproduced:** injected scenario time `2026-12-10T12:00:00+02:00`, known-stock offer with `closingTime: 2026-12-09T17:00:00+02:00`. Create a priced plan and commit: **success, confirmed receipt**. The scenario deadline had passed by nineteen hours.

**Cause:** `validateLine` checks stock, price presence, lots and kitchen constraints but takes no clock/requested-date context. `commitOrder` checks approval expiry but not offer cut-off, price `validTo` or availableDate against requested delivery ([orders.ts:448](../../../src/lib/core/services/orders.ts#L448)). `onScenario` moves dates for display; that is not enforcement. No expired-price probe was run, but the missing check is visible in the same commit path.

**Fix, core-db/clock, 45–90 min:** temporal validation at prepare and immediately before commit using one injected clock: cut-off not passed, requested delivery satisfiable and price terms valid. Return a typed re-quote/next-date outcome. Static mock dates may be translated by the labelled simulator; that simulator's translated deadline must still bind the order. Keep approval expiry and supplier-offer expiry separate.

**Acceptance:** before/exactly-at/after cut-off, expired price, future availability and Helsinki offset cases; missed cut-off writes no order/spend/stock consumption and offers an explicit next action.

### 3. P1 — After stock is consumed, the next quote still promises it

**Reproduced:** synthetic catalogue has one unit in known stock. First plan commits it. A second plan for one unit is returned **eligible, committable, confirmedCover 1**, with availability still 1. The second commit then fails `INSUFFICIENT_STOCK`, reporting 0 left.

The atomic consume is correctly protecting stock. The defect is the upstream promise/read model, not overselling: catalogue `offers` reads cached supplier observations; consumption changes only `sim_stock` ([stock.ts:17](../../../src/lib/server/adapters/simulator/stock.ts#L17)). No scoped availability-to-promise adjustment feeds the next quote. This is especially visible in the advertised multi-kitchen contention story.

**Fix, core-db/simulator, 1–2 h:** distinguish supplier observation from run-scoped ATP; tier/preview/read model against current ATP, and revalidate atomically at commit. Do not change the shared static supplier cache to represent one simulator run. A failed stock commitment should also re-quote/hold its plan so the UI does not keep advertising the same failed action.

**Acceptance:** after consuming the last unit, another kitchen sees zero/below-lot and a repair action before approval; two truly concurrent commitments still resolve atomically. Known stock before commitment is availability, not a reservation or guaranteed confirmation.

### 4. P1 — Zero demand can become a positive purchase

**Reproduced pure production functions:** `toLot(0, 'KG', productWithLot10)` returns **10 KG**, because it enforces at least one lot. `makeInHouseQty({order:{unit:'ST'}, per:1, pack:1}, 0)` returns **1 ST**. Meanwhile `roundToSales` permits zero correctly. There are now inconsistent zero-demand transformations.

**Fix, core-db/demand, 20–40 min:** zero demand produces no purchasable line; do not apply a positive minimum lot until demand is positive. Either reject zero quantity on explicit ordering input or interpret it as removal through a dedicated edit command. Make-in-house zero demand must remove all its ingredient purchase lines.

**Acceptance:** set a dish to zero grams and verify zero ingredient/substitute quantity, no spend, no new approval; positive quantities below a genuine lot still round upward. Reject negative/nonfinite quantities before rounding.

### 5. P2 — The advertised server-derived committable view lacks temporal authority

Code inspection: `lineView` accepts only approval state, line IDs and planVersion ([view.ts:36](../../../src/lib/core/mandate/view.ts#L36)); its approval type excludes expiry, hash and mandateVersion, and it has no clock. A stored granted approval can therefore remain `committable: true` after expiry or a policy-version change, although commit later refuses it. Cover is expressed as kg for `KG`, otherwise `pcs`; a `KI` case consequently appears as pieces despite the quantity remaining cases ([view.ts:32](../../../src/lib/core/mandate/view.ts#L32)).

**Fix, domain/read-model, 45–90 min:** derive eligibility from a complete effective authority/clock input, and expose sales quantity distinctly from physical cover. If availability is not reserved, name the field `availableCover`/`provisionalCover` rather than confirmed. Receipts alone establish confirmed supplier quantities. Return the same blocked reason the command will enforce.

**Acceptance:** advance clock beyond approval expiry without changing the plan; view switches to re-approval. A ten-piece case is distinguishable from ten physical pieces. Every displayed committable line survives the command when no intervening fact changes; intervening changes produce a reconcilable new view.

## Persistence/API guarantees to retain and tighten

- **Keep:** one transaction for state + op + stock + budget + idempotent response, unique selected lines, immutable Order, explicit awaitingSupplier, version-bound approval and prepare-before-lock. Those fixes should not be weakened for latency.
- **Explicit run semantics:** idempotency is currently scoped to workspace/caller/tool/key, not run. A repeated key after a demo reset can intentionally replay an old run response. Either make run part of the key or document cross-run replay and give clients new request intent IDs. Do not silently alternate meanings.
- **Reducer boundary:** `applyOps` checks authority/membership but trusts generated Order amounts; direct service validation must remain authoritative. For future job/admin mutations, do not expose raw CommitOrder ops. Add invariant tests comparing every committed Order line to the approved Plan terms, not only receipt count.
- **Document lineage:** when a substitute or recipe changes, preserve its source Need and requirement basis. `substituteFor` is a product ID, not an original line ID; same-SKU needs must always use the `needId` too. Receipt joins must retain enough information to explain which need the purchased units served.
- **Projection rebuilding:** test replay-to-state and load-from-rows equivalence after partial commit, reapproval, recall and enrichment. A passing op history alone does not establish that the database projection or API view agrees.

## Minimum regression journeys before claiming a coherent foundation

1. Physical request → unequal-pack substitute → approve → commit → physical coverage/residual.
2. Event → substitute → zero/increased portions → recipe/lot resize → invalidated approval → correct receipt.
3. Two kitchens → shared stock consumption → refreshed ATP → conflict/repair without stale committable claims.
4. Quote → clock passes line cut-off/price validity → view and commit agree on refusal/next delivery.
5. Partial commit → remaining lines edit/requote → old receipt immutable, spent total and remaining-total fields unambiguous.

These are small end-to-end domain tests using injected catalogue/clock fixtures; they complement the real-Postgres race suite. They do not require adding a new product, generalized ontology or another model.
