# CONCEPT

_v2.1, Fri 13 Nov ~23:45, after Valio Aimo's stand and their printed info sheet (photo in `Misc/`). D1 still stands. **Sponsor set superseded by D7; see [PITCH.md](../PITCH.md) for current claims** and [ARCHITECTURE.md](ARCHITECTURE.md) for what is built. A lane agent with no chat history should understand the product from this page._

**Working name:** Mandate (placeholder). **Main challenge:** Valio Aimo, Trusted Trade Agents. **Stacked (D7):** Gemini API, Aiven, Context.dev, Exa.

## What Valio told us at the stand
- **Customer-facing, not sourcing.** Valio Aimo is mainly a wholesaler (little own produce) serving many kitchens; hotels are big clients. They already have a webshop and **don't want another one**. They want the kitchen's agent experience.
- **Menu-based, with regularity and anomalies.** Kitchens order from a stable menu (regular), then anomalies hit: a broken fridge, a big reservation, an item out of stock.
- **Different priorities per kitchen:** price, ecological products, carbon, and more. Follow the kitchen's needs; ask the user when unclear. "What scenarios can it support?"
- **Substitutes** when the product isn't available.
- **Enrichment:** manufacturer info is often missing, so fill the gaps.
- **Sign-off:** for this hack, assume **the person using the AI has full authority**. No manager approval chain needed.
- **Bonus, later:** managing Aimo's own stock from aggregated demand.
- **Their pipeline sketch:** raw API → enrichment → store; menu/regularity → anomalies → agent resolutions.

**From their printed info sheet (these are rules, not hints):**
- **The flow the solution must run:** 1 Request (the agent asks for what the buyer needs) → 2 Lookup (products, prices, availability) → 3 Order (commit at a fixed price) → 4 Approval (**the agent decides, or a human signs off**). Core = lookup, request and order, **permissions and approval**. Bonus = compare more than price (delivery reliability, sustainability labels), handle exceptions (partial availability, substitutions), explain decisions (a human-readable record of what the agent did and why).
- **Their example:** a hotel chain's agent: "I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability."
- **"It is not a chatbot."** Chat can be one input, but the product is the flow, the plan and the decisions.
- **"Query the APIs only when needed, never for all products."** So: no bulk price/availability sweeps against their API. Stress tests and the simulator run against **our own simulator of their API** (the fixture adapter), and live calls go only for the lines in an actual order.
- "Trust and openness by design: a full flow that works, a clear model for human sign-off, and open, well-documented choices. Not a production-ready system in 48 hours."
- A test account for the real webshop exists (credentials on the photo, never in git): use it to study today's ordering flow.

## One-breath
A kitchen tells its agent what it cooks and what it cares about (price, carbon, Finnish, organic). The agent keeps it stocked through Valio Aimo: it plans the regular order from the menu, notices anomalies (a big reservation, a broken fridge, a product out of stock), and resolves them with substitutes that fit the kitchen's priorities. It explains every choice and stays inside limits the kitchen set. Under it is an open agent interface (MCP + API) that any agent can use, and an internal control room where Valio sees every kitchen's agent at work.

**Wedge and buyer (PRODUCT.md):** the wedge is the exceptions, not the routine order (Valio already has templates, recipe-to-cart and an AI assistant, A.I.mo). The buyer is Valio Aimo (it runs the agent gate and offers it free to kitchens); the user is the kitchen. Scope and order of work: D4 rings, Ring 0 = the 8 stories in [PRODUCT.md](PRODUCT.md).

## The person and the pain
- **Kitchen (primary user):** the head chef or purchaser of a ~120-cover Helsinki restaurant, or a hotel kitchen (big client). The order follows the menu and the expected covers, but the week never goes to plan: reservations jump, deliveries miss cut-off times, products are out, a fridge dies. Today they rework the order by hand in the webshop. _Numbers to verify with Valio: orders per week, time per order, shortage rate._
- **Valio Aimo (operator):** wants kitchens' agents to work *with* Aimo, before another platform owns the customer relationship. They need enriched product data an agent can reason over, and visibility of what the agents do.
- **Why it's hard:** agents do legitimate things nobody listed. The vending-machine agent stocked products that didn't fit the machine ([research/mcpcon.md](../research/mcpcon.md)). Pack sizes, cut-off times, temperature classes and missing data are this domain's "doesn't fit the machine".

