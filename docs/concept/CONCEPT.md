# CONCEPT

_v2.1, Fri 13 Nov ~23:45, after Valio Aimo's stand and their printed info sheet (photo in `Misc/`). D1 still stands. A lane agent with no chat history should understand the product from this page._

**Working name:** Mandate (placeholder). **Main challenge:** Valio Aimo, Trusted Trade Agents. **Stacked:** Gemini API, Nemotron, Modal, Verda, Aiven, Cloudinary, Context.dev (tech); maybe the Context.dev main challenge (live recalls) and Gemma.

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
- **"Query the APIs only when needed, never for all products."** So: no bulk price/availability sweeps against their API. The swarm and the stress test run against **our own simulator of their API** (the fixture adapter), and live calls go only for the lines in an actual order.
- "Trust and openness by design: a full flow that works, a clear model for human sign-off, and open, well-documented choices. Not a production-ready system in 48 hours."
- A test account for the real webshop exists (credentials on the photo, never in git): use it to study today's ordering flow.

## One-breath
A kitchen tells its agent what it cooks and what it cares about (price, carbon, Finnish, organic). The agent keeps it stocked through Valio Aimo: it plans the regular order from the menu, notices anomalies (a big reservation, a broken fridge, a product out of stock), and resolves them with substitutes that fit the kitchen's priorities. It explains every choice and stays inside limits the kitchen set. Under it is an open agent interface (MCP + API) that any agent can use, and an internal control room where Valio sees every kitchen's agent at work.

## The person and the pain
- **Kitchen (primary user):** the head chef or purchaser of a ~120-cover Helsinki restaurant, or a hotel kitchen (big client). The order follows the menu and the expected covers, but the week never goes to plan: reservations jump, deliveries miss cut-off times, products are out, a fridge dies. Today they rework the order by hand in the webshop. _Numbers to verify with Valio: orders per week, time per order, shortage rate._
- **Valio Aimo (operator):** wants kitchens' agents to work *with* Aimo, before another platform owns the customer relationship. They need enriched product data an agent can reason over, and visibility of what the agents do.
- **Why it's hard:** agents do legitimate things nobody listed. The vending-machine agent stocked products that didn't fit the machine ([research/mcpcon.md](../research/mcpcon.md)). Pack sizes, cut-off times, temperature classes and missing data are this domain's "doesn't fit the machine".

## The insight ("who would have thought")
1. **Ordering is predictable from what goes in.** Menu × expected covers → ingredients → the regular order. The kitchen doesn't type an order; it confirms one. This is the fridge-app or calorie-photo idea at business scale.
2. **Anomalies are where agents earn trust.** The value is not the routine order but the Friday when 80 extra guests booked and the salmon is out: the agent finds substitutes that match *this* kitchen's priorities, shows the trade-offs (price vs carbon vs delivery reliability), and explains why.
3. **Priorities are the mandate, and sign-off is a designed step.** The kitchen's profile (weights for price, carbon, origin, organic; hard constraints such as allergens; spend limits) bounds what the agent does alone. Three tiers: **act** (routine, inside the mandate), **propose** (a deviation the chef shapes with the agent, such as an event), **sign-off** (over a limit, novel, or a substitute that breaks a preference). Every approval is recorded against the exact order lines. Human in the loop stays central; what changes is that the human co-plans instead of rubber-stamping.
4. **Enrichment makes the catalogue agent-readable.** 11k of 17.5k products have carbon data and 4.4k have delivery reliability; names, pack sizes and specs are messy. We enrich the whole catalogue in one batch (Modal fan-out, web sources via Context.dev/Exa), with provenance on every filled value ("estimated from category", "source: X").

## Three faces of one system
1. **Kitchen app (customer-facing, phone-first; not a chatbot):** a live order plan the agent edits in front of you, with chat or voice as one way to explain context. Priority sliders; the week's anomalies as cards; one tap to accept a substitute; "why?" on every line. Snap a photo (a handwritten prep list, a broken fridge, a delivery note) and the agent acts on it.
2. **Valio control room (internal, big screen):** every kitchen's agent live: orders, anomalies, substitutions, enrichment coverage, demand per product (the bonus: Aimo's own stock planning). The swarm runs here. This is where the data-at-scale UI shines.
3. **Open agent interface:** MCP + OpenAPI over Valio's mock APIs plus our enriched store, so any agent (Claude, ChatGPT, the judge's own) can search, compare by priorities, get substitutes, and order.

