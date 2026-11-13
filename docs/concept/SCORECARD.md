# SCORECARD: excel at each challenge, not just qualify

_One row per criterion: what in our build scores it, and the evidence a judge sees. Weights are from the verbatim briefs in [../event/challenges/](../event/challenges/README.md). Use this to cut scope: a feature that scores nowhere is out. Update the **Status** column at each checkpoint._

Status: `[ ]` not started · `[~]` in progress · `[x]` shown working · `[!]` at risk.

## Valio Aimo: Trusted Trade Agents (main, €4k)
| Criterion (weight) | What scores it | Evidence the judge sees | Status |
|---|---|---|---|
| Working end-to-end demo (30) | Their required flow, run live: Request → Lookup → Order at a fixed price → Approval (agent decides, or a human signs off) | Their own example ("1,000 L lactose-free milk by Monday") runs end to end, then the Christmas-dinner deviation | [ ] |
| Solving the user's need (20) | Menu × covers → regular order; events co-planned; ranked by the kitchen's priorities; least manual correction | The chef changes one thing, not twenty; price-first vs carbon-first baskets differ visibly | [ ] |
| Autonomy and controls (20) | Act / propose / sign-off tiers from the kitchen profile; every approval recorded against exact lines; op log | Policy card ("what this agent may do alone"); a held line with the reason; audit trail per order | [ ] |
| Robustness to exceptions (15) | Partial availability, substitutions, cut-off times, pack sizes, recalls | Out-of-stock salmon → ranked substitutes with trade-offs; a missed cut-off → next delivery date | [ ] |
| Openness and path to production (15) | MCP + OpenAPI with documented schemas; provenance (PROV-shaped) on decisions and enriched data; stated assumptions; next steps | A judge's own Claude connects and orders; `/openapi.json` and the MCP tool list; an "assumptions" page | [ ] |

Rules from their sheet: not a chatbot; query their APIs only when needed (the swarm uses our simulator); not a production system.

## Context.dev: The Web Is Your Real-Time Database (main, €2k), only if the recall monitor works
| Criterion (weight) | What scores it | Evidence | Status |
|---|---|---|---|
| Real-world impact (20) | Food recalls reach affected kitchens in minutes, with substitutes | A recall notice → the affected orders highlighted → substitutes proposed | [ ] |
| Creative use of live web data (20) | Recalls + manufacturer data enrichment + real menus | Three uses, each with a source link | [ ] |
| Completeness of demo (20) | The recall flow runs end to end | Live or replayed monitor event | [ ] |
| Technical execution (20) | Monitors/webhooks, schema extraction, caching | Code + trace of the extraction | [ ] |
| Real-timeness (20) | Monitor → webhook → anomaly in the kitchen app | Timestamp from notice to alert | [ ] |

## Tech challenges
| Challenge (prize) | Criteria | Our central use | Evidence / required write-up | Status |
|---|---|---|---|---|
| **Gemini API** (€4k / €2k / €1k) | Problem; how integrated; why innovative; why Gemini matters (unweighted) | Decisions API: calibrated rubric scoring of substitutes against priorities, act-or-ask decisions; optional Live voice for the chef | Write-up answering the four questions; the decision scores visible in the UI | [ ] |
| **Nemotron** (RTX 5080) | Meaningful use 25 · execution 25 · output quality 25 · creativity 25 | Reads photos/PDFs (prep lists, delivery notes, spec sheets); second-model check on plans | Text in the submission form: model, what it does, why, **how we improved outputs** (eval set of 10–20 cases) | [ ] |
| **Modal** ($2k + $3k credits) | Effective use 40 · ambition 25 · impact 20 · live demo 15 | Enrichment batch over 17.5k products; 500-kitchen swarm; Sandboxes | Run dashboard: containers, throughput, cost; live deployed app | [ ] |
| **Verda** ($10k credits) | Ambition · fit · working prototype · path to scale (25 each) | Hosts open models in the EU (Nemotron, Gemma); GPU batch if needed | Documented process; **summary link posted in their Discord channel** | [ ] |
| **Aiven** (€1k) | Meaningful use 40 · tech 30 · impact 20 · creativity 10 | Postgres: enriched catalogue (pgvector), orders, ops; LISTEN/NOTIFY drives the control room; maybe Runtime hosting | Architecture slide; the live stream visibly fed by Postgres | [ ] |
| **Cloudinary** ($500 voucher per member) | Innovation 30 · tech 20 · UX/design 30 · impact 20 | Valio data has no product images: only a document workflow (receipt / prep list / BEO upload → crop → extracted fields → order change), else drop | Before/after document crops; **submit their form** | [ ] |
| **Context.dev tech** (€750) | Creative use 40 · centrality of live web 30 · execution 30 | Real menus, manufacturer enrichment, recall monitor | Same as the main entry | [ ] |
| **Gemma** (€1k ×3) | Open | Cheap model for the swarm's kitchen agents (Featherless/Verda) | One line in the write-up + swarm config | [ ] |
| AfterQuery (main, optional) | Gap 30 · difficulty 30 · reward integrity 25 · craft 15 | Only if the swarm becomes a reproducible environment with a checkable reward | One-command eval | skip unless time |

## Honest demo metrics (PRODUCT.md)
Edits per plan · gate outcomes (acted / held / rejected; 0 duplicates after a retry) · time to rescue and lookup economy. Path to production: the 4-week hotel pilot in PRODUCT.md.

## Shared assets that serve many rows
- **The op log with provenance:** Valio controls and openness, Context.dev sources, Nemotron "grounded outputs".
- **The control room:** Modal, Aiven, Valio end-to-end, and the peer-review wow.
- **The MCP + OpenAPI interface:** Valio openness, the judge's-own-agent moment.
- **A 2-minute video and a deck** that name each sponsor's role in one line.
