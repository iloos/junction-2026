# Ring 3 review: docs, criteria and submission readiness

_Independent read-only review, Sat 14 Nov evening. Main `c1b6900` (snapshot `1922679` + one docs commit). Read: CLAUDE, AGENTS, README, STATUS, DISPATCH, PLAN, DECISIONS, PITCH, CLAIMS, BUGS, concept/*, foundations/*, lanes/*, handoff/*, research/*, event/*, STACK, BUILDING-BLOCKS, ORCHESTRATION, LESSONS, strategy. Claims spot-checked with grep against `src/`, `drizzle/`, `evals/`, git history. Nothing was run (no gate, no prod calls)._

## Verdict
The engineering record is unusually honest (PITCH → CLAIMS → BUGS is a real claim ledger, and every evidence file PITCH cites exists). But the docs **trail main by roughly two merge waves**: A4, cut-off at commit, the Why-drawer web evidence, chat v2, the 5-min Context.dev monitor and D12 have landed, while PITCH, CLAIMS, SCORECARD, ARCHITECTURE and DISPATCH still call them "not yet" or "open". The documents judges will open are **not ready**. The README is 12 lines with no demo URL. There are no submission texts at all: `docs/event/platform/` holds only scraped partner pages. The git history still holds the real Valio API key (49 chars), the resource-portal password and an Atech redeem code. All three were added before `d332715` redacted them, and the repo is currently PRIVATE. Against the Valio rubric we score about **3.4/5 (≈67%)**. Controls are the strength; end-to-end polish (open BUGS blockers) and openness docs are the gaps.

## Criteria scorecard (today, honest)
| Criterion (weight) | Score | Evidence | Gap |
|---|---|---|---|
| Valio · Working end-to-end demo (30) | 3 | Milk flow on `/request` and the buffet run deployed; prod race smoke (same key ×4 → 1 receipt); visitor gate e2e passed on prod `ab3a557` | BUGS open blockers on the main journey: #5 order summary wrong (€532 + €0 vs €933), #6 receipt lost on reload, #9 rice formula, #3 event menu (re-test after b2 merge). All 7 CLAIMS "Demo beats" are "not yet" observed on prod |
| Valio · Solving the user need (20) | 3 | Constraints survive the parse; physical amounts (`direct.test.ts`); fidelity 5 cases × 3 entries; g/guest edits; A4 `plan_event{proposal}` in `core/services/events.ts` | Paraphrase gaps (P1/P2); open menu → plan not yet observed end to end; no price-first vs carbon-first toggle in the UI (CONCEPT wow #2, PITCH "bold beat" `[~]`) |
| Valio · Autonomy and controls (20) | 4 | Terms-hash approval, hard limit, split-proof caps, per-line authority, decide per reason group, judge key 403 on approve (prod), adversarial suite | Human-readable audit is weak: `/agents` shows raw op names, Ops Timeline shows `agent:plan_event`, the Why drawer leaks file paths (BUGS Ugly). Every MCP line is held, even €46.80 of milk (product decision; say it in the pitch) |
| Valio · Robustness to exceptions (15) | 4 | Real outages (ham `462490`, lanttulaatikko `462482`), supply tier first (D8), lot steps (s3), cut-off at commit (`cutoff.test.ts`, r5-f9), unknown ≠ cover, recall drill | "Stock taken by another kitchen" blamed with the Simulator untouched (BUGS blocker); lot rounding of Graavilohi +8.47 kg unexplained |
| Valio · Openness and path to production (15) | 3 | MCP + REST + OpenAPI from one registry (17 tools), judge keys, VOCABULARY labels, GROWTH, PRODUCT pilot | No judge-facing README or "assumptions" page; ARCHITECTURE out of date; PITCH says the "normal-week" and "assumption" labels were missing at the last review, so still unverified on screen |
| Junction · Innovation | 4 | Mandate as an open gate any agent can use; exact-terms approval; AP2 framing | Pitch must land it in 10 s; CONCEPT wow ladder still promises "didn't write an order" (not built) |
| Junction · Impact | 3 | Luke waste figures, buyer = Valio, 4-week hotel pilot (targets) | No user evidence; pilot is targets only (say so) |
| Junction · Implementation | 4 | ~420 server tests, evals, merge gate, Aiven Runtime + PG, 30 concurrent visitors at 0 errors | Open UI blockers; no CI (local gate only) |
| Gemini API (tech) | 3 | Decisions batch with p in ranking, Flash-Lite parse/plan, 3.8-flash menu (D12, `llm/router.ts`), traced | Four-question write-up not written; "recipe-aware" not claimable (no labelled fit set) |
| Aiven (tech; use 40 · tech 30) | 4 | Runtime + PG + PgBouncer, TLS verified, NOTIFY → SSE, web state in PG (0004), race proof | Write-up and architecture slide not written |
| Context.dev (main + tech) | 3 | Monitor every 5 min (foundations/web.md), webhook, revisions, spend caps, recall card | No real recall matched (drill); SCORECARD still says "hourly"; real-timeness timestamp not captured |
| Exa (main "Internet Butler") | 2 | `lookup_facts`, `find_outside`, Why-drawer evidence merged (`/api/web/evidence`) | The brief is a *personal* assistant; weak fit. Not in SCORECARD at all; no prod observation. Submit only with a sharp angle, or drop |

**Are the criteria good?** SCORECARD maps rubric to features well, but its `[x]/[~]` marks are opinion, stale (status "as of `0623b19`"), and miss Exa, the generic Junction criteria and the grand-jury lens. Make each row a check someone can rerun:
- **E2E:** `evals/ui` prod journeys green and 0 open blockers in BUGS; each PITCH demo beat has a prod screenshot in CLAIMS with a time.
- **Need:** fidelity + paraphrase pass rate as a number (e.g. ≥ 90% of EN/FI cases); "edits per plan" measured on the buffet (PRODUCT's honest metric) and shown.
- **Controls:** adversarial suite 100%; judge key 403 on `approve`/`set_mandate` observed on prod; an audit trail with **no raw op names, enum names or ids** on judge surfaces (a DOM-text grep test for `ws-j-`, `run-`, `CommitOrder`, ISO timestamps, `fixtures/`).
- **Robustness:** a named eval per exception type (outage, partial, lot, cut-off, recall, unknown supply), listed in SCORECARD.
- **Openness:** README has demo URL, MCP connect snippet and assumptions; `/api/openapi.json` validates; MCP `tools/list` count matches `/agents` copy (BUGS: says 13, registry has 17).
- **Five-second UI (memory only today; not in CLAUDE.md, SCORECARD or foundations/ux):** add it as hard rule 12 with proxies: the first decision is above the fold at 390×844; the phone Kitchen page is under ~3,000 px (today ~7,800 px); one status sentence + icon per dish, no per-row encoded bars (the `CoverageRuler` is still in `KitchenScreen.svelte`, and SURFACES §2/§5 and PITCH beat 15–40 still feature it); ≤ 4 type sizes; a cold viewer can say what each card means in 5 s (test with one person before the video).
- **Hard rules:** rule 7 ("traced") gets a unit test that each LLM/Decide adapter emits a trace. Rule 8 ("done means seen") gets a screenshot path in each UI merge body.

## Contradictions found (docs ↔ docs ↔ code)
1. **A4 / open menus:** STATUS says A4 is on main and `core/services/events.ts` implements `plan_event{proposal}`. PITCH "Not yet claimable", CLAIMS "Still not yet", SCORECARD `[~]`, DISPATCH "Contract-only" and ARCHITECTURE ("not yet served") all say it isn't built.
2. **Cut-off at commit:** PITCH lists it as provable (`cutoff.test.ts` exists), while SCORECARD says "cut-off at commit open (F9)" and DISPATCH/ARCHITECTURE list it as typed-only.
3. **Exa UI:** PITCH/CLAIMS say "no judge-facing UI". The merged `03d4da7` added Why-drawer web evidence (`/api/web/evidence`, `KitchenScreen.svelte`).
4. **Chat:** CLAIMS says "chat entry not built", but `/agents/chat`, `/api/chat/{turn,task}` and chat v2 (`ad82d16`) are merged.
5. **Context.dev cadence:** PITCH says "hourly unless 10-min approved" and SCORECARD `[ ]` hourly, while foundations/web.md and STATUS say every 5 min.
6. **Decide per reason group:** the PITCH Q&A says "in progress (A2b + C)", but it is merged (`groups.test.ts`).
7. **ARCHITECTURE vs code:** tools table lacks `propose_menu`, `get_outcome`; migrations stop at 0002 (0003 `agent_tasks`, 0004 `web_state` exist); module list lacks `chat/`, `tasks/`, `review/`, `external/`; shape diagram lacks `/agents`, `/api/chat`.
8. **CLAUDE.md routes:** missing `/agents`, `/agents/chat`, `/api/chat/*`, `/api/web/{evidence,leads,make-in-house}`. It lists `/api/agent/run/<id>`, but only `/<id>/cancel` exists. Rule 6 says Flash-Lite for the LLM port, but D12 moves `menu.propose` to `gemini-3.8-flash`.
9. **Coverage ruler:** the user rejected per-row rulers (five-second memory; ui-mockset-to-prod row 1), yet PITCH beat 15–40, STATUS "Works" and SURFACES §2/§5/§6 present it as a feature.
10. **STATUS** "Open: evidence in the Why drawer (D), ChatDock" is now merged or partly merged. "Prod runs `ab3a557`" is unverified against today's merges; `/healthz` now reports the commit, so CLAIMS' "healthz does not report the deployed commit" is stale.
11. **CLAIMS header** "`/agents` 13 tools" vs registry 17 (judge sees 15 without approve/set_mandate).
12. **Strategy/prep vs D3/rule 6:** WINNING principle 6 "local storage over a database"; event/SPONSORS model routing `claude-sonnet-5-5` for agent chat; LESSONS "SvelteKit on Vercel". All contradict D3 and the Gemini-only rule.
13. **Broken/untracked links:** SURFACES → `../review/ROUND6-VOCABULARY.md` (docs/review is untracked); `handoff/ui-mockset-to-prod.md` → `research/ui-dataviz-patterns.md` (untracked).

## Ranked doc fixes
| # | Action | File | Why |
|---|---|---|---|
| 1 | **Rewrite for judges**: one-line pitch, prod URL, 60-s tour (Kitchen → Request milk → `/agents` key → Ops), connect-your-agent snippet (`/mcp/k/<key>`), what's real vs simulated (labels list from PITCH), architecture link, sponsors and their role, run locally (`LLM_PROVIDER=fixture pnpm dev`), MIT, data notice | `README.md` | It is the first thing every judge and the openness criterion reads; today it has no URL |
| 2 | **Create the submission texts**: name, punchline, description; per entry (Valio, Gemini 4 questions, Aiven, Context.dev, Exa if kept) a ≤150-word write-up drawn only from CLAIMS "say it" rows | new `docs/event/platform/submission.md` | Nothing exists; PLAN assumes drafts. Submission closes Sun 10:00 |
| 3 | **Re-pass after the next deploy**: fold "Moved since PITCH" into the main table; mark A4, chat, Exa evidence, cut-off; observe all 7 demo beats on prod | `docs/CLAIMS.md` | The video and stage depend on it |
| 4 | Update "Not yet claimable" and the Q&A (items 1–6, 9 above); drop the ruler beat; add the price-first/Finnish beat only if observed | `docs/PITCH.md` | Avoid under- and over-claiming |
| 5 | Refresh statuses, add the Exa row and the generic Junction criteria, replace marks with the measurable checks above; collapse parked tech rows to one line | `docs/concept/SCORECARD.md` | Criteria become rerunnable |
| 6 | Tools 17, migrations 0003–0004, tables, modules, routes; delete "Typed but not yet served" | `docs/concept/ARCHITECTURE.md` | Judges' "path to production" doc |
| 7 | Move the Ring 1 half (lines 1–50) and "Contract-only" to archive; keep one Ring 3 freeze plan | `docs/DISPATCH.md` | Half of it describes finished waves |
| 8 | Routes list, D12 models, add CLAIMS/BUGS to the docs table, add the five-second rule; drop links to WINNING/LESSONS/BUILDING-BLOCKS if archived | `CLAUDE.md` | Agents read this first |
| 9 | Archive: `handoff/ring2/*` (incl. REVIEW-PROMPT-ROUND7), `lanes/b-retrieval.md` (parked, merged), `lanes/kitchen.md` (says `lane/c-kitchen`; worktree is `lane/c2-ui`), `lanes/ops.md` (says `lane/g3` base `f2052ca`; worktree on `lane/g6`), `lanes/request.md` if b2 is done. Rewrite `handoff/README.md` (points at a SYNTHESIS that lives in archive) | `docs/lanes/`, `docs/handoff/` | Noise for any session reading lanes |
| 10 | Archive prep docs whose advice is dead: BUILDING-BLOCKS (duckdb, cosmos.gl), LESSONS (Vercel), strategy/WINNING (local storage), event/SPONSORS (Claude routing, Cala, Hostinger), event/KICKOFF; trim EVENT's "No brief found yet" table | `docs/` | They contradict D3 and rule 6 |
| 11 | Mark v2.1 as history or trim the wow ladder to what's built; "Working name: Mandate (placeholder)" → final; resolve the `_pending_` risk rows | `docs/concept/CONCEPT.md` | Judges may read it as the spec |
| 12 | Point at the in-repo VOCABULARY; rewrite §2/§5/§6 to the status-sentence UI | `docs/concept/SURFACES.md` | Broken link; five-second contradiction |
| 13 | Rewrite to the current hour; drop SHAs that aren't prod; drop "Ring 1" wording | `docs/STATUS.md` | Last touched two merge waves ago |
| 14 | Collapse fixed rows (#1, #2, #4, cut-off) into "Found and fixed"; re-test on the current prod sha | `docs/BUGS.md` | Top 10 mixes fixed and open |
| 15 | Commit or gitignore `docs/review/`, `.impeccable/` and `research/ui-dataviz-patterns.md` | `.gitignore` | Untracked files referenced by tracked docs |

## Submission-readiness checklist
| Item | Status | Note |
|---|---|---|
| MIT `LICENSE` at root | ✅ | "Copyright (c) 2026 Junction 2026 team"; GitHub detects MIT |
| Repo public at submission | ❌ | `iloos/junction-2026` is PRIVATE; flip only after the scrub below |
| No secrets in the tree | ✅ | Key-pattern grep on tracked files is clean (data.md has a `<password>` placeholder); `.env.example` has names only (one default `LLM_PROVIDER=fixture`); challenge copies say `[REDACTED]` |
| No secrets in history | ❌ | History holds the Valio API key (49 chars), the portal password and an Atech redeem code (pre-`d332715`). Squash or filter before going public (PLAN lists it) and ask Valio whether the key should be rotated |
| No employer or other-company content | ⚠️ | `docs/research/sibling-repos.md` describes four of the owner's other codebases (another agent repo, reasoner3, conv-analysis, roadmap planner): remove it from the public repo. `docs/roadmap/` is gitignored and untracked ✅. `docs/event/guidebook.txt` is gitignored ✅ |
| Hallway quotes trimmed | ❌ | `docs/research/mcpcon.md` (PLAN item open) |
| No Valio dataset committed | ✅ | `data/` untracked; `fixtures/` 116 KB of seeds/views; `docs/foundations/valio-profile.json` (108 KB profile) needs the same "derived sample" check |
| README for judges | ❌ | 12 lines, no URL, no how-to (fix #1) |
| PITCH / CLAIMS current | ⚠️ | Accurate ledger structure, stale content (contradictions 1–6) |
| ARCHITECTURE current | ⚠️ | Fix #6 |
| Platform texts (name, punchline, description, per-challenge write-ups) | ❌ | None in repo (fix #2); EVENT checklist all unchecked |
| 2-min video, deck PDF (6 slides) | ❌ | PLAN "Land (Sunday)" open; CLAIMS demo beats unobserved |
| Demo link healthy, deployed tag | ⚠️ | Prod up per STATUS; `demo-good` tag not yet; only `ring0` and `ring1-clean` exist |
| Team phone/Discord, publicity setting, Status FINAL by 09:30 | ❌ | Platform side; not trackable from the repo |
| Gate green on main | ? | Claimed in STATUS/CLAIMS; not rerun in this review |
