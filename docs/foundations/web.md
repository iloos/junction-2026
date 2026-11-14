# Web: Context.dev + Exa

_Code: `src/lib/server/web/**`, routes `src/routes/api/web/**`, scripts `scripts/web/**`. The verdict below is from the spike on Sat 14 Nov 2026 (real outputs); the rest describes the code as it is._

## Verdict: GO on both, with one honest caveat

| Question | Answer (real output) |
|---|---|
| Structured extraction of a recall notice? | **Yes, exact.** The 9 Oct 2026 egg recall extracts to 4 products with name, brand, manufacturer `Munax Oy`, GTIN (`6415715101210` …), batch `1FI15493`, best-before `28.10. tai aiempi`, hazard `microbiological`, reason in Finnish. 5 credits, 2–4 s per notice. 10 notices extracted, all parsed. |
| Monitor on the recall list with a webhook? | **Yes.** `mon_4ee3dd1742d94276b4a05c528c982f6d` watches the Ruokavirasto list (semantic; every 5 min, set by the user Sat 14 Nov). Baseline run completed 1.1 s after start, 1 credit; Context.dev attempted the webhook 1.8 s later (it retries a failed delivery for ~16 h). |
| Signed webhooks? | `X-Context-Signature: t=<unix>,v1=<hex>` = HMAC-SHA256 of `t.rawBody` with the monitor's secret. Checked in code and tests: a local signed ping → 202, a wrong secret → 401. |
| Exa for missing product facts? | **Yes, strong.** `type:auto` + `outputSchema` returns fields **with per-field citations** (`output.grounding`) plus highlights as quotes. For `460006 Apetit Keittojuures` (Valio: no allergen record) it found the manufacturer page `apetit.fi/...` which **names the GTIN**, ingredients "Lanttu, porkkana, purjo", origin Suomi. 1.4 s, $0.007. |
| Exa for outside options? | **Yes.** `lanttulaatikko` (real outage 462482) → two sourced recipes (flavorado.com, mtk.fi), ingredients mapped to orderable catalogue products (lanttu 460879, kuohukerma 469126, korppujauho 461363 …). 3.1 s, $0.007. |
| **Caveat** | **None of the last 10 Ruokavirasto recalls matches a Valio Aimo GTIN** (17,393 GTINs checked). Consumer recalls are retail packs (Pirkka, K-Menu eggs). The matcher therefore reports supplier leads (Munax: 17 catalogue products; Arla: 208) and holds nothing, which is correct behaviour. A stage beat that shows a **held line** needs the labelled drill (below) or a real foodservice recall during judging. |

## What runs

