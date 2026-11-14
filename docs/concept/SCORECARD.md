# SCORECARD: excel at each challenge, not just qualify

_One row per criterion: what in our build scores it, and the evidence a judge sees. Weights are from the verbatim briefs in [../event/challenges/](../event/challenges/README.md). Use this to cut scope: a feature that scores nowhere is out. Update the **Status** column at each checkpoint._

Status: `[ ]` not started · `[~]` in progress · `[x]` shown working · `[!]` at risk.

## Disposition (D7, status as of main `0623b19`)
Pursue: **Valio** (main), **Gemini**, **Aiven**, **Context.dev** and **Exa** (submit each only if its evidence row is `[x]` at the Sat 22:00 checkpoint). Parked: Modal, Gemma, Verda, Nemotron, Cloudinary, AfterQuery, S-Pankki. Claims and their evidence: [PITCH.md](../PITCH.md).

## Valio Aimo: Trusted Trade Agents (main, €4k)
| Criterion (weight) | What scores it | Evidence the judge sees | Status |
|---|---|---|---|
| Working end-to-end demo (30) | Their required flow, run live: Request → Lookup → Order at a fixed price → Approval (agent decides, or a human signs off) | Their own example ("1,000 L lactose-free milk by Monday") runs end to end, then the Christmas-dinner deviation | [x] `/request` milk flow and the Christmas plan, deployed |
| Solving the user's need (20) | Menu × covers → regular order; events co-planned; ranked by the kitchen's priorities; least manual correction | The chef changes one thing, not twenty; price-first vs carbon-first baskets differ visibly | [~] seeded event × covers with g/guest edits; open menus not yet (A4) |
| Autonomy and controls (20) | Act / propose / sign-off tiers from the kitchen profile; every approval recorded against exact lines; op log | Policy card ("what this agent may do alone"); a held line with the reason; audit trail per order | [x] tiers, held reasons, per-line authority, hard limit, op log |
| Robustness to exceptions (15) | Partial availability, substitutions, cut-off times, pack sizes, recalls | Out-of-stock salmon → ranked substitutes with trade-offs; a missed cut-off → next delivery date | [~] outages, substitutes, lots, recall drill; cut-off at commit open (F9) |
| Openness and path to production (15) | MCP + OpenAPI with documented schemas; provenance (PROV-shaped) on decisions and enriched data; stated assumptions; next steps | A judge's own Claude connects and orders; `/openapi.json` and the MCP tool list; an "assumptions" page | [~] MCP + REST + OpenAPI, judge keys; `/agents` page on a branch |

Rules from their sheet: not a chatbot; query their APIs only when needed (the swarm uses our simulator); not a production system.

## Context.dev: The Web Is Your Real-Time Database (main, €2k), only if the recall monitor works
| Criterion (weight) | What scores it | Evidence | Status |
|---|---|---|---|
| Real-world impact (20) | Food recalls reach affected kitchens' held lines, with substitutes | A recall notice → the affected orders highlighted → substitutes proposed | [~] recall drill → held lines; no real recall matched |
| Creative use of live web data (20) | Recalls + manufacturer data enrichment + real menus | Three uses, each with a source link | [~] recall watch + Exa facts (MCP only) |
| Completeness of demo (20) | The recall flow runs end to end | Live or replayed monitor event | [~] replayed drill |
| Technical execution (20) | Monitors/webhooks, schema extraction, caching | Code + trace of the extraction | [x] webhook, revisions, caching, spend caps |
| Real-timeness (20) | Monitor → webhook → anomaly in the kitchen app | Timestamp from notice to alert | [~] monitor every 5 min; recall cases visible in Ops; a held line is a labelled drill |

## Tech challenges
| Challenge (prize) | Criteria | Our central use | Evidence / required write-up | Status |
|---|---|---|---|---|
| **Gemini API** (€4k / €2k / €1k) | Problem; how integrated; why innovative; why Gemini matters (unweighted) | Decisions API: calibrated rubric scoring of substitutes against priorities, act-or-ask decisions; request parsing (Flash-Lite) | Write-up answering the four questions; the decision scores visible in the UI | [~] Decisions in ranking, Flash-Lite parsing live; write-up open |
| **Nemotron** (RTX 5080) | Meaningful use 25 · execution 25 · output quality 25 · creativity 25 | (parked) documents; second-model check on plans | Text in the submission form: model, what it does, why, **how we improved outputs** (eval set of 10–20 cases) | parked (D7) |
| **Modal** ($2k + $3k credits) | Effective use 40 · ambition 25 · impact 20 · live demo 15 | (parked) enrichment batch over 17.5k products | Run dashboard: containers, throughput, cost; live deployed app | parked (D7) |
| **Verda** ($10k credits) | Ambition · fit · working prototype · path to scale (25 each) | Hosts open models in the EU (Nemotron, Gemma); GPU batch if needed | Documented process; **summary link posted in their Discord channel** | parked (D7) |
| **Aiven** (€1k) | Meaningful use 40 · tech 30 · impact 20 · creativity 10 | Runtime (prod + staging); Postgres: catalogue and Valio offer cache, plans and op log, idempotency, agent tasks, web state and spend caps; LISTEN/NOTIFY drives the control room | Architecture slide; the live stream visibly fed by Postgres | [x] Runtime + Postgres, race test on prod, NOTIFY → Ops; write-up in [SUBMISSION](../SUBMISSION.md) |
| **Cloudinary** ($500 voucher per member) | Innovation 30 · tech 20 · UX/design 30 · impact 20 | Valio data has no product images: only a document workflow (receipt / prep list / BEO upload → crop → extracted fields → order change), else drop | Before/after document crops; **submit their form** | dropped (no product images) |
| **Context.dev tech** (€750) | Creative use 40 · centrality of live web 30 · execution 30 | Real menus, manufacturer enrichment, recall monitor | Same as the main entry | [~] as the main entry |
| **Gemma** (€1k ×3) | Open | Cheap model for the swarm's kitchen agents (Featherless/Verda) | One line in the write-up + swarm config | parked (Featherless adapter exists, not in the demo) |
| AfterQuery (main, optional) | Gap 30 · difficulty 30 · reward integrity 25 · craft 15 | Only if the swarm becomes a reproducible environment with a checkable reward | One-command eval | skip unless time |

## Honest demo metrics (PRODUCT.md)
Edits per plan · gate outcomes (acted / held / rejected; 0 duplicates after a retry) · time to rescue and lookup economy. Path to production: the 4-week hotel pilot in PRODUCT.md.

## Shared assets that serve many rows
- **The op log with provenance:** Valio controls and openness, Context.dev sources, Nemotron "grounded outputs".
- **The control room:** Modal, Aiven, Valio end-to-end, and the peer-review wow.
- **The MCP + OpenAPI interface:** Valio openness, the judge's-own-agent moment.
- **A 2-minute video and a deck** that name each sponsor's role in one line.
