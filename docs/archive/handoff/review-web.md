# Review: web lane (Context.dev + Exa)

_Sat 14 Nov ~03:55, worktree `lane/web` with main `f2edb21` merged. Read-only review; the only live calls were free ones (monitor runs, unsigned prod POSTs)._

## 1. Own scope (`src/lib/server/web/**`, `src/routes/api/web/**`, `scripts/web/**`)

**Solid (with evidence)**
- Recall extraction: 10 real Ruokavirasto notices parsed with our schema (`fixtures/recall-notices.json`). The 9 Oct egg recall gives 4 products with GTIN, batch `1FI15493` and best-before, exactly. Tests: `web.test.ts` "recorded notices …".
- Matching tiers with confidence (`recall.ts:matchNotice`): gtin 1.0; name ≥ 0.6 names a product; supplier/brand leads never do. Whole-word company match (`hasWords`) fixed a live false lead (SOK matched sokeri). Tests: "matching a notice …" (5 cases).
- Ingest through `transact` with stable ids and in-run dedup. Test: "a drill on a planned product … once, and publishes it". Verified live: a second drill gave `alreadyKnown: 1`.
- Webhook auth: Context.dev HMAC (`verifyContextSignature`, 300 s tolerance) or the shared header. Tests: "webhook auth" (3). Prod, unsigned JSON POST: `401 bad or missing webhook signature`.
- Live monitor `mon_4ee3dd17…`: baseline at 00:36:48Z and a scheduled run at 00:59:03Z, both `completed`, 1 credit each, no change. Next run 01:58Z.
- Exa facts: live `460006` returned 5 suggestions in 1.4 s for $0.007, cited to apetit.fi pages that name the GTIN. Outside: `lanttulaatikko` returned 2 sourced recipes in 3.1 s.

**Known bugs / fragile (ranked)**
1. **A failed background ingest loses the change.** The webhook answers 202 before the work (`contextdev/+server.ts`). If the fresh list read 429s or times out, Context.dev never retries, and the next run sees no change because the baseline moved. A notice can be missed silently (only a trace `error`). Fix: on every `run.completed`, also diff the list against findings (5 credits/h, self-healing), or answer 5xx on failure.
2. **The Postgres `catalogIndex` path is untested** (`index.ts`, `db.execute` with raw SQL). Tests and my e2e used the file catalogue. Prod uses this path for every `/api/web/recall` and every change. The lead's "manual retry got 200" was a `run.completed`, which doesn't match anything.
3. **Findings are not atomic with ops.** `findings.put` runs after `transact`. On prod `WEB_CACHE_DIR=/tmp/web-cache` (deploy.md:57), so findings are per instance and lost on redeploy.
   - Effect: after a redeploy, the first change re-reads up to 3 notices from the last 30 days. Dedup holds within the run, so this costs credits but adds no duplicate anomalies.
   - Also: a write error after a committed `transact` returns 503 to `/api/web/facts`, although the ops were written.
4. **Context.dev 429 at about 10 requests/min** (spike). There is one retry (≤ 8 s). Repeated `/api/web/recall` calls from judges hit it and answer 503.
5. **No spend guard on `/api/web/*`.** Any key can call Exa ($0.007 per call, $50 credit) and Context.dev (5 credits per notice) without a cap. Uncached queries are new spend.
6. **Ingredient mapping is a heuristic** (`rankByWord`): live "2 tl suolaa" → 460505 SUOLAHEINÄ (wrong). It is labelled a suggestion but has no confidence.
7. **CSRF:** SvelteKit answers 403 "Cross-site POST form submissions" to a non-JSON POST before our auth. Context.dev sends JSON; any script must set `content-type: application/json`.

**Untested paths:** every route handler (no route tests); `handleChange` with `matched_urls` (search monitors); `lookupFacts({query})` free text; live `findOutside` for anything except two needs; the name tier on a real positive (synthetic only).

**Shortcuts:** `findOutside` writes no op, so options leave no provenance in the log; the `findings.json` file stands in for a table; the drill re-targets a real notice's GTIN (labelled DRILL in title and `via`).

## 2. Adjacent scopes

| Need (docs/lanes/web.md) | State on f2edb21 | Evidence |
|---|---|---|
| 1 Recall → hold | **Done.** A recall anomaly holds the line at sign-off, voids the approval, survives a re-quote, is never offered as a substitute, and is superseded once replaced | `core/mandate/tier.ts:59–118,161,210`; `server/store/recall.test.ts:61,89,109` |
| 2 Durable enrichments | **Done in the store** | `db/schema.ts:217`, `drizzle-store.ts:97,158`, `store/enrichments.test.ts` |
| 2b Enrichments shown anywhere | **Open.** Nothing outside state/store reads `state.enrichments` (grep), so Exa suggestions are invisible in the UI | — |
| 3 Registry tools `lookup_facts` / `find_outside` / `check_recall` | **Open.** Nothing imports `$lib/server/web` outside the web lane | grep: no hits |
| 5 `.env.example` names | **Open** (`WEB_PROVIDER`, `WEB_CACHE_DIR`, `CONTEXT_DEV_WEBHOOK_SECRET` missing) | `.env.example` |
| 6 Foundations index | **Open.** `foundations/README.md:19` still says web is "pending" | — |
| 7 Recall card in UI | **Open.** /ops shows the long message (screenshot from the lane run) | — |

