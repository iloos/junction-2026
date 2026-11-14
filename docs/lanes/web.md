# Lane: web

**Branch:** `lane/d2-sponsors` (Ring 2 Track D; was `lane/d-web`) · **Worktree:** `../junc26-lanes/web` · **Dev port:** 5186 · **Track:** D (web judge-reachable)

## Goal
Live web data strengthens the purchasing core. A Context.dev monitor turns real Ruokavirasto recall notices into recall anomalies on the op log. Exa answers product-fact and outside-option questions as sourced suggestions. A source supports an identity or a field, never safety or supply (D10). Sponsor fit: D7 (Context.dev, Exa).

## Owned paths
`src/lib/server/web/**`, `src/routes/api/web/**`, `scripts/web/**`, `src/lib/server/adapters/decide/**`, `src/lib/server/external/**`, `docs/foundations/web.md`, this file. The lead delegated one change outside these paths (tool registration, merged in `e7c0bd9`). Shared files stay lead-owned.

## What exists
Details and the full route table are in [docs/foundations/web.md](../foundations/web.md).
- **Recall watch:** a Context.dev monitor on the Ruokavirasto list (every 5 min, set by the user Sat 14 Nov) posts a signed webhook to `/api/web/contextdev`.
  - The change is queued on disk (`queue.ts`) before the 202, then drained (`watch.ts`). A failed read stays queued and heals on the next `run.completed`.
  - Each notice is read once and filed with a content revision (`ingest.ts`, `findings.ts`).
  - It is applied per workspace and run, with retry state (`applications.ts`). An amended notice becomes an update with an item diff; a new run is caught up from stored reads.
  - Drills live in their own `drill:<ws>:…` namespace.
- **Matching** (`recall.ts`): tiers gtin / name / supplier. Every matched line carries its evidence (provenance) and a resolution path.
- **Tools** (`tools.ts`, registered in `contracts/tools.ts` and `tools/handlers.ts`): `lookup_facts` (Exa, read-only), `find_outside` (Exa, never ordered), `check_recall` (notices on file, no network). Each runs under the caller's `WebExecutionContext`. Summaries are labelled `[live]`, `[cache]` or `[replay]`.
- **Routes** (`/api/web/*`): facts, outside, recall (read one notice, list, or `{productId}` → check_recall), replay (drill), findings (`{mode, workspaceId, findings, applications, queued}`). All are scoped to the caller's workspace and run (`webContext`).
- **HTTP layer** (`http.ts`, `persist.ts`): accepted 2xx bodies are cached for 24 h. Calls are traced. After a 429, one retry, then a cool-down that serves a stale answer when one exists.
- **Spend** (`spend.ts`): daily caps per caller key and per instance, per API. A cap is HTTP 429 with `Retry-After` on every surface.
- **Exa output** is zod-parsed (`exa.ts`, `lookup.ts`).
- **Tests** (fixtures only, no network): `web.test.ts`, `watch.test.ts`, `apply.test.ts`, `http.test.ts`, `tools.test.ts`, `mcp-web.test.ts`, `catalog-index.test.ts`. The last one is opt-in against Postgres via `pnpm test:pg`.

## Env (names only; defaults in code)
| Var | Default |
|---|---|
| `WEB_PROVIDER` | `fixture` in dev/tests; `live` in production when both keys are set |
| `CONTEXT_DEV_API_KEY`, `EXA_API_KEY`, `CONTEXT_DEV_WEBHOOK_SECRET` | none |
| `WEB_CACHE_DIR` | `scratch/web-cache` (prod: `/tmp/web-cache`) |
| `WEB_CAP_PER_KEY` | 40 calls per key, per API, per UTC day |
| `WEB_CAP_GLOBAL` | 1000 calls per instance, per API, per UTC day |
| `WEB_RECALL_WORKSPACES` | `ws-demo` |

