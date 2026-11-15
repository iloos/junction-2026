# SUBMISSION

_Draft texts for the Junction 2026 platform, written for the judges. Every behaviour claim traces to a "say it" or "say it, tests" row in [CLAIMS.md](CLAIMS.md) or to code on main; "narrow it" rows keep their narrow wording. Re-check against CLAIMS after the last deploy before pasting. Placeholders: `[repo]`, `[video]`._

---

## 1. Name, punchline, description

**Name:** Mandate

**Punchline** (84 chars):
> A kitchen purchasing agent that orders on its own only inside limits the chef sets.

**Description** (~150 words):
> Mandate is a purchasing agent for professional kitchens, built on Valio Aimo's catalogue and price and availability API. It plans a kitchen's order from an event, ranks substitutes when products run out, and orders on its own only inside the kitchen's mandate: spend caps, a hard limit, origin rules and things the chef never delegates, such as an allergen change. Everything else is held for a person, grouped by reason. An approval covers the exact terms the person saw; any later edit voids it and shows what changed. Retrying an order returns the same receipt, never a second order. Products whose supply Valio doesn't state are labelled unknown and never counted as covered. The kitchen screen, the in-app agent, REST and MCP all pass through one gate, so an outside agent gets the same tools and can never approve. Each visitor gets a private sandbox and their own agent key.

**Live:** https://mandate.kitchen (the app: https://app.mandate.kitchen) · **Source:** `[repo]` (MIT) · **Video:** `[video]`

**Technologies:** SvelteKit 2 (Svelte 5), TypeScript, Tailwind 4, d3, Drizzle, Postgres, MCP (Streamable HTTP) and OpenAPI, Gemini API (`gemini-decision-1`, `gemini-3.5-flash-lite`, `gemini-3.8-flash`), Aiven Runtime and Aiven for PostgreSQL, Exa, Context.dev, Playwright, Vitest.

---

## 2. Valio Aimo: Trusted Trade Agents

**The problem.** A kitchen orders from its menu, but the week rarely goes to plan: a large booking, a product out of stock, a missed cut-off. An agent can fix that faster than a person in the webshop, but only if the kitchen and Valio can trust what it may do alone.

**What Mandate does.** A hotel plans a Christmas buffet for 140. Whole ham (`462490`) and lanttulaatikko (`462482`) are out in Valio's own data. The agent turns grams per guest into packs using Valio's sales units and lot steps, and ranks substitutes known stock first, each with a reason: ham moves to HK Palvikinkku (`476768`), lanttulaatikko is made in house from in-stock ingredients. Valio's own example, "1,000 L lactose-free milk by Monday", runs on `/request` as request → lookup → order → approval.

**Autonomy and controls.**
- **The mandate is data:** weekly and per-order caps, a hard limit, origin rules and a never-delegate list (e.g. allergen changes). Each line is eligible, held for a person with its reasons, or unorderable.
- Caps hold even when an order is split; no approval passes the hard limit; a quantity below a lot step or a passed cut-off is refused at commit.
- **Approval is bound to the exact terms.** A price change or an edit voids it and shows what changed. One decision per reason group, so an allergen change never rides with routine lines.
- **Idempotency:** on the deployed Postgres, four commits with one key gave one receipt.
- **One gate** for the kitchen UI, the in-app agent, REST and MCP. Each committed line names what allowed it. Outside agents have no `approve` tool and get 403 over REST.

**Bonus: beyond price.** After supply tier, substitutes are scored on the kitchen's own weights over price, carbon (Valio's product-group CO₂e average per kg), delivery reliability (Valio's delivery-reliability data), Finnish origin and organic labels (`core/rank/rank.ts`). The seeded hotel weighs reliability first and a lunch restaurant weighs price first; each candidate's score keeps its parts. Valio's API is queried only when needed: live price and availability only for shortlisted products, through a 15-minute cache.

**Many kitchens, one stock: the room.** Ops shows a QR code; anyone who scans it names their own store and orders by chat within seconds, under safe default rules (ask before a new product, never change an allergen). Ops shows each store arrive, lights up its first order and keeps a live total, and each store can act only on its own kitchen: the room's sample hotel is read-only to visitors. A visitor's own kitchen persists: it is still there in a new tab, on a paired phone and for their agent's key (`get_context` lists it). Rehearsed on prod `f2a0de7` (Sun 15 Nov): three phone-size visitors from the QR to three orders on Ops in 33 seconds.

**Real vs simulated.** Real: Valio's catalogue, and live price and availability calls only for shortlisted products, cached and labelled. Simulated and labelled: the booking, the clock, stock on hand, recipes, and the order itself (Valio's API has no order endpoint, so nothing is sent to Valio).

