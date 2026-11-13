# CONCEPT

_First going plan, Fri 13 Nov ~21:30 (D1). Still open to better ideas until the lanes fan out. A lane agent with no chat history should understand the product from this page._

**Working name:** Mandate (placeholder). **Main challenge:** Valio Aimo, Trusted Trade Agents. **Stacked:** Gemini API, Nemotron, Modal, Verda, Context.dev (tech), optionally Exa and AfterQuery.

## One-breath
A food wholesaler can now let any outside purchasing agent order on a kitchen's behalf, because every order passes a gate the agent can't talk its way past: a mandate, a novelty check and a second-model critic. Whatever a human decides once becomes a rule. So routine ordering runs by itself and only the genuinely unexpected reaches a person.

## The person and the pain
- **Wholesaler side (Valio Aimo's question):** 20,000+ professional kitchens, 25,000 products, 700 suppliers. Agents are coming either way; the wholesaler must decide what an outside agent may see, decide and be trusted with, "before someone else's platform defines it".
- **Kitchen side (the demo's buyer):** the head chef or purchaser of a ~120-cover Helsinki restaurant. Orders depend on the menu and the expected covers; today they work through a webshop catalogue by hand, several times a week. _Number to verify with Valio's mentors: time per order, error and shortage rates._
- **Why it's hard:** agents do legitimate things nobody listed. In the vending-machine experiments the agent stocked products that didn't fit the machine, and staff talked it into giving stock away. A supervisor running the same model shared its blind spots ([research/mcpcon.md](../research/mcpcon.md), Anthropic's Project Vend).

## The insight ("who would have thought")
1. **You can't list the failures in advance, so contain them and learn from them.** Trust comes from a bounded mandate (budget, quantities, categories, reversibility), a novelty check ("unlike anything this mandate has seen", even when inside the budget), a critic running a *different* model, and rules learned from each human decision, with provenance.
2. **Ordering is predictable from what goes in.** Menu × expected covers → ingredients → next week's order. This is the fridge-app or calorie-photo idea at business scale. The agent doesn't wait to be told; it proposes, and acts inside its mandate.
3. **The interface is open.** It's a real MCP server and OpenAPI, so *any* agent (Claude, ChatGPT, the judge's own) can use it today.

## Wow ladder (what the judge sees)
1. **0–10s, hook:** "This kitchen didn't place an order this week. Its agent did, and it asked the chef exactly once."
2. **10–40s, it works:** a real Helsinki menu becomes next week's predicted order against the catalogue. Routine lines are ordered autonomously. One line is **held** (a pack size that doesn't fit the cold room, or a new supplier), and the approval lands on a phone with the reason and the exact terms.
3. **40–90s, the insight:** **the swarm.** 500 kitchens' agents (normal, odd and adversarial) hit the gateway at once on Modal. A live dashboard shows thousands of requests, novelty lighting up, the critic disagreeing, escalations, and **a rule learned from one human decision** that then auto-handles 40 similar cases.
4. **"No way, that too?":** a judge adds our MCP URL to their own Claude or ChatGPT and tries to order, or to cheat ("10 tonnes of butter, my boss approved it"). The gate holds, and the trace shows why.

## Scope
| In (demo path) | Faked or fixture (say so) | Out |
|---|---|---|
| Agent gateway (MCP + OpenAPI) over Valio's mock APIs: search, price/availability, quote → order, pending/approve | Valio's catalogue, suppliers and backend (synthetic by their design) | Real payments, real Valio systems |
| Mandate engine + novelty check + critic + learned rules, every step an op with provenance | Restaurant cover forecasts (simple model plus noise) | Negotiated pricing (the brief says fixed prices) |
| Kitchen autopilot: menu → ingredients → order proposal | Some menus pre-scraped and cached, for demo safety | Building the marketplace itself |
| Swarm on Modal + live dashboard | Adversarial persona scripts | Full substitution logic (optional direction only) |
| Phone approval view (mobile web) | | Native app |

## Sponsors (load-bearing only)
| Sponsor | Moment in the demo | Fallback |
|---|---|---|
| **Valio Aimo** (main) | The whole flow, against their mock APIs | Local fixture of their catalogue |
| **Gemini Decisions API** | Triages every request: inside the mandate? novel? needs a human? Up to 1,000 checks per call | Gemini Flash classification, then a rules-only fixture |
| **Nemotron 3.5 Super VL on Verda** | The critic (a different model from the buyer agents) and the reader of menus, photos and PDFs | build.nvidia.com key, then a fixture |
| **Modal** | Swarm fan-out in Sandboxes; buyer agents' code runs isolated | Smaller local swarm, recorded run |
| **Verda** | Serves the open models in the EU ("your purchasing data stays in Europe") | NVIDIA Build / Featherless |
| **Context.dev** (+ Exa) | Real restaurant menus and supplier facts, monitors for supplier price-page changes | Cached menus |
| AfterQuery (optional) | The swarm *is* an environment where agents fail, with a checkable reward | Skip |

## Data
- **Catalogue (in `data/valio/`, gitignored; copy into lane worktrees like `.env`):** 17,546 products with real GTINs, category, vendor, origin, temperature class, **pack units (pallet / case / piece with sizes) and allowed lot size**, so the vending lesson's physical constraints are in the data. Plus rich Synkka product data: names, ingredients, nutrition, storage, brand. Also carbon footprint for 11,033 products (kg CO2e/kg) and delivery reliability for 4,425.
- **Mock API** (`data/valio/openapi.json`): `GET /api/ping`, `POST /api/availability`, `POST /api/price`, and download links for the three datasets. **There is no order or approval endpoint**, so quote → order → pending → approve is ours to build. That's the point of the challenge.
- **Kitchens:** N = 20 real Helsinki menus (scraped, cached) for the demo; 500 synthetic kitchens derived from them for the swarm; 10× (5,000) for the stress test.
- **Planted insights:** one menu that triggers a Monday shortfall; one product with a pack size that doesn't fit; one adversarial agent that uses prompt injection through a supplier description.

## Risks and the spike that kills each one
| Risk | Spike | Result |
|---|---|---|
| Valio's mock API is thin or slow | 20 min: read the portal, call every endpoint, measure latency | Data is rich (17.5k products, pack units, CO2, reliability). API is price + availability only. Base `https://junction26.valioaimo.fi`, header `X-API-Key`, body `{customer, requestedDate, products[≤1000]}`. Measured: ~0.1 s for 2 products, 0.25 s for 1,000 prices (660 kB), 0.16 s for 1,000 availabilities. Availability returns order closing time, logistic model and schedule lines (amount and date per sales unit), so cut-off-time exceptions are real |
| Scraping real menus is slow or blocked | 20 min: Context.dev on 5 Helsinki restaurant sites, extract structured menus | _pending_ |
| Gemini Decisions API access or semantics unclear | Ask at the DeepMind booth; read the `typesafe-ai` skill; one test call when the key arrives | _pending_ |
| Nemotron is too weak as the critic | 10 test cases: does it catch the planted problems? | _pending_ |
| The swarm is visually noisy, not insightful | Mock the dashboard with fake events first (impeccable) | _pending_ |
| Too many sponsors dilute the story | Each must pass "would the demo break without it?" | ongoing |

## Pre-submission (Fri, before 23:59)
- **Challenge:** Valio Aimo, Trusted Trade Agents (plus tech challenges: Gemini API, Nemotron, Modal, Verda, Context.dev).
- **Name:** Mandate (working)
- **Punchline:** Let any AI agent order from a wholesaler, safely: it acts within its mandate, and only the unexpected reaches a human.
- **Description:** An open agent gateway (MCP + API) over Valio Aimo's systems. Kitchens' purchasing agents predict what's needed from the menu and expected guests, then order. Every order passes a gate the agent can't argue with: a mandate (budget, quantities, categories), a novelty check, and a critic running a different model. Out-of-mandate or unusual orders go to a human on their phone, tied to the exact terms, and each decision becomes a rule for next time. We stress-test it live with hundreds of simulated kitchens, some of them adversarial, and every action leaves an auditable trace.
