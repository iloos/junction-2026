# DISPATCH

_Lead-owned. The live assignment for the Ring 1 build: tracks, who owns which seam, and the integration waves. Finding ids (F1–F32) refer to [archive/handoff/SYNTHESIS.md](archive/handoff/SYNTHESIS.md) §2; decisions are [D8–D10](DECISIONS.md). Markers: `[x]` merged on main · `[~]` on a lane branch or in progress · `[ ]` not started. State as of main after the convergence merges (Sat ~12:00)._

## How a track works
- Every active brief (`docs/lanes/<lane>.md`) starts with a Dispatch block: track, base SHA, owned paths, first deliverable, dependencies, acceptance command.
- Contracts (`src/lib/core/contracts/**`, `src/lib/core/ports.ts`), the tool registry and schema wiring are lead-only; a track that needs a change writes it under **Needs**.
- Merge gate for every track: `pnpm gate` (check, lint, eval self-test, unit tests, `pnpm eval`, `pnpm eval:agent`; stops on the first red; machine-wide lock on the test steps), plus a browser screenshot for any UI change. A lane that fixes a finding deletes its `expectFail` entry in the same merge.

## Tracks
| Track | Owner | Owned paths | Merged on main | Open |
|---|---|---|---|---|
| **A** core correctness | 8d (`lane/a2b-core`) | `src/lib/core/**` (not contracts), `src/lib/server/store/**`, catalogue `offers` and scenario stock | [x] A1: supply tier first (F5), per-line authority (F8), zero demand (F11), quote date default (F22) · [x] A2: direct-need sizing (F10), `FulfilmentView`, `LineView.physical/unitPrice/comparisonPrice`, `fixtures/views/` · [x] loaded state cached per run | [x] A2b: `approve{lineIds}` per reason group, `Approval.bound`, voided-approval diff (`get_plan.lastVoided`) | [ ] A3: cut-off at commit (F9) and temporal validity of views (F29) · [ ] lineage across same-named dishes (r6-1) · [ ] A4: deterministic `plan_event` from a chef-reviewed `MenuProposal` |
| **B** request → menu | lead agent (`lane/b-request`) | `src/lib/server/request/**`, `src/routes/request/**`, `src/lib/server/menu/**` | [x] constraints kept (F3), event guard (F7), stable item ids · [x] menu store and event-brief questions on `/request` | [x] menu proposal step (Gemini with template fallback, rubric, golden briefs) | [ ] Postgres MenuStore + `Ports.menus` · [ ] chef review UI · [ ] `/request` → reviewed proposal → `plan_event{proposal}` (needs A4) |
| **B-retrieval** | 1f (`lane/b-retrieval`) | catalogue `search`/`candidates`/`resolve` in `src/lib/server/adapters/catalog/**`, `evals/retrieval/**` | [x] hybrid substitute candidates by default · [x] `Catalog.resolve` · [x] hybrid search behind `CATALOG_SEARCH=hybrid` | [ ] request and agent owners adopt hybrid search (their tests pin substring order) |
| **C** kitchen visuals | kitchen session (`lane/c-kitchen`) | `src/routes/(kitchen)/**`, `src/lib/kitchen/**` | [x] C1: unit bases (F14) and coverage ruler per dish | [x] worked Why chain and make-in-house AND view · [x] one decision per reason group (F13) · [x] F15 counts from FulfilmentView | [ ] web evidence in the Why drawer (from D) |
| **D** web | lead agent (`lane/d-web`) | `src/lib/server/web/**`, `src/routes/api/web/**` | [x] recall revisions, per-run applications, spend caps · [x] `lookup_facts`, `find_outside`, `check_recall` in the registry | [ ] evidence UI (C mounts it) · [ ] recall card in Ops (G mounts it) · Exa submission decided at the video checkpoint |
| **E** agent door | lead agent (`lane/e-agent`) | `src/lib/server/agent/**`, `src/lib/server/tools/{mcp,serve}.ts`, OpenAPI text, MCP instructions, `src/routes/agents/**` | [x] units and dates via the request parser (F4), seams (F25), `get_context`, MCP instructions | [x] `/agents` page with the visitor's judge key · [x] `llm.for(job)` routing · [x] `ResultMeta` on tool outputs · [x] review mechanism behind `REVIEW=1` · [x] perturbed task r6-5 (`adjust_need`) · [x] F4-pack | [ ] `requirements` intent calling B's planner (needs A4) |
| **F** evals | 91 (`lane/f-evals`) | `evals/**`, `src/lib/server/evals/**`, `scripts/merge-gate.mjs` | [x] merge gate with retry and lock · [x] s6–s11, R5, R6 scenarios · [x] cross-entry fidelity suite · [x] opt-in live-planner diagnostics · [x] post-deploy race smoke | [x] golden event-brief evals · [x] cross-surface fulfilment eval · [x] scenario pruning | [ ] `pnpm build` in the gate + `--full` e2e |
| **G** ops, sandbox, deploy | 9c (`lane/g3`) | `src/lib/server/demo/**`, `src/routes/ops/**`, `src/routes/api/events/**`, `src/lib/server/bus/**`, `scripts/deploy/**`, `docs/foundations/deploy.md` | [x] per-visitor signed workspaces, judge keys, scoped reset and overlay, presenter session (F1, F2, D9) · [x] Ops/kitchen held-count parity (F15) · [x] clock scoped per workspace · [x] SQL tally and visitor load script | [~] deploy notes and ops brief rewrite · [~] exact-plan locator `?ws&run&plan` (F16): kitchen side on `lane/c-kitchen` |

