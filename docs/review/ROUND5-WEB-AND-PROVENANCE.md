# Round 5: web ingestion, API boundaries and provenance

Reviewed on 14 November 2026 against `dc0f213`–`dd600e5`. Outside review; recommendations for the lead, no application changes. Sources are the repository and the local Exa / Context.dev integration skills. This is not a live-provider certification.

## 1. High: authenticated web routes discard the caller's workspace

The facts route obtains `ctx`, then calls `servedPorts()` without it. That helper calls default `createServerPorts()` and uses its workspace or `DEMO_WORKSPACE`. The authenticated actor is retained on the write, but the authenticated workspace is not. Recall, outside and replay have the same wiring. Findings reads are entirely global.

Evidence: [facts route](../../src/routes/api/web/facts/+server.ts#L16), [wiring](../../src/lib/server/web/index.ts#L108), [findings route](../../src/routes/api/web/findings/+server.ts#L11), [finding storage](../../src/lib/server/web/findings.ts#L9).

**Consequence:** the judge sandbox / presenter separation enforced elsewhere does not hold across these routes. An authorized judge request can record an enrichment or recall into the default workspace; any authenticated caller can read all findings. This is a source-level trace, not an exploit against the deployed service. The route's intended role permissions also need to be stated explicitly: “any key” currently permits paid work and enrichment writes.

**Fix:** derive `WebExecutionContext` from authenticated context, including workspace, current run, actor and permitted capability; pass it to ports and all reads/writes. A webhook needs an explicit configured target/subscription, rather than inheriting the stage workspace. Public source documents can be shared, but their customer applications and private search intents must be scoped.

**Acceptance:** two distinct keys/workspaces use the same product and notice; each sees only its own applications, events and findings. A sandbox request cannot change the presenter state. Missing scope fails closed.

## 2. High: recall deduplication prevents updates and fresh-run application

[`newNoticeUrls`](../../src/lib/server/web/watch.ts#L32) excludes every URL already present in findings. Its key is only normalized host/path ([identity](../../src/lib/server/web/recall.ts#L130)). An amended notice at the same URL is therefore never re-read, even when the monitor says it changed. A global finding can also suppress application to another workspace or a new run.

Drills add a URL fragment, but notice identity ignores fragments. A drill and the real notice share the same finding key ([replay](../../src/lib/server/web/watch.ts#L74)). A local pure probe confirmed this equality. This is an identity collision between demo material and source evidence, not merely a display issue.

**Fix:** separate three identities:

- `SourceDocument`: canonical URL and provider/source retrieval metadata.
- `SourceRevision`: extraction/content digest, source time, observed time, parser/schema version, live/replay/drill origin.
- `RecallApplication`: revision + workspace + run + product/plan target, with independent idempotency.

Keep replay/drill documents in their own namespace. Re-read changed URLs and reconcile added/removed products and changed batches; do not use “ever seen URL” as proof the current run is protected. A durable job should acknowledge webhook work only after enqueueing it. Today the webhook starts background work and returns, and `Promise.all` means one failed extraction prevents ingestion of its successful siblings ([handler](../../src/routes/api/web/contextdev/+server.ts#L55), [batch](../../src/lib/server/web/watch.ts#L60)).

**Acceptance:** replay → real notice; run reset → same notice; unchanged retry; revised notice at same URL; and one extraction failure in a batch all produce the intended distinct, recoverable results.

## 3. Medium: successful HTTP is cached before successful extraction

[`createWebHttp`](../../src/lib/server/web/http.ts#L174) caches every HTTP 2xx response. Context.dev's body can contain `json.success: false`, which is rejected only later in the adapter. With the default unbounded cache age, that failure is then replayed indefinitely unless the caller explicitly bypasses caching.

**Reproduced locally:** a stubbed fetch returning HTTP 200 with `{json:{success:false,error_code:'temporary'}}`; two `readNotice` calls with a one-hour cache allowance invoked fetch once and both failed. No paid API was called.

Positive `maxAgeMs` is passed to the local HTTP cache, but only zero is forwarded to Context.dev ([adapter](../../src/lib/server/web/contextdev.ts#L40)). The same stub confirmed that `maxAgeMs:3600000` was absent from the provider request. `cache_metadata.age_ms` is declared but ignored, and `fetchedAt` becomes the local HTTP response time ([metadata](../../src/lib/server/web/contextdev.ts#L25), [notice](../../src/lib/server/web/contextdev.ts#L81)). A locally new response is not evidence that the source page was freshly captured.

**Fix:** cache validated extraction results or let adapters supply a success predicate; give negative results a short explicit TTL. Carry `requestedMaxAge`, `retrievedAt`, provider cache age/status, and source capture time when available. Do not invent source time when the provider does not supply it. Propagate caller cancellation and an overall deadline across retries, rather than restarting a 60-second allowance per attempt.

**Acceptance:** temporary extraction failure can recover on the next eligible retry; a bounded freshness request reaches the provider; an old provider capture cannot be presented as a fresh source observation.

## 4. Medium: findings are a second, process-global state store

[`createFindings`](../../src/lib/server/web/findings.ts#L24) uses one global map even when called with different file paths. The record has no workspace, and op references merge by run ID only; independent workspaces commonly share run labels. Synchronous full-file writes are neither a distributed store nor atomic with the ops transaction.

**Reproduced locally:** two independently created, memory-only findings repositories shared an inserted record. The probe ran in a separate process and wrote no cache file.

The comment that the op log has every finding should not be treated as a recovery guarantee: outside research and its complete source material need an explicit durable representation too.

**Fix:** use the existing Postgres store for scoped finding applications and provider jobs. Keep file/memory adapters as fixture implementations. A deliberately shared public-source cache should have separate types and keys from tenant findings. Include workspace + run in op references and event links. Avoid creating another mutable truth beside the existing event/projection model.

## 5. Medium: uncertainty is lost between extraction and user language

Recall matching correctly distinguishes GTIN, name and supplier confidence. But [`lineFor`](../../src/lib/server/web/ingest.ts#L37) says “every pack counts” whenever batch/date fields are absent, including a probabilistic name match. Missing extraction data is not proof the notice covers every variant. A precautionary hold can be appropriate while the language still says “potential match; verify variant and batch.”

Exa facts are correctly retained as **suggestions**, with a note that they are not catalogue facts. Preserve this boundary. However, [`sourcesFor`](../../src/lib/server/web/lookup.ts#L83) infers `gtinOnPage` from substring inclusion in citation URLs and highlights, then labels a suggestion `verified: 'gtin'`. That establishes a weak identity hint, not verification of the extracted value or its safety applicability. The extraction result is also not independently schema-validated at this boundary.

**Fix:** distinguish `identityEvidence`, `fieldEvidence`, `authority`, and `reviewStatus`; use exact digit boundaries for GTIN matching. Validate model/provider output at runtime and retain evidence spans. Dietary or allergen fields must remain unknown for ordering until the domain's evidence policy accepts them. Never promote a web extraction because it came from a named sponsor API.

## API review limits and useful design direction

The Exa adapter uses a structured search request and receives grounding; Context.dev uses JSON extraction and validates recall notices. These are useful seams. This pass did not call either service, inspect provider consoles, certify monitor signatures against a new live delivery, or assert an undocumented API incompatibility.

The next worthwhile abstraction is a **source-to-decision lineage**, not a generic provider wrapper: provider response → validated source revision → scoped suggestion → authorized promotion → catalogue version → priced offer → exact plan terms. Each transition needs an explicit owner and a retained link to its evidence.