## Wow ladder (what the judge sees)
1. **0–10s, hook:** "This hotel kitchen didn't write an order this week. Its agent did, and asked the chef one question."
2. **10–40s, it works:** a real Helsinki menu plus next week's bookings become the regular order, priced and checked against live availability, ranked by this kitchen's priorities (carbon-first vs price-first gives a visibly different basket).
3. **40–90s, the deviation:** the hotel tells the agent "Christmas dinner on the 12th, 140 guests, buffet". The agent proposes the adjustments against the normal order (quantities per dish, extra lines, delivery timing before cut-off), visualised as a diff of the usual week, and the chef shapes it interactively, then signs off. Then an anomaly: "Friday: +80 covers, and the salmon is out." The agent proposes substitutes with the trade-offs shown and the reasons cited; the chef taps once. A photo of a broken fridge reschedules the chilled lines.
4. **"No way, that too?":** switch to the control room: 500 kitchens' agents running at once (Modal), anomalies and substitutions streaming, the catalogue enriched in one batch. Then a judge's own Claude connects to our MCP and orders.

## Scope
| In (demo path) | Faked or fixture (say so) | Out |
|---|---|---|
| Kitchen app: menu → regular order, priorities, anomalies, substitutes, "why", photo input | Bookings and cover forecasts (simple model + noise) | A full webshop (Valio has one) |
| Agent interface (MCP + OpenAPI) over Valio price/availability + our store: search, compare, substitutes, order | Order placement (no order endpoint exists; we store orders) | Real payments, real Valio systems |
| Enrichment batch over the catalogue (carbon estimates, pack-size normalisation, missing specs) with provenance | Some enrichment from cached web results | Manufacturer onboarding |
| Control room: live agents, anomalies, demand, enrichment coverage; the swarm | Swarm personas; the swarm hits our API simulator, never Valio's real mock | Aimo's own stock management (show demand only) |
| Kitchen profile as the mandate: priorities, constraints, limits; act / propose / sign-off tiers; approvals recorded per line | | Multi-level manager approval chains |
| Event planning: "Christmas dinner, 140 guests" → proposed deviation from the normal order, shaped interactively | Portion heuristics (from research/horeca.md) | Recipe costing |

## Sponsors (load-bearing only)
| Sponsor | Moment in the demo | Fallback |
|---|---|---|
| **Valio Aimo** (main) | The whole flow, against their mock APIs and data | Local fixture of their catalogue |
| **Gemini** (Decisions API + Live) | Ranks substitutes against the kitchen's priorities (calibrated rubric scoring, many at a time); decides "act or ask"; optional voice for the chef | Gemini Flash, then rules |
| **Nemotron 3.5 Super VL on Verda** | Reads photos and PDFs (prep lists, delivery notes, spec sheets); second-model check on the agent's plan | build.nvidia.com key, then fixture |
| **Modal** | Batch enrichment of all 17.5k products (from the data files, not the API); the 500-kitchen swarm against our simulator of Valio's API; agent code in Sandboxes | Smaller batch, recorded run |
| **Verda** | Hosts the open models in the EU; GPU for the batch if needed | NVIDIA Build / Featherless |
| **Aiven** | Postgres: enriched catalogue (pgvector), kitchens, orders, ops; LISTEN/NOTIFY streams the control room; maybe Runtime hosting | Local Postgres |
| **Cloudinary** | Product images from Valio's data, transformed for the phone UI | Raw image URLs |
| **Context.dev** (+ Exa) | Real menus; manufacturer data for enrichment; **live food-recall monitor** (Finnish Food Authority) that triggers an anomaly | Cached results |
| Gemma (Featherless) | Cheap model for the swarm's kitchen agents | Any small model |