## Contract-only (typed, not yet served)
| Contract | State | Lands with |
|---|---|---|
| cut-off at commit (`cutoff_passed`) | not checked at commit; eval r5-f9 marks it `expectFail F9` | A3 |
| `plan_event{proposal:{id,revision}}` | returns `INVALID_INPUT` ("planning from a brief is not available yet") | A4 |

## Ownership at the seams
| Boundary | Owner |
|---|---|
| Catalogue `search`/`candidates`/`resolve` | B-retrieval. A owns `offers` and scenario stock. Same file: each edits only its methods; A merges first |
| Contracts, tool registry and schema wiring | lead. E owns serving and presentation (`tools/mcp.ts`, `serve.ts`, OpenAPI text, MCP instructions); D supplies web handlers |
| Visitor resolver, cookie signing, judge-key mint/verify | G, including the named edits in `kitchen/live.ts`, `request/workspace.ts`, `ops/+page.server.ts`. E consumes `JudgeKeys`, never mints its own |
| Exact-plan locator `?ws&run&plan` | G specifies; Request owns its loader and recovery; Kitchen owns event-plan rendering; approval happens in the Kitchen screen |
| Web evidence UI | D exposes typed evidence and fixtures; C mounts it in the Why drawer, G the recall card in Ops |
| Menu | B owns interpretation and the `MenuProposal`; A owns demand → plan from a reviewed proposal |
| Evals | domain tests stay with implementations; F owns cross-path scenarios, the harness and the gate; agent goal trials stay with E |

## Waves
- [x] **Now (Sat ~08:30):** B parser and constraint fixes · E unit/date guard and context · D cache, schema and drill · G resolver · F regression cases · A1.
- [~] **Integration 1:** A1 + G + E discovery → two browsers and an MCP client each complete the milk flow in their own workspace; Ops opens the exact plan. Merged; the deployed two-browser + MCP run is the open check (`src/routes/ops/visitor-gate.e2e.ts`).
- [~] **Integration 2:** A2/A3 + C coverage/Why + E outcomes → physical quantities and supplier-confirmed vs unknown supply agree on every surface. A2 and C1 merged; A3 and E outcomes open.
- [ ] **Integration 3:** B menu + A4 + D evidence UI → one arbitrary dinner reaches an editable, explained, safely held plan with every unresolved requirement visible.
- [ ] **Video checkpoint (Sat 22:00):** green deployable tag; sponsor claims decided from observed journeys.
- [x] **Review mechanism** (user): a validator pass at each model-output checkpoint (request parse, menu proposal, agent outcome, explanations). It sees the full context and a written rubric and returns pass, revise (one bounded retry with the critique) or block (reason shown). Never authorises, never overrides the gate; scored through Gemini Decisions, traced and capped; behind a flag until F's evals show it improves the same tasks. Owner E (`src/lib/server/review/`): outcome-text checkpoint wired; request-parse wiring and the menu proposal next; F compares on/off.

## Next scopes (user, after Integration 3)
- [ ] **In-app agent chat and tooling:** the chef talks to the same agent the tools serve, inside the kitchen screen, through the same gate.
- [ ] **UI/UX pass** over Kitchen, Request, Ops and `/agents` (one vocabulary per [concept/VOCABULARY.md](concept/VOCABULARY.md)).
- [ ] **Extension scopes later:** GROWTH.md gates (more kitchens, memory, Modal/Gemma jobs) only after the freeze plan is safe.

---

# Ring 2 (from Sat ~13:30): upgrade the app

_Sources: [handoff/ring2/](handoff/ring2/) (agent, sponsors, UI/UX, roadmap reviews). Product promise: help a kitchen keep service possible when plans and supply change, with a precise account of what can be promised. Principles: live sponsor calls over mocks (fixtures only for tests and labelled fallback); one coherent read model on every surface; plain words by default, the System layer shows the mechanics; the gate stays the only authority. Gates to pass (from the roadmap): **isolated task** (one purchase across UI, chat, MCP, Ops), **semantic truth** (quantities and supply certainty agree everywhere), **open menu** (one reviewed arbitrary menu → held plan, no hidden gaps), **source → action** (a sourced incident on the precise plan), **assisted value** (agent beats the scripted baseline on a perturbed task)._