**Try it.** https://app.mandate.kitchen gives you a private sandbox. `/agents` mints an MCP key for it: connect any MCP client to `/mcp/k/<key>` and start with `get_context`. Your agent can plan and order within the mandate, never approve. Valio's view is `/ops`.

**Next.** The kitchen's usual week (Valio's order templates) as the baseline the agent runs inside, so only exceptions reach the chef before cut-off; delivery shortfalls turned into claims and rescues; and for Valio, a registry of outside agents with their own grants and spend caps. A 4-week hotel shadow pilot is the proposed first step.

---

## 3. Sponsor tracks

### Google DeepMind: Best Use of Gemini API

**What problem are you solving and why does it matter?**
A purchasing agent for professional kitchens has to make many small judgements a rule can't: is this ham a fair substitute in this dish, might this product break the kitchen's allergen rules, what did the chef mean by "4 kg butter for tomorrow"? Those judgements have to be useful to the agent without ever being allowed to spend money on their own.

**How have you integrated the Gemini API?**
Each model has one job, chosen through a routing table (D12):
- **Gemini Decisions (`gemini-decision-1`)** in substitute ranking. For each line that needs a substitute, one batched call asks three questions about each surviving candidate (up to 12 candidates): a 0–4 fit score for the dish, the probability that it breaks the kitchen's hard constraints, and the probability it is Finnish. Fit reorders candidates within the same supply tier. A probability of breaking a constraint above 0.5 adds a caution and holds the line for a person; a model answer never rejects, clears or approves anything. If Gemini is unavailable, a recorded replay answers, then deterministic rules, and every answer says which source produced it. Calls have daily caps per workspace and overall, kept in Postgres.
- **Gemini 3.5 Flash-Lite** (minimal thinking) parses a free-text request into structured items on `/request`, understands chat messages (the `chat.understand` job, guarded by a deterministic classifier) and writes short explanations that are checked against the task's ledger. Explicit constraints such as "lactose-free" are checked after the parse so they survive it. In the in-app chat, Flash-Lite (`chat.understand`) reads each message into a kind and goal; a deterministic classifier keeps the authority, and the purchase is rewritten only when it matches the chef's own words item by item, otherwise the chef's words run. Flash-Lite then chooses the chat's tool calls (`agent.plan`), falling back to the scripted planner on any failure. "approve all", "accept the salmon" or "reject the herring" in the chef's own dock are decided by rules, not a model: they act on the lines and version the last turn showed, through the approve tool as the chef, and never on sign-off lines. The REST/Ops agent runs (`/api/agent/run`) use the scripted planner unless `AGENT_PLANNER=llm`.
- **Gemini 3.8 Flash** (low thinking) proposes a menu from an event brief (`propose_menu`, on `/request` and from the chat), checked against a rubric, with team templates as a fallback. Turning an accepted menu into a plan is deterministic and calls no model.

**What makes your use of Gemini innovative or technically impressive?**
Gemini is used as calibrated evidence, not as an authority. Decisions returns probabilities in one call for many questions (our spike measured 120 questions in about 0.6 s), so every candidate can be checked against the kitchen's own constraints while the chef waits. The model's answers feed a deterministic gate: the mandate, the hard limit and approvals are code, and the model can only make the agent more careful. Model choice was measured rather than assumed: on our own eval inputs, 3.8 Flash matched Flash-Lite on parsing, planning and explaining at about three times the latency, so the interactive jobs stay on Flash-Lite; menu proposals moved to 3.8 Flash because it scored 10/10 against 8/10 on our golden briefs.

**Why is Gemini an important part of your solution?**
Without Decisions, substitute ranking would rely only on price, supply and keyword rules, and a candidate that might break an allergen rule would not be flagged. Without Flash-Lite, the free-text request on `/request` and the chat would need rigid forms; without 3.8 Flash, an event brief would get only a team template. Every model call sits behind a port with a replay and a rules fallback, so the demo still runs if the API is down, and the trace shows which source answered.

### Aiven: Best Use of Aiven

- **Aiven Runtime** hosts the whole app as one Node container (SvelteKit `adapter-node`, our Dockerfile). Production is https://app.mandate.kitchen (custom domain on Aiven; https://widely-many-scorpion.eur-1.aiven.app also works); a second Runtime app (`mandate-b`) runs the same build on the same Postgres, and a store made on one, or an order, shows on the other's Ops within a fraction of a second (LISTEN/NOTIFY). Every deploy is gated by the full test gate before it ships and a post-deploy smoke on prod (the race check plus the UI checks).
- **Aiven for PostgreSQL** holds all state: kitchens, plans, approvals, orders, the op log and per-visitor workspaces. TLS is verified against the Aiven project CA.
- **No double orders, enforced in Postgres.** The idempotency table and per-workspace locking make a retried commit return the same receipt. After each deploy, a race check runs against the production database: four commits with one key give one receipt; three with different keys give one receipt and two refusals.
- **LISTEN/NOTIFY as the event bus.** Every change is published on one Postgres channel and streamed to browsers over server-sent events, so the Kitchen and Valio's Ops view update from the same source.
- **Valio cache-through.** Live price and availability answers are stored in an `offer_cache` table with the time Valio answered, and availability is re-fetched after 15 minutes, so we call Valio only for products in an actual order, as Valio asked.
- **Web and model state.** Migration 0004 keeps the web response cache, daily spend counters for Exa, Context.dev and Gemini Decisions, recall findings, and a work queue claimed with `FOR UPDATE SKIP LOCKED`, so caps and the recall queue survive restarts and are shared across instances.

