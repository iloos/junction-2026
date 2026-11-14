# Sponsor touchpoints: what each prize needs, what we have, the smallest honest integration

_Sat 14 Nov ~02:30, audit of `main` at `7970d79`. Sources: verbatim briefs in `docs/event/challenges/**`, SCORECARD, D1–D6, ARCHITECTURE, STATUS, foundations, code. No web check (search quota ran out); Context.dev and Exa capabilities are as their briefs state them._

**Headline finding.** Gemini is our second-biggest prize, and today it doesn't run in any served flow. `createDecide` (`src/lib/server/adapters/decide/index.ts:113`) is built and tested, but nothing calls it. The served ports inherit `decide: unavailable` (`src/lib/server/store/fixture-ports.ts:38`, via `db-ports.ts:51`), `replay.json` is `{}`, and `rank.ts:97–99` only adds the fit term "when it answered". The `Web` and `Jobs` ports (`src/lib/core/ports.ts:90–100`) have no adapters, and `jobs/` doesn't exist. `products.embedding vector(768)` (`schema.ts:66`) is never filled.

## Valio Aimo: Trusted Trade Agents (main, €4k): KEEP, P0
| | |
|---|---|
| Criteria | E2E demo 30 ("full request → lookup → order/approval flow … not just isolated pieces"), user need 20, autonomy and controls 20, robustness 15, openness 15 (`main/valio-aimo…md:15–19, 36–40`). Core must: lookup, inquiry→order "based on fixed prices", permission and human approval (`:58–61`). Example: "1,000 litres of lactose-free milk by Monday" (`:68`). |
| Wired | Tool registry → REST `/api/tools/*`, MCP `/mcp`, `/api/openapi.json`; quote, place_order, approve, commit, plan_event, edit_line, find_substitutes (frozen rank), make_in_house; mandate tiers, terms-hash approvals, idempotent commit; evals s1–s5 pass; `/` chef journey, `/ops` live; deployed on Aiven Runtime. |
| Missing | **R0-c Request box** (their own flow, verbatim), R0-b live flip, R0-g outside agent on stage, R0-d reset/fresh run, an assumptions page. |
| Smallest strong | Request box: NL → Gemini Flash-Lite structured parse `{query, qty, unit, deliverBy, constraints}` → `search_products` → `quote` → `place_order` → tier/approval, all through `serveTool`. Run their milk example live, then the Christmas deviation. A judge's Claude connects to `/mcp/k/<key>` and gets `held{sign_off, external_agent_needs_approval}`. Effort **M**. Owners: request, lead (R0-g). |
| Evidence | Their example runs end to end on the deployed URL (screenshot plus the op log); the evals table; `/openapi.json`; the assumptions page (999999 = unknown, the simulator owns time). |

