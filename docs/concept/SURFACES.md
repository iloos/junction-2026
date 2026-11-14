# SURFACES: the shape of the product, its doors and its navigation

_Lead-owned design note, Sat 14 Nov. Built from the verbatim Valio brief, CONCEPT, PRODUCT, PITCH, GROWTH, ux.md, the round-4 reviews, [sibling-repos](../research/sibling-repos.md) and a look at the deployed build (desktop + 390 px). **A direction and contract, not a claim of what is built.** Section 7 says what to do this weekend; everything else is the shape the slices should grow into._

## 1. What the challenge actually asks
Valio's brief, in their words: *"This is not about replacing today's e-commerce UI with a chatbot. It is about defining how a European food-service wholesaler can be safely and openly readable by autonomous agents."* Their example actor is **"a hotel chain's agent"**, not a chef at a screen. Their required flow is Request → Lookup → Order → Approval, and their insight list is trust protocol, guardrails model, response logic (partial availability, good-better-best) and **an audit trail usable by both buyer and Valio**.

So the product has **one engine and several doors**, and the doors don't carry equal weight in scoring:

| Door | Who comes through it | What it proves (criterion) |
|---|---|---|
| **Agent door** (MCP / REST / OpenAPI) | A buyer's agent: the judge's Claude, a hotel chain's system | E2E 30 on their own example; Openness 15; that the gate holds for agents we don't control (Autonomy 20) |
| **Kitchen** (canvas + conversation) | Chef, purchaser, exec chef | User need 20 ("least manual correction"); human sign-off (Autonomy 20); exceptions (Robustness 15) |
| **Operations** | Valio account / ops | Valio's half of the audit trail; exceptions across kitchens; "who owns the customer relationship" |
| **Approval link** | The human an agent escalates to | The bridge between doors: an agent asks, a person signs exact terms on a phone |

Implication: the kitchen app is **the human side of an agent interface**, not the product's centre of gravity. It is where people state the mandate, decide what the agent may not, and see what happened. It is not where every order is typed.

## 2. Who we optimise for, and what each needs to see
| Audience | Must see within a minute | Where it lives |
|---|---|---|
| Valio judges (mentors on marketplace, online sales, IT/data governance) | Their milk example end to end through an outside agent; a sign-off model they recognise (spend, substitutions outside preferences); an audit row both sides can read; assumptions stated | Agent door → approval link → receipt → Ops row |
| Peer reviewers and the jury (generic: innovation, impact, implementation; past winners were tight live demos) | One surprising moment they can touch: change a rule or a portion and watch the order and the asks change | Kitchen, judge's phone via QR |
| Kept sponsors (D7): Gemini, Aiven, Context.dev, Exa (Modal + Gemma if convenient) | Each in one load-bearing moment, labelled where it acts | Gemini: fit score in the rescue compare + request parsing; Aiven: Ops stream + reload recovery; Context.dev: a recall that opens a case; Exa: sourced facts on an unknown field |
| Chef | "What needs me before the next cut-off?" and nothing else | Kitchen Inbox |
| Exec chef | The event as a diff of the normal week, editable per guest | Kitchen event layer |
| Valio ops | Which kitchens are at risk, why, who acts, by when | Ops queue → case → exact plan |
| Agent developer | Connect, search, quote, order, get a structured pending result and an approval URL | Agent door page + MCP |

## 2b. What comparable products teach ([analogs](../research/analogs.md))
- **The routine already exists; don't rebuild it.** Valio Aimo's webshop has order templates (*tilauspohjat*: private / shared / central) and a cart per delivery date, and Kespro has *vakiolistat* ([valio-baseline](../research/valio-baseline.md)). Our standing order is the kitchen's existing template read as the agent's **baseline**, not a new list editor. What the webshop lacks, and we add: limits and approval, delegation to agents, explained substitutes ("Katso korvaavat" shows similar products with no reason or allergen diff), and an agent door.
- **Their assistant answers questions; ours acts.** Asked Valio's own milk example, A.I.mo (webshop chat, Leadoo AI) said it can't confirm availability or price and pointed to sales service. That's the honest baseline for the pitch; say it respectfully and with the date.
- **The pitch claim is taken.** Choco's OrderAgent Autopilot already says "only genuine exceptions reach a person". Our difference: the exception rule is the **customer's mandate**, enforced in an **open interface any agent can use**, with approval **bound to exact terms**. Choco's is a vendor feature inside its own app. Say this in the Q&A.
- **Fallbacks set in advance make stock-outs silent.** US Foods lets each list line carry a primary and fallbacks. A pre-approved fallback is a mandate rule: inside it, the agent swaps and tells; outside it, it asks.
- **Show decisions, not alerts, ranked by stakes.** Lokad ranks by expected value; Kinaxis by importance; Zendesk sorts by time to breach. Rank the Inbox and Ops by **€ at risk × time to cut-off**.
- **Group signals into one case.** PagerDuty folds related alerts into one incident and says why. Amazon Business sends one notification even when several policies fire. One recall across 40 kitchens is **one** Ops case; several held lines with one reason are **one** Decision.
- **Say why it needs you, and hold the terms.** Amazon and Coupa show the rule that fired; Amazon holds price and quantities while approval waits. We bind to a hash, which is stronger. Show the rule first and the hash last.
- **Agents prepare, people decide.** Ramp's agents "never approve or reject". Linear keeps a human assignee and shows the agent's state. AP2 splits Human Present (sign the closed cart) from Not Present (sign open constraints) and falls back to Human Present when a constraint can't be met. That maps one to one onto act / sign-off.
- **Checks that only appear when they fire.** Sysco runs a large-quantity confirm, a "Did you forget" prompt and a critical-item warning before submit; MarketMan flags shortfalls at receiving. Treat these as agent checks with a reason, plus line-level fulfilment states (confirmed / substituted / short / held), as in Shopify and MarketMan.
- **Triage verbs and per-line review.** Linear offers accept / decline / snooze-until-change; Cursor offers keep / undo per change. Decisions get approve / decline / snooze; agent proposals get keep / undo per line.

