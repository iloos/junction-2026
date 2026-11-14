# Breadcrumbs: every user ask, checked against the repo

_Lead, Sat 14 Nov late. Two audits of every message the user typed in all 19 sessions, paraphrased, with no personal data or keys. Missing items are queued in [RESTART.md](RESTART.md). The extracted messages stay in gitignored `scratch/sessions/`._

## Lead session: every ask, checked against the repo

_Audit of the 168 messages the user typed to the lead session (Fri 13 16:55 → Sat 14 21:47, local UTC+2), checked against USER-DIRECTIVES, RESTART, SYNTHESIS, DECISIONS (D0–D21), STATUS, lane checkpoints, PITCH, VOCABULARY, PLAN and git history up to 67a193d. Near-duplicates merged; one-off questions skipped. `?` = uncertain._

**Counts (113 rows):** DONE 74 (4 also partly queued) · QUEUED 28 · MISSING 3 rows (6 items below) · SUPERSEDED 4.

| # | When | Ask (paraphrased) | Area | Status | Evidence / where it belongs |
|---|---|---|---|---|---|
| 1 | Fri 16:55 | Prep the repo: stack, building blocks, docs layout, agent workflows; mine prior projects and hackathon winners | process | DONE | STACK.md, BUILDING-BLOCKS.md, ORCHESTRATION.md, strategy/WINNING.md |
| 2 | Fri 16:55 | Review the local tooling (MCPs, plugins) | infra | DONE | STACK.md |
| 3 | Fri 16:55 | Win criteria: impressive UI, lots of data, solves a problem, self-explaining, wow; working app; strong sponsor use | design | DONE (rule) | CLAUDE.md rules 4, 12; WINNING.md |
| 4 | Fri 16:55 | Local storage first, with a proper API | core | SUPERSEDED | D3 (Postgres) |
| 5 | Fri 16:55 | Agentic chat, data dashboard, data-transform mechanisms | core | DONE | dock, Ops, core |
| 6 | Fri 16:57 | d3 or three.js for impressiveness | design | DONE | D0c |
| 7 | Fri 18:03 | Use the personal GitHub account | infra | DONE | memory |
| 8 | Fri 18:13 | SvelteKit 3 or 2 | infra | DONE | D0 |
| 9 | Fri 18:22 | Architecture and deployment; deploy-ready, multi-user/SaaS shape | infra | DONE | D3, D9, GROWTH.md, memory-and-tenancy.md |
| 10 | Fri 20:00 | W3C PROV for provenance and audit | core | DONE | ARCHITECTURE, CONCEPT, PRIVACY |
| 11 | Fri 20:00 | Transcribe the kickoff; use the saved challenge pages | process | DONE | event/KICKOFF.md, event/challenges/ |
| 12 | Fri 20:35 | What each partner prize requires | process | DONE | event/SPONSORS.md |
| 13 | Fri 20:49 | A slice that stacks challenges, with a wow factor | process | DONE | D1, D7 |
| 14 | Fri 21:03 | Roles for Verda, Modal, Nemotron, Context.dev vs Exa | infra | DONE | D5, D7 |
| 15 | Fri 21:07 | Out-of-sample failures need live research and critical loops | core | DONE | CONCEPT; research/mcpcon.md; D20 |
| 16 | Fri 21:16 | Modal sandboxes and fan-out; self-hosted speech later | infra | SUPERSEDED | D7 parked; D19 amendment |
| 17 | Fri 21:16 | Value is simulation, prediction and automatic capture, not last-gen dashboards | design | QUEUED (partly) | Ops Forecast; never written as a principle |
| 18 | Fri 21:53 | Set up all SDKs, CLIs and MCPs | infra | DONE | foundations/*.md |
| 19 | Fri 21:57 | Generic one-sentence description | site | DONE | PITCH, SUBMISSION |
| 20 | Fri 22:01 | Never read .env; renaming keys is fine | process | DONE (rule) | CLAUDE.md rule 5 |
| 21 | Fri 22:09 | Move the downloaded Valio files into the repo | process | DONE ? | event/challenges/, foundations/valio-data.md |
| 22 | Fri 22:26 | Prefer sponsor infrastructure over Vercel | infra | DONE | D3 |
| 23 | Fri 23:00 | Public URL and domain for judges' agents | infra | DONE | app.mandate.kitchen, mandate.kitchen |
| 24 | Fri 23:40 | Valio booth notes: menu base, priorities, substitutes, enrichment, regular orders, anomalies; customer and internal sides | core | DONE | CONCEPT, PRODUCT; Kitchen + Ops |
| 25 | Fri 23:45 | Christmas-dinner case; human in the loop; research horeca flows | core | DONE | research/horeca*.md |
| 26 | Fri 23:45 | Stack sponsors; excel in each challenge's scope | process | QUEUED | PLAN.md; D7 |
| 27 | Fri 23:51 | Placeholder submissions, clearly marked | process | DONE | SUBMISSION.md |
| 28 | Sat 00:14 | Would the design survive another data-heavy challenge? Avoid overfitting | core | DONE | rule 2, D4 |
| 29 | Sat 00:14 | Markdown stays the source of truth; the roadmap view is the user's, later | process | DONE | docs/roadmap (untracked) |
| 30 | Sat 00:20 | Per-service foundations, full-shape review, parallel lanes, UX thinking | process | DONE | foundations/, ORCHESTRATION |
| 31 | Sat 00:23+ | Adversarial-review prompts for an outside model | process | DONE | review/ROUND*-PROMPT.md |
| 32 | Sat 00:26 | Probe Valio's data and API with a cache | infra | DONE | valio_probe.py, D5 |
| 33 | Sat 00:39 | Big version on the real stack; no hardcode→JSON→SQL ladder | process | DONE (rule) | D4 |
| 34 | Sat 00:40 | Startup-method pass: stories, flows, cases | process | DONE | concept/PRODUCT.md |
| 35 | Sat 00:42 | Horeca profiles, regularity patterns, online data | core | DONE | research/horeca-profiles.md |
| 36 | Sat 00:43 | Scrape Finnish horeca from several sources | agent door | DONE | research/venues.md |
| 37 | Sat 00:53 | Later: multi-user, memory, server-side work, many clients, no double orders | core | DONE | D6, D9, memory-and-tenancy.md; RESTART Foundations 1 |
| 38 | Sat 01:04 | Reground and tidy before compaction | process | DONE | checkpoints |
| 39 | Sat 01:08 | Lead orchestrates; peer sessions vigilant and proactive | process | DONE (rule) | memory |
| 40 | Sat 02:13 | Include Exa; Modal and Gemma only as extensions | process | DONE | D7 |
| 41 | Sat 03:04 | Model choice beyond one env var | infra | DONE | D12 |
| 42 | Sat 03:13 | Land stable periodically; review → review the review → dump | process | DONE (rule) | ORCHESTRATION |
| 43 | Sat 04:13 | Surface the user's actions; overview first | process | DONE (rule) | "Waiting on the user" sections |
| 44 | Sat 05:51 | Repo-wide consistency and cleanup; land clean | process | DONE | rings 3–5 |
| 45 | Sat 05:56 | Spend Context.dev credits | infra | DONE | lanes/web.md |
| 46 | Sat 07:00 | Clean wiring, best service use, real stories, UI overhaul, d3 that shows the system | design | QUEUED | Foundations 3, Ops rework |
| 47 | Sat 07:02 | Review the roadmap | process | DONE | roadmap reviews (stale) |
| 48 | Sat 07:08 | Away from mock, cache and fake | core | DONE (rule) | D11 |
| 49 | Sat 09:02 | Presenter key then Kitchen broke | ops | QUEUED ? | BUGS.md:83 |
| 50 | Sat 09:50 | Agent on a hidden page, scripted-only | chat | DONE | dock everywhere; D20 |
| 51 | Sat 09:52 | Can't accept the menu | chat | QUEUED | E checkpoint (lane/e2-chat) |
| 52 | Sat 09:53 | Open chat input; a stronger model | chat | DONE | D12, D15, D20 |
| 53 | Sat 11:05 | Step back: coherence, mis-piped parts, current←eventual, criteria | process | DONE | syntheses, SCORECARD |
| 54 | Sat 11:05 | No bloated, stale or history comments | process | QUEUED | CLAUDE.md "Comments"; comment sweep |
| 55 | Sat 11:05, 15:18 | Fold the good mock-design parts into the app | design | QUEUED | handoff/ui-mockset-to-prod.md; Ops rework |
| 56 | Sat 12:14 | Choose the domain | infra | DONE | mandate.kitchen |
| 57 | Sat 12:56 | Rewrite the git-history mistake | infra | QUEUED [!] | waiting on the user |
| 58 | Sat 13:07 | Substitute kinds from data, pre-mapped, not prompt-only | core | QUEUED | core-db (R11-10) |
| 59 | Sat 13:17 | Substitutes generalise out of sample; enrich on discovery | core | QUEUED | D19 amendment; core-db |
| 60 | Sat 13:35 | Use Valio's Discord answers | core | DONE | D6 amendment |
| 61 | Sat 13:44 | Less friction; reliable, intuitive, trustworthy, private; clean UI/agent mix | design | DONE (rule) | V3; PRIVACY.md |
| 62 | Sat 13:57 | Kitchen: less text, alignment, shorter rows, concrete titles | kitchen | DONE + QUEUED | b364dd4, ac2899e; Foundations 3 |
| 63 | Sat 14:01 | Stuck approving without the Kitchen page | chat | DONE | D13 |
| 64 | Sat 14:17 | Landing: fanned hand of case cards; compact real app | site | DONE | site.md |
| 65 | Sat 14:41 | Nemotron pictures for outside agents (MCP) | agent door | QUEUED [!] | read_image behind VISION_LIVE; endpoint name pending |
| 66 | Sat 14:41 | Pictures in the in-app chat | chat | **MISSING** | no dock upload; PITCH "parked" |
| 67 | Sat 14:41 | Later: web menus → estimated ingredients → proposed basket | agent door | **MISSING** | research/venues.md data only |
| 68 | Sat 14:44 | No separate approver or notifications; the chef approves | core | DONE | D13, D17 |
| 69 | Sat 14:44 | Festivities as demand signals; surface spending patterns | ops | **MISSING** | only holidays in the date control |
| 70 | Sat 15:20 | Ops orders overview as a diff, usable for approval | ops | DONE | O1 |
| 71 | Sat 15:20 | Ops "not there yet" | ops | QUEUED [!] | Ops rework; brainstorm |
| 72 | Sat 16:08 | Kitchen ↔ chat sync of approve and dismiss | chat | QUEUED | dock-sync fails on prod; Foundations 2 |
| 73 | Sat 16:25 | "Valio suggests" slot with "I don't mind" | kitchen | QUEUED | K7; core-db; kitchen.md |
| 74 | Sat 16:25 | Diet and allergen marks | kitchen | DONE | d8a5c95 |
| 75 | Sat 16:25 | Property matrix view; cards only with images | kitchen | QUEUED | K8; request.md |
| 76 | Sat 16:25 | Product images | kitchen | DONE | 8f48df5 |
| 77 | Sat 16:25 | More profiles that shape recommendations | kitchen | DONE | 0501b16, ca8f9ed |
| 78 | Sat 16:25 | Recurring orders → dependable demand | core | QUEUED | D14; usual-order UI on c3 |
| 79 | Sat 16:49 | Switching restaurant switches the basket | kitchen | QUEUED | c3 `join` (lane/c3-basket) |
| 80 | Sat 16:49 | Christmas 140 overused | kitchen | DONE | b8f58db, c6d0baf |
| 81 | Sat 16:49 | Landing shows the full chain | site | DONE | W1, W2 |
| 82 | Sat 16:56 | Per-client history, windows, detected periods | core | DONE | D14 |
| 83 | Sat 17:03 | Lost first message, dead chips | chat | DONE | 9a7fa8f |
| 84 | Sat 17:03, 20:58 | Calendar: a day picker; add an event, not a calendar | kitchen | DONE + QUEUED | 8ede973, 4f01541; DayPicker on c3 |
| 85 | Sat 17:05 | Quantity and item separate; public listing | request | DONE | 9c2a9e6 |
| 86 | Sat 17:16 | Exa for watching too | agent door | QUEUED | PITCH Next |
| 87 | Sat 17:16 | Sponsor-usage pass plus e2e quality review | process | QUEUED | V1 |
| 88 | Sat 17:22 | Join → chat-first home → Kitchen canvas; Request merges into the agent | chat | QUEUED | D15; RESTART |
| 89 | Sat 17:25 | Stage it | process | DONE | D15 |
| 90 | Sat 17:37 | One coherent shape for mandate, requirements, constraints, notes | core | DONE | D16 |
| 91 | Sat 17:47 | Observability via Aiven | infra | DONE | o-obs |
| 92 | Sat 17:51 | Ship logs to OpenSearch | infra | SUPERSEDED | Aiven refused; service held/deleted |
| 93 | Sat 17:55 | Align requirements with the agent door | agent door | DONE | 1eb870d |
| 94 | Sat 18:01 | 250 ml → 250 l; the judge should catch it | core | DONE | D18, D20, f882939 |
| 95 | Sat 18:04 | Logo two-click behaviour | site | DONE | b410aa0 |
| 96 | Sat 18:09 | pgvector + Modal reranking | core | SUPERSEDED | D19 + amendment |
| 97 | Sat 18:34 | Agent goes passive | chat | DONE + QUEUED | 98ea1a9, f8964e5 |
| 98 | Sat 18:47 | Intent over special cases; few-shot | chat | DONE | D20 |
| 99 | Sat 18:47 | Flash-Lite not smart enough | chat | DONE | D12, D20 |
| 100 | Sat 19:00 | Kitchen as a basket; images there too | kitchen | QUEUED | c3 Basket (lane/c3-basket) |
| 101 | Sat 19:02 | Converge, don't fixate on the freeze | process | DONE (rule) | memory; SYNTHESIS |
| 102 | Sat 19:31 | Sessions vs subagents | process | DONE | RESTART table |
| 103 | Sat 20:19 | PUBLIC_ORIGIN, Nemotron, public scrub | infra | QUEUED [!] | waiting on the user |
| 104 | Sat 20:34 | /story polish (scroll-snap, sections, clutter, gap) | site | DONE ? | a64cad1, 51defe0; the gap fix not named |
| 105 | Sat 20:35 | No slogan-pattern copy | site | DONE (rule) | VOCABULARY Voice |
| 106 | Sat 20:36 | Sponsor tiles; generic tagline | site | DONE | 9d4e9da, 511b8a5 |
| 107 | Sat 20:39 | Reset the sandbox from System | kitchen | DONE | 33d086e |
| 108 | Sat 20:39 | Bill alignment, layout, errors | kitchen | DONE + QUEUED | 33d086e; Foundations 3 |
| 109 | Sat 20:42 | Request goes to chat by itself | chat | QUEUED | D15 stage 2 |
| 110 | Sat 20:43 | Request page text-heavy; bill-style lines | request | QUEUED | request.md Next |
| 111 | Sat 20:46 | Chat menu flow broken end to end | chat | DONE + QUEUED | f8964e5; agent2.md Next |
| 112 | Sat 21:01 | Grey out with the reason up front; filter/sort/priority layout | design | DONE + QUEUED | b36def5; Foundations 3 |
| 113 | Sat 21:05, 21:25 | /how explainer; Ops sankey and a professional dashboard | site / ops | DONE + QUEUED | d2e8b81; Ops rework |

### Missing (added to RESTART's queue)
- **Conversation: photos in the dock.** The dock takes a photo and calls `read_image` when `VISION_LIVE=1`; otherwise the button is hidden or says why. Acceptance: one photo → reading → need on prod, traced; PITCH updated once live.
- **Ops + Kitchen: festivities as demand signals.** Forecast and the usual order show a holiday adjustment with its source; the Kitchen shows a spending-trend chip. Acceptance: one seeded kitchen shows both, labelled simulated where they are.
- **Lead: the parked web-menus idea.** One line in PITCH Next and GROWTH: web menus → ingredients → proposed basket. Nothing built until reopened.
- **Site: /story gap check** (may already be fixed). No gap taller than one viewport at 1440 and 390, light and dark.
- **Kitchen + Conversation: one ranking/priority/filter control**, in the same place on the Kitchen, the request card and the dock (may fold into Foundations 3).
- **Lead: the product principle.** "Value is simulation, prediction and automatic capture, not a dashboard of past data", in CONCEPT or SCORECARD.

### Standing rules and preferences (where captured)
| Rule or preference | Captured in |
|---|---|
| Never read .env values | CLAUDE.md rule 5 |
| No secrets in git; scrub before public | CLAUDE.md; PLAN |
| Big version in rings on the real stack; no mock ladders | D4; memory |
| Converge to the ideal shape; the freeze is a backstop | memory; SYNTHESIS (CLAUDE.md still frames by freeze times) |
| Prefer live calls; fixtures for tests and labelled fallback | D11; memory (CLAUDE.md rule 6 still says fixture is "the default") |
| Label simulated data; never claim unwired features | CLAUDE.md rule 8; CLAIMS |
| Five-second UI; depth on demand | CLAUDE.md rule 12 |
| Less text, alignment, compact rows, bill-style lines, tables over prose | RESTART Foundations 3 (DESIGN.md not yet written) |
| Prevent rather than error: grey out with the reason | Foundations 3; kitchen.md |
| Cards only with images | K8 |
| No slogan patterns; no "covers" | VOCABULARY |
| Intent over special cases; few-shot; measure generalisation | D20 |
| The chef approves; the agent never does | D13, D17, D21 |
| Sponsor infrastructure, load-bearing | D3, D7 |
| Fewer durable sessions plus subagents; vigilant peers | memory; RESTART |
| Checkpoint: review → review the review → dump | ORCHESTRATION |
| No stale or history comments | CLAUDE.md "Comments" |
| Stress-test at 10× | CLAUDE.md rule 4 |
| Value is simulation and prediction, not dashboards | **not captured** (queued above) |

### Recurring themes (three or more asks)
1. UI text-heavy, misaligned, "vibe-coded" (9+): no design system or shared row primitives → Foundations 3.
2. Agent and app don't feel like one thing (8): two harnesses over one state → Foundations 2, D15 stage 2.
3. One hard-coded demo instead of a customer (4): no tenancy shape → Foundations 1.
4. Wrong quantities and lost requirements (4): D16/D18/D20 landed; R12-02 and R12-04 open.
5. Sponsor usage not visible or not best-use (5): V1.
6. Model quality (3): answered by D12 each time; a per-job model table in the app would end the question.
7. Calendar and dates (3): DayPicker pending on c3.
8. Process asks repeat (review/compact/handoff ~8, adversarial prompts 5, overviews 6): candidates for templates or skills.

## Lane sessions: every ask the user made directly to a lane

_Audit of the user's messages in the 18 non-lead sessions, checked against USER-DIRECTIVES, RESTART, SYNTHESIS, DECISIONS (through D21), STATUS, docs/lanes on main and the lane branches, and the specs they point to. Times local (UTC+2). The session-to-lane map is inferred; `?` = a guess. No keys, names or private content reproduced._

**Counts (77 asks):** DONE 45 · DONE but partial or at risk 8 · QUEUED 17 · MISSING 5 (+3 missing pieces inside DONE rows) · SUPERSEDED 2.

| # | Lane | When | Ask | Area | Status | Evidence |
|---|---|---|---|---|---|---|
| 1 | event research | Fri 20:40 | Parse all challenge pages behind the login, semi-structured | Event | DONE | event/CHALLENGES.md, KICKOFF.md |
| 2 | tooling | Fri 20:20 | Install the Context.dev MCP and SDK | Tooling | DONE ? | check_recall live |
| 3 | transcripts | Fri 21:09 | Transcribe event and workshop recordings; insights | Event | DONE | KICKOFF.md; research/mcpcon.md |
| 4 | transcripts | Fri 21:17 | Team email and mock pre-submission? | Event | DONE | KICKOFF.md |
| 5 | team name | Fri 21:24 | Team name and profile text | Event | DONE | D2 |
| 6 | one-liner | Fri 23:56 | Pre-submission deadline | Event | DONE | KICKOFF.md |
| 7 | core (8d?) | Sat 02:50 | Gemini 402 after the key change | LLM | DONE | D12 |
| 8 | core (8d?) | Sat 12:52 | Deterministic kg↔l with density; the agent asks "is x l OK?" | Core | DONE (comment stale?) | 5399328, core/demand/convert.ts vs tools.ts:303 |
| 9 | infra | Sat 03:04 | Why Context.dev fails | Sponsors | DONE ? | recall monitor live |
| 10 | infra | Sat 06:46 | More useful Aiven spend, headless | Infra | DONE | OpenSearch tried and refused; Kafka as W5 |
| 11 | credits | Sat 02:28 | What the Gemini credits unlock | LLM | DONE | D12 |
| 12 | research/UX | Sat 02:32 | Learn principles from other agentic projects; samples only | Process | DONE | ring3 review-docs-criteria; D20 |
| 13 | research/UX | Sat 02:41 | Chat useful without the UI; in-chat components beside a canvas | Conversation | QUEUED | D15; RESTART |
| 14 | research/UX | Sat 02:41 | Flows for repeat orders, anomalies, custom orders per user type | Product | QUEUED | D14, D15 |
| 15 | research/UX | Sat 02:51 | Screenshot Valio's demo portal as the baseline | Research | DONE | research/valio-baseline.md |
| 16 | research/UX | Sat 03:07 | Product images: OFF/sponsor chain, licensing | Images | DONE | research/product-images.md; barcode-verified photos |
| 17 | research/UX | Sat 03:27 | Report claims to the lead; pitch notes | Process | DONE | archive |
| 18 | kitchen (1f?) | Sat 14:47 | Kitchen title adapts to the case | Kitchen | DONE | ac2899e |
| 19 | evals (91) | Sat 05:40 | Smoke setup and keys, local and Aiven | Ops | DONE | f-evals.md (race smoke passed Sat 05:51) |
| 20 | evals (91) | Sat 12:58 | A sponsor finds a dish's true ingredients | Web | DONE | web/grounding.ts; dish-card grounding queued |
| 21 | evals (91) | Sat 13:02 | Better substitution design | Core | DONE | research/substitutes.md, ce5f37e; K8 queued |
| 22 | evals (91) | Sat 15:33 | Ranking axes as optional filters in Kitchen, planner and agent | Kitchen/agent | DONE (partial) | presets; parity = Foundations 2 |
| 23 | evals (91) | Sat 15:33 | Constraints per line or per order, strict or best try | Core/UI | DONE core, UI MISSING | 39d2368 |
| 24 | evals (91) | Sat 21:14 | Verda/Featherless routing, configurable in System? | LLM | QUEUED (lane only) | f-evals.md:27 |
| 25 | mocks (c3) | Sat 09:09 | More wow; landing as pitch; architecture page; sponsors | Site/UI | DONE | /story, /how |
| 26 | mocks (c3) | Sat 09:18 | Mockups of landing, architecture and UI | Design | DONE | scratch/ux-mock + ui-mockset-to-prod.md |
| 27 | mocks (c3) | Sat 09:18 | Chat-led flow with strong Kitchen and ledger affordances | Product | QUEUED | D15 |
| 28 | mocks (c3) | Sat 09:31 | Per-line bars don't read; five-second rule | Kitchen | DONE | rule 12; 7f98f20 |
| 29 | mocks (c3) | Sat 09:36 | Ops and engine must mean something, not a dev panel | Ops | QUEUED | ops.md rework brief |
| 30 | mocks (c3) | Sat 09:36 | Orders over time and stock; kitchen → menu → dish → ingredient map; many kitchens | Ops/domain | QUEUED | sankey, forecast; Foundations 1 |
| 31 | mocks (c3) | Sat 09:36 | Libraries for our stack | Design | DONE | mockset "Libraries" |
| 32 | mocks (c3) | Sat 09:47 | Better sankey; scale to many stores and items | Ops | QUEUED | Ops brief |
| 33 | mocks (c3) | Sat 09:47 | Interactive sponsor highlight with a worked example | Site/Ops | DONE site, QUEUED Ops | /story partner tabs; R12-09 |
| 34 | mocks (c3) | Sat 10:02 | Slower gate pulses; less LLM prose | Site | DONE | VOCABULARY Voice |
| 35 | mocks (c3) | Sat 10:02 | Data entities and the request process over time | Site/app | DONE (partial) | /how; in-app page unrouted |
| 36 | mocks (c3) | Sat 10:08 | A "locked-in" regularity surface with the maths | Usual order | QUEUED | rhythm.html; usual-order spec |
| 37 | mocks (c3) | Sat 10:27 | Review the mock set; plan the move to prod | Design | DONE | ui-mockset-to-prod.md |
| 38 | mocks (c3) | Sat 11:04 | Forecast vs usual order; per-customer memory; SaaS tenancy | Domain | DONE (doc) | memory-and-tenancy.md; Foundations 1 |
| 39 | mocks (c3) | Sat 11:09 | Memory without overfitting; time; company and chat memory | Domain | DONE (doc) | memory-and-tenancy.md |
| 40 | mocks (c3) | Sat 15:17 | Kitchen mock B slightly better | Kitchen | SUPERSEDED | mockset #15 closed |
| 41 | mocks (c3) | Sat 19:12 | Pair-a-phone optional | Kitchen | QUEUED | c3 brief |
| 42 | site (d0) | Sat 12:16 | DNS: apex for landing, `app.` for the app | Deploy | DONE | STATUS |
| 43 | site (d0) | Sat 13:53 | Lean pitch landing plus deeper pages | Site | DONE | /, /story, /how, /proof |
| 44 | site (d0) | Sat 14:56 | Story more interactive; /proof styled differently | Site | DONE | a64cad1 |
| 45 | site (d0) | Sat 14:58 | Usual order and How ordering works pages, with the maths, in the app | App | QUEUED, unrouted | usual-order spec |
| 46 | site (d0) | Sat 17:13 | Lighter dark story | Site | SUPERSEDED | by #56 |
| 47 | site (d0) | Sat 17:13 | Story speaks to the customer: event, menu, dish or item | Site | DONE | tagline |
| 48 | site (d0) | Sat 17:14 | Kafka on Aiven as pitch next | Pitch | QUEUED | W5 |
| 49 | site (d0) | Sat 17:18 | Ops dashboard must improve | Ops | QUEUED | Ops rework |
| 50 | site (d0) | Sat 21:25 | "URL-based or internal events?" | ? | MISSING ? | no answer recorded |
| 51 | site design (73) | Sat 18:25 | Full impeccable review; subtle motion; one type family | Site | DONE | site-design.md |
| 52 | site design (73) | Sat 18:25 | Copy and card fixes; several entry points, not one chain | Site | DONE | 26bc20d, b0aae2c |
| 53 | site design (73) | Sat 18:42 | Dark mechanism-focused deep dive | Site | DONE | /story, /how |
| 54 | site design (73) | Sat 18:52 | A feature map, dataflow and mechanisms doc | Docs | DONE, at risk | scratch/site-review/SYSTEM-MAP.md (gitignored) |
| 55 | site design (73) | Sat 18:54 | /how, /story and landing look identical on prod | Site | DONE ? | separate pages live |
| 56 | site design (73) | Sat 19:23 | Earlier side layout nicer; text too big; darker dark | Site | DONE dark, MISSING layout | site.md |
| 57 | site design (73) | Sat 19:27 | Keep the scroll slides | Site | MISSING ? | site-design "no snap" vs site.md "snap" |
| 58 | site design (73) | Sat 20:48 | Headline "What do you need? We'll sort it out. That's a mandate." | Site | DONE | live |
| 59 | site design (73) | Sat 20:49 | Middle component too big; hero wrap awkward | Site | MISSING | |
| 60 | valo basket (0d) | Sat 13:13 | Real basket on Valio's webshop, no account | Valio | QUEUED (held) | valo-basket 7ecaa9e |
| 61 | valo basket (0d) | Sat 13:23 | Short pitch message to Aimo | Valio | DONE | sent |
| 62 | valo basket (0d) | Sat 13:24 | Call counts per ingredient vs a person | Valio | DONE | EAN matcher |
| 63 | valo basket (0d) | Sat 13:50 | Build it with abuse guards; a human checks out | Valio | DONE | 9d25a48, 4c2f0c6, 33f9d8b |
| 64 | valo basket (0d) | Sat 16:44 | A "Valio-only" filter so the basket fills | Valio | QUEUED | kitchen-profiles.md Next |
| 65 | logo | Sat 14:49 | Better logo | Brand | DONE | 05a47b2 |
| 66 | agent door (da) | Sat 14:03 | An Agent door page like the draft | Agent door | DONE | /agents |
| 67 | agent door (da) | Sat 14:04 | Sandbox wiring; the user's own Claude as chatbot | Agent door | DONE | D9 |
| 68 | agent door (da) | Sat 14:07 | Improve the MCP; the in-app agent matters as much | Agent | QUEUED | Foundations 2 |
| 69 | agent door (da) | Sat 16:54 | Rail top; resizable; synced with Decide | Kitchen | DONE | ecf30db |
| 70 | agent door (da) | Sat 17:39 | Images matched to Valio's catalogue, linked to the listing | Images | DONE | ProductToken |
| 71 | MCP test | Sat 17:41 | MCP connected; sandbox reset without OAuth? | Agent door | DONE | D9; in-memory pairing risk |
| 72 | MCP test | Sat 17:45 | Live MCP test: dinner for 7, then order | Agent door | DONE | absolute approval links |
| 73 | MCP test | Sat 17:50 | An OAuth-signed-in human should approve from an outside chat | Agent door | DONE links, MISSING decision | vs D13/D17 |
| 74 | MCP test | Sat 17:50 | User profiles / OAuth for the MCP | Agent door | QUEUED | agent-door-v2 |
| 75 | MCP test | Sat 17:50 | Review state, info gathering and tool efficiency in both agents | Agent | QUEUED | Foundations 2 |
| 76 | MCP test | Sat 17:51 | Use other vendors' MCP tools as reference | Agent door | DONE | agent-door-v2 table |
| 77 | MCP test | Sat 18:16 | Hold hybrid search; pgvector without Modal | Retrieval | DONE | D19 |

### Standing rules the user gave lanes
- The freeze means no changes after Sun 06:00, not a stop on thinking; converge (captured: memory, SYNTHESIS).
- Peers vigilant and proactive with low overhead (memory; the overhead limit isn't written).
- Guard Valio's webshop against abuse, never order, a human checks out (valo-basket brief only).
- Matching Valio's public catalogue is fine; nothing behind the login (research docs).
- Presenting pages dark, one type family, calm motion (site-design.md; DESIGN.md pending).

### Recurring themes
- The UI reads as vibe-coded across mocks, site and agent door → Foundations 3.
- The in-app agent trails the MCP door → Foundations 2.
- Ops lacks a purpose → Ops rework, brainstorm pending.
- Time is missing from the product (orders over time, regularity, forecast, memory): on paper (D14, the spec, memory-and-tenancy), only the simulated usual order is built.
- Tenancy and scale → Foundations 1.
- Agents misstate the clock or treat the freeze as a stop on thinking.
- Decisions made in lane chats stay lane-local; the user relays by pasting.
- Breadcrumbs live in gitignored scratch (SYSTEM-MAP, ux-mock, site-review), so a fresh clone loses them.
