# Review: lead (contracts, integration, orchestration), Sat 14 Nov ~05:40, main f2edb21

## Own scope
**Solid (evidence):**
- Contracts: D6 implemented and extended by review rounds 3–4 without a rewrite: closed op union, `applyOps` authority (core/commit.test.ts), shared validator with forbid/gap/waive (core/mandate/validate.ts, gate.test.ts), `Line.view` read model, hard ceiling, recall holds, scenario dates. 252 server tests, 5/5 evals, adversarial 10/10, Aiven race 4/4 (`pnpm test:pg`), tx-boundary 21→0 (store/prepare.test.ts).
- Test isolation: `dbMode()` forces fixture under vitest and `sql()` throws (db/client.ts); Gemini forced to fixture in served handlers under vitest.
- Live Gemini: `pnpm test:live` (Decisions score + Flash-Lite JSON + request parse) passes from main's `.env`.
- Deploy: Aiven Runtime from `main`, Postgres mode, TLS verified, keys as console secrets; one-command redeploy via 9c.

**Fragile / shortcuts:**
- Contract ratification is informal: lanes edited `src/lib/core/contracts/**` with my after-the-fact OK (8d, 1f). Fine at this size; risky when more lanes fan out. Rule for next round: contract diffs as a separate commit, lead merges first.
- `contracts/tools.ts` uses loose shapes in places (`approval.requestedBy` as `{kind,id}` strings, `weights` as a free record).
- No contract versioning of stored documents (round-4 systems #6): stored JSONB is cast, not parsed.
- Flaky timing: PGlite-heavy suites occasionally exceed per-test timeouts under parallel load (seen twice after merges; rerun green). Not fixed at the root (could cap vitest workers for the server project).
- I merged a red suite once (faaf1bb) because lint and push were chained after tests without a gate. Merge script must stop on test failure.

## Adjacent scopes
- Two sources of truth for demand remain: `src/lib/kitchen/fixture-plan.ts` still carries a browser purchasing engine for `/offline`; production uses the server, but drift risk stays (round-4 systems #2).
- In-memory process state: current run, kitchen sessions, simulator overlays, fit memo, findings file. One Aiven instance only; a restart drops sessions and overlays (documented, not fixed).
- Workspace-wide lock and full-state reconstruction per command (round-4 systems #3): fine at demo size, the first scaling wall.

## Whole product
- Proven on prod: Christmas plan with real outages, rescues from a curated pool, edit → void approval → re-approve → commit → same receipt; Valio's milk request flow; MCP judge key cannot approve; Ops queue with deep links; hard ceiling; sandbox isolation and self-reset.
- **Not yet provable on stage:** a real recall hitting our orders (only labelled DRILL); "recipe-aware ranking" beyond the top-3 fit (no labelled evaluation set); arbitrary events and menus (seeded event only); embeddings / vector search (0 rows); Modal/Gemma (nothing built).
- A judge would break first: an open request outside the lexicon ("5-course dinner for 50"), or a product the lexicon maps badly (search takes the top substring hit).

## Continuation (lead view)
1. **Open request → menu → ingredients** (PLAN track): biggest product gap, and it exercises Gemini + Exa + the gate.
2. **Self-explanation and visuals:** the funnel (17.5k → 3), a "why held" grouping on Ops, the flow from menu to order, the ranking strip already exists; the user wants the system to explain itself.
3. **Model routing per job** + an honest fit evaluation (labelled set, held-out split) before claiming recipe-aware ranking.
4. **Scale seams** before any "estimate any kitchen" showcase: per-plan transactions, durable run/session state, readiness entities (GROWTH.md).
5. **Submission track** after the stable tag: PITCH verified-claims-only, video, platform drafts, history squash + key rotation.

Disagreement to record: none blocking. One caution: we added features faster than eval coverage; the five scenarios still describe Friday's plan. New behaviours (ceiling, recall, baseline, dates, preview/apply) are unit-tested but not in `evals/`.
