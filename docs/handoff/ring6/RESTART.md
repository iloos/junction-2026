# Ring 6 restart: every lane picks back up from here

_Lead, Sat 14 Nov late. The user asked to restart all lanes in fresh sessions. Lanes finish what is in flight, start nothing new, push their branch, and write their checkpoint (Done · In flight · Next · Risks · How to resume) in their lane brief. The lead merges what lands green and fills this page from those checkpoints. A fresh session reads, in order: CLAUDE.md, this page, its lane brief, [ring5 SYNTHESIS](../ring5/SYNTHESIS.md), [USER-DIRECTIVES](../ring4/USER-DIRECTIVES.md), [Round 12](../../review/ROUND12-ADVERSARIAL.md)._

## Sessions for ring 6 (one area each; subagents for bounded jobs)
| Session | Area | Brief | Absorbs | Final SHA | Ready |
|---|---|---|---|---|---|
| Core | core, mandate, `meets()`, needs, contention | [core-db](../../lanes/core-db.md) | 8d | | |
| Kitchen and basket | Kitchen canvas, Basket, usual-order UI, establishment entry, rules UI | [kitchen](../../lanes/kitchen.md) | 1f, c3 | | |
| Conversation | chat, /request, menus, D15 stage 2 | [request](../../lanes/request.md), [agent2](../../lanes/agent2.md), [menu-v2](../../lanes/menu-v2.md) | B, E, 41 | | |
| Ops and deploy | Ops rework, traces, deploys and smokes | [ops](../../lanes/ops.md) | 9c | lane/g17 40be576 (WIP R12-09, don't merge alone); prod a9f06ee | ✓ |
| Evals and claims | OPEN maps, CLAIMS, prod re-tests | [f-evals](../../lanes/f-evals.md) | 91 | lane/f-evals a300109 (local; origin stale at ddf701a) | ✓ |
| Agent door | MCP/REST, `revise_menu`, pairing | [agent-door-v2](../../lanes/agent-door-v2.md) | da | | |
| Site | mandate.kitchen, proof, story | [site](../../lanes/site.md) | d0, 73 | lane/site 632a0d0 (includes 73's 4ff9913); live site dfff213 | ✓ |

0d is done: lane/history-profiles f418814 (R12-06 history for P4/P5/P6/P8 in ca8f9ed), ready; lane/valo-basket 7ecaa9e stays held. 0d retires; its open items move to Kitchen and basket (profiles, history) and the lead (valo-basket held).

## Queued at restart (from the lead's routing; lanes confirm in their Next)
- **Core:** R12-01 (the ask binds quote and commit), R12-02 (one cereal/allergen fact table), R12-04 = R10-05 (contention adds only the residual); then R11-04, R11-10, R10-06, R10-08; every place_order line makes a need; the "Valio suggests" contract (K7).
- **Conversation:** the chat menu flow (TOP in SYNTHESIS), R12-03 (vegan stays a requirement), unknown units ask (R12-01 upstream), R12-10 (no Continue after cancel), menu-ask routing, the text-heavy request page → one-line rows + comparison table + one bill-style line component, choice quality, D15 stage 2, pin persistence, the dinner-replay eval, `/request?text=` prefill for site CTAs.
- **Kitchen and basket:** R12-05 (establishment first; Basket on `basketFor`), R12-06 (usual-order panel; P4–P8 history), the rules rework, K7/K8.
- **Ops:** the full rework (header and KPI row; Live, Demand, Forecast, Engine room; sankey demand flow, case story, stakes chart, gate paths, forecast), R12-09 (stored traces and Sponsors summary), the cross-tab live check.
- **Agent door:** R12-08 (`revise_menu` registered, converging to one receipt), Ring 2, the listing on lookup_facts.
- **Evals:** keep the OPEN maps current as core closes R12-01/02/04; prod re-run of all nine Round 12 journeys before filming.
- **Site:** R12-11 site side (pinned numbers, CTA labels or prefill), W4 re-record.

## Found during wind-down (prod a9f06ee)
- **Ops doesn't follow a sandbox reset from another tab** (same run id after 30 s) → Ops P1 in its Next. A new order does show live in 0.6 s.
- **Dock approval status** ("You approved N lines") never appears: `evals/ui/dock-sync.e2e.ts:28` fails on prod → Conversation/Kitchen.
- The smoke can't verify Add to calendar (it's a menu) or the bill at 390 → fix the smoke selectors.

## Waiting on the user
PUBLIC_ORIGIN in the Aiven console · Nemotron deployment name · SMOKE_KEY · history rewrite and placeholder prices before public (also fixes the Source 404) · the Ops brainstorm with d0.
