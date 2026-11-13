# PRODUCT: who it's for, what we build first, how we tell it

_Sat 14 Nov. Uses startup tools (jobs to be done, user stories, forces, riskiest assumptions) to sharpen the big build in [D4](../DECISIONS.md) rings, not to shrink it. Grounded in [valio-data](../foundations/valio-data.md), [horeca](../research/horeca.md), [ux](../foundations/ux.md) and the reviews. **(?)** = our assumption, still to be checked._

**Tags.** Ring `R0`–`R3` per D4. Criterion: `E2E` end-to-end 30 · `Need` user need 20 · `Ctrl` autonomy and controls 20 · `Exc` exceptions 15 · `Open` openness and path 15 · side entries `Ctx` `Exa` `Lab`.

## 1. Personas and jobs
| | **Head chef / purchaser**, 120-cover Helsinki restaurant | **Hotel F&B / exec chef**, banquets, Christmas season | **Valio Aimo account / ops** | **Outside agent developer** (hotel chain IT, Choco-type app) |
|---|---|---|---|---|
| Job | "Get the right stuff in by delivery day without thinking about it, and save my week when it breaks." | "Turn a BEO (140 guests, joulupöytä, 12 Dec) into the right extra order, on time, without over-buying." | "Keep my kitchens supplied and loyal; catch problems before they call me." | "Let my agent buy from Aimo safely, without screen-scraping a webshop." |
| Workaround today | Webshop templates + order history, re-edited by hand at 23:00; phone customer service for shortages | Excel per event, guesses +10–15% over the guarantee, separate cart per delivery date | Phone/email when lines short-ship; My Aimo reports after the fact | No API: scraping, or a human re-keys the agent's list |
| Pain | Short deliveries found on arrival; unannounced substitutes; pack sizes unclear (11% of name/weight pairs conflict) | Guarantee firms up at T−72 h, after some cut-offs; 15–20% food waste in Finnish food service | No view of *why* a customer changed or left; substitutes handled ad hoc (Valio's own rules cover 1.1% of products) | No permissions model, no fixed-price commit, no audit trail |
| Trigger moment | Big booking lands; "out of stock" on Thursday's cut-off day; a recall notice | Event signed; guarantee changes; a Christmas item undeliverable (lanttulaatikko `462482` = 0) | A product goes scarce across many kitchens; a recall | Their customer asks "can the bot just order it?" |
| "Hired" looks like | Confirms a plan in minutes, changes one thing not twenty, never surprised at delivery | Event shown as a diff of the normal week, editable g/guest, waste number visible, signs off once | One screen: which kitchens need action and why; every agent decision inspectable | Connects via MCP/OpenAPI, gets a held order + approval link, a receipt |

**Forces of switching (the chef).** Push: the week never goes to plan; late-night re-ordering. Pull: an order that repairs itself and explains why. **Anxiety:** "it will buy the wrong thing / an allergen / too much" → answered by the mandate card, tiers and hold-to-approve. **Habit:** templates already work for the routine → so our wedge is the *exceptions*, not the routine order (Valio already has templates, recipes-to-cart, A.I.mo).

**Buyer vs user.** The user is the kitchen (and its agent). The **buyer is Valio Aimo**: it would run this as its agent gateway, free to kitchens (as Choco is free to restaurants), and pay for it with retention, fewer short-ship service contacts and control over how agents read its catalogue. Secondary buyer later: chains' central purchasing (policy compliance).

## 2. User stories (25; ★ = the 8 that define Ring 0)
| # | Epic · story | Acceptance (observable) | Ring | Scores |
|---|---|---|---|---|
| ★1 | **Order flow.** As a hotel purchaser I want "1,000 L lactose-free milk by Monday" turned into a priced, availability-checked order so that I don't search the catalogue | Stepper shows Request → Lookup (live price €1.56/l for `464201`, labelled live/cache) → pending order 100 × KI → held (€1,560 > €1,000 cap) → approved → receipt | R0 | E2E |
| ★2 | **Event.** As an exec chef I want "Christmas dinner, 12 Dec, 140, buffet" shown as a diff against my normal week so that I see only what changes | Per-dish rows: guests × g/guest → kg → packs, rounding shown ("21 kg → 9 × 2.5 kg"); editing ham 150 → 120 g recomputes in < 1 s | R0 | Need |
| ★3 | **Rescue.** As a chef I want a shortage replaced by substitutes that fit my priorities so that service isn't at risk | ≥ 3 candidates with €/kg, CO₂e (group avg), reliability, origin, pack fit; one attractive candidate visibly **rejected** with the rule; residual shortfall stated if no full fix | R0 | Exc, Need |
| ★4 | **Mandate.** As a chef I want to state what the agent may do alone so that I only see decisions outside it | Mandate card in plain words; server enforces per-line, per-order **and cumulative weekly** caps; splitting an order cannot evade the cap (test) | R0 | Ctrl |
| ★5 | **Approval.** As a chef I want approval bound to exact terms so that a changed price or quantity can't ride on my "yes" | Approval stores SKU, unit, qty, price, date, version; any change → approval void, line back to held | R0 | Ctrl |
| ★6 | **Commit.** As a purchaser I want one durable order however often the button is hit so that I never get double deliveries | Idempotency key; retry returns the same receipt; reload shows it (Postgres) | R0 | E2E, Ctrl |
| ★7 | **Open door.** As an outside agent developer I want to search, quote and order through MCP/REST under the same rules so that my agent is a first-class buyer | External client's order goes through the same gate, is held, approved on the phone, appears in the op log as "external agent" | R0 | Open |
| ★8 | **Why.** As a chef or Valio ops I want every line to say why and from what source so that I can trust or correct it | Why drawer: dish → g/guest → covers → kg → packs → chosen because (weights) → price at time T → source label | R0 | Open, Ctrl |
| 9 | **Week.** As a chef I want menu × expected covers × stock → the regular order so that I confirm rather than type | `max(0, demand + target stock − on hand − inbound)` per line, shown; ≥ 80% of lines accepted unedited in rehearsal | R1 | Need |
| 10 | As a chef I want priorities (price / carbon / Finnish / organic / reliability) so that baskets differ by kitchen | Price-first vs carbon-first produce visibly different winners on the same shortage | R0→R1 | Need |
| 11 | As a chef I want "require FI" on meat, distinct from "prefer" so that origin law is respected | A non-FI meat substitute is held, never auto-acted | R1 | Ctrl |
| 12 | **Time.** As a purchaser I want a cut-off countdown per delivery so that I order in time | "Order by Sun 17:00 for Mon"; after cut-off → next date proposed, never a silent miss | R1 | Exc |
| 13 | As an exec chef I want the guarantee drop (140 → 124 at T−72 h) to shrink the top-up so that I don't over-buy | Two-step order (bulk now, top-up after guarantee); delta in kg, €, CO₂e | R1 | Need |
| 14 | As a chef I want a waste line ("vs your usual +15%") so that I see the money I keep | Number computed from the plan, labelled as an estimate | R1 | Need |
| 15 | **Ops.** As Valio ops I want kitchens needing action, held lines and shortfalls in one view so that I act before they call | Click a kitchen → its exact plan; same events as the kitchen app (one store) | R1 | E2E, Open |
| 16 | As Valio ops I want demand on scarce SKUs across kitchens so that I see contention (salmon 43 kg) | Per-SKU committed vs available; the salmon bar fills as kitchens commit | R1 | Exc |
| 17 | **Web.** As a chef I want a recall/spec change to flag affected lines so that I don't serve a recalled product | Source URL + fetch time; GTIN match → "potentially affected" unless batch known; substitutes proposed | R1 | Ctx, Exc |
| 18 | As a chef I want "find a replacement for X for this dish" answered with web evidence so that odd substitutes are justified | Exa sources in the compare card; unsupported → "no supported answer" | R1 | Exa |
| 19 | **Gate safety.** As Valio I want product text treated as data so that an injected description can't steer agents | Planted injection in a description has no effect; flagged in the log | R1 | Ctrl |
| 20 | As a chef I want the agent to ask one question when intent is unclear so that it doesn't guess | Gemini decision "ask" → one question card; answer re-plans | R0→R1 | Need, Ctrl |
| 21 | **Lab.** As a judge I want a seeded environment where agents plan under budget, stock and deadlines so that failures are measurable | One-command run, reference vs frontier, do-nothing baseline | R2 | Lab |
| 22 | As Valio I want 500 simulated kitchens through the same gate (simulator, never their API) so that scale is shown honestly | Throughput, held %, violations = 0; labelled synthetic | R2 | Modal, Open |
| 23 | As Valio I want catalogue gaps filled with provenance so that agents can reason over it | Coverage panel split measured / estimated / unknown; reliability unknown stays unknown | R2 | Open |
| 24 | **Docs.** As an exec chef I want a BEO or prep-list photo to become an event so that I skip typing | Extracted fields shown next to the crop, editable | R3 | Nemotron |
| 25 | As a chef I want to snooze/decline a proposal so that the agent learns my "no" | Declined substitute not re-proposed this week | R3 | Need |

## 3. Core flows
**F1 Regular week (R1).** Menu + covers forecast + on-hand → demand per SKU → pack rounding → live lookup of **only these ids** → lines tiered. *Decision:* known product, in cap → **act**; new SKU or > line cap → **propose**; over weekly cap → **sign-off**. *Fail:* API down → cache/simulator, lines labelled "cached at T"; unknown id → reject before calling (it would look undeliverable).

**F2 Christmas dinner for 140 (R0).** Event card → dish template (hand-verified, §7) → g/guest × 140 → kg → packs → diff vs normal week. Real data hits: whole ham on the bone `462490` = 0 → sliced Juhlakinkku `462919` (Terminal, quantity unknown, cut-off Thu); lanttulaatikko `462482` = 0 and big formats undeliverable → propose another casserole or "make in-house" (residual). *Decision:* event total > weekly cap → **sign-off** once for the event layer. *Fail:* guarantee after cut-off → two-step order; Terminal 999999 → "unknown quantity, confirm with Valio", never "plenty".

**F3 Shortage rescue, salmon (R0).** Need ≈ 11.5 kg (60–80 g/guest + trim) vs Valio stock **43 kg live**, of which the simulator has 34 kg committed by other kitchens (labelled) → 9 kg for us. Candidates: Finnish trout `462016` (€15.77/kg, 40 kg, rel 1.0) ranks first on origin; smoked trout buffet `471898` (rel **0.33**, stock 0) is **rejected by rule** in view of the chef; partial salmon + trout split is an option. *Decision:* Gemini scores dish fit; hard rules (allergen, origin require, availability) are code. Substitute breaking a preference → **sign-off**. *Fail:* no valid candidate → residual shortfall shown with kg and the dish affected.

**F4 Recall / web change (R1).** Monitor (Context.dev) → extracted notice → GTIN match against open orders → "potentially affected" (no batch in orders) → lines held, substitutes proposed, Ops view lights the kitchens. *Fail:* no match → notice kept, inspectable; replayed notice labelled "replay".

**F5 External agent orders (R0).** Judge's Claude → MCP `search` → `quote` (live, shortlisted ids) → `place_order` → **pending**, never committed by the agent → approval link on the phone (agent holds no approval tool) → receipt in both places. *Fail:* stale quote → re-quote; duplicate call → same receipt.

**F6 Ops oversight (R1).** Stream of ops from Postgres with a cursor → kitchens by state (working / waiting / held / done) → scarce SKUs → drill into a plan. *Decision:* ops can see and message; it cannot approve for the kitchen.

## 4. Cases and edge cases (ranked by how likely a judge hits it)
| # | Case | Expected behaviour | Where |
|---|---|---|---|
| 1 | Partial availability (milk 640 L Mon, rest Wed; simulated, the mock never splits) | Split into two lines with dates; requested-by date missed for the rest → ask | **demo** |
| 2 | Out of stock (0) / undeliverable (`[]`, 18%) | Rescue flow; undeliverable ≠ out-of-stock wording | **demo** |
| 3 | Unknown quantity (Terminal 999999, 42%) | "Supplier-delivered, quantity unknown, lead time 3–4 d"; never counted as cover for a hard need | **demo** |
| 4 | Over cap, incl. split orders to dodge it | Held; cumulative cap test | **demo** + test |
| 5 | Stale approval (price/qty/date changed) | Approval void, back to held, reason shown | **demo** + test |
| 6 | Duplicate commit / retry | One receipt | **demo** + test |
| 7 | Substitute breaks a preference (Oatly `470863`: cheaper, 0.44 CO₂e, but SE and not dairy) | Ranked but tiered **sign-off**, the broken preference named | **demo** |
| 8 | Unreliable supplier (`471898` rel 0.33) | Warning chip; never auto-acted | **demo** |
| 9 | Pack-size / catch-weight (KG items with 1.5–15 kg steps; 11% name/weight conflicts, "Eila voi 4x5 kg" = one 5 kg block) | Round up to lot step, show it; conflicting unit data → hold, no LLM guess | **demo** (hero SKUs) + test |
| 10 | Cut-off missed | Next delivery date proposed; never silent | demo (simulated clock) |
| 11 | Valio's own rule points at an undeliverable product (`464201` → `464440`) | Skip it, say "Valio's rule, not deliverable", go on | test |
| 12 | Missing allergen data (59%) | "Unknown" never satisfies "free from"; held if the kitchen has that constraint | test (demo if asked) |
| 13 | Missing carbon (37%) / group average | "Estimated from category" label; carbon ranks across groups, not within | test |
| 14 | Injected text in product data | Ignored; flagged | test, demo in Ops if time |
| 15 | Two kitchens contend for the same scarce stock | Simulator commits consume stock consistently; second sees less | test (R1 demo in Ops) |
| 16 | Seasonal block (Laskiaispulla salesBlock to 30 Dec) | "Not orderable until" | test |
| 17 | Recall without batch | "Potentially affected" | later (R1) |
| 18 | Price basis mismatch (per piece vs per kg, VAT 13.5/25.5%) | Compare on comparisonPrice ex VAT; null → per-unit with note | test |
| 19 | LLM down / slow | Rules ranking, labelled; flow still completes | test |
| 20 | Old-flagged names (POISTO/VANHA) | Excluded from search | later |

## 5. Value proposition and story
**Value proposition.** *For kitchens:* the order repairs itself when the week changes, and asks only what's outside your rules. *For Valio:* every agent, yours or someone else's, buys through a gate you define, with your data, rules and audit.

**Why now.** Buyers' agents are arriving (MCP and agent tool-use are now standard in Claude, ChatGPT, Gemini); if Valio doesn't publish the door, they'll scrape the webshop or another platform will own the interface (Valio's brief: "before that interface gets defined by someone else's platform"). **Why agents.** The routine is solved by templates; the pain is exceptions: judgement across price, origin, carbon, reliability, pack and cut-off, under a deadline, at 23:00. **Why Valio.** It holds what an agent needs and an outsider can't get: live availability and cut-offs, substitution rules, carbon and reliability per product, 20,000+ kitchens' demand.

