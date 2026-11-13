# Food-service supply chain, inventory and the simulator

_Research, Sat 14 Nov 2026. For the contracts, the Valio simulator and both UIs. Builds on [valio-data](../foundations/valio-data.md), [PRODUCT](../concept/PRODUCT.md), [ux](../foundations/ux.md), [horeca](horeca.md), [horeca-profiles](horeca-profiles.md). Sources inline. **(?)** = guess or single vendor source._

## 1. How a food-service wholesaler works (and what Valio's data says)
| Mechanism | Practice | Valio Aimo / our data |
|---|---|---|
| **Stocked vs supplier-direct** | Stocked items sit in the wholesaler's DC and are picked overnight. Non-stocked items are bought from the supplier per order and cross-docked (in, sorted, out on the customer's truck) or shipped direct, so they have the supplier's lead time and the wholesaler doesn't know the quantity until the supplier confirms **(?, standard practice)** | `logisticModel` Stock (31% real amount, 8% "unlimited" ≥1e6) vs **Terminal** (42%, amount 999999 = unknown). Valio also runs VALO Tilauspalvelu, delivered direct from the supplier ([valioaimo.fi](https://www.valioaimo.fi/en/valo-tilauspalvelu-en)) |
| **Cut-off and picking** | Orders close at a fixed time so the DC can run a wave pick and load trucks by route at night | Stock closes **17:00 the day before delivery**; Terminal 3–4 days before (`closingTime`). Static in the mock, so **our simulator owns the clock** |
| **Routes and delivery days** | Customers get fixed delivery weekdays per area so trucks stay full (route density). Kespro shows each customer its "agreed delivery days and delivery window" plus exception days ([Kespro](https://www.kespro.com/sv/ideer-och-inspiration/artiklar/kespron-uusi-toimitukset-palvelu-sujuvoittaa-arkea)). A typical US route: ~14 stops/day, ~55 cases per stop (IFDA via [FleetOwner](https://www.fleetowner.com/refrigerated-transporter/article/21219480/multitemp-delivery-solutions-evolve-rapidly)) | Valio delivers "usually within 24 h on agreed delivery days" ([delivery wholesale](https://www.valioaimo.fi/en/become-a-customer/delivery-wholesale/)). Days per kitchen are not in the data: seed them per profile (hotel 5–6/wk, lunch 3–5, horeca-profiles §1) |
| **Temperature chain** | Frozen ≤ −18 °C, chilled 0–8 °C, ambient. Food-service relies almost exclusively on **multi-temperature trucks** so one stop unloads all zones ([FleetOwner](https://www.fleetowner.com/refrigerated-transporter/article/21219480/multitemp-delivery-solutions-evolve-rapidly)) | `temperatureCondition` 1–9 (99.7%): ambient 10k, frozen 3.2k, chilled ~4k, fresh 0–3 °C 240. A substitute across classes changes prep (thawing) and storage |
| **Catch weight and lots** | Meat, fish, cheese are counted in pieces/cases but invoiced by actual weight; two units of measure per line ([AEB](https://www.aeb.com/en/magazine/articles/catch-weight-management.php)) | `allowedLotSize`: 0.01 for 96%; KG items step 1.5–15 kg (salmon `462150` 10 kg, ham `462490` 7 kg). Ordered ≠ delivered weight in reality: invoice by weighed kg **(?)** |
| **Allocation when short** | Rules: first-come (order time), **product allocation** quotas per customer/channel/region, and **backorder processing** that re-ranks confirmed orders (SAP's strategies: win, gain, redistribute, fill, lose) ([SAP aATP BOP](https://www.sapdocs.info/13946/sap-aatp-cookbook-backorder-processing), [SAP Press](https://blog.sap-press.com/how-sap-advanced-atp-solves-key-order-fulfillment-challenges)). Even SAP had no true "fair share" in aATP as of 2021 ([SAP Community](https://answers.sap.com/questions/13318133/bop-fair-share-distribution-between-customer.html)) | Nothing in the data. Ours to define and show |
| **Backorder vs substitution** | Perishables are rarely backordered: a short line is cut (short-ship), substituted (with or without consent) or re-ordered for the next delivery **(?)**. Practical case fill-rate target ~98–99% (vendor case studies, [SC247](https://www.supplychain247.com/article/acr_raises_fill_rates_to_98_after_network_overhaul/case_studies)) | 250 Valio substitution rules (1.1%); undeliverable 18%; zero stock 2%. We never backorder silently: either next delivery date or substitute, shown |
| **Returns and deposits** | Damaged or wrong goods are claimed at delivery; crates, bottles and roll cages carry deposits and come back on the truck **(?)** | `deposits[]` on 2.9% of products (7 materials). Show as a deposit line; no returns flow in Ring 0 |
| **Recalls and traceability** | Food-service tracing = **GTIN + date + batch/lot** at case level, GS1-128 ([GS1 US](https://www.manufacturing.net/safety/news/13164703/foodservice-guideline-aims-to-enhance-food-traceability-and-safety)). In Finland the batch id must be on the transport package or the documents between operators ([Ruokavirasto, pakkausmerkinnät osa 9](https://www.ruokavirasto.fi/globalassets/yritykset/elintarvikeala/toiminnan-aloittaminen/pk/pakkausmerkinnat/osa-9_muut-pakolliset-tiedot2.pdf) **(?, exact guide)**). Suppliers send Valio Aimo batch, best-before, quantities, delivery dates and delivered batches, and Aimo removes product from customers ([Valio Aimo recalls](https://www.valioaimo.fi/tietopankki/communications-regarding-recalls)) | GTIN 99.1%; **no batch or best-before** anywhere. Simulator must assign lots to receipts to show "exactly affected" vs "potentially affected" |
| **FEFO and remaining shelf life** | DCs pick first-expired-first-out; customers set a minimum remaining shelf life at delivery (often ≥70% for retail **(?)**) and FEFO must respect it per customer ([Mecalux](https://www.mecalux.com/blog/fefo)) | No shelf-life days in our normalised model; storage text 49% **(?)** whether Synkka has a min-life field. Later ring |

## 2. Inventory concepts: in the data, simulate, or skip
| Concept | Side | In data? | Simulate? | Ring |
|---|---|---|---|---|
| **Lot size / catch weight rounding** | both | **Yes** (`allowedLotSize`, `units[]`) | no | **R0** (salmon 11.5 → 20 kg; 9 kg left < 1 lot = unorderable, S3) |
| **Cut-off and lead time** | both | Yes, but static | clock + per-model rule | **R0** (F2 bulk vs top-up), countdown R1 |
| **ATP** = on hand + inbound by date − committed − reserved | wholesaler | Partly: Stock amount for 31%; unlimited 8%; Terminal unknown 42% | **Yes**, depletion across kitchens | **R0** (salmon contention, milk 640 l Mon + rest Wed) |
| **Reservations / holds** | wholesaler | No | Yes (ours) | **R0**: a held line reserves stock with a TTL so approval isn't hollow |
| **Stock contention** | wholesaler | No | Yes, labelled simulated | R0 hero, R1 Ops view (★16) |
| **Par level** = use until next delivery + 20–30% buffer ([Unleashed](https://www.unleashedsoftware.com/blog/par-levels-in-inventory-management-with-formula-examples/)) | kitchen | No | Seed per profile | R1 (★9 regular week) |
| **Safety stock / reorder point**: SS = z·σ_d·√L, ROP = d̄·L + SS ([Fishbowl](https://www.fishbowlinventory.com/blog/calculating-the-safety-stock-formula-6-variations-key-use-cases)) | both | No | From synthetic history | R1 kitchen (as "buffer" in the why); R2 wholesaler |
| **Days of cover** = on hand / avg daily use | both | No | Derived | R1 (Ops heat map) |
| **Forecast error** (MAPE, bias) | both | No | Synthetic history, labelled | R2 (Lab), back-test chip R1 |
| **Bullwhip** | wholesaler | No | Emerges from the swarm | R2 (Ops narrative: order variance / consumption variance) |
| **Waste / shrink** | kitchen | No (15–20% Finnish food service, horeca §3) | Estimate | R1 waste line |
| **FIFO / FEFO, shelf life** | both | No | Lots with best-before on receipts | R1 for recall; FEFO picking out of scope |
| **Fill rate** (lines / cases delivered as ordered) | wholesaler | No | Derived from allocation | R1 Ops KPI |

## 3. When many customer agents order
1. **Demand arrives earlier and more honestly.** A BEO signed 3 weeks out can become a **soft hold** (forecast intent, no stock taken) on Aimo's side instead of a T−1 order. That is Valio's "bonus" (stock from aggregated demand) for free.
2. **Shortage gaming gets faster.** Lee, Padmanabhan & Whang name rationing and shortage gaming as a bullwhip cause: buyers inflate orders when they expect rationing; the remedy is to **allocate on past usage, not current orders** ([Mgmt Sci 1997](https://courses.ie.bilkent.edu.tr/ie102/wp-content/uploads/sites/12/2019/02/Lee-Padmanabhan-Whang-1997-MS.pdf), [SMR summary](https://courses.ischool.berkeley.edu/i290-4/s03/readings/bullwhip.htm)). Agents re-plan in milliseconds, so a raw ATP number + FCFS invites a race and hoarding by reservation.
3. **Double orders.** Sources: agent retries, two agents for one kitchen (our app + the judge's Claude), the human in the webshop. Fixes: idempotency key per commit (Stripe stores the first response per key and rejects reuse with different parameters, [Stripe](https://docs.stripe.com/api/idempotent_requests)); plus an **open-intent check** on `(kitchen, product, deliveryDate)` that turns a second order into "you already have 20 kg on Mon; add?" (propose tier).
4. **Fairness under contention.** Policies: FCFS (simple, rewards the fastest agent), proportional to request (gameable), **capped by historical usage** (Lee et al.), priority tiers (care home P5 "no missed delivery"). Our pick: FCFS reservations while ATP is ample; when demand > ATP for a delivery date, the remainder is allocated at cut-off by usage-capped fair share in **lot steps**, priority tier first. Show the policy and each kitchen's granted / requested.
5. **How to expose ATP to agents.** Return a **promise**, not a stock count: `{status: available|limited|below_lot|unknown|out|undeliverable|blocked, promisedQty, date, cutoff, validUntil}`; banded quantities for scarce SKUs **(?, our design)**. UCP has agents query live inventory and price from the merchant ([Google](https://developers.googleblog.com/under-the-hood-universal-commerce-protocol-ucp/)) but we found no protocol that specifies reservations, so ours is a design choice to document.
6. **Rate limits**: token bucket per kitchen and per external client on top of our ≤4-concurrent rule toward Valio; quotes are cheap (simulator), commits are limited (e.g. 10/min per kitchen) **(?)**.
7. **Fit to our concurrency design.** (a) **Atomic conditional update**: `reserved += q WHERE onHand + inbound − committed − reserved ≥ q AND q % lotStep = 0`, one statement, no read-then-write. (b) **Idempotency key** on reserve and commit. (c) **Terms hash + version**: the approval binds `{sku, unit, qty, price, deliveryDate, promiseId}`; if allocation cuts the qty at cut-off, the version bumps, approval voids, line back to held. (d) **Reservation TTL** (until cut-off or 30 min after quote, whichever first) so abandoned agent carts release stock. Terminal lines never reserve (quantity unknown): they're "requested, awaiting supplier".

## 4. Visualisations that answer a question
Real-world references: control towers centre on exceptions plus **dynamic ATP and allocation** ([Kinaxis control tower](https://www.kinaxis.com/sites/default/files/resources/Kinaxis-Brochure-Solutions-Guide-Control-Tower.pdf)); SAP's allocation and backorder apps show requested vs confirmed per customer ([SAP Learning](https://learning.sap.com/courses/functions-innovations-in-sap-s-4hana-sales/using-advanced-available-to-promise-aatp-in-sap-s-4hana_ef38afd2-4730-433f-854a-613b8e4afec5)); days-of-supply heat maps by item × location ([Minitab](https://support.minitab.com/en-us/minitab/help-and-how-to/modules/supply-chain/inventory/inventory-days-of-supply/heatmap/)); exception-driven planning keeps the alert set small to avoid fatigue ([fitgap](https://us.fitgap.com/stack-guides/exception-driven-planning-that-keeps-planners-focused-on-what-breaks-the-plan)). The classic MRP **time-phased projected stock** (step line by day with receipts and cut-offs) is the one chart every planner reads.

| View | Question it answers | Verdict |
|---|---|---|
| **Kitchen: delivery calendar strip** with cut-off countdowns and per-day tier badges | "What must I decide, by when?" | **Build (K1)**. SVG, trivial |
| **Kitchen: order diff vs normal week** (ghost bar = usual qty, delta, rounding note) | "What changed and why?" | **Build (K3)**. Svelte rows + inline SVG |
| **Kitchen: promise bar per line**: need → rounded to lot → promised → gap; Terminal hatched "unknown" | "Will I actually get it?" | **Build (K2 lines + K4)**. Replaces a separate ATP chart for the chef |
| **Kitchen: substitute dot plot** per attribute with the kitchen's weights | "Why this one?" | **Build (K5)**. SVG + d3 scales |
| Kitchen: Sankey menu → ingredients → products → packs | provenance | Skip: the why drawer says it in one line; Sankey is decorative at 10 dishes |
| **Ops: contention board**: one SKU, ATP bar split into each kitchen's reservations/commits (top 12 + "others"), cut-off marker, policy toggle FCFS ↔ fair share | "Who gets the salmon, and is that fair?" | **Build (★16, the hero Ops chart)**. SVG, ≤ 13 segments |
| **Ops: projected ATP timeline** per SKU: step line onHand/ATP by day, receipts as ticks, cut-offs as vertical rules, demand bars | "When does it run out?" | **Build**. uPlot (step paths); small multiples for the top 6 at-risk SKUs |
| **Ops: risk heat map** category group (18 prefixes or LLM labels) × next 14 delivery days, colour = demand / ATP (or cover days); Terminal share as hatch | "Where is the next shortage?" | **Build**. Canvas 2D + d3 scales; 18–349 rows × 14 |
| **Ops: allocation fairness**: per-kitchen fill rate (granted / requested) as a beeswarm by profile, under each policy | "Did the policy treat the care home fairly?" | **Build if time** (pairs with the contention board) |
| Ops: product map coloured by availability/risk | "Which parts of the catalogue are fragile?" | Should, after the embedding spike (ux §5): embedding-atlas or regl-scatterplot |
| Ops: recall exposure graph GTIN → lots → orders → kitchens | "Who has the bad batch?" | R1 with the recall flow; d3-force, tiny n |

**Performance (17.5k SKUs, 500 kitchens).** Only "active" SKUs (on some order or shortlist, ~1–3k **(?)**) carry simulator state; the rest are static rows. Keep per-SKU daily projections as `Float32Array[sku × 14]` in `$state.raw`, recompute only touched SKUs per event batch. Heat map aggregates in a worker to ≤ 349 rows before drawing. Contention board aggregates kitchens beyond the top 12. 500 kitchens × ~60 lines ≈ 30k lines/week: index reservations by `(sku, date)`. Coalesce events to ≤ 10 UI updates/s (ux §5). Test at 5,000 kitchens.

## 5. The simulator
**Credible means:** a clock that moves and closes cut-offs; Stock depletes as kitchens commit; lot rounding is enforced; Terminal stays unknown until a supplier confirmation lands (and sometimes confirms less: reliability < 1 → shortfall with probability 1 − reliability **(?)**); replenishment arrives on a schedule; everything starts from cached real responses and every value says `valio-live | cache | sim`.

**Minimal state**
```
Clock      { now, speed }                                  // Europe/Helsinki
SkuSim     { productId, model: stock|terminal|undeliverable|blocked,
             onHand | null, unlimited, lotStep, reliability?,
             receipts[{qty, eta, lotId, bestBefore}], cutoffRule: {kind:'D-1', at:'17:00'} | {kind:'lead', days:3|4} }
Kitchen    { id, profile, deliveryWeekdays[], routeId, priorityTier, usage[productId → avg/wk] }
Promise    { id, kitchenId, productId, deliveryDate, qty, status, validUntil }
Reservation{ id, promiseId, qty, expiresAt, idempotencyKey }   // Stock only
Commit     { id, kitchenId, productId, deliveryDate, qty, termsHash, version, idempotencyKey }
Allocation { productId, deliveryDate, policy, grants[{kitchenId, requested, granted}] }   // written at cut-off
```
ATP(sku, date) = onHand + Σ receipts(eta ≤ date) − Σ commits(date' ≤ date) − Σ live reservations.

**Five events for the Operations view**
| Event | Payload | Ops reads it as |
|---|---|---|
| `atp.changed` | productId, date, onHand, reserved, committed, atp, cause (commit / reservation / expiry / receipt) | timeline + heat map update |
| `contention.detected` | productId, date, requested Σ, atp, kitchens n, lotStep | contention board lights; anomaly stream line |
| `cutoff.closed` | deliveryDate, model (stock/terminal), routeIds, lines locked, lines missed → next date | countdown resets; missed lines become anomalies |
| `allocation.decided` | productId, date, policy, grants[], fill rate, residual below lot | fairness view; kitchens whose qty was cut get version bump → held |
| `supply.arrived` | productId, qty (Stock receipt or Terminal confirmation, possibly short), lotId, bestBefore | ATP rises; Terminal "unknown" resolves to a number |

Later: `recall.issued` {gtin, lotIds?, source} for R1.

## Means for us
1. **Contracts:** add `Promise {status: available|limited|below_lot|unknown|out|undeliverable|blocked, promisedQty, deliveryDate, cutoffAt, validUntil, source}` as the only thing agents see about stock; extends PRODUCT's closed `Availability` set with `limited` and `below_lot`.
2. **Contracts:** `Reservation` (Stock only, TTL to cut-off) and `Commit` with `idempotencyKey`, `termsHash`, `version`; allocation that cuts qty bumps the version and voids approval (★5 test).
3. **Contracts:** `Kitchen.deliveryWeekdays`, `routeId`, `priorityTier`, `usage` (from seeds) so cut-offs, routes and usage-capped fair share have inputs.
4. **Simulator:** implement the state in §5 and the ATP formula in one pure `core/` function; reserve via one atomic conditional update (lot-step check inside it).
5. **Simulator:** cut-off rules per model (Stock D-1 17:00, Terminal lead 3–4 d from `closingTime − availableDate`), allocation at cut-off with policy `fcfs | fair_share_usage` and priority tiers first; residual below one lot reported, never rounded down silently.
6. **Simulator:** Terminal lines never count as cover; a `supply.arrived` confirmation resolves them, short with probability 1 − reliability (labelled sim).
7. **Simulator:** assign `lotId` + `bestBefore` to every receipt and record it on deliveries, so the R1 recall can say "exactly affected" when the lot is known and "potentially affected" otherwise.
8. **Kitchen UI:** promise bar on every line (need → lot → promised → gap, Terminal hatched) plus the calendar strip and order diff; no separate stock chart for the chef.
9. **Ops UI:** contention board (hero), projected ATP timeline (uPlot step lines, cut-off rules), category × day risk heat map (canvas); fairness beeswarm if time. All driven only by the five events.
10. **Double-order guard:** open-intent check on `(kitchen, product, deliveryDate)` across all clients (app, MCP, REST), so the judge's Claude and the chef's app can't both order the same salmon unseen.
