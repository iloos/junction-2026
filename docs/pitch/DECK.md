# DECK: six slides

_S7, Sun 15 Nov 02:30. The outline for the stage deck and the video's frames. Each slide has a headline, one visual, the proof and what to say. Every claim maps to [CLAIMS.md](../CLAIMS.md) or [MAP.md](MAP.md). A proof marked ⏳ waits for the playtest on the deployed commit: if it isn't green by the freeze, cut the line, don't soften it. Valio's criteria set the order: working end-to-end demo 30 · the user's need 20 · autonomy and controls 20 · exceptions 15 · openness and path to production 15._

---

## 1 · The case: a kitchen's week rarely goes to plan
**Headline:** "A kitchen's week rarely goes to plan. An agent could fix it, if anyone trusted what it may do alone."

**Visual:** the user's sketch 1, redrawn. Suppliers → **Valio Aimo** → establishments (hotel, care home, school, restaurant, café). One phrase on top: "140 guests Saturday. The ham is out. The cut-off is 17:00."

**Proof (one line each):**
- Valio's mentor, on the event Discord (Sat 14 Nov): "Currently there are no approval gates… in an agentic scenario a human approval would be required." That is our brief, in their words.
- Finnish food services waste ~61 Mkg of edible food a year (Luke). The EU requires a 30% per-person cut by 2030.
- Field experiments: buyers beat the algorithm only where they know something it doesn't (Kesavan & Kushwaha 2020). So the agent should **ask at the exceptions, not on every line**.

**Say:** "The hard part isn't finding the product. It's knowing what the agent may buy alone."

---

## 2 · Our approach: Understand · Decide · the mandate gate
**Headline:** "Tell it what you need. It plans like a chef and buys only what your rules allow."

**Visual:** the user's sketch 3 (food requirements in, ships order out), with agent 1's three layers inside the mandate.kitchen box:
```
Chef (phone or Kitchen page)
  words, a menu, an event ↓          ↑ approves held lines (only a person can)
┌──────────────── mandate.kitchen ────────────────┐
│ 1 Understand  words → menu → dishes → Valio products, sized in Valio's units │ ← your AI agent over MCP
│ 2 Decide      rank (known stock first), substitutes, re-plan on a shortage   │   (scoped key: can plan and
│ 3 The mandate caps · allergens and diet · never-delegate → order, or hold    │    order, never approve)
│ Trace: every step logged with its why                                        │
└──────────────────────────────────────────────────┘
  stock, price, cut-offs ↑          ↓ order (only what the rules allow)
                    Valio Aimo ── ships ──→ Kitchen
```
**Proof:** one gate for every door (Kitchen page, chat, `/request`, REST, MCP): `core/contracts/tools.ts` + `server/tools/serve.ts`; every change through `applyOps`. Approval is bound to the exact terms by a hash, and any edit voids it (tests: `gate.test.ts`, eval s4).

**Say:** "The model reads and proposes. Code decides what's allowed. A model can make a line more careful, never less."
**Who approves (D22 as built):** the chef approves on the page or in the in-app chat ("approve all" on the lines just shown; an allergen change still needs the confirm card). Any MCP agent, an outside one or the chef's own, gets an approval link that the chef opens on any device, including a phone paired from `/agents`. The link only points; it grants nothing (D17). Never say an agent can approve.

---

## 3 · Slices: the product working, one moment at a time
One slide with four frames (or four quick slides in the video). Each frame is a prod screenshot taken on the submitted commit.

| Frame | Headline | Visual | Proof | Status |
|---|---|---|---|---|
| **a. Words → a costed, rule-checked plan** (the hero) | "A no-meat dinner for 120 with a peach dessert." | the dock: menu card → plan → every ingredient a Valio product with a price or an honest label → held lines in one decision → "Ordered · 1 receipt" | playtest m2: 10/10 at 1440 and 390 on prod `ea9f4d5` (S5); one receipt under a 4× race on prod | prod |
| **b. One shortage, every kitchen** | "Same shortage. Each kitchen's own rules." | Ops Room on the big screen: stores by name, a shortage fires, per store: kept · swapped · held · short | `812d714`; playtest m1 | ⏳ room cascade on screen (S5 r1/m1) |
| **c. An outside agent, stopped** | "Your agent can plan and order. It can't approve." | Claude with a judge key: `place_order` over the line cap → held; `approve` → refused; Ops: "An outside agent tried to approve… Nothing changed." | CLAIMS b10 (403, logged); 17 tools over MCP, none approves | prod |
| **d. Valio's view** | "Valio sees demand before the cut-off." | Ops Forecast: two weeks of stock per product, where it runs short, labelled simulated, every estimate sourced | D27 stock model `5b7154e`; playtest m4 | prod (simulated, labelled) |