## Gotchas
- Real Ruokavirasto recalls are retail packs and match no catalogue GTIN. A held line on stage needs the labelled drill (`POST /api/web/replay {drillProductId}`) or a real foodservice notice.
- Findings, the queue and the application ledger are per instance (files in `WEB_CACHE_DIR`). After a redeploy, stored reads are gone; the next run re-reads, and anomaly ids keep it idempotent.
- The Context.dev rate limit is per minute (~10 calls).
- Send `content-type: application/json` on POSTs; SvelteKit rejects other cross-site POSTs with 403.
- In Git Bash, set `MSYS_NO_PATHCONV=1` for `scripts/web/*`.
- Only the worktree's `scratch/web/monitor.json` (gitignored) holds the webhook secret.

## Needs (open)
1. **Env (lead):** add `WEB_CAP_PER_KEY`, `WEB_CAP_GLOBAL` and `WEB_RECALL_WORKSPACES` to `.env.example` and the Runtime. Add `ws-judges` to `WEB_RECALL_WORKSPACES` if judges should see real recalls there.
2. **UI (C: Why drawer, G: Ops recall card):** mount the evidence views on `lookup_facts`, `check_recall` and `GET /api/web/findings`. The findings shape above is stable. Waiting for C.

3. **Lead, merge review:** `697dd3a` edits 8d's `core/services/substitutes.ts` + `core/rank/rank.ts` (rescue batch: fit, violates, origin in one Gemini call; a calibrated P(violates) > 0.5 rejects, nothing un-rejects). `c3a2e9e` edits shared `tools/handlers.ts` (every tool runs in `withExternalScope(scopeFor(ctx))`) and `request/index.ts` (review Decide gets the trace). Review with 8d before merging.
4. **Env (lead, `.env.example` + Runtime):** `DECIDE_CAP_PER_WORKSPACE` (default 300 calls/day), `DECIDE_CAP_GLOBAL` (default 5000). `LLM_PROVIDER=gemini` on prod so Decide is live; `GEMINI_STUDIO_API_KEY` already set.
5. **Sandbox seeder (lead / demo owner):** call `prepareSandboxRecalls(env, ctx, { drillProductId })` from `demo/sandbox.ts` after a visitor sandbox is seeded (pick a product on the seeded plan for the drill, or omit it).
6. **Web state into Postgres (item 3, with 9c):** not started, waiting on the lead's go and 9c's migration: tables `external_cache(key pk, api, at, value jsonb)`, `recall_queue(id, item jsonb, attempts, locked_at)` read with `FOR UPDATE SKIP LOCKED`, `spend_ledger(day, api, key, n)` charged with `UPDATE … WHERE n < cap RETURNING`, `web_findings(id pk, workspace_id, kind, at, data jsonb)`, `web_applications(scope, finding_id, state jsonb)`. The store code sits behind the existing `persist`/`ledger` seams.
7. **UI (1f Why drawer, G Ops card):** mount `POST /api/web/evidence`, `POST /api/web/make-in-house`, `GET /api/web/leads`; RescuePanel can read `score.fit.provenance.note` ("recipe fit 2.2/4 via gemini, conf 0.33, 410 ms, Finnish origin p 0.97").

## Next
1. Once C lands, help mount "Find on the web" and the recall card against the shapes above.
2. A route-level test for `/api/web/contextdev` (signature → queue → drain on fixtures).
3. Show the cache and spend state (`spend.json`, cool-down) in the /ops trace drawer.

## Report
- Sat 14 Nov (convergence, base main f2052ca) · done: cleanup (dead code removed, one JSON persistence helper, web route errors match the tool gate), the 5-min cadence recorded, `WEB_CAP_GLOBAL` default 1000, docs rewritten to the current state · stubbed: none · needs: 1–2 · ready to merge: yes
- Sat 14 Nov (Ring 2 Track D, base main cf00345) · done: ExternalCall helper (fc23292), Decide.batch + p/probabilities + spend cap + 429 retry (4338a84), rescue batch for 8d (697dd3a), replay book recorded live (27ca0e5), scoped tool calls for the trace drawer (c3a2e9e), web evidence/make-in-house/leads/sandbox (bc99108) · stubbed: Postgres web state (item 3, waiting on lead + 9c), embeddings (item 5, not started) · needs: 3–7 · gate GREEN · ready to merge: yes, after 8d reviews 697dd3a