Seam to watch: core holds on any `RecordAnomaly{kind:'recall', productId}`. The web lane sets `productId` only for gtin or name ≥ 0.6, so supplier leads never hold. Keep that contract if core changes.

## 3. The whole product: what we can honestly claim

**Context.dev (main + tech).**
- Claim:
  - A live monitor on the Finnish Food Authority list with signed webhooks, running hourly, 1 credit per run.
  - Schema extraction of real notices (product, GTIN, batch, best-before, hazard).
  - Catalogue matching with stated confidence.
  - A GTIN hit holds the line, voids the approval and proposes substitutes (core test).
- Don't claim:
  - "A real recall hit our orders": 0 of 10 recent notices match a catalogue GTIN.
  - "Within minutes": cadence is hourly; ingest takes about 30–45 s after the webhook.
  - "Several endpoints": monitors and scrape JSON in the app; search was spike only.
- Tech 40% rewards combining endpoints, and we are thin there.

**Exa.**
- Claim: GTIN-verified, cited allergen and ingredient suggestions for products Valio has no record for (6,347 food items undeclared), and sourced outside recipes mapped to orderable products.
- The brief scores "live queries the judges try themselves" and "clarity in showing sources". Today the only surface is a bearer-key REST route: no UI, no MCP tool, and enrichments are not displayed.

**What a judge breaks first:**
1. "Let me try Exa": there's no place to type.
2. "Show a real recall in your orders": only the DRILL.
3. Clicking "check recall" a few times gives a 429, then 503.
4. A non-Finnish free-text `facts` query: untested, likely "No cited facts".

## 4. Continuation (ranked)
1. **Expose Exa where judges and agents act.** Register `lookup_facts`, `find_outside` and `check_recall` (Need 3) so they reach MCP and the agent. Add a "Find on the web" button in the kitchen Why drawer for allergen-unknown lines that shows `state.enrichments` with source links and quotes.
   - Gate: a judge's MCP client gets a cited answer for any product id.
2. **Make the recall watch self-healing and faster.**
   - Diff the list on every `run.completed` (bug 1).
   - Move the cadence to 10 min (144 credits/day).
   - Add a recall card (title, hazard, tier and confidence, source, timestamps notice → webhook → anomaly → held).
   - Run a PG smoke of `/api/web/recall` on prod (bug 2).
3. **A second and third Context.dev endpoint that matters to the product.**
   - `/news/search` over the suppliers on open plans (recall, strike, plant closure) → anomaly leads.
   - A `search` monitor (`takaisinveto elintarvike`) for wholesaler and manufacturer notices outside Ruokavirasto, which are the ones likely to name foodservice GTINs.
   - That answers "combining several endpoints" with product value, not decoration.
4. **Spend guard:** a per-key daily cap and a per-minute limit on `/api/web/*`, and a 429 that says when to retry.
5. **Tests:** route handlers, `catalogIndex` on PGlite with seeded products, and `handleChange` with a list read failure.

**Feeds for the open-request → menu → ingredients track (PLAN.md:13):**
- `findOutside` is already steps (3)+(4) in small form: recipe → ingredients → catalogue products.
- Persisting accepted options as dish templates seeds the "recipes found via Exa" knowledge base. Exa's `yield` ("14 annosta") gives g/cover once parsed.
- `lookupFacts` gives allergen facts to check menu diets against ingredients that Valio leaves undeclared.
- Keep them labelled estimate/suggestion (D6).

**Feeds for "estimate any kitchen" (GROWTH.md:35–38):**
- Venue → Exa finds the menu page (`includeDomains` = venue site) → Context.dev `formats.json` dish schema (the offline 15-menu scrape becomes a route) → dishes → Exa recipes for unknown dishes → ingredient templates → likely SKUs.
- Context.dev `/brand/retrieve` brands the venue's estimate card, which fits their "Brand in a Box" theme.
- GROWTH rule 1 holds by construction: every web value carries `provenance.source:'web'` and never grants authority.

**Disagreement:** don't submit Exa unless step 1 lands. Without a judge-facing surface it scores low on "working implementation" and "clarity", and the draft costs pitch time.