## Multi-challenge map
- **Valio Aimo (main, €4k):** end-to-end 30 (menu → order → anomaly → resolution), user need 20 (the stand's own list), autonomy and controls 20 (priorities as mandate, act-or-ask), robustness to exceptions 15 (anomalies, substitutes, cut-offs), openness 15 (MCP + OpenAPI, provenance).
- **Context.dev main (€2k), if the recall monitor is real:** "react to the live web": a recall notice on the food authority's site → which kitchens ordered that product → substitutes proposed within minutes. Real-timeness is 20% of their score.
- **Tech prizes:** Gemini, Nemotron, Modal, Verda, Aiven, Cloudinary, Context.dev tech, Gemma; each needs a short write-up.

## Data
- **Catalogue (in `data/valio/`, gitignored; copy into lane worktrees like `.env`):** 17,546 products with real GTINs, category, vendor, origin, temperature class, **pack units (pallet / case / piece with sizes) and allowed lot size**, so the vending lesson's physical constraints are in the data. Plus rich Synkka product data: names, ingredients, nutrition, storage, brand, images. Also carbon footprint for 11,033 products (kg CO2e/kg) and delivery reliability for 4,425.
- **Mock API** (`data/valio/openapi.json`): `GET /api/ping`, `POST /api/availability`, `POST /api/price`, and download links for the three datasets. **There is no order endpoint**, so ordering is ours to store.
- **Kitchens:** N = 20 real Helsinki menus (scraped, cached) for the demo; 500 synthetic kitchens derived from them for the swarm; 10× (5,000) for the stress test.
- **Planted insights:** a big reservation that triggers a shortfall; a product out of stock with good and bad substitutes; a pack size that doesn't fit; a product recall; one adversarial agent that tries prompt injection through a product description.

## Risks and the spike that kills each one
| Risk | Spike | Result |
|---|---|---|
| Valio's mock API is thin or slow | 20 min: read the portal, call every endpoint, measure latency | Data is rich (17.5k products, pack units, CO2, reliability). API is price + availability only. Base `https://junction26.valioaimo.fi`, header `X-API-Key`, body `{customer, requestedDate, products[≤1000]}`. Measured: ~0.1 s for 2 products, 0.25 s for 1,000 prices (660 kB), 0.16 s for 1,000 availabilities. Availability returns order closing time, logistic model and schedule lines (amount and date per sales unit), so cut-off-time exceptions are real |
| Scraping real menus is slow or blocked | 20 min: Context.dev on 5 Helsinki restaurant sites, extract structured menus | **Go, with caching** ([research/menu-spike.md](../research/menu-spike.md)): 7/8 sites, 10–95 dishes each, 6–32 s per page, 5 credits each, max 10 req/min. Extraction varies between runs, so pre-scrape ~20 menus as fixtures. Dish → ingredient → product matching is plausible but noisy, so it needs a rerank step and an alias table |
| Gemini Decisions API access or semantics unclear | Read the `gemini-api-dev` skill (it covers calibrated decisions); one test call now the key is in | _pending_ |
| Substitute ranking is wrong or unexplainable | 20 out-of-stock cases ranked by Gemini rubric scoring vs a simple weighted scorer | _pending_ |
| Nemotron is too weak for photos or as a second check | 10 cases: prep-list photo, delivery note, planted plan errors | _pending_ |
| A recall feed is too slow or unscrapable | Context.dev on the Finnish Food Authority recall page; does a monitor fire? | _pending_ |
| The control room is visually noisy, not insightful | Mock it with fake events first (impeccable) | _pending_ |
| Too many sponsors dilute the story | Each must pass "would the demo break without it?" | ongoing |

## Pre-submission (Fri, before 23:59)
- **Challenge:** Valio Aimo, Trusted Trade Agents (plus tech challenges: Gemini API, Nemotron, Modal, Verda, Aiven, Cloudinary, Context.dev).
- **Name:** Mandate (working)
- **Punchline:** An agent that keeps a kitchen stocked: it plans from the menu, handles the week's surprises, and explains every choice.
- **Description:** A kitchen-facing purchasing agent on top of Valio Aimo. It turns the menu and expected guests into the regular order, then handles the anomalies: big reservations, out-of-stock items, broken equipment, recalls. It proposes substitutes ranked by each kitchen's own priorities (price, carbon, origin) and explains every choice. It works through an open agent interface (MCP + API) over an enriched catalogue, so any agent can use it, and Valio gets a live control room of every kitchen's agent. Data stays in Finland.