## 3. What the current build shows (deployed, 14 Nov)
**Strong, keep:** the order is the interface (dish → g/guest → kg → lots → price, all visible); the mandate in the chef's own words in the header; honesty labels (cached, scenario, simulated commitment); "Same shortage. Your rules." as a judge-touchable control; the Ops queue already has Due / What / Why / State / Owner / Next step; the phone has a sticky "14 lines need you · Review" bar.

**Five shape problems:**
1. **Everything asks.** 14 of ~17 event lines are held, mostly as "New product for this kitchen", including lines the normal week already orders (salmon, milk, potatoes). Cause: `orderedBefore` only counts orders committed in this run ([events.ts:103](../../src/lib/core/services/events.ts#L103), [orders.ts:53](../../src/lib/core/services/orders.ts#L53)), and the kitchen has no routine baseline. A mandate that asks about everything reads as no mandate, and invites rubber-stamping ("Hold to approve 14 lines").
2. **Lines, not decisions.** The approval card and the Ops queue list line items. A person decides per *reason*: "these 7 are new products for the event", "these 2 change an allergen", "these 4 have unknown supply". Ops will scale as kitchens × lines.
3. **No routine.** "A normal week €3,120 · 46 lines" is a number. There is no standing order to confirm, so the wedge ("routine is silent, exceptions come to you") can't be shown, and Valio's "standing order drift detection" scenario has no home.
4. **Three disconnected pages.** `/request` is a separate composer whose result doesn't land in the kitchen's plan; Kitchen is one event; Ops rows don't open the plan. The agent door has no page.
5. **Audit before consequence.** The approval card opens with a voided hash/version banner; the chef needs what changed and what it costs first (triage #5).

## 4. The object model the UI is built around
```
Kitchen ─ Mandate (versioned)
   └ Week (per delivery day, with cut-offs)
        ├ Standing order   ← the baseline; defines "usual products" and normal quantities
        ├ Layers           ← event (Christmas 140), request (milk by Monday), exception fix (recall, stock-out)
        └ Lines            ← one product, qty, price, state, why, source
   Decisions  ← lines grouped by the judgement a person must make (same reason, same layer)
   Orders     ← committed, immutable; receipts
Ops: Case  ← one cause (a recall, a regional shortage, a held event) across one or many kitchens,
             with owner, due (time to cut-off), € at risk, next step; contains Decisions
```
Two concepts are new to the UI and carry most of the polish:
- **Standing order (baseline).** The products and quantities a kitchen orders in a normal week, with optional **pre-approved fallbacks per line**. It makes `new_sku` mean something, gives drift detection a reference ("dairy +18% over 4 weeks"), makes a stock-out with an approved fallback silent, and lets every other layer be shown as a diff. In production it would be read from the kitchen's existing Valio standing order; in the demo it is seeded from the normal week, labelled as scenario data.
- **Decision.** A group of lines needing the same human judgement: `{layer, reason, lines[], total, consequence if declined, due}`. Approval still binds to the exact lines and terms (D6); the grouping only changes what a person reads and presses. "Approve the 7 new event products (€544)" is one decision; "2 allergen changes" is another, never merged with the first.

## 5. Kinds of work, and the right interaction for each
| Kind | Valio's scenario | How often / how much it varies | Interaction | Where it surfaces |
|---|---|---|---|---|
| **Routine reorder** | standing order | weekly, low | Agent prepares it within the mandate; the chef sees only the diff vs last week and confirms with one press, or it auto-commits inside caps | Week (quiet line: "routine order ready, 46 lines, €3,120, inside mandate") |
| **Drift** | standing order drift detection | slow, low | A single insight card with the trend and a proposed new baseline; never auto-renews a drifted order | Inbox, as a Decision |
| **Stock-out / undeliverable** | supplier stock-out; allergen-safe substitution | unpredictable, urgent | Rescue compare (good-better-best, one visibly rejected with its rule); the chosen substitute becomes a Decision if it crosses the mandate | Inbox → line on the canvas; Ops case |
| **Event / custom** | last-minute event; need → recipe → order | occasional, high | Starts as a sentence (composer, BEO later) → becomes a **layer** shown as a diff of the week; g/guest editable | Week layer |
| **Ad-hoc request** | the milk example | frequent, medium | Composer → interpreted request card (qty, unit, date shown before lookup) → quote → place → Decision if held | Composer, result lands in the Week |
| **Recall / web change** | (Context.dev) | rare, urgent | Case opens with source and fetch time; affected lines held; substitutes proposed | Ops case + kitchen Inbox |
| **Proactive offer** | proactive selling agent | occasional | Suggestion card with source, never inserted into an order; parked for later rings | Inbox, low priority |
| **Policy change** | guardrails model | rare | Mandate page; a chat-stated rule becomes a *proposed* mandate change the chef approves | Mandate |

The rule underneath: **the more routine the work, the less conversation it needs; the more novel, the more it starts in words and ends on the canvas.**

## 6. The doors, in detail
### 6.1 Agent door (headless)
- **Quality bar:** a buyer completes the milk example in Claude with no Mandate UI except one approval link. Every tool result carries `summary` (consequences first, in words), `state`, `nextAction`, `approvalUrl` when held, and the structured payload. Refusals are structured (`code`, `retryable`, `why`), never prose only.
- **Page `/agents`:** MCP URL with copy + QR, tool list with one-line descriptions, `/api/openapi.json`, a 6-line sample transcript, the assumptions (simulated commitment, scenario clock), and "agents can't approve: here's what the human sees" linking to a sample approval.
- **Later:** an MCP App renders the same Decision card inside Claude (D6 keeps this out of Ring 0).

### 6.2 Kitchen: canvas plus conversation
- **The canvas is the truth.** The Week and its layers render the server read model (triage #4: `reviewable, committable, confirmedCover, blockedReason, nextAction`). Ops animate on the line they touch.
- **The composer lives on every kitchen page**, docked at the bottom on the phone. It knows the selection: with a line selected, "find something Finnish" is about that line. It turns words into typed requests (D6 intent kinds); unsupported says so. It never approves: approval is a deliberate act on a Decision card.
- **A closed card catalogue** (ux.md §1, A2UI idea), the same components in the composer thread, on the canvas and in Ops: `RequestCard` (interpreted request), `QuoteCard`, `RescueCompare`, `DecisionCard`, `ReceiptCard`, `OutcomeLine`. A card in the thread is a **live view by id**: it updates, or shows "superseded by v8 →", and never stays clickable when stale.
- **Under every agent turn, one `OutcomeLine` computed from state:** "3 lines held, 1 substitute proposed, nothing ordered" (sibling-repos #1, #9).

### 6.3 Operations
- **Default: Cases, not lines.** One row per cause, across however many kitchens it touches. Each row has due (time to cut-off), € at risk, owner, next step, the kitchens and lines it covers, and why they were grouped. Expand to lines; click through to the exact plan at its version. Sort by € at risk × time to cut-off. Verbs: take, message the kitchen, snooze until change, close with evidence. Wallboard stays as presentation mode (it exists).
- **Audit for Valio:** each case shows who (chef, kitchen agent, external agent with key label), what, which mandate and terms version, and the outcome. The trace drawer holds model/prompt/latency.
- Ops can see and message; it cannot approve for the kitchen (F6).

### 6.4 Approval link
A standalone, phone-first page per Decision, `/approve/<decisionId>`: consequences first (what, why outside the mandate, total, delivery, what stays unsupplied), then "Review → Confirm exact terms" (accessible) or hold; hash and versions in a collapsed audit block; stale → highlight what changed. The same page is reachable from the agent door, the Inbox and an Ops case.

## 7. Navigation and sitemap
```
Kitchen  (one kitchen; switcher top-left)
  /k/<kitchen>                 Inbox: Decisions due before the next cut-off, routine status line
  /k/<kitchen>/week            Week: delivery days, standing order, layers as diffs   (?layer=, ?line=)
  /k/<kitchen>/orders          Orders, deliveries, line-level status (confirmed / substituted / short / held), receipts
  /k/<kitchen>/standing        Standing order (baseline) + pre-approved fallbacks; drift vs usual
  /k/<kitchen>/mandate         The mandate in words + its rules, versioned
  /k/<kitchen>/activity        What the agent and people did (op log, human-readable)
  composer                     docked on every kitchen page
/approve/<decisionId>          Approval link (phone)
Operations
  /ops                         Cases queue (sort: € at risk × time to cut-off; filters: cause, kitchen, owner)  · Wallboard tab
  /ops/case/<id>               Case → kitchens → decisions/lines → "open plan" deep link
  /ops/kitchens                Customers: mandates on file, cut-offs, readiness
  /ops/products                Availability, substitution rules, recalls
  /ops/agents                  Keys, traffic, refusals by code, agent runs + model traces
  /ops/coverage                Later: venues, readiness, enrichment (GROWTH showcase)
/agents                        Agent door: connect, tools, assumptions, sample run
```
All state that a person might share lives in the URL (kitchen, layer, line, case, version), so a chat card, an Ops case and an approval link point at the same thing. The demo header keeps the honesty labels and the simulated clock on every page.

## 8. Persona journeys across the doors
1. **Hotel chain agent (Valio's example).** Claude → `search` → `quote` (1,000 L lactose-free, Monday; 640 L available Monday → split) → `place_order` → `pending, sign_off: over €1,000 order cap, approvalUrl` → the purchaser opens the link on a phone → confirms exact terms → `commit` → receipt in Claude, in the kitchen's Orders, and as a closed Ops case with "external agent" as actor.
2. **Chef, Monday morning.** Inbox: "Routine order for Thu ready, inside mandate" + 2 Decisions (ham out: substitute proposed; dairy drift). Confirms the routine in one press, opens the ham rescue, picks, done in two minutes.
3. **Exec chef, event.** Composer: "Christmas dinner 12 Dec, 140, buffet" → the event layer appears on Thu's delivery as a diff → edits ham 135 → 120 g → one Decision "7 new event products, €544" + one "2 allergen changes" → approves the first, declines one allergen change → the line goes back to a residual with "make in house" offered.
4. **Valio ops.** Recall arrives (Context.dev) → one Case per affected kitchen, owner unassigned, due before cut-off → opens the plan at the exact line → messages the chef; the kitchen's Inbox shows the same case.
5. **Judge at peer review.** QR → `/k/hotel/week` on their phone → flips "Finnish required" → the rescue winner and the Decisions change; then `/agents` on the laptop and their own Claude orders, landing in Ops.

## 9. What this changes now (ranked; Ring 0 / R1, before the Sun 06:00 freeze)
| # | Slice | Why now | Owner (suggested) | Size |
|---|---|---|---|---|
| 1 | **Baseline = known products.** Seed `orderedBefore` (or a `usualProducts` set on the kitchen) from the normal week, labelled scenario | Turns 14 asks into a handful; the mandate becomes visible; prerequisite for the routine story | core | S |
| 2 | **Decisions: group held lines by layer + reason** in the approval card, Inbox count and Ops rows; approval still binds exact lines | Kills approval fatigue; one decision per judgement; Ops stops scaling with lines | core read model + kitchen + ops | M |
| 3 | **Approval card consequences-first**, hash/version collapsed | Triage #5; the judge reads it in five seconds | kitchen | S |
| 4 | **Request result lands in the kitchen plan** (as a layer) and the composer docks on the kitchen page; `/request` stays as the stepper view | Connects the required flow to the product; one world, not two pages | kitchen + request | M |
| 5 | **Tool results: `summary`, `nextAction`, `approvalUrl`** + a `/agents` page | Headless quality bar; Openness 15; the external-agent beat | agent | S–M |
| 6 | **`OutcomeLine` under agent runs** (from `GoalOutcome`) | Truthful "what happened"; same work as sibling-repos top item | agent | S (after GoalOutcome) |
| 7 | **Ops case drill-down** to the plan at its version via URL | Triage #9; completes the oversight loop | ops | S |
| 8 | **Reason line on every substitute** ("same fat %, no new allergens, +3 %") and the rule that fired on every held Decision | The two things no competitor shows; cheap from existing ranking components | kitchen | S |
| Later | Week view with delivery days and cut-offs; standing order page with pre-approved fallbacks; drift card; `/approve/<id>` page; cross-kitchen Ops cases; line-level receiving states; MCP App card; coverage explorer; proactive offers | | | |

## 10. Not doing
A general chat assistant; a chat transcript as the record (the op log is the record); agent avatars or typing theatre; a nationwide map with an order button; a second webshop (Valio has one); separate apps per persona (one design system, role-scoped homes).