| Flow | Provider call | Route / tool | Output |
|---|---|---|---|
| Recall watch | Context.dev monitor (page, semantic, 5 min) → webhook → `POST /web/scrape` `formats.json` on the list, then on each new notice | `POST /api/web/contextdev` (signature, or `x-mandate-webhook-secret` from our scripts) | `change.detected` is written to the work queue on disk before the 202, then drained: notice reads run in parallel (`allSettled`), and a failed read stays queued. `run.completed` drains too and re-reads the list at most hourly, so failures heal on the next run; seen notices ≤ 14 days old are re-read after 12 h to catch edits. Applied to every `WEB_RECALL_WORKSPACES` target's current run |
| Notice identity | — | — | Source: `recall:<noticeKey>` plus a content revision (hash of title, hazard, item codes); the last 5 revisions are kept with the full read. Application: one record per workspace/run/notice with the revision applied and retry state. An amended notice is an update (`Updated recall … Changed: batch of X: A → B`, ids `recall-<key>-r<rev>-…`) only where an earlier revision was applied; a new run is caught up from stored reads without a paid call. Drills: `drill:<ws>:<key>:<gtin>`, never the real notice's identity |
| Read one notice now | `POST /web/scrape` `formats.json` | `POST /api/web/recall {url, fresh?}` (any key, caller's workspace); `{}` → current list | anomalies + the extracted notice + matches with tier and confidence |
| Presenter replay | recorded real notice | `POST /api/web/replay {url?, drillProductId?}` (chef/approver key, caller's workspace) | "Replay of the 9 Oct 2026 recall …"; with `drillProductId` the GTIN is re-targeted and the title says **DRILL** |
| `lookup_facts` | Exa `/search` + `outputSchema` + highlights | MCP / `POST /api/tools/lookup_facts`, and `POST /api/web/facts {productId, question?}` | `{facts: [{field, value, gtinCited, sources, provenance}], cached}`. Read-only: records nothing on the plan or product. `gtinCited`: a cited URL or excerpt contains the GTIN as a whole number (a text match). A source supports a field, never safety or supply |
| `find_outside` | Exa `/search` + `outputSchema` | MCP / REST tool, and `POST /api/web/outside {need, amount?}` | `{options: [{title, url, note?, provenance}]}`; no citation, no option; never ordered |
| `check_recall` | none (notices on file) | MCP / REST tool, and `POST /api/web/recall {productId}` | `{notices: [{url, title, match: gtin, name or none, drill, seenAt}]}`; a drill shows only in its own workspace |
| Findings | — | `GET /api/web/findings?kind=` | `{mode, workspaceId, findings, applications, queued}`: public notices plus the caller's workspace's own findings, its applications, queued recall work |
| Why-drawer evidence | Exa (as `lookup_facts`) | `POST /api/web/evidence {productId, question?}` | `{catalogue: "Valio has no allergen record…", gap, source: live/cache/replay, fields: [{label, value, gtinCited, sources: [{url, host, title, quote, gtinCited}]}], disclaimer}`; GTIN-cited fields first (`evidence.ts`) |
| Make in house | Exa (as `find_outside`) + `Catalog.resolve` | `POST /api/web/make-in-house {need, context?}` | `{status: 'held', reasons, recipe{title,url,yield}, ingredients[{text, status resolved/nearest/none, products}], coverage}`; proposes only, nothing is written to a plan |
| Supplier leads | Context.dev `POST /news/search` (entity by name, 6 h cache, 1 credit / 10 results) | `GET /api/web/leads?planId=` | `{source, vendors, leads: [{vendor, title, url, host, publishedAt, level}]}` from the last 30 days; leads only, never a hold. Fixture mode reads none and says so |
| Sandbox recalls | stored reads (no network) | `prepareSandboxRecalls(env, ctx, {drillProductId?})` in `sandbox.ts`, for the sandbox seeder | stored public notices applied to the visitor's run, plus an optional labelled DRILL in the visitor's own namespace |

Every route and tool runs under a `WebExecutionContext` (`webContext(ctx)` for routes; `tools/handlers.ts` for tools): the caller's workspace and run, never the default. Tool summaries are labelled `[live]`, `[cache]` or `[replay]`. The planner sees only counts and field codes from web results (`agent/facts.ts`).

Matching tiers (`recall.ts`): **gtin** 1.0 names the product; **name** (brand as whole words + Finnish-stem word overlap) 0.4–0.9, names the product at ≥ 0.6; **supplier** (brand 0.3 / vendor 0.25) never names a product and is only listed as a lead. Our orders don't record batch or best-before, so a GTIN hit says "potentially affected … check the pack" and a name match says "potential match; verify variant and batch on the pack". Every matched line ends with a resolution path ("To resolve: … release the line … or pick a substitute"); a web source never clears a hold. Evidence is in `provenance` (notice URL, match tier, confidence).

## Env

| Var | Default | Meaning |
|---|---|---|
| `WEB_PROVIDER` | `fixture` in dev and tests; `live` in production when both keys are set | live or recorded adapters |
| `CONTEXT_DEV_API_KEY`, `EXA_API_KEY` | — | provider keys (server only) |
| `CONTEXT_DEV_WEBHOOK_SECRET` | — | the monitor's signing secret (also accepted as `x-mandate-webhook-secret`; ≥ 16 chars) |
| `WEB_CACHE_DIR` | `scratch/web-cache` | response cache, findings, `recall-queue.json`, `recall-applications.json`, `spend.json` |
| `WEB_CAP_PER_KEY` | 40 | network calls per caller key, per API, per UTC day |
| `WEB_CAP_GLOBAL` | 1000 | network calls per instance, per API, per UTC day (the monitor counts only here) |
| `WEB_RECALL_WORKSPACES` | `ws-demo` | comma list of workspaces the monitor's recalls are applied to |

## Commands

```sh
# offline (default in dev/tests): recorded real responses
pnpm vitest run --project server src/lib/server/web           # 60 tests (+2 opt-in pg)
pnpm test:pg                                                   # includes the read-only catalogIndex check
curl -X POST localhost:5176/api/web/replay -H 'authorization: Bearer fx-chef' -H 'content-type: application/json' -d '{}'
curl -X POST localhost:5176/api/web/replay -H 'authorization: Bearer fx-chef' -H 'content-type: application/json' -d '{"drillProductId":"463860"}'
curl -X POST localhost:5176/api/tools/lookup_facts -H 'authorization: Bearer fx-kitchen-agent' -H 'content-type: application/json' -d '{"productId":"460002"}'
# live: WEB_PROVIDER=live (default in production when both keys are set)
pnpm tsx --env-file=.env scripts/web/monitor.ts list
MSYS_NO_PATHCONV=1 pnpm tsx --env-file=.env scripts/web/monitor.ts cadence <monitorId> <minutes>   # PATCH schedule
pnpm tsx --env-file=.env scripts/web/monitor.ts create https://<app> 5   # secret → scratch/web/monitor.json
CONTEXT_DEV_WEBHOOK_SECRET=… pnpm tsx --env-file=.env scripts/web/monitor.ts ping https://<app>
```

## Limits, cost, gotchas

- **Monitor cadence:** every **5 min, set by the user Sat 14 Nov** (≈ 288 runs a day at 1 credit each, run on Context.dev's side).
- **Spend caps** (`spend.ts`): only network calls count; cache hits are free. A reached cap is `PROVIDER_UNAVAILABLE` with `sub: daily_cap` and `detail.retryAfter`, answered as HTTP 429 with `Retry-After` on every surface. Our own Context.dev calls per change: one fresh list read and ≤ 3 notice reads; `run.completed` reads the list at most hourly. Even a monitor that flags a change on every run (~300 list reads a day) leaves room for judges under the global default.
- **Context.dev rate limit is real for our key:** a burst of ~10 scrapes returns `429`. `http.ts` retries once honouring `Retry-After`, then the API cools down (default 60 s): no call is sent, and a stale cached answer is served (`stale: true`) when one exists, otherwise 429 (`sub: rate_limit`). Repeated clicks never become a 503 storm.
- Costs seen: scrape+json **5 credits**, search 1 per 10 results, monitor run **1 credit**. Exa costs $0.007 per call and takes 1.4–4 s.
- A fresh list read (`maxAgeMs: 0`) takes ~25 s; a cached one ~4 s; a notice 2–4 s.
- Each scrape output has its own `success`, so a 200 can carry `json.success:false`. We throw on it and never cache it.
- Context.dev charges for its own cached hits, so `http.ts` caches accepted 2xx bodies itself (memory + `WEB_CACHE_DIR`) for 24 h by default: extraction `success`, or Exa output that passes its zod schema.
- Exa: `highlights` go under `contents`; `outputSchema` needs `type: auto`. Grounding field names are paths (`options[0].title`), matched by prefix. Sibling products appear in results (Puljonki *tomaatti*kastike next to *luumutomaatti*kastike), which is why `gtinCited` matters. Output is zod-parsed: malformed results and citations are dropped, and a bad field becomes null.
- Exa says `allergens: []` when a page lists none: no fact is returned for it, and catalogue `declared:false` is never overwritten (D6).
- Existing `web.<field>` enrichments in a database keep their shape `{value, verified, sources}`; nothing writes new ones.
- Real Ruokavirasto recalls are retail packs, so a held line on stage needs the labelled drill or a real foodservice notice.
- Git Bash rewrites `/web/...` args into Windows paths; set `MSYS_NO_PATHCONV=1` for `scripts/web/*`.
- SvelteKit rejects non-JSON cross-site POSTs with 403 before our code runs: send `content-type: application/json`.
- Every call is traced (source, endpoint, purpose, latency, credits/$, cache) to the dev console and, from routes and tools, to the /ops trace drawer.

## Fixtures

`src/lib/server/web/fixtures/`: `recall-list.json` (16 notices), `recall-notices.json` (10 extracted real notices incl. the 9 Oct 2026 egg recall), `exa.json` (`facts:460002`, `outside:joulutorttu`). All recorded 2026-11-14 from the live APIs, trimmed.

## Shared outside-call plumbing (`src/lib/server/external/`)
`createExternalCall` wraps every outside call (web HTTP now; Gemini Decide; Valio next): response cache (memory + dir), a spend guard charged only on a network call, a half-open breaker per API (5 failures or a 429 opens it; one probe when the cool-down ends), and one `ExternalCallTrace` per call (`{api, purpose, cache: live|cache|replay|fixture, ok, latencyMs, costUnits, model, workspaceId}`). `withExternalScope(scopeFor(ctx), fn)` carries the caller's workspace so adapters built once per process trace into its drawer and charge its caps. `ledger.ts` is the daily cap ledger (web: `WEB_CAP_*`; Decide: `DECIDE_CAP_PER_WORKSPACE` 300, `DECIDE_CAP_GLOBAL` 5000).

## State in Postgres (migration 0004)
`pg-state.ts`: `web_cache` (response cache behind memory), `web_spend` (daily counters per day/api/key, `*` = instance; one conditional upsert per counter in a transaction), `web_queue` (claimed with `FOR UPDATE SKIP LOCKED` and a 2-minute lease per drain pass), `web_findings`, `web_applications`. Findings, applications and the queue stay process maps (sync reads), hydrated once by `webStateReady` and written through per changed item; the webhook awaits the write before answering 202. Without a database the JSON files under `WEB_CACHE_DIR` are the store.