**Wedge → expansion.** Wedge: events + shortages for hotel kitchens in the Christmas season (the peak of the year). Then: act-tier routine ordering → the open gate for all external agents → aggregated demand for Aimo's own stock planning → the planned B2B marketplace with suppliers behind the same gate.

**Pilot Valio could run next month (Dec 2026).** 3–5 Helsinki hotel kitchens, 4 weeks over pikkujoulu/Christmas. Weeks 1–2 **shadow**: agent proposes, chef orders as usual, we compare. Weeks 3–4 **act tier on** with a €-cap. Metrics and thresholds: ≥ 80% of agent lines accepted unedited; ≥ 90% of short lines get a valid substitute proposal **before cut-off**; chef ordering time −50% (self-reported + click logs); **zero** mandate breaches and duplicate orders (hard stop). Secondary for Valio: short-ship service contacts per kitchen.

**Three metrics we can show honestly in the demo.** (1) **Edits per plan:** Christmas plan of N lines, chef changed 1 (counted live). (2) **Gate outcomes:** acted / held / rejected counts with reasons, 0 duplicates after a deliberate retry. (3) **Lookup economy and time-to-rescue:** "23 live lookups of 17,546 products, 0.2 s; shortage → valid proposal in X s". Do not claim waste savings as measured; say "estimated".

