# Ring 6 restart: every lane picks back up from here

_Lead, Sat 14 Nov late. The user asked to restart all lanes in fresh sessions. Lanes finish what is in flight, start nothing new, push their branch, and write their checkpoint (Done · In flight · Next · Risks · How to resume) in their lane brief. The lead merges what lands green and fills this page from those checkpoints. A fresh session reads, in order: CLAUDE.md, this page, its lane brief, [ring5 SYNTHESIS](../ring5/SYNTHESIS.md), [USER-DIRECTIVES](../ring4/USER-DIRECTIVES.md), [Round 12](../../review/ROUND12-ADVERSARIAL.md)._

## Sessions for ring 6 (one area each; subagents for bounded jobs)
| Session | Area | Brief | Absorbs | Final SHA | Ready |
|---|---|---|---|---|---|
| Core | core, mandate, `meets()`, needs, contention | [core-db](../../lanes/core-db.md) | 8d | lane/a-atp 26e7037 (R12-01 core binding in f882939) | ✓ |
| Kitchen and basket | Kitchen canvas, Basket, usual-order UI, establishment entry, rules UI | [kitchen](../../lanes/kitchen.md), c3's docs/lanes/c3.md on lane/c3-basket | 1f, c3 | 1f: lane/c2-ui 67a193d (rules rework b36def5); c3: lane/c3-basket b0729bc (R12-05/06; lead-reviewed; 390 px + e2e next) | ✓ |
| Conversation | chat, /request, menus, D15 stage 2 | [request](../../lanes/request.md), [agent2](../../lanes/agent2.md), [menu-v2](../../lanes/menu-v2.md) | B, E, 41 | B: lane/b2-request ce09f7c (R12-03 + unknown units in a0ab741) ✓; E: lane/e2-chat f0d51a5 (menu flow + R12-10 core in f8964e5; yes-as-review per D21) ✓; 41: lane/menu-v2 f72debc (contract 49e6514 + 906cdbe land together) ✓ | B ✓ 41 ✓ |
| Ops and deploy | Ops rework, traces, deploys and smokes | [ops](../../lanes/ops.md) | 9c | lane/g17 40be576 (WIP R12-09, don't merge alone); prod a9f06ee | ✓ |
| Evals and claims | OPEN maps, CLAIMS, prod re-tests | [f-evals](../../lanes/f-evals.md) | 91 | lane/f-evals 3c65869 (local; origin stale at ddf701a; a300109 merged) | ✓ |
| Agent door | MCP/REST, `revise_menu`, pairing | [agent-door-v2](../../lanes/agent-door-v2.md) | da | lane/agent-door-revise dd68b76 (local; R12-08 in 3db5fa3 + 5783174) | ✓ |
| Site | mandate.kitchen, proof, story | [site](../../lanes/site.md) | d0, 73 | lane/site 632a0d0 (includes 73's 4ff9913); live site dfff213 | ✓ |

0d is done: lane/history-profiles f418814 (R12-06 history for P4/P5/P6/P8 in ca8f9ed), ready; lane/valo-basket 7ecaa9e stays held. 0d retires; its open items move to Kitchen and basket (profiles, history) and the lead (valo-basket held).

## North star (user, Sat late): it must not look like a shopping cart with an agent
The user's read: the app now feels like a cart with a chat box. The machinery that makes it worth building is invisible: the mandate gate, one Valio stock shared across many kitchens, live supply and recall signals, prediction from order history, outside agents held to the same rules. Ring 6 designs every surface around showing that work, before the UI pass polishes it. The cart is the detail level, not the home.

- **Home is "your kitchen's week, handled", not a basket.** A ledger of what the agent did on the kitchen's behalf (re-planned, swapped, held, ordered, and why), what it needs from the chef (the few decisions, each one row with one primary action), and what is coming (the next deliveries, the forecast, recalls watched). The basket and lines open beneath it.
- **Four moments a judge sees in under a minute, each live, not narrated:**
  1. **A shortage hits and the system re-plans:** Valio's stock drops; every affected kitchen's plan re-plans in seconds within its own rules, and the cascade is visible (which dishes, which swaps, what each kitchen's mandate allowed, what waits for a person).
  2. **Words or a photo become a costed plan:** "a no-meat dinner for 120 with a peach dessert" (or a menu photo) → dishes → ingredients → products → a priced, rule-checked basket, with the reasoning shown step by step.
  3. **An outside agent overreaches and is stopped:** a judge's own Claude tries to buy past the mandate; the refusal names the rule; the chef approves on their phone.
  4. **Valio's view:** demand across all kitchens per delivery day, what the usual orders predict, where stock will run short (Ops rework, sankey, forecast).
- **Motion shows the work:** a plan that re-plans animates the changed lines; the agent's steps appear as they happen; numbers count. Depth on demand: every number opens its why.
- **Acceptance:** a first-time visitor understands within five seconds that an agent is running the kitchen's purchasing under rules, and sees it act within thirty.

The user, in retrospect: the Kitchen mock A ([docs/design/mocks/kitchen-a.html](../../design/mocks/kitchen-a.html)) reads cleaner than the live Kitchen, though it isn't complete. Start the target screens from A's structure and calm, then add what the live app has that A lacks (per-line control, rules, the rail, the full order flow). A short product-and-narrative session (design + pitch) writes this up as the target screens before Foundations 3 and the UI pass, so the polish serves the story.

## A self-testing judge harness (user, Sat late): Claude playtests and reviews, so we iterate on feedback
The adversarial rounds (R9–R12) and the user's own screenshots are the best feedback we have, but each is a manual, multi-hour event. Make it a loop any session can run.
- **Playtest (code):** scripted journeys under `evals/playtest/` (Playwright plus the MCP client): the nine Round 12 journeys and the four north-star moments, run as a first-time visitor at 1440 and 390 against a target. Targets: local fixture (`DATABASE_URL=` blank, `LLM_PROVIDER=fixture`), or the deployed app in a fresh sandbox, with live models under the spend caps. Each run saves screenshots, the DOM text, the chat transcript, the traces by request id, and the receipts to `scratch/playtest/<run>/`.
- **Exploratory playtest (agent):** a Claude subagent with the browser drives the app from a persona brief (a hotel chef with a shortage, a care-home cook with a lactose-free menu, a judge's outside agent) and tries to get the job done, recording where it got stuck.
- **Judge (agent):** separate judge subagents score each run against written rubrics, each arguing a position rather than rating:
  - the north-star test (understood in 5 s, acts in 30 s);
  - DESIGN.md and the UX laws (Foundations 3);
  - VOCABULARY;
  - truthfulness: what's said vs the state, receipts and traces;
  - safety: the mandate, D13/D17/D21, asked vs bought;
  - parity: the UI vs the agent tools.
  Every finding needs a reproduction (step plus screenshot or trace), a severity and an owner area. Existing pieces to reuse: the `judge` skill, impeccable critique, `request.reading`, the Round 12 prompt.
- **Loop:** a repo skill `playtest` (`.claude/skills/playtest/`): run journeys → judge → write `scratch/playtest/<run>/FINDINGS.md` → compare with the previous run (fixed, new, regressed) → route by owner. Run it after each deploy (by the Ops session) and on demand by any lane for its surface. A confirmed finding becomes a test under `evals/` so it can't silently return.
- **Acceptance:** one command produces a findings report for a deploy within ~15 minutes, under the provider caps, and a second run shows which findings were fixed. The first run's report on the current build seeds the UI pass.
- **Owner:** the Evals session (91's successor), with the design session for the rubrics.

## Foundations first (user, Sat late): settle these before the lanes fan out
The user's read: many small nudges, often the same ones, because the foundations are thin. Ring 6 opens with three short foundation docs, each owned, reviewed by the lead and the user, then binding on every lane.

1. **Domain shape** (lead → docs/concept/ARCHITECTURE.md §Tenancy). Account → establishment(s) → kitchen (one store or site) → basket. A basket belongs to one kitchen and one delivery day: never one basket across stores. A chain with several sites has one basket per site; carrying lines to another site is an explicit copy that makes new plans there. Saved things (usual orders, rules, menus, pins) are per kitchen, and shared ones are copied, never linked. The demo sandbox holds seven seeded kitchens as seven separate customers, not one chain: say so on the picker. Every surface (Kitchen, chat, Ops, agent door) states which kitchen it is acting for.
2. **Agent harness parity** (Conversation + agent door, lead owns the registry). Anything a person can do in the app, the agent can do through the same tool, and vice versa: one action registry where each UI control names the tool it calls, and a parity test that fails when a control has no tool or a tool no control (except the human-only ones: approve, pair, grant, D13/D17). Both sides read and write through `serveTool` → `applyOps` and see each other's changes through the same event stream. The agent's view of state is the projection the UI renders (`get_context`/`get_plan`), so neither side acts on a stale picture.
3. **UI foundations** (a design session with the impeccable skill, then every lane). A short DESIGN.md plus shared primitives that make the recurring mistakes impossible rather than reviewed away:
   - **Layout:** an 8-pt spacing scale; one row primitive on a CSS grid with fixed tracks (time · chip · text · value), so variable-length chips never shift the text after them; numbers right-aligned in tabular figures; one max text measure.
   - **Prose:** one line says one thing once; no text repeated in title, body and side panel; formulas and ids only with System; one headline, then facts as tokens, then details on demand (the bill style).
   - **Affordance:** clickable things look clickable; disabled controls say why up front; one primary action per zone; empty states say the next step.
   - **Density:** no large empty panels; whitespace groups related things (proximity) instead of padding everything.
   - **Laws to check against:** Hick, Fitts, proximity and common region, Jakob, Miller, the five-second rule (CLAUDE.md rule 12).
   - **A check every UI change passes:** screenshots at 1440 and 390 plus the impeccable critique, with the checklist in the PR message.

## Also before fan-out (user, Sat late): lines you can manage, and every request in view
- **Per-line control, nested.**
  - Every line can be managed on its own: change the amount, swap the product (compare), remove, hold, approve just this line, see why. A dish line opens into its ingredient sub-lines, each with the same controls; a change to one sub-line re-plans only that ingredient.
  - Bulk actions are a selection over the same per-line actions (select lines → approve, hold, swap), not separate bulk-only buttons.
  - The same actions exist as tools for the agent (Foundations 2: parity), and the same nested row primitive serves the Kitchen, Basket, /request and the dock cards (Foundations 3).
  - Acceptance: on the hotel event, change one ingredient of one dish, approve one line alone, and select three lines and hold them, at 1440 and 390; the agent does the same through tools.
- **Every request in view.** One list of all requests and plans for this kitchen, whatever door they came through (event, usual, /request, chat, outside agent), with their state (asked → proposed → held → approved → ordered), date and origin. Open any one in place. This is the Basket's other axis (by request rather than by delivery day).
- **A full UI/UX pass in the new swarm:** after the three foundations land, one design session walks every surface (Kitchen, Basket, /request, chat dock, Ops, /agents, the site) with the impeccable critique against DESIGN.md. Its findings become the lanes' first batch. Seed findings from the user's full-page Kitchen screenshot (hotel buffet, Sat late):
  - the state column truncates its chips ("Valio hasn't s…", "Rescued · Valio hasn't…"), and dish names truncate ("Perkkanalaat…", "Imellletty pe…"): the columns are sized for the shortest content, not the longest;
  - "Valio hasn't said": the chip and its detail say the same thing, and Valio is made a speaker. Name the data instead ("No stock info"; detail: "Valio's data has no stock count for this product. The supplier confirms the amount when you order."). The vocabulary rule: name the data, not the supplier, and a chip and its detail never repeat each other;
  - the Order panel's "Still not covered" is a tall list of chips; it should be a compact table or grouped by reason (K5);
  - the rules and "Same shortage, your rules" sit detached at the bottom of a long page, with large empty areas beside them;
  - the right rail stacks three long decision cards with nested product lists; with per-line control (above) they become rows with one primary action each;
  - very small type throughout at 1440: the page fits by shrinking, not by structure.

## Queued at restart (from the lead's routing; lanes confirm in their Next)
- **Core:** R12-01 (the ask binds quote and commit), R12-02 (one cereal/allergen fact table), R12-04 = R10-05 (contention adds only the residual); then R11-04, R11-10, R10-06, R10-08; every place_order line makes a need; the "Valio suggests" contract (K7).
- **Conversation:** first check E's f8964e5 against D21 (a yes acts only on one named offer and the shown revision; trials for a bare "ok" with a stale or unnamed offer), then the rest of the chat menu flow (TOP in SYNTHESIS: menu card contents, "Show on the page", the chat-only e2e), the prod dock-sync failure ("You approved N lines"), R12-03 (vegan stays a requirement), unknown units ask (R12-01 upstream), R12-10 (no Continue after cancel), menu-ask routing, the text-heavy request page → one-line rows + comparison table + one bill-style line component, choice quality, D15 stage 2, pin persistence, the dinner-replay eval, `/request?text=` prefill for site CTAs.
- **Kitchen and basket:** review and land c3's 7b32ead (establishment first via `join`, Basket tabs, NothingPlanned), then its 390 px pass and the picker → plan → Basket e2e; the header kitchen selector also uses `join` (choosing a kitchen plans nothing, per the domain shape); the rules rework, K7/K8.
- **Ops:** the full rework (header and KPI row; Live, Demand, Forecast, Engine room; sankey demand flow, case story, stakes chart, gate paths, forecast), R12-09 (stored traces and Sponsors summary), the cross-tab live check.
- **Agent door:** R12-08 done (da 3db5fa3 + 5783174); next: an agent's `revise_menu` pin sets `pinnedBy:'agent'` (41's field), Ring 2, the listing on lookup_facts, the menuReviewUrl switch.
- **Evals:** keep the OPEN maps current as core closes R12-01/02/04; prod re-run of all nine Round 12 journeys before filming.
- **Site:** R12-11 site side (pinned numbers, CTA labels or prefill), W4 re-record.

## Found during wind-down (prod a9f06ee)
- **Ops doesn't follow a sandbox reset from another tab** (same run id after 30 s) → Ops P1 in its Next. A new order does show live in 0.6 s.
- **Dock approval status** ("You approved N lines") never appears: `evals/ui/dock-sync.e2e.ts:28` fails on prod → Conversation/Kitchen.
- The smoke can't verify Add to calendar (it's a menu) or the bill at 390 → fix the smoke selectors.

## From the breadcrumb audit (every user message in all 19 sessions; [BREADCRUMBS](BREADCRUMBS.md))
- **Kitchen and basket:**
  - rebase c3's lane/c3-basket b0729bc onto main. It conflicts with 1f's rules rework in KitchenScreen: c3 wrapped `<main>` in tabs and 1f restructured the rows and rules. Keep 1f's rows and rules, put c3's tabs around them, then the 390 px pass and the e2e;
  - the in-app "Usual order" and "How ordering works" pages per `docs/superpowers/specs/2026-11-14-usual-order-and-ordering-journey-design.md` (Goals 1–3, `core/usual` maths with a 10× test, labelled sample history);
  - one ranking/priority/filter control, in the same place on the Kitchen, the request card and the dock (with Foundations 3).
- **Core + Kitchen + Conversation:**
  - a strict or best-try control per order and per line for diet, allergen and origin. Core has it (39d2368); add a tool parameter, the parity test, and an eval where best try returns a labelled near-miss;
  - align the kg↔l comment at `contracts/tools.ts:303` with the density conversion in `services/events.ts:447`, plus a "make it 20 kg" test.
- **Conversation, top (user, Sat late):** "hi i want 500 pizzas no meat 50%" on prod a9f06ee read "pizzas no meat" as a product word, called "50%" unclear, and dead-ended at "nothing matched".
  - The reading shape (D20) needs **shares**: one amount split into parts, each with its own requirements (250 vegetarian + 250 any; "half beef, half mixed" is the same shape).
  - A dish noun with a count takes the dish path (ready-made vs from raw).
  - An ambiguous reading proposes its most likely interpretation as a one-tap question ("250 meat-free and 250 regular?"), never a dead end.
  - Held-out paraphrases: "300 burgers, a third vegan", "half the 80 lunches gluten-free", "200 pizzas 40% veggie".
- **Conversation:** photos in the dock. The dock takes a photo and calls `read_image` when `VISION_LIVE=1`; otherwise the button is hidden or says why. Acceptance: one photo → reading → need on prod, traced.
- **Ops + Kitchen:** festivities as demand signals (a holiday adjustment with its source in the Forecast and the usual order) and a spending-trend chip, labelled simulated.
- **Site:**
  - the user's last notes (Sat 19:23–20:56): the earlier side layout was better and the text is too big; the middle component is too big; the hero wrap is awkward;
  - settle the scroll slides (the user said keep them; site-design.md says no snap);
  - check /story for a gap taller than one viewport at 1440 and 390;
  - each with screenshots in light and dark.
- **Evals:**
  - V1, a sponsor-usage pass plus an e2e quality review on the deployed build: every sponsor in CLAIMS observed with a trace on the deployed SHA;
  - rerun the Round 12 journeys before filming.
- **Lead:**
  - promote `scratch/site-review/SYSTEM-MAP.md` into `docs/concept/` (re-checked against main, linked from ARCHITECTURE);
  - write the product principle "value is simulation, prediction and automatic capture, not a dashboard of past data" into CONCEPT;
  - add the parked web-menus → ingredients → proposed basket idea to PITCH Next and GROWTH;
  - the comment sweep;
  - rewrite PLAN.md's Sunday checklist;
  - refresh USER-DIRECTIVES from BREADCRUMBS;
  - update CLAUDE.md rule 6 (fixture is the default for tests only; prod prefers live) and its freeze framing (converge; the freeze only times the video and submission).

## Waiting on the user
- **Decide:** may a person signed in with OAuth approve from an outside chat client? D13/D17 say no as written; the user argued yes. Record the answer as D22 and align agent-door-v2.
- **Decide:** Verda/Featherless routing. 91's proposal (f-evals.md:27): Verda after 3 passing vision runs, skip Featherless, a read-only routing view in System.
- **Before public:** rotate the static MCP judge keys and SMOKE_KEY, which were pasted into a lane chat.
- **SMOKE_KEY:** it was set in Aiven Sat ~05:45 and the race smoke passed at 05:51, but today's smoke ran without it (13 skipped). It needs to be in the Ops session's shell, not newly created.
- **Clarify:** the Sat 21:25 question to the site session, "URL-based or internal events?". Its meaning isn't recorded.

## Also waiting on the user
PUBLIC_ORIGIN in the Aiven console · Nemotron deployment name · SMOKE_KEY · history rewrite and placeholder prices before public (also fixes the Source 404) · the Ops brainstorm with d0.
