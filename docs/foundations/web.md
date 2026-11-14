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
| Recall watch | Context.dev monitor (page, semantic) → webhook → `POST /web/scrape` `formats.json` on the list (fresh) → same on each new notice | `POST /api/web/contextdev` (signature or `x-mandate-webhook-secret`) | `RecordAnomaly{kind:'recall'}` per strong match per plan, else one notice-level anomaly; stable ids `recall-<noticeKey>-<productId|notice>-<planId|catalogue>` |
| Check one notice now | `POST /web/scrape` `formats.json` | `POST /api/web/recall {url, fresh?}` (any key); no url → current list | same anomalies + the extracted notice + matches with tier/confidence |
| Presenter replay | recorded real notice | `POST /api/web/replay {url?, drillProductId?}` (chef/approver key) | "Replay of the 9 Oct 2026 recall …"; with `drillProductId` the GTIN is re-targeted and the title says **DRILL** |
| Missing facts | Exa `/search` + `outputSchema` + highlights | `POST /api/web/facts {productId | query}` (any key) | suggestions `{field, value, verified: gtin|name, grounding, sources[{url, title, quote, gtinOnPage}]}`; with productId → `RecordEnrichment{field:'web.<f>'}` ops, provenance `web:<url>` |
| Outside options | Exa `/search` + `outputSchema` | `POST /api/web/outside {need, context?}` (any key) | options with sources; each ingredient → up to 3 catalogue products |
| Findings | — | `GET /api/web/findings?kind=` | durable list keyed `recall:<key>`, `facts:<productId>`, `outside:<slug>` (file in `WEB_CACHE_DIR`) |

Matching tiers (`recall.ts`): **gtin** 1.0 → names the product; **name** (brand as whole words + Finnish-stem word overlap) 0.4–0.9, names the product at ≥ 0.6; **supplier** (brand 0.3 / vendor 0.25) never names a product, only listed as leads. Batch/best-before are never in our orders, so a GTIN hit says "potentially affected … check the pack".

## Commands

```sh
# offline (default in dev/tests): recorded real responses
pnpm vitest run --project server src/lib/server/web           # 21 tests
curl -X POST localhost:5176/api/web/replay -H 'authorization: Bearer fx-chef' -d '{}'
curl -X POST localhost:5176/api/web/replay -H 'authorization: Bearer fx-chef' -d '{"drillProductId":"463860"}'
curl -X POST localhost:5176/api/web/facts -H 'authorization: Bearer fx-kitchen-agent' -d '{"productId":"460002"}'
# live: WEB_PROVIDER=live (default in production when both keys are set)
pnpm tsx --env-file=.env scripts/web/monitor.ts list
pnpm tsx --env-file=.env scripts/web/monitor.ts create https://<app> 60   # secret → scratch/web/monitor.json
CONTEXT_DEV_WEBHOOK_SECRET=… pnpm tsx --env-file=.env scripts/web/monitor.ts ping https://<app>
```

## Limits, cost, gotchas

- **Context.dev rate limit is real for our key:** a burst of ~10 scrapes returned `429` (the brief says "no rate limit, 50 concurrent"; STATUS's "10 req/min" is what we saw). `http.ts` retries once honouring `Retry-After`; a change reads ≤ 3 notices.
- Costs seen: scrape+json **5 credits**, search 1 per 10 results, page monitor run **1 credit** (hourly = 24/day). Credits left after the spike: ~50,670 of 50,750.
- A **fresh** list read (`maxAgeMs: 0`) took 25.7 s; a cached one 4 s. Webhook → three anomalies took 43 s end to end with sequential reads; notice reads are now parallel.
- Each scrape output has its own `success`; a 200 can still carry `json.success:false`. We throw on it.
- Context.dev caches 3 days by default and charges for cached hits, so `http.ts` caches every successful response itself (memory + `WEB_CACHE_DIR`). Repeat questions are free and traced as `cache: hit`.
- Exa: put `highlights` under `contents`; `outputSchema` needs `type: auto` (not `lite`). Grounding field names are paths (`options[0].title`); we match by prefix. A sibling product appears in results (Puljonki *tomaatti*kastike with celery next to *luumutomaatti*kastike): suggestions are marked `verified:'gtin'` only when a citing page names this product's GTIN.
- Exa says `allergens: []` when a page lists none. It stays a suggestion; catalogue `declared:false` is never overwritten (D6).
- Git Bash rewrites `/web/...` args into Windows paths; set `MSYS_NO_PATHCONV=1` for `scripts/web/cd.mjs`.
- Every call is traced (`source`, endpoint, purpose, latency, credits/$, cache) to the dev console and, from routes, to the /ops trace drawer.

## Fixtures

`src/lib/server/web/fixtures/`: `recall-list.json` (16 notices), `recall-notices.json` (10 extracted real notices incl. the 9 Oct 2026 egg recall), `exa.json` (`facts:460002`, `outside:joulutorttu`). All recorded 2026-11-14 from the live APIs, trimmed.
