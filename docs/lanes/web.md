# Lane: web

**Branch:** `lane/web` · **Worktree:** `../junc26-lanes/web` · **Dev port:** 5176 (was taken by another process; ran on 5186) · **Owner:** web lane agent

## Goal
Live web data strengthens the purchasing core: a Context.dev recall watch turns real Ruokavirasto notices into anomalies on the op log, and Exa fills missing product facts and outside options as sourced suggestions. Sponsor fit: D7 (Context.dev main + tech, Exa).

## Owned paths
`src/lib/server/web/**`, `src/routes/api/web/**`, `scripts/web/**`, `docs/foundations/web.md`, this file.

## Needs (contract changes for the lead / core-db)
1. **Recall → hold (core-db, `src/lib/core/**`).** When a `RecordAnomaly{kind:'recall', productId, planId}` lands, lines with that `productId` in uncommitted plans should be held with reason `recall` (and committed orders flagged), so `find_substitutes` runs. Today the anomaly shows on /ops but the line state is unchanged. Proposed: a `LineReason` `recall` and, in `applyOps` for `RecordAnomaly` with `kind:'recall' && productId`, set matching lines of non-committed plans to held with that reason (pure; no new op).
2. **Durable enrichments projection (lead, per round-4 finding 5).** `RecordEnrichment` reduces into state but isn't persisted or reloaded, and the catalogue reads only `products.doc`. Proposed table `enrichments(workspace_id, product_id, field, value jsonb, provenance jsonb, seq, run_id, primary key (workspace_id, product_id, field))`, filled by the store from `RecordEnrichment` ops and loaded into `state.enrichments`; web writes fields `web.allergens | web.mayContain | web.netContent | web.origin | web.ingredients` with `value: {value, verified: 'gtin'|'name', sources: url[]}`. Until then `findings.json` in `WEB_CACHE_DIR` holds them by stable id.
3. **Registry tools (lead, `contracts/tools.ts`).** Expose the JSON routes as tools so the agent and judges' MCP clients use them:
   - `lookup_facts {productId? , query?}` → `FactsResult` (scope `read`; writes RecordEnrichment as a side effect, actor = caller).
   - `find_outside {need, context?}` → options with sources and catalogue matches (scope `read`).
   - `check_recall {url?}` → notice + matches + recorded anomalies (scope `plan`), or the current list without url.
   Handlers can call `lookupFacts` / `findOutside` / `ingestRecall` from `src/lib/server/web/*` (they need `exa`/`recalls` from `webClients(env)`, so pass them through ports or a `web` port extension).
4. **`Web` port shape.** The current `Web.search` is enough for the agent loop; the structured calls live behind `FactSearch` / `RecallSource` in `src/lib/server/web`. If core needs them, add `web.facts(productId)` and `web.recall(url)` to `Ports`.
5. **Env + deploy (lead).** Add to `.env.example`: `CONTEXT_DEV_WEBHOOK_SECRET=`, `WEB_PROVIDER=`, `WEB_CACHE_DIR=`. On Aiven Runtime set `CONTEXT_DEV_WEBHOOK_SECRET` to the secret in `junc26-lanes/web/scratch/web/monitor.json` (monitor `mon_4ee3dd1742d94276b4a05c528c982f6d`, already pointing at `https://widely-many-scorpion.eur-1.aiven.app/api/web/contextdev`), `EXA_API_KEY`, `CONTEXT_DEV_API_KEY`, and a writable `WEB_CACHE_DIR` (e.g. `/tmp/web-cache`).
6. **Foundations index (lead).** Add `web.md` to `docs/foundations/README.md`.
7. **UI (kitchen/ops lanes).** The anomaly message is long; a recall card could show title, hazard, match tier/confidence and the source link from `provenance.ref`. `GET /api/web/findings` has the structured data.

## Report
- Sat 02:45 · done: spike (GO), recall watch (webhook + list diff + notice extraction + matching + anomalies), presenter replay/drill, Exa facts + outside, fixtures, 21 tests, live monitor created · stubbed: none (fixture adapters replay real recordings) · needs: 1–7 above · ready to merge: yes

## Handoff (Sat 14 Nov)

**Branch and paths.** `lane/web`, worktree `../junc26-lanes/web`, synced to main `5615a58`. Owned paths: `src/lib/server/web/**` (adapters, matching, ingest, lookups, fixtures, tests), `src/routes/api/web/**` (contextdev, recall, replay, facts, outside, findings), `scripts/web/**` (`cd.mjs` raw call helper, `monitor.ts` admin), `docs/foundations/web.md`, this file.

**State.** Merged to main. On main: recall → hold (core, 8d), enrichments table (store), prod env (`WEB_PROVIDER=live`, `WEB_CACHE_DIR=/tmp/web-cache`, both API keys and the webhook secret; deploy.md:57). Track D from SYNTHESIS is the next work. Open findings: F19 scoping, F20 recall identity/self-healing, F21 judge surface, F28 provenance (cache predicate, "verified" wording, runtime schema, "every pack counts"), and the pg `catalogIndex` test in F31.