## T1 contracts (lead, first)
- `Task` + `TaskLedger` (procurement task: requirement, typed slots, plans touched, proposal ref, runs, pending clarify|decision|none, state, ledger from FulfilmentView + receipts + money); table `agent_tasks` (migration 0003); `Plan.taskId?`.
- `Decision` gains `p`/`probabilities`; `Decide.batch(questions[])`.
- Tools: `get_outcome{planId|taskId}` (ledger), `propose_menu{brief}`; `place_order` lines may give `amount` without `qty` (server sizes); `find_substitutes.apply` explicit; `commit_order` destructive.
- `ExternalCall` trace shape `{api, purpose, cache: live|cache|replay|fixture, latencyMs, costUnits, workspaceId}`.

## Tracks
| Track | Owner | Scope (first deliverable first) | Gate |
|---|---|---|---|
| **A** core + live supply | 8d | A3 cut-off at commit + view validity · A4 plan from a reviewed proposal (lineage) · **Valio live cache-through** on the PG catalogue (price + availability on miss, 15 min availability TTL, `valio_live` + fetch time, half-open breaker, traced) · quotes subtract consumed stock (core-current-atp) · one `nextActionFor(plan)` | semantic truth, open menu |
| **C** UI shell + Kitchen task page | 1f (+ subagents) | **Shell + tokens first** (type scale, D10 state tokens with patterns, Ops dark theme on the same tokens, LabelPill, Sandbox menu, System toggle `?system=1`, 390 px fixes, no `text-[..px]`) → Kitchen task page (TaskHeader "N decisions before <cut-off>", DecisionCard as the unit, Decide/Plan/Order zones, committed state, StrategyCard AND group, compact rows) → vis: demand→packs waterfall, coverage partition, **approval seal**, rescue strip with tier bands → Why drawer web evidence (from D) | isolated task, semantic truth |
| **G** Ops as explainer + Aiven | 9c | Ops cases close on rescue/commit and group per cause (trust bug first) · plain-word trace labels · Ops on shared tokens + mobile · op-log timeline (vis) · agent run graph (vis, replaces raw JSON) · recall card · **web state into Postgres** (cache, recall queue SKIP LOCKED, spend ledger, findings) · transactional NOTIFY · Infrastructure strip (DB latency, TLS, LISTEN, lag, plan) · staging promote flow | source → action, Aiven proof |
| **E** agent + chat | lead agent | agent fixes first: runs per workspace + cancel check · one shared classifier (order wins when an amount is stated; read questions allowed) · typed clarify{field,options} + slots · ledger with quantities and money → then `Task` store, `POST /api/chat/turn` (NDJSON: step, clarify, decision, ledger, done), `continue_task`, **chat dock** (uses C's DecisionCard/LineRow; never approves) · schema-constrained Gemini output + one corrective retry · `/agents`: client config snippet + "your calls" | isolated task, assisted value |
| **B** request → menu | lead agent | after A4: menu proposal on /request → chef review (server-recorded) → `plan_event{proposal}` → task; Request sends physical `amount`; polish (green steps, unit words, friendly dates, approver name, no dead end); Request as the "New request" composer that creates a task | open menu |
| **D** sponsors: Gemini + web | lead agent | **Gemini Decisions visible**: batch fit + violates + origin per candidate, p/confidence shown in rescue + Why, trace into the drawer, replay book recorded from real calls (tests only), LLM spend ledger per visitor/day · Exa "no allergen record → lookup with citations" data for the Why drawer · Exa unresolved need → recipe → resolve → make-in-house proposal · Context.dev: stored notices + visitor-scoped labelled drill applied on sandbox seed; news search on plan suppliers as Ops leads · shared `ExternalCall` helper (with G) · Gemini embeddings + pgvector hybrid retrieval if retrieval eval improves | source → action, Gemini/Exa proof |
| **F** evals + claims | 91 | chat evals (clarify, approval handoff, continue, truthful ledger) · paraphrase set EN/FI per intent · REVIEW on/off arms · deployed two-browser + MCP journey recorded · claim ledger for the 22:00 video (each PITCH claim → observed evidence) | all |

## Waves
- **W1 (to ~18:00):** T1; C shell + tokens; E agent fixes; A3 + Valio live; G Ops trust fix + web state in PG; D Gemini visible; F chat eval scaffolds.
- **W2 (to ~22:00, video checkpoint):** C Kitchen task page + seal + waterfall; E chat turn + dock v1; A4 → B menu review → plan; D evidence data → C Why drawer; G recall card + run graph; tag + deploy + rough video.
- **W3 (22:00 → Sun 05:00):** funnel + gate sankey, op-log timeline, Request composer handoff, Infrastructure strip, live k/N agent comparison, polish at 390 px, claim ledger; freeze 06:00.

**Park (Ring 2):** recurring/rhythm, order history/receiving/cancel, inbox beyond the task list, ops administration, agent memory, schema evolution, growth (venue map only if spare), product map, native function calling, LLM planner on prod by default, approving from chat, Kafka/OpenSearch, Gemini Live, Modal.