**Say (a):** "From words to a plan the chef can sign in one tap. What the mandate allows goes through on its own; the rest waits in one decision per reason." (The "3 lines, €302.62 ordered alone" figure is the buffet's, CLAIMS b3: don't attach it to the hero plan unless m2 shows its own number.)

---

## 4 · The sponsor round
**Headline:** "Every partner is load-bearing."

**Visual:** five tiles, each with its job, its live 24 h count from `/healthz` and what breaks without it. Re-read `/healthz` `day` right before the pitch. The figures below are from prod `5ed5bdf`, Sun 01:55.

| Partner | Its job in the hero journey | Without it | 24 h |
|---|---|---|---|
| **Valio Aimo** | 17.5k catalogue; live price and availability **only for shortlisted products** (15-min cache); sales units, lot steps, cut-offs; product page and photo by barcode | nothing is orderable | 372 live calls |
| **Gemini** | Flash-Lite reads the request and the chat (845 ms median, 44/45 held-out, offline); 3.8 Flash proposes the menu; Decisions scores fit and hard-rule risk, with replay and rules fallbacks | words become forms | 828 live calls |
| **Aiven** | Runtime hosts the app; Postgres holds the op log, receipts, locks, caches, spend caps and traces; LISTEN/NOTIFY drives the live Room | no "one receipt under a race", no live Ops | db ok, TLS verified |
| **Exa** | cited facts where Valio has no record (allergens, origin), GTIN first; menu dishes checked against cited recipes | the Why drawer guesses | 410 calls (222 live) |
| **Context.dev** | watches Ruokavirasto's recall list every 5 min, extracts each notice and matches it against the catalogue | no outside event can hold a line | 187 calls (123 live) |

**Say:** "Everything that comes from outside has a fallback, and the screen labels it live, cached, replay or rules."
Don't say: vector search, schema-constrained, recipe-aware, "a real recall hit our orders". Verda (photo reading) and Featherless are wired but not live, so they stay off the slide.

---

## 5 · Why us: what the obvious builds can't show
**Headline:** "Anyone can put a chatbot on a catalogue. We built what makes it safe to let it buy."

| The obvious build | What it can't show | What we show live |
|---|---|---|
| **A chatbot over the catalogue** (answers, suggests, links to the webshop) | that anything was ordered, or why it was allowed | an order with a receipt, each line naming what allowed it; "approve it" refused in chat |
| **A cart with an agent** (fills the basket, the human checks out) | which lines the agent may buy alone, and that checking out twice orders once | the mandate tiers: 3 lines ordered alone, the rest grouped by reason; 4 commits on one key → 1 receipt |
| **An agent with a confirm button** | that the "yes" covers exactly what was shown | approval bound to the terms hash; an edit voids it and shows what changed |
| **One kitchen, one demo path** | contention and fairness | one stock across many stores in the room; a shortage re-plans each store under its own rules |
| **A closed app** | other people's agents | an open MCP + REST + OpenAPI door with scoped keys; outside agents held to the same gate |

**Proof of rigour:** adversarial rounds R7–R12 closed into tests; evals that run in the merge gate (14 scenarios, cross-entry fidelity, EN/FI paraphrases, chat trials, agent goals, adversarial authority); the hero journey as a referee after every deploy. Numbers ⏳ from S5 (MAP §4).

---

## 6 · What's real, and what's next
**Headline:** "Real data, real gate, simulated orders, and a clear path to production."

**Visual:** two columns. **Real:** Valio's catalogue and live price and availability, Gemini, Aiven, Exa, Context.dev, MCP and OpenAPI. **Simulated, labelled on screen:** the order itself (Valio's API has no order endpoint), the supplier's reply, history, stock movement, the clock.

**Next (say "next", never "built"):**
1. A 4-week shadow pilot with one hotel: the agent proposes, the chef orders as usual, and we measure how many lines would have gone through alone. These are targets, not results.
2. Valio's systems subscribe to the op log (Aiven Kafka + Debezium): held lines, orders and shortfalls with no app change.
3. Usual orders (Valio's *tilauspohjat*) as the baseline the mandate widens over, line type by line type, as the record earns it.
4. Your own agent can ask you to approve in its client (MCP elicitation), bound to the exact terms; an outside agent still never approves.

**Close:** "What do you need? We'll sort it out. That's a mandate." Then `mandate.kitchen` and the QR.

---

## Open before filming
- [ ] S5: the numbers for slides 3 and 5 (hero at 390, r1 stores and first order, m1 room cascade, eval counts, facets 0 unsafe, F1 cases, rounds closed).
- [ ] Re-read `/healthz` `day` on the submitted commit for slide 4.
- [ ] Screenshots on the submitted commit: m2 plan, m2 receipt, Room with stores, Forecast, the m3 refusal in Ops.
