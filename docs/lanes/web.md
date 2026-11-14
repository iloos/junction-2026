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