What it enables: a judge can use the deployed app in a private sandbox, and the guarantees we claim (one receipt per order, caps, scoped keys) were observed on Aiven, not only in local tests.

### Context.dev: Best Use of Context.dev

**ENTER? (lead decides):** the live pipeline is real, but no real recall has matched a Valio product, so a held line on screen needs the labelled drill; enter only if the drill is seen holding a line in a visitor's sandbox on prod.

- **Endpoints:** a Context.dev **monitor** on the Finnish Food Authority's recall list (checked every 5 minutes) with a signed **webhook** to our app; **scrape with JSON extraction** for each new notice (product, brand, GTIN, batch, best-before, hazard); **news search** for supplier leads.
- **What it drives:** each notice is matched against the catalogue by GTIN, then by name and brand. A GTIN match holds the affected line with the notice as its source and a way out (release it or pick a substitute). A supplier-level match is listed as a lead and holds nothing.
- **Honest status:** the monitor, webhook and extraction run live. None of the recent recalls match a Valio product, because they are retail packs, so the live notices correctly hold nothing. The held-line demonstration is a **drill**: a recorded real notice re-targeted at one catalogue product, labelled DRILL, in the visitor's own sandbox only.
- Why Context.dev: one API gives the change trigger and the structured read, with per-output success flags we check before caching.

### Exa: The Internet Butler

**ENTER? (lead decides):** Exa's challenge is a main challenge for a personal assistant, which is not our problem. The Why drawer's Exa evidence is "say it" in CLAIMS (seen on prod); the recipe bullet below has no CLAIMS row yet.

- **Facts for gaps in the catalogue:** when Valio has no allergen or origin record, the Why drawer asks Exa (`/search` with an output schema) for the missing fields. Each field comes with its source URL and a quote, and fields whose source names the product's GTIN are shown first. Web facts are shown as evidence; they never overwrite catalogue data and never clear a hold.
- **Make in house from a web recipe:** for a product that is out, Exa finds a sourced recipe, its ingredients are matched to orderable catalogue products, and the proposal is **held for sign-off**; nothing is added to the order by itself.
- The same lookups are tools any outside agent can call over MCP and REST (`lookup_facts`, `find_outside`), with daily caps per key.

---

## 4. Honest limits

- **Orders are simulated.** Valio's API has no order endpoint; a commit is a local simulated commitment, and we never call it "confirmed" without a receipt from the simulated supplier.
- **The scenario is staged:** the booking, the December clock, the kitchen's stock on hand, recipes and grams per guest are team estimates, labelled on screen.
- **Unknown supply is held for one tap.** Valio confirmed that availability of 999999 or more means unknown, orderable in any quantity. Such a product is labelled unknown, never counted as cover, and a line that relies on it waits for one approval instead of being ordered alone. Most routine dairy carries that figure, so in the demo few lines go through without a person.
- **Gemini fit is evidence, not proof.** We have not run a labelled test set, so we don't claim the ranking is recipe-aware; supply tier decides first.
- **Same words, same basket** holds for the cases we test, in English and Finnish, across `/request`, the agent and REST. The chat reads words with its own model and is not part of that check.
- **The cut-off is named, never moved silently.** A too-late date is caught before ordering: the user is told which cut-off passed and offered the next delivery day. A passed cut-off is also refused at commit.
- **Menus to plans:** an event brief gives a proposed menu, and an accepted menu becomes a plan. Amounts per guest and ingredient picks are labelled estimates, and an ingredient with no product is shown as unresolved.
- **Reading pictures is not live.** A `read_image` tool exists for photos of prep lists, delivery notes and labels (NVIDIA Nemotron VL on Verda), but the vision endpoint isn't deployed, so outside agents aren't offered the tool and we don't claim it.
- **An outside agent's stale commit being refused** is covered by tests, not yet observed on prod over MCP.
- **Recalls:** no real recall has hit a Valio product; the held-line case is a labelled drill.
- **No data-residency claim.** The app and database run on Aiven in the EU (Frankfurt); we don't say the data stays in Finland.
