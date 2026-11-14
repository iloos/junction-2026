# Lane O: observability

**Branch:** `lane/o-obs` · **Worktree:** `../junc26-lanes/obs`

**Goal:** traces that survive a restart, one request id end to end, structured JSON logs, and a read route for Ops. No new service, no new dependency.

**Owned paths:** `src/lib/server/obs/**`, `src/routes/api/ops/**`, `drizzle/0005_traces.sql` (+ meta), the `traces` table in `schema.ts`, `src/hooks.server.ts` (request context), and mechanical `console.*` → `log.*` swaps in `src/lib/server`.

## What exists

- **`traces` table** (migration `0005_traces`, additive): one row per model, outside and tool call. Columns: id, at, request_id, workspace_id, run_id, actor_kind, actor_id, via, step, source, model, tool, tokens_in, tokens_out, latency_ms, cache, ok, error, cost_units, data (jsonb, redacted, ≤ 4 KB).
- **Writer** (`obs/traces.ts`): `logTrace` and `serveTool` queue rows; batches of 50 flush every 2 s off the request path; a failing database keeps ≤ 2,000 rows queued (oldest dropped) and retries; rows older than 7 days are pruned on a flush at most every 10 min. Unit tests write nowhere unless they call `setTraceStore`.
- **Request context** (`obs/context.ts`): `hooks.server.ts` opens it per request (keeps a plain incoming `x-request-id`, else `req-…`), returns `x-request-id` on every response. `withCallScope` and `serveTool` fill in workspace, run, actor and via.
- **Logger** (`obs/log.ts`): `log.info|warn|error|debug(event, fields)`. Production prints one flat JSON line per event to stdout (`at, level, event, requestId, workspaceId, runId, route, …`; nested keys dotted; ≤ 8 KB) for the platform shipper (OpenSearch). Dev and tests print a short readable line. `LOG_FORMAT=json|pretty`, `LOG_LEVEL`. Fields pass through `redact` (secret keys blanked, prompts and bodies dropped, credential shapes scrubbed).
- **Events:** `request.in`, `request.out` (route, status, ms), `request.error`, `tool.call` (tool, actor, via, ok, code, ms), `model.call` / `outside.call` (source, model, purpose, cache, tokens, ms, ok, error), `op.written` (type, seq, via, actor), `refusal` (tool, code), plus the error events that replaced the old `console.*` lines.

## Read contract (for 9c, Ops UI)

Scoped like `/api/events`: production reads a public room or the browser's own sandbox; the presenter reads any workspace; dev reads anything. Without `ws`, a visitor reads their own room, the presenter every workspace.

`GET /api/ops/traces?ws=&since=&source=&requestId=&limit=`
- `since`: ISO time or `15m` / `2h` / `1d`; default 1 h; clamped to 7 days. `limit` ≤ 500 (default 200).
- → `{ traces: TraceView[], filter, persisted }`, newest first. `TraceView = { id, at, requestId, workspaceId, runId, actor: {kind,id}|null, via, step, source, model, tool, tokensIn, tokensOut, latencyMs, cache, ok, error, costUnits, data }`.
- `&as=events` → `{ events, filter }`: the same rows as `trace` ServerEvents, oldest first, `data.persisted: true`. The trace drawer can prepend these to its live stream (dedupe by `data.id` if needed; live events carry no id).
- 400 `INVALID_INPUT` for an unsafe id, 403 `FORBIDDEN` for a workspace this browser may not read.

`GET /api/ops/traces/summary?ws=&since=`
- → `{ sources: [{ source, count, p50Ms, p95Ms, errorRate, cacheHitRate, tokensIn, tokensOut }], filter, writer: { queued, dropped, failing } }`. Default window: the last hour. `source` is `gemini`, `valio`, `exa`, `contextdev`, `featherless`, `verda`, `tool`, `fixture`, …

## Needs

- **Lead:** run `pnpm db:migrate` on Aiven before deploying this (new table `traces`). The app does not migrate at request time; without the table, trace writes fail quietly (one `trace.write_failed` warning) and the read routes answer empty with `persisted: false`.
- **9c (Ops UI):** wire the trace drawer's history and an engine-room table to the contract above.

## Report

- 2026-11-14 · traces table + batched writer + retention, request id via ALS + header, JSON logger with redaction (OpenSearch-friendly lines), /api/ops/traces + summary, 13 unit tests · fixture LLM calls without a router aren't traced (as before) · lead: db:migrate on Aiven · ready to merge yes (after gate)
