# Lane: core-db

**Branch:** `lane/core-db` · **Worktree:** `../junc26-lanes/core-db` · **Dev port:** 5172 · **Owner:** peer session junc26-8d

## Goal (one sentence, user-visible)
Every tool in the registry works for real on PGlite (and Aiven): quote, plan an event, place, approve and commit orders under the mandate, and find ranked substitutes, so evals s1–s5 pass.

## Context to read first (≤4 files)
- docs/concept/ARCHITECTURE.md (command flow, rules the handlers enforce, ranking, demand)
- src/lib/core/contracts/{plan,tools,ops}.ts, src/lib/core/ports.ts, src/lib/core/state.ts
- evals/README.md, fixtures/seeds/christmas-buffet-140.json
- docs/foundations/valio-data.md §3–6

## Owned paths (only these may be edited)
- src/lib/core/{demand,mandate,rank,services}/**
- src/lib/server/store/**, src/lib/server/adapters/{catalog,simulator}/**, the seed loader
- evals/** (runner + adapter, `pnpm eval` via Needs)
- tests for the above

## Contracts used (read-only)
`ToolHandlers`, `Ports` (Catalog, Simulator, Store, Clock), `applyOps`, Drizzle schema, seeds in fixtures/seeds/.

## Tasks (each ends in a commit and a SHA to the lead)
- [x] Slice 1: Valio catalog adapter (normalised catalogue, cache-through offers, D6 availability kinds, cents), simulator overlay, `quote` + `search_products` handlers with scope and input checks
- [ ] Slice 2: Drizzle store on PGlite (transact, idempotency, budgets, op seq), `place_order` + mandate tiers + `approve` + `commit_order` + `get_plan` + `set_mandate`; simulator `consume`
- [ ] Slice 3: seed loader (EventSeed), `plan_event` + demand + `edit_line` + `explain_line`
- [ ] Slice 4: `find_substitutes` + rank (frozen formula), make-in-house substitutes
- [ ] Eval adapter: s1–s5 through the handlers on PGlite; `pnpm eval`

## Acceptance (observable)
- [ ] `pnpm check` and `pnpm vitest run --project server` pass
- [ ] `pnpm eval` reports s1–s5 all keys pass on PGlite
- [ ] Works with no Valio key (cache-only fixture)

## Out of scope
UI, MCP/REST serving (agent lane), Gemini fit (Decide port, agent lane; rank uses `fit` when given).

## Needs (requests to the lead)
- `package.json` script `"eval": "node evals/run.ts --adapter fixture"` once the adapter lands.
- Deploy: the container needs `data/valio/` (normalised catalogue + cache, not in git) or live mode with `VALIO_API_KEY`; the adapter builds `data/valio/normalized/products.json` on first load (~1 s, 350 MB heap once).

## Report
- Sat 14 Nov ~05:30 · done: slice 1 (catalog adapter, overlay, quote/search handlers, 7 tests) · stubbed: other tools return PROVIDER_UNAVAILABLE "not implemented yet" · needs: above · ready to merge: yes
