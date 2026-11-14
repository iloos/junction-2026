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
- **A full UI/UX pass in the new swarm:** after the three foundations land, one design session walks every surface (Kitchen, Basket, /request, chat dock, Ops, /agents, the site) with the impeccable critique against DESIGN.md. Its findings become the lanes' first batch.

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