## The insight ("who would have thought")
1. **Ordering is predictable from what goes in.** Menu × expected covers → ingredients → the regular order. The kitchen doesn't type an order; it confirms one. This is the fridge-app or calorie-photo idea at business scale.
2. **Anomalies are where agents earn trust.** The value is not the routine order but the Friday when 80 extra guests booked and the salmon is out: the agent finds substitutes that match *this* kitchen's priorities, shows the trade-offs (price vs carbon vs delivery reliability), and explains why.
3. **Priorities are the mandate, and sign-off is a designed step.** The kitchen's profile (weights for price, carbon, origin, organic; hard constraints such as allergens; spend limits) bounds what the agent does alone. Three tiers: **act** (routine, inside the mandate), **propose** (a deviation the chef shapes with the agent, such as an event), **sign-off** (over a limit, novel, or a substitute that breaks a preference). Every approval is recorded against the exact order lines. Human in the loop stays central; what changes is that the human co-plans instead of rubber-stamping.
4. **Enrichment makes the catalogue agent-readable.** 11k of 17.5k products have carbon data and 4.4k have delivery reliability; names, pack sizes and specs are messy. Missing facts are filled on demand from the web (Exa, Context.dev), as suggestions with sources that never overwrite a catalogue fact, with provenance on every filled value ("estimated from category", "source: X").

## Three faces of one system
1. **Kitchen app (customer-facing, phone-first; not a chatbot):** a live order plan the agent edits in front of you (the request box is one way to explain context). Priority sliders; the week's anomalies as cards; one tap to accept a substitute; "why?" on every line.
2. **Valio control room (internal, big screen):** every kitchen's agent live: orders, anomalies, substitutions, enrichment coverage, demand per product (the bonus: Aimo's own stock planning). This is where the data-at-scale UI shines.
3. **Open agent interface:** MCP + OpenAPI over Valio's mock APIs plus our enriched store, so any agent (Claude, ChatGPT, the judge's own) can search, compare by priorities, get substitutes, and order.

## Wow ladder (what the judge sees)
1. **0–10s, hook:** "This hotel kitchen didn't write an order this week. Its agent did, and asked the chef one question."
2. **10–40s, it works:** a real Helsinki menu plus next week's bookings become the regular order, priced and checked against live availability, ranked by this kitchen's priorities (carbon-first vs price-first gives a visibly different basket).
3. **40–90s, the deviation:** the hotel tells the agent "Christmas dinner on the 12th, 140 guests, buffet". The agent proposes the adjustments against the normal order (quantities per dish, extra lines, delivery timing before cut-off), visualised as a diff of the usual week, and the chef shapes it interactively, then signs off. Then the real shortage: **whole ham (`462490`) and lanttulaatikko (`462482`) are out of stock in Valio's own data**; the agent finds valid substitutes, visibly rejects one that breaks a rule, and the chef approves the exact terms. (Salmon only runs short when contended by other kitchens: label that as simulated.) The agent proposes substitutes with the trade-offs shown and the reasons cited; the chef taps once.
4. **"No way, that too?":** switch to the control room: every held line across kitchens and why, live from Postgres. Then a judge's own agent connects to our MCP with a key bound to the judge's own sandbox, plans and orders, and cannot approve.

## Scope
| In (demo path) | Faked or fixture (say so) | Out |
|---|---|---|
| Kitchen app: menu → regular order, priorities, anomalies, substitutes, "why" | Bookings and cover forecasts (simple model + noise) | A full webshop (Valio has one) |
| Agent interface (MCP + OpenAPI) over Valio price/availability + our store: search, compare, substitutes, order | Order placement (no order endpoint exists; we store orders) | Real payments, real Valio systems |
| Web facts for missing data (Exa) and a recall watch (Context.dev), with sources | Some facts from cached web results | Manufacturer onboarding |
| Control room: held lines across kitchens, anomalies, agent traces | Simulated events, labelled; never Valio's real mock | Aimo's own stock management (show demand only) |
| Kitchen profile as the mandate: priorities, constraints, limits; act / propose / sign-off tiers; approvals recorded per line | | Multi-level manager approval chains |
| Event planning: "Christmas dinner, 140 guests" → proposed deviation from the normal order, shaped interactively | Portion heuristics (from research/horeca.md) | Recipe costing |

