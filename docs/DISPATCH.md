# DISPATCH

_Lead-owned. The live assignment for the Ring 1 build: tracks, who owns which seam, and the integration waves. Finding ids (F1–F32) refer to [archive/handoff/SYNTHESIS.md](archive/handoff/SYNTHESIS.md) §2; decisions are [D8–D10](DECISIONS.md). Markers: `[x]` merged on main · `[~]` on a lane branch or in progress · `[ ]` not started. State as of main `0623b19`._

## How a track works
- Every active brief (`docs/lanes/<lane>.md`) starts with a Dispatch block: track, base SHA, owned paths, first deliverable, dependencies, acceptance command.
- Contracts (`src/lib/core/contracts/**`, `src/lib/core/ports.ts`), the tool registry and schema wiring are lead-only; a track that needs a change writes it under **Needs**.
- Merge gate for every track: `pnpm gate` (check, lint, eval self-test, unit tests, `pnpm eval`, `pnpm eval:agent`; stops on the first red; machine-wide lock on the test steps), plus a browser screenshot for any UI change. A lane that fixes a finding deletes its `expectFail` entry in the same merge.

## Tracks
| Track | Owner | Owned paths | Merged on main | Open |
|---|---|---|---|---|
| **A** core correctness | 8d (`lane/a2b-core`) | `src/lib/core/**` (not contracts), `src/lib/server/store/**`, catalogue `offers` and scenario stock | [x] A1: supply tier first (F5), per-line authority (F8), zero demand (F11), quote date default (F22) · [x] A2: direct-need sizing (F10), `FulfilmentView`, `LineView.physical/unitPrice/comparisonPrice`, `fixtures/views/` · [x] loaded state cached per run | [~] A2b: `approve{lineIds}` per reason group and `Approval.bound` · [ ] A3: cut-off at commit (F9) and temporal validity of views (F29) · [ ] voided-approval diff (`get_plan.lastVoided`) · [ ] lineage across same-named dishes (r6-1) · [ ] A4: deterministic `plan_event` from a chef-reviewed `MenuProposal` |
| **B** request → menu | lead agent (`lane/b-request`) | `src/lib/server/request/**`, `src/routes/request/**`, `src/lib/server/menu/**` | [x] constraints kept (F3), event guard (F7), stable item ids · [x] menu store and event-brief questions on `/request` | [~] menu proposal step (Gemini, rubric, golden briefs) · [ ] `/request` → reviewed proposal → `plan_event{proposal}` (needs A4) |
| **B-retrieval** | 1f (`lane/b-retrieval`) | catalogue `search`/`candidates`/`resolve` in `src/lib/server/adapters/catalog/**`, `evals/retrieval/**` | [x] hybrid substitute candidates by default · [x] `Catalog.resolve` · [x] hybrid search behind `CATALOG_SEARCH=hybrid` | [ ] request and agent owners adopt hybrid search (their tests pin substring order) |
| **C** kitchen visuals | kitchen session (`lane/c-kitchen`) | `src/routes/(kitchen)/**`, `src/lib/kitchen/**` | [x] C1: unit bases (F14) and coverage ruler per dish | [~] worked Why chain and make-in-house AND view · [~] one decision per reason group (F13; needs A2b) · [ ] web evidence in the Why drawer (from D) |
| **D** web | lead agent (`lane/d-web`) | `src/lib/server/web/**`, `src/routes/api/web/**` | [x] recall revisions, per-run applications, spend caps · [x] `lookup_facts`, `find_outside`, `check_recall` in the registry | [ ] evidence UI (C mounts it) · [ ] recall card in Ops (G mounts it) · Exa submission decided at the video checkpoint |
| **E** agent door | lead agent (`lane/e-agent`) | `src/lib/server/agent/**`, `src/lib/server/tools/{mcp,serve}.ts`, OpenAPI text, MCP instructions, `src/routes/agents/**` | [x] units and dates via the request parser (F4), seams (F25), `get_context`, MCP instructions | [~] `/agents` page with the visitor's judge key · [~] `llm.for(job)` routing with `job` on every trace · [~] `ResultMeta` for web tools · [~] review mechanism (below) · [ ] `requirements` intent calling B's planner (needs A4) |
| **F** evals | 91 (`lane/f-evals`) | `evals/**`, `src/lib/server/evals/**`, `scripts/merge-gate.mjs` | [x] merge gate with retry and lock · [x] s6–s11, R5, R6 scenarios · [x] cross-entry fidelity suite · [x] opt-in live-planner diagnostics · [x] post-deploy race smoke | [~] golden event-brief evals through `/request` · [~] cross-surface fulfilment eval · [~] pruning scenarios now covered by unit tests |
| **G** ops, sandbox, deploy | 9c (`lane/g3`) | `src/lib/server/demo/**`, `src/routes/ops/**`, `src/routes/api/events/**`, `src/lib/server/bus/**`, `scripts/deploy/**`, `docs/foundations/deploy.md` | [x] per-visitor signed workspaces, judge keys, scoped reset and overlay, presenter session (F1, F2, D9) · [x] Ops/kitchen held-count parity (F15) · [x] clock scoped per workspace · [x] SQL tally and visitor load script | [~] deploy notes and ops brief rewrite · [~] exact-plan locator `?ws&run&plan` (F16): kitchen side on `lane/c-kitchen` |

## Contract-only (typed, not yet served)
| Contract | State | Lands with |
|---|---|---|
| `approve{lineIds}` + `remainingApprovalId` | handler decides the whole approval | A2b |
| `get_plan.lastVoided` (`TermsDiff`) | not returned; eval r6-5 marks it `expectFail R6-diff` | A |
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
- [~] **Review mechanism** (user): a validator pass at each model-output checkpoint (request parse, menu proposal, agent outcome, explanations). It sees the full context and a written rubric and returns pass, revise (one bounded retry with the critique) or block (reason shown). Never authorises, never overrides the gate; scored through Gemini Decisions, traced and capped; behind a flag until F's evals show it improves the same tasks. Owner E (`src/lib/server/review/`): outcome-text and request-parse checkpoints on `lane/e-agent`; menu proposal next.

## Next scopes (user, after Integration 3)
- [ ] **In-app agent chat and tooling:** the chef talks to the same agent the tools serve, inside the kitchen screen, through the same gate.
- [ ] **UI/UX pass** over Kitchen, Request, Ops and `/agents` (one vocabulary per [concept/VOCABULARY.md](concept/VOCABULARY.md)).
- [ ] **Extension scopes later:** GROWTH.md gates (more kitchens, memory, Modal/Gemma jobs) only after the freeze plan is safe.