## Google Gemini API (tech, €4k / €2k / €1k): KEEP, P0. Our largest gap
| | |
|---|---|
| Criteria | Unweighted. "Go beyond simply adding an LLM"; the submission must explain the problem, how Gemini is integrated, what's innovative, why Gemini matters (`tech/google-deepmind--best-use-of-gemini-api.md` brief lines 44–56); 18+. |
| Wired | Adapter only: Decide (gemini → replay → rules, source-tagged), Flash-Lite `Llm` (`adapters/llm/index.ts:52,116`) used by the `/api/agent/run` planner only when `LLM_PROVIDER=gemini`. **No product flow calls Decide.** |
| Smallest strong | (1) Build `createDecide` into `createServerPorts`. (2) `find_substitutes` makes **one Decisions call per held line, outside the lock**, with questions `{id}_culinary` (score 0–4) and `{id}_violates` (yes/no vs the mandate's hard constraints) for every candidate; P, confidence and source go onto `ProposeSubstitute` provenance. (3) The grey-zone tier as a `choice{act,propose,signoff}`, with θ = the mandate's autonomy slider; hard limits stay in code. (4) Record replay (`DECIDE_RECORD=1`) so the demo survives offline. (5) The Request-box parse (above). Effort **M**. Owners: agent (wiring and replay), core-db (service call), kitchen (show "fit 3.4/4 · gemini · conf 0.50"). |
| Evidence | Review gate: "live decision changes a recipe-fit choice; trace and labelled-case baseline". A 20-case labelled set, **rules vs Gemini**: accuracy, violations caught (shrimp vs "no shellfish"), latency (~0.5 s for 120 questions). The trace drawer shows questions in, probabilities out. A write-up answering the 4 questions. |

## Aiven (tech, €1k): KEEP, P0/P1
| | |
|---|---|
| Criteria | Meaningful use 40, technical implementation 30, impact 20, creativity 10 (`tech/aiven…md:15–18`); "at least one Aiven service as a meaningful part" (`:47`). |
| Wired | Aiven PG (migrated, 17,546 products seeded), Runtime hosting the app, verified TLS `/healthz`, LISTEN/NOTIFY → SSE `/ops` (`bus/pg.ts:13–23`), locked budget row and idempotency table. |
| Smallest strong | R0-e concurrent double-commit test on Aiven (`pnpm test:pg`), plus a reload/reconnect demo (Last-Event-ID catch-up). **Claim pgvector only if the Modal embeddings land** and `find_substitutes` "domain search" uses it. Effort **S** (M with pgvector). Owners: core-db, ops. |
| Evidence | Architecture slide: Runtime + PG + NOTIFY; "2 commits race, 1 order" test output; kill the tab, then the stream resumes with no gaps. Don't say "data in Finland" (do-fra / eu-central-1). |

## Context.dev: main (€2k) + tech (€750): STRETCH R1, the best second entry
| | |
|---|---|
| Criteria | Main: impact, creative live web, completeness, technical execution, **real-timeness ("react to change over time or a one-off snapshot?")**, 20 each (`main/context-dev…md:15–19, 36–40`). Tech: creative use 40 ("combining several endpoints"), centrality of live web 30, execution 30 (`tech/context-dev…md:15–17, 34–36`). **Hard:** an endpoint "in its core flow"; data "must visibly drive something in the demo" (`:50, 53–54`). Submit repo + demo + "a short note on which endpoints you used and why" (`:57`). |
| Wired | Offline only: `scripts/venues/scrape_menus.py` (15 menus, 574 dishes), not in the app. No `Web` adapter. |
| Smallest strong | **Recall/change watch.** A Context.dev **monitor** on Ruokavirasto's recall page (and a supplier page) → **webhook** `POST /api/web/contextdev` on the Runtime URL (no tunnel needed) → **structured extraction** (schema: product, brand, GTIN, batch, best-before, reason) → match against the catalogue and committed/planned lines → `RecordAnomaly` (source URL, fetchedAt) → affected lines held → `find_substitutes` (Gemini fit) → visible on `/ops` and in the kitchen. Do a **30-min go/no-go spike first** (does the monitor fire on that page, and does extraction parse it?). Mentors are on site from Sat 09:00, workshop 17:30. Effort **M**. Owners: web (`adapters/web/**`, `routes/api/web/**`), core-db (anomaly → hold), ops (timeline). |
| Evidence | Timestamps for notice → webhook → anomaly seq → substitutes ready. One live monitor running during judging, plus the real 9 Oct egg recall **labelled "replay"** (the review: replay alone is weaker). Endpoint note: monitors, extract, scrape. |

## Modal (tech, $2k + $3k credits) + Gemma (tech, €1k × 3): STRETCH R2, one job
| | |
|---|---|
| Criteria | Modal: effective use 40 ("how central Modal is"), ambition 25, impact 20 ("solves a real problem from your main challenge"), demo 15 ("a live, deployed app the judges can actually use") (`tech/modal…md:13–16, 31–34`). Gemma: open; "innovative and impactful use of … open models" (`tech/google-deepmind--best-use-of-gemma.md:32`). |
| Wired | Spikes only (`scratch/spikes/modal`), plus the Featherless Gemma path in `createLlm` (`llm/index.ts:120`). No `jobs/`, no `Jobs` adapter, no `record_enrichment` tool. |
| Smallest strong | `jobs/modal/enrich.py`. Stage 1 is rules over CPU `.map` (pack size, labels, carbon prior). Stage 2 runs **Gemma 4 on Modal vLLM**, only for the ~24% pack-size conflicts and the missing carbon. Stage 3 runs **EmbeddingGemma (768-d, which matches `vector(768)`)** over 17.5k products. The job writes **through a scoped `record_enrichment` API** (D6, not straight to the DB); outputs stay suggestions with provenance. pgvector then feeds `find_substitutes` domain-search candidates, which Gemini judges. Keep the Gemma endpoint warm and use it as `LLM_PROVIDER=modal` for the routine agent, so Modal is live in the demo. **Swarm: drop.** Effort **M–L** (6–8 h). Owners: jobs; lead (contract plus tool scope); core-db (vector search). |
| Evidence | Gate: "useful measured batch completes and writes validated results through the API". `/ops` coverage bars climbing during the run (NOTIFY), the Modal container graph, `modal billing report`, carbon-estimate error on a hold-out of the 11k known values, and the model id in the trace. |

## Dropped (blunt: no working demo by Sun 06:00, or no honest fit)
| Prize | Why drop | Keep instead |
|---|---|---|
| **Exa** main ($2.5k) | The brief wants a *personal* butler judged on "live queries the judges try themselves" (`main/exa…md:38–42`). Our honest Exa use (unknown menu → dishes) needs arbitrary events, but `plan_event` only takes seeded `eventId`s (`contracts/tools.ts:43–48`), so it is L. | Leave the draft unsubmitted. Exa stays in the offline venue pipeline (credited in the README). |
| **AfterQuery** main (€3k) | Needs the Harbor harness (not in hand), a reference run, 3 frontier runs, do-nothing and stop-early baselines, a 15-min exploit hunt and a separate 10-min demo (`main/afterquery…md:15–18, 78`). L, and off the critical path. | Our evals s1–s5 + MCP are the story for Daksh on the grand jury: "where agents fail: lot rounding, unknown supply, injection". |
| **Verda** ($10k credits) | Scored on "how much did compute let you do" (`tech/verda…md:35`); our GPU work belongs to Modal, and splitting one job across two clouds reads as prize-farming. No model is enabled; no Nemotron key. | Reopen only if NVIDIA's Verda Nemotron key arrives by Sat 14:00, for a plan critic (Verda + Nemotron together). |
| **S-Pankki** (€2k vouchers) | A separate mobile product and data model; the data has no stated terms, so it can't ship in the container; all five criteria are about the coach. | Nothing. |
| Nemotron, Cloudinary | No endpoint; no product images (already dropped in SCORECARD). | None. |

## Shared work (build once, score many)
1. **Request box → Gemini parse → registry → approval**: Valio E2E 30 + Gemini.
2. **Held line → Decide (fit + violates) → ranked substitutes with P/source**: Valio robustness and controls, Gemini, the kitchen Why drawer.
3. **Context.dev monitor → webhook → `RecordAnomaly` → hold → (2) → NOTIFY → `/ops`**: one demo beat covers Context.dev ×2, Valio robustness, Gemini and Aiven.
4. **Modal Gemma enrichment + EmbeddingGemma → `record_enrichment` API → pgvector candidates → (2)**: Modal, Gemma, Aiven (pgvector) and Valio's optional sustainability direction.

Conflicts: the `record_enrichment` tool/scope and webhook auth are lead-only contract edits, so make them **once, early (Sat ~08:00)**. Context.dev monitors and Modal both write while `/ops` streams on a 15-connection free PG, so jobs write through the API, never with their own pools. STATUS says Context.dev allows 10 req/min, while the brief says 50 concurrent with no rate limit; cache every result anyway (credits are charged even on cached hits).

## Ordered plan (Sat 02:15 → freeze Sun 06:00 → submit by Sun 09:00)
| # | When | What | Lanes | Gate (else drop the claim) |
|---|---|---|---|---|
| 1 | now → Sat 10:00 | **Valio Ring 0**: R0-c Request box (milk example), R0-b, R0-d reset, R0-g outside agent | request, kitchen, ops, lead | Milk + Christmas run deployed |
| 2 | now → Sat 10:00 | **Gemini wired**: Decide in server ports, fit + violates in `find_substitutes`, replay recorded, P/source in the UI | agent, core-db, kitchen | A live decision visibly changes a substitute's rank |
| 3 | Sat 06:00–12:00 | **Aiven proof**: `pnpm test:pg` race, reload recovery, architecture slide | core-db, ops | 1 order from 2 racing commits on Aiven |
| 4 | Sat 08:00 | **Lead contract pass**: `record_enrichment` tool + `jobs` scope, webhook auth, `Web`/`Jobs` adapter seams | lead | Compiles; evals still pass |
| 5 | Sat 09:00–17:00 | **Context.dev recall watch** (30-min spike first) | web, core-db, ops | Real monitor → anomaly → held line with timestamps by 17:00 |
| 6 | Sat 10:00–16:00 | **Gemini evidence**: 20 labelled cases (rules vs Gemini), θ ↔ autonomy slider, write-up draft | agent | Table in the write-up |
| 7 | Sat 12:00–21:00 | **Modal + Gemma enrichment** → API → pgvector candidates | jobs, core-db | Batch completes and writes through the API by 21:00 |
| 8 | Sat 22:00 | Rough 2-min video; vision-check the claims | lead | Every sponsor line in the video is wired |
| 9 | Sun 00:00–06:00 | Write-ups (Gemini 4 Qs; Context.dev endpoint note; Modal billing numbers); squash history and rotate the Valio key; make the repo public under MIT | lead | Freeze 06:00 |
| 10 | Sun ≤09:00 | Final submissions: Valio (tick Gemini, Aiven, Context.dev tech, and Modal/Gemma only if #7 passed) + Context.dev main; drafts for Exa, AfterQuery, S-Pankki and the placeholders stay unsubmitted | lead | Status FINAL |

Every entry needs (`docs/event/EVENT.md:28–37`): a public video ≤2:00, a demo link, a public MIT repo, the pitch deck PDF, the tech challenges ticked, and status FINAL. The whole team must be present for peer review at Sun 10:30.