## 6. Riskiest assumptions and the cheapest test this weekend
| Type | Assumption | Cheapest test (≤ 15 min) |
|---|---|---|
| Desirability | Exceptions, not routine orders, are where kitchens lose time | Ask a Valio mentor: share of lines short-shipped; how substitutes reach the customer today; a hotel's orders/week |
| Desirability | Chefs will let an agent act alone under a cap | Ask a chef / mentor: "what would you never delegate?" Expect allergens and origin; put the answer on the mandate card |
| Desirability | Valio values the external-agent gate as much as the kitchen UI | Ask the mentor which 30 s they'd rather see: chef app or an outside agent ordering through the gate. Re-order the demo by the answer |
| Feasibility | One kitchen's Christmas salmon runs short for real | **Data check done here: it doesn't** (≈ 11.5 kg vs 43 kg). Honest framing = contention from other kitchens (simulated, labelled) or use the fully real ham/lanttulaatikko outages |
| Feasibility | Dish → SKU → pack mapping is right for the hero menu | Hand-map the 10-dish buffet; check every pack in the data (lot step, net weight) |
| Feasibility | Gemini ranking beats a weighted scorer | 20 labelled substitute cases, both rankers, count agreement with the mentor's label |
| Feasibility | Cut-offs and dates are usable | Ask the mentor Q3 in valio-data (does closingTime move?); else the simulator owns the clock, labelled |
| Viability | Valio would own and fund this, free to kitchens | Ask: "which team inside Aimo would own this; which KPI moves?" Quote the answer in the pitch |
| Viability | Liability for a wrong substitute is acceptable | Ask: who is accountable today when Aimo substitutes? Our answer: hard rules in code, human sign-off on anything novel |