## Sponsors (load-bearing only)
| Sponsor | Moment in the demo | Fallback |
|---|---|---|
| **Valio Aimo** (main) | The whole flow, against their mock APIs and data | Local fixture of their catalogue |
| **Gemini** (Decisions API, Flash-Lite) | Scores recipe fit inside substitute ranking (calibrated); parses the request on `/request` | Recorded replay, then rules |
| **Aiven** | Runtime hosts the container; Postgres holds kitchens, plans, orders and the op log; NOTIFY streams Ops | PGlite (offline demo) |
| **Context.dev** | Food-recall watch (Finnish Food Authority) → an anomaly that holds the affected lines | Recorded drill |
| **Exa** | Facts for missing allergen/pack data and options outside the catalogue, always suggestions with sources | Cached results |

Parked by D7: Nemotron, Modal, Verda, Cloudinary, Gemma (Featherless adapter exists, not in the demo).

## Multi-challenge map
- **Valio Aimo (main, €4k):** end-to-end 30 (menu → order → anomaly → resolution), user need 20 (the stand's own list), autonomy and controls 20 (priorities as mandate, act-or-ask), robustness to exceptions 15 (anomalies, substitutes, cut-offs), openness 15 (MCP + OpenAPI, provenance).
- **Context.dev main (€2k), if the recall monitor is real:** "react to the live web": a recall notice on the food authority's site → which kitchens ordered that product → substitutes proposed. Real-timeness is 20% of their score.
- **Tech prizes (D7):** Gemini, Aiven, Context.dev tech; each needs a short write-up.

## Data
- **Catalogue (in `data/valio/`, gitignored; copy into lane worktrees like `.env`):** 17,546 products with real GTINs, category, vendor, origin, temperature class, **pack units (pallet / case / piece with sizes) and allowed lot size**, so the vending lesson's physical constraints are in the data. Plus Synkka product data: names, ingredients, nutrition, storage, brand (media ids only, **no image URLs**). Net weight for 56% of products (89% with name parsing). 349 category codes without names. Facts: [foundations/valio-data.md](../foundations/valio-data.md). Also carbon footprint for 11,033 products (kg CO2e/kg) and delivery reliability for 4,425.
- **Mock API** (`data/valio/openapi.json`): `GET /api/ping`, `POST /api/availability`, `POST /api/price`, and download links for the three datasets. **There is no order endpoint**, so ordering is ours to store.
- **Kitchens:** the demo runs on three fictional seed kitchens (`fixtures/seeds/kitchens.json`); Helsinki venue data ([research/venues.md](../research/venues.md)) is background for GROWTH.
- **Planted insights:** a big reservation that triggers a shortfall; a product out of stock with good and bad substitutes; a pack size that doesn't fit; a product recall; one adversarial agent that tries prompt injection through a product description.

## Risks and the spike that kills each one
| Risk | Spike | Result |
|---|---|---|
| Valio's mock API is thin or slow | 20 min: read the portal, call every endpoint, measure latency | Data is rich (17.5k products, pack units, CO2, reliability). API is price + availability only. Base `https://junction26.valioaimo.fi`, header `X-API-Key`, body `{customer, requestedDate, products[≤1000]}`. Measured: ~0.1 s for 2 products, 0.25 s for 1,000 prices (660 kB), 0.16 s for 1,000 availabilities. Availability returns order closing time, logistic model and schedule lines (amount and date per sales unit), so cut-off-time exceptions are real |
| Scraping real menus is slow or blocked | 20 min: Context.dev on 5 Helsinki restaurant sites, extract structured menus | **Go, with caching** ([menu-spike](../archive/prep/research/menu-spike.md)): 7/8 sites, 10–95 dishes each, 6–32 s per page, 5 credits each, max 10 req/min. Extraction varies between runs, so pre-scrape ~20 menus as fixtures. Dish → ingredient → product matching is plausible but noisy, so it needs a rerank step and an alias table |
| Gemini Decisions API access or semantics unclear | Read the `gemini-api-dev` skill (it covers calibrated decisions); one test call now the key is in | Works: `pnpm test:live`, with replay and rules fallbacks |
| Substitute ranking is wrong or unexplainable | 20 out-of-stock cases ranked by Gemini rubric scoring vs a simple weighted scorer | _pending_ |
| A recall feed is too slow or unscrapable | Context.dev on the Finnish Food Authority recall page; does a monitor fire? | _pending_ |
| The control room is visually noisy, not insightful | Mock it with fake events first (impeccable) | _pending_ |
| Too many sponsors dilute the story | Each must pass "would the demo break without it?" | ongoing |
