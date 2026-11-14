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

## Waiting on the user
PUBLIC_ORIGIN in the Aiven console · Nemotron deployment name · SMOKE_KEY · history rewrite and placeholder prices before public (also fixes the Source 404) · the Ops brainstorm with d0.