**Live monitor.** `mon_4ee3dd1742d94276b4a05c528c982f6d`: page target, Ruokavirasto recall list, semantic detection (threshold 0.6), every 60 min, webhook events `change.detected` and `run.completed` → `https://widely-many-scorpion.eur-1.aiven.app/api/web/contextdev`. 1 credit per run. Inspect (free; no secret is printed):
- `pnpm tsx --env-file=.env scripts/web/monitor.ts list` (status, last and next run)
- `MSYS_NO_PATHCONV=1 node --env-file=.env scripts/web/cd.mjs cd /monitors/<id>/runs -` (runs, `change_detected`, `webhook_delivery_ids`)
- `… cd /webhooks/deliveries/<whd_id>/attempts -` (HTTP status per delivery attempt)
- Change cadence or webhook: `PATCH /monitors/<id>`. Rotate the secret: `POST /monitors/<id>/webhook/rotate-secret`, then update the Runtime env. Only the worktree's `scratch/web/monitor.json` (gitignored) holds the current secret.

**Non-obvious knowledge.**
- Context.dev rate limit is per minute (~10 calls, then 429), despite the brief's "no rate limit". `http.ts` retries once, waiting ≤ 8 s. One change reads ≤ 3 notices.
- Credits: scrape+json 5, search 1 per 10 results, monitor run 1. A fresh list read (`maxAgeMs:0`) takes ~25 s; a notice 2–4 s. Context.dev charges for its own cached hits, so `http.ts` caches every 2xx forever (memory + `WEB_CACHE_DIR`), keyed on endpoint+body. A deliberate fresh read passes `maxAgeMs:0` (F28: it caches before checking `json.success`).
- Signature: header `X-Context-Signature: t=<unix>,v1=<hex>`, HMAC-SHA256 over `` `${t}.${rawBody}` `` with the monitor's webhook secret, 300 s tolerance. Verify against the raw body text, never re-serialised JSON. Our scripts use `x-mandate-webhook-secret` with the same value instead.
- SvelteKit rejects non-JSON cross-site POSTs with 403 before our code runs. Always send `content-type: application/json`.
- Exa: `contents.highlights` goes under `contents`; `outputSchema` needs `type:'auto'`; `output.grounding[].field` is a path (`options[0].title`), matched by prefix. Cost $0.007 per call, 1.4–4 s.
- Fixture vs live: `webMode()`. Tests always use fixtures; dev defaults to fixture; prod is live when both keys are set. Fixture keys: `facts:460002`, `outside:joulutorttu`, and 10 notices including the 9 Oct egg recall.
- Git Bash rewrites `/web/...` arguments into Windows paths: set `MSYS_NO_PATHCONV=1`.
- Port 5176 was taken by another process during the lane run; I used 5186.

**Open threads (next steps, in order).**
1. F20: in `handleChange`, use `Promise.allSettled` (one failed read drops its siblings today). Diff the list on every `run.completed` so a failed change heals within the hour. Put drills in their own id namespace (`drill:` key, not the real URL's key).
2. F28: cache only when `json.success`; rename `verified:'gtin'` to `gtinCited`; zod-validate Exa `output.content`; change the name-match wording to "potential match; verify variant and batch".
3. F21: tools `lookup_facts` / `find_outside` / `check_recall` (lead registers them; handlers call `lookupFacts` / `findOutside` / `ingestRecall`). Add a "Find on the web" panel reading `state.enrichments` (`web.*` fields carry `{value, verified, sources}`), a per-key daily cap, and a 429 with `retryAfter`.
4. F19: take the workspace and run from the caller's context, not `servedPorts()` defaults. Scope findings per workspace once T0's `WebExecutionContext` lands.
5. Test the pg `catalogIndex` (raw SQL on `doc->>'gtin'`, brand/vendor `like`) on PGlite with seeded products, and add route tests.

**Traps.**
- Real Ruokavirasto recalls are retail packs: 0/10 matched a catalogue GTIN. A held line on stage needs `POST /api/web/replay {drillProductId}` (labelled DRILL) or a real foodservice notice.
- `newNoticeUrls` dedups on findings (per instance, `/tmp`), not on state. After a redeploy the first change re-reads up to 3 recent notices; run dedup prevents duplicate anomalies.
- Supplier/brand leads never set `productId`, so they never hold. Core holds on any recall anomaly that has a `productId`; keep that contract.
- `findOutside` writes no op; its results live only in findings.
- Ingredient mapping is heuristic (`rankByWord`); "suolaa" maps to SUOLAHEINÄ.

**How to resume.**
```powershell
cd C:\Users\jiaqi\Documents\.ai\hackathon\junc26-lanes\web; git merge main
$env:DATABASE_URL=''; pnpm vitest run --project server src/lib/server/web   # 21 tests
$env:DATABASE_URL=''; $env:WEB_PROVIDER='live'; $env:CONTEXT_DEV_WEBHOOK_SECRET='<local test value>'; pnpm vite dev --port 5186 --strictPort
# replay / drill / facts / outside: curl lines in docs/foundations/web.md "Commands"
$env:CONTEXT_DEV_WEBHOOK_SECRET='<same local value>'; pnpm tsx --env-file=.env scripts/web/monitor.ts ping http://localhost:5186
```

**Only I knew this.** All 10 recorded notices were checked against all catalogue GTINs: no match. Munax Oy maps to 17 catalogue products (vendor `MUNAX OY`), Arla Protein to 4 rahka products (not the recalled vanukas). The spike used ~80 Context.dev credits (~50,670 left) and ~$0.03 on Exa. The cloudflared tunnel for a local delivery test was refused by the permission classifier, so real delivery has only been seen against prod (404 before merge, then 200 on your manual retry).
