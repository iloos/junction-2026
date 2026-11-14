# Web: Context.dev + Exa

_Spike Sat 14 Nov 2026 01:00–02:40, lane `web`. Code: `src/lib/server/web/**`, routes `src/routes/api/web/**`, scripts `scripts/web/**`._

## Verdict: GO on both, with one honest caveat

| Question | Answer (real output) |
|---|---|
| Structured extraction of a recall notice? | **Yes, exact.** The 9 Oct 2026 egg recall extracts to 4 products with name, brand, manufacturer `Munax Oy`, GTIN (`6415715101210` …), batch `1FI15493`, best-before `28.10. tai aiempi`, hazard `microbiological`, reason in Finnish. 5 credits, 2–4 s per notice. 10 notices extracted, all parsed. |
| Monitor on the recall list with a webhook? | **Yes.** `mon_4ee3dd1742d94276b4a05c528c982f6d` watches the Ruokavirasto list (semantic, hourly). Baseline run completed 1.1 s after start, 1 credit; Context.dev attempted the webhook 1.8 s later (404 only because the route isn't deployed yet; it retries for ~16 h). |
| Signed webhooks? | `X-Context-Signature: t=<unix>,v1=<hex>` = HMAC-SHA256 of `t.rawBody` with the monitor's secret. Verified in code and tests; local signed ping → 202, wrong secret → 401. |
| Exa for missing product facts? | **Yes, strong.** `type:auto` + `outputSchema` returns fields **with per-field citations** (`output.grounding`) plus highlights as quotes. For `460006 Apetit Keittojuures` (Valio: no allergen record) it found the manufacturer page `apetit.fi/...` which **names the GTIN**, ingredients "Lanttu, porkkana, purjo", origin Suomi. 1.4 s, $0.007. |
| Exa for outside options? | **Yes.** `lanttulaatikko` (real outage 462482) → two sourced recipes (flavorado.com, mtk.fi), ingredients mapped to orderable catalogue products (lanttu 460879, kuohukerma 469126, korppujauho 461363 …). 3.1 s, $0.007. |
| **Caveat** | **None of the last 10 Ruokavirasto recalls matches a Valio Aimo GTIN** (17,393 GTINs checked). Consumer recalls are retail packs (Pirkka, K-Menu eggs). The matcher therefore reports supplier leads (Munax: 17 catalogue products; Arla: 208) and holds nothing, which is correct behaviour. A stage beat that shows a **held line** needs the labelled drill (below) or a real foodservice recall during judging. |

## What runs

| Flow | Endpoint(s) | Route | Output |
|---|---|---|---|
| Recall watch | Context.dev monitor (page, semantic) → webhook → `POST /web/scrape` `formats.json` on the list (fresh) → same on each new notice | `POST /api/web/contextdev` (signature or `x-mandate-webhook-secret`) | `change.detected` is queued on disk (`recall-queue.json`) before the 202, then drained: reads with `allSettled`, failures stay queued. `run.completed` drains too and re-reads the list at most hourly (self-healing; seen notices ≤ 14 days old are re-read after 12 h to catch edits). Applied to each `WEB_RECALL_WORKSPACES` target's current run |
| Notice identity | — | — | Source: `recall:<noticeKey>` with a content revision (hash of title, hazard, item codes) and the last 5 revisions kept. Application: one record per workspace/run/notice (`recall-applications.json`) with the revision applied and retry state. An amended notice is an **update** (`Updated recall … Changed: batch of X: A → B`, ids `recall-<key>-r<rev>-…`) only where the earlier revision was applied; a new run gets stored reads applied without a paid read. Drills: `drill:<ws>:<key>:<gtin>`, never the real notice's identity |
| Check one notice now | `POST /web/scrape` `formats.json` | `POST /api/web/recall {url, fresh?}` (any key, caller's workspace); `{productId}` → `check_recall`; `{}` → current list | anomalies + the extracted notice + matches with tier/confidence |
| Presenter replay | recorded real notice | `POST /api/web/replay {url?, drillProductId?}` (chef/approver key, caller's workspace) | "Replay of the 9 Oct 2026 recall …"; with `drillProductId` the GTIN is re-targeted and the title says **DRILL** |
| `lookup_facts` | Exa `/search` + `outputSchema` + highlights | `POST /api/web/facts {productId, question?}` (any key) | `{facts: WebFact[{field, value, gtinCited, sources, provenance}], cached}`. Read-only: records nothing. `gtinCited` = a cited URL/excerpt contains the GTIN as a whole number (a text match, not verification). `lookupFacts` can still write `web.<f>` enrichments `{value, gtinCited, verified (alias: 'gtin' when gtinCited), sources}` when given a store; no route does |
| `find_outside` | Exa `/search` + `outputSchema` | `POST /api/web/outside {need, amount?}` (any key) | `{options[{title, url, note?, provenance}]}`; no citation, no option; never ordered |
| `check_recall` | none (notices on file) | `POST /api/web/recall {productId}` | `{notices[{url, title, match: gtin|name|none, drill, seenAt}]}`; drills only in their own workspace |
| Findings | — | `GET /api/web/findings?kind=` | public notices + the caller's workspace's own findings, its applications, queued work |

Handlers: `createWebTools` (`tools.ts`), each under a `WebExecutionContext` from `webContext(ctx)` (F19: the caller's workspace and run, never the default); schemas in `contracts/tools-next.ts`.

Matching tiers (`recall.ts`): **gtin** 1.0 → names the product; **name** (brand as whole words + Finnish-stem word overlap) 0.4–0.9, names the product at ≥ 0.6; **supplier** (brand 0.3 / vendor 0.25) never names a product, only listed as leads. Batch/best-before are never in our orders, so a GTIN hit says "potentially affected … check the pack"; a name match says "potential match; verify variant and batch on the pack" (never "every pack counts"). Every matched line ends with a resolution path ("To resolve: … release the line … or pick a substitute"); evidence is in `provenance` (notice URL, match tier and confidence).

## Commands

```sh
# offline (default in dev/tests): recorded real responses
pnpm vitest run --project server src/lib/server/web           # 56 tests (+2 opt-in pg)
MANDATE_TEST_PG=1 pnpm vitest run --project server src/lib/server/web/catalog-index.test.ts   # read-only, real catalogue
curl -X POST localhost:5176/api/web/replay -H 'authorization: Bearer fx-chef' -d '{}'
curl -X POST localhost:5176/api/web/replay -H 'authorization: Bearer fx-chef' -d '{"drillProductId":"463860"}'
curl -X POST localhost:5176/api/web/facts -H 'authorization: Bearer fx-kitchen-agent' -d '{"productId":"460002"}'
# live: WEB_PROVIDER=live (default in production when both keys are set)
pnpm tsx --env-file=.env scripts/web/monitor.ts list
MSYS_NO_PATHCONV=1 pnpm tsx --env-file=.env scripts/web/monitor.ts cadence mon_4ee3dd1742d94276b4a05c528c982f6d 10   # PATCH schedule
pnpm tsx --env-file=.env scripts/web/monitor.ts create https://<app> 60   # secret → scratch/web/monitor.json
CONTEXT_DEV_WEBHOOK_SECRET=… pnpm tsx --env-file=.env scripts/web/monitor.ts ping https://<app>
```

## Limits, cost, gotchas

- **Context.dev rate limit is real for our key:** a burst of ~10 scrapes returned `429` (the brief says "no rate limit, 50 concurrent"; STATUS's "10 req/min" is what we saw). `http.ts` retries once honouring `Retry-After`; a change reads ≤ 3 notices.
- Costs seen: scrape+json **5 credits**, search 1 per 10 results, page monitor run **1 credit** (hourly = 24/day; every 10 min = 144/day).
- **Monitor cadence:** the live monitor runs every **60 min**. The approved change to **10 min** is prepared (`monitor.ts cadence`, `PATCH /monitors/<id>` with `schedule:{type:'interval',frequency:10,unit:'minutes'}`) but **not applied yet**: the lane agent's call was blocked by the permission classifier on Sat 14 Nov. Whoever applies it records the time here.
- **Spend caps** (`spend.ts`): per UTC day and per API, `WEB_CAP_PER_KEY` (default 40 calls per caller key) and `WEB_CAP_GLOBAL` (default 600); only network calls count, the monitor only against the global cap. Reached → 429 `RATE_LIMITED` with `Retry-After` (tools: `PROVIDER_UNAVAILABLE`, `sub: daily_cap`).
- **429 from Context.dev:** after the one retry the API cools down for `Retry-After` (default 60 s); during it no call is sent, a stale cached answer is served (`stale: true`) if one exists, else 429 with `Retry-After`. Never a 503 storm from repeated clicks. Credits left after the spike: ~50,670 of 50,750.
- A **fresh** list read (`maxAgeMs: 0`) took 25.7 s; a cached one 4 s. Webhook → three anomalies took 43 s end to end with sequential reads; notice reads are now parallel.
- Each scrape output has its own `success`; a 200 can still carry `json.success:false`. We throw on it.
- Context.dev caches 3 days by default and charges for cached hits, so `http.ts` caches successful responses itself (memory + `WEB_CACHE_DIR`) for 24 h by default, and only when the body is accepted (extraction `success`, Exa output that passes its zod schema). Repeat questions are free and traced as `cache: hit`.
- Exa: put `highlights` under `contents`; `outputSchema` needs `type: auto` (not `lite`). Grounding field names are paths (`options[0].title`); we match by prefix. A sibling product appears in results (Puljonki *tomaatti*kastike with celery next to *luumutomaatti*kastike): facts are marked `gtinCited` only when a cited URL or excerpt contains this product's GTIN. Exa output is zod-parsed (`exa.ts`): malformed results and citations are dropped, a bad field becomes null.
- Exa says `allergens: []` when a page lists none. It stays a suggestion; catalogue `declared:false` is never overwritten (D6).
- Git Bash rewrites `/web/...` args into Windows paths; set `MSYS_NO_PATHCONV=1` for `scripts/web/cd.mjs`.
- Every call is traced (`source`, endpoint, purpose, latency, credits/$, cache) to the dev console and, from routes, to the /ops trace drawer.

## Fixtures

`src/lib/server/web/fixtures/`: `recall-list.json` (16 notices), `recall-notices.json` (10 extracted real notices incl. the 9 Oct 2026 egg recall), `exa.json` (`facts:460002`, `outside:joulutorttu`). All recorded 2026-11-14 from the live APIs, trimmed.
