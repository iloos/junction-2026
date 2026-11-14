# Ring 2 review: sponsor usage and external-service wiring (main f2f7864)

_Condensed by the lead from a read-only design review. Paths under `src/lib/server/` unless noted. Web search was unavailable to the reviewer; items marked (verify) need a docs check._

## Biggest gaps
1. **Prod never calls Valio's API.** Prod catalogue = `createPgCatalog` (store/server-ports.ts); `offers()` reads seeded `offer_cache` only (adapters/catalog/pg.ts:157-213). `valio.ts` live path is never enabled; `VALIO_API_KEY` unused in src. Cache covers ~6,956 / 17,546 products, so most judge-picked products have no price/stock. The `quote` description ("live … cache-through") is false on prod.
2. **Gemini Decisions invisible and under-used.** One question per call (decide/index.ts:148) vs the 120-question batch it's good at; recipe fit never shown in the UI; handlers' Decide has no `trace` (tools/handlers.ts:64) so ranking calls never reach the trace drawer (rule 7). yes/no collapsed to boolean; `Decision` has no p/probabilities. `replay.json` is `{}` so fixture mode falls to a constant 2/4.
3. **Exa and Context.dev invisible to judges:** no `.svelte` reads `/api/web/*`; recalls apply only to `WEB_RECALL_WORKSPACES` (default ws-demo), never a visitor sandbox.
4. **Web state on container disk** (`/tmp/web-cache`): cache, recall queue, spend ledger, findings, applications lost on redeploy; a 202'd webhook can be lost; caps reset.

## Valio (end-to-end 30, autonomy 20, robustness 15, openness 15)
- [High, S–M] Cache-through on the PG catalogue: on miss `POST /api/price` + `/api/availability` (≤200 ids, 4 concurrent), upsert `offer_cache`, tag `valio_live` + fetch time; availability TTL ~15 min. `VALIO_API_KEY` as an Aiven secret. Reuse `fetchMisses` (valio.ts:179).
- [High, S] Breaker never closes (valio.ts:181): half-open after 60 s.
- [Med, S] Trace Valio calls (ids, hit/miss, latency) into the drawer. [Med, S] Source + time on every price line.
- Don't: call per keystroke/search; claim real-time stock.

## Gemini ("beyond adding an LLM", "why Gemini")
- [High, M, port change lead] `Decide.batch`: one call per rescued line with `{id}_fit` (score), `{id}_violates` (noul vs hard constraints/allergens, in front of code rules, never replacing), `{id}_fi` (origin) (design in foundations/gemini.md).
- [High, S] Return p/probabilities/confidence and show them (RescuePanel "fit 3.4/4 · conf · gemini"; Why chain).
- [High, S] Pass `trace` into createDecide. [Med, S] Record the replay book (`DECIDE_RECORD=1` over demo paths). [Med, S] Schema-constrained output (`z.toJSONSchema` as response schema) for parse, menu, planner; native function declarations later (verify Interactions tool shape). [Med, S] LLM spend ledger per visitor/day (copy web/spend.ts). 429 retry once. [Med, M] Gemini embeddings → pgvector (see Aiven).
- Don't: Live voice, Gemini granting anything.

## Aiven (meaningful use 40, technical 30, impact 20, creativity 10)
- [High, S–M] Move web state to Postgres: response cache, `recall_queue` (`FOR UPDATE SKIP LOCKED`), spend ledger (`UPDATE … RETURNING`), findings, applications. One Postgres = state + queue + audit.
- [High, M] Real hybrid retrieval: Gemini embeddings (768-d to match `schema.ts:66`, verify model) for 17.5k product names, HNSW index, RRF fusion with lexical in SQL; serves menu `resolve` and English search. Claim only if `retrieval.eval.test.ts` improves.
- [Med, S] Transactional NOTIFY inside `store.transact` (send iff commit); batch NOTIFYs.
- [Med, S] Infrastructure strip on /ops: DB latency, TLS verified, LISTEN connected, NOTIFY→SSE lag, op count, region, plan.
- Plans upgraded by 9c (Runtime startup-100-2048, PG startup-4 AWS Frankfurt, staging app).
- Don't: Kafka/OpenSearch/ClickHouse to tick boxes; Valkey only if multi-instance.

## Context.dev (impact, live data, completeness, technical, real-timeness)
- [High, M] Visible + personal: recall card in Ops, held line with source in the Kitchen; apply stored notices and a visitor-scoped drill when a sandbox is seeded.
- [Med, M] Second endpoint: `POST /news/search` on vendors in the open plan → "supplier risk" leads on the Ops card (leads only, never holds).
- [Low, S] Consider an extract monitor (verify output has GTINs). Fix doc drift: cap default 1000 (spend.ts) vs 600 (deploy.md).
- Don't: brand/people enrichment; cadence < 5 min; a web source clearing a hold.

## Exa (usefulness, source clarity, originality, live judge queries)
- [High, M] Why drawer "Valio has no allergen record" → `lookup_facts` → fields with citation URLs, quote, GTIN-cited ✓. Works on any product.
- [High, M] Unresolved need → `find_outside` recipes → `Catalog.resolve` ingredients → make-in-house proposal held for sign-off (ties to D8).
- [Low, S] Add `objective` to structured searches.
- Don't: Agent API / Websets interactively; Exa monitors; Exa overwriting catalogue facts.

## Optional
Featherless Gemma: point the low-risk `explain` job at it (S) if D7 is reopened; not request.parse. Modal: skip.

## Architecture of external services
Ports are clean (Catalog, Decide, Llm, Web with fixture twins; llm.for(job); timeouts and abort everywhere; source labels). Plumbing is uneven: four caching forms (Valio disk files, PG rows without TTL, Decide memo, web JSON on /tmp); spend caps only for web; tracing misses Valio and ranking decisions; failure handling good for web, weak for Valio (breaker) and Gemini (no 429 retry, empty replay). **Target:** one `ExternalCall` helper (generalised from web/http.ts) for Valio, Gemini and web: PG-backed cache + spend ledger, half-open breaker, one trace shape `{api, purpose, cache, latency, cost, workspace}`, read by the trace drawer and an /ops cost-per-job view.