## 7. Do things that don't scale
- **Time today's workflow** in the real webshop test account: build the Christmas order by hand, count minutes and clicks. That is the pitch's baseline, not a vendor statistic.
- **Hand-verified Christmas buffet** (10 dishes, g/guest from horeca §7, mapped to hero SKUs), reviewed by a mentor or chef; provenance "reviewed by …".
- **One real Helsinki menu** (cached Context.dev scrape, hand-cleaned) as the demo kitchen's normal week.
- **Mentor-validated substitutes** for the 5 hero shortages (salmon, whole ham, lanttulaatikko, milk 0.5 l rule, unreliable trout); label "validated by Valio mentor".
- **Hand-written mandate** in a chef's words ("≤ €2,000/week alone; never change allergens; Finnish meat only").
- **Readable names by hand** for the ~30 hero SKUs; the batch does the rest later.
- **Rehearse with a mentor playing the chef**; count their edits, use the number.

## Recommended changes
1. **CONCEPT:** make the wedge explicit ("exceptions, not the routine order"); name Valio as the buyer and the gate as its product; fix "a 140-guest buffet runs short" for salmon to "contended stock (simulated)" and promote ham `462490` / lanttulaatikko `462482` as the fully real outages.
2. **CONCEPT wow ladder:** open on the event + rescue, keep the milk example as the required-flow beat, cut the broken-fridge photo from the 90 s (R3).
3. **SCORECARD:** add the three demo metrics (edits per plan, gate outcomes with 0 duplicates, lookup economy/time-to-rescue) as evidence; add the pilot as the "path to production" evidence for Open 15.
4. **Lane briefs:** each lane's acceptance = the ★ stories it owns; core/gate lane owns ★4–6 plus edge cases 4–6 and 9 as tests; kitchen lane ★1–3, ★8; interface lane ★7; edge cases 1–3, 7, 8 are seeded fixtures in the simulator lane.
5. **ARCHITECTURE:** `Mandate {lineCap, orderCap, weeklyCap, require[], prefer[], neverDelegate[]}`, `Approval {terms hash, version}`, `Availability {kind: unlimited|known|unknown|out|undeliverable|blocked}` as closed sets.
6. **PITCH:** use the stand questions in §6 Saturday morning; replace numbers marked (?) with mentor answers or the webshop timing.
