# Lane: b-retrieval (Track B, retrieval half; F18)

## Dispatch
- **Track:** B retrieval (docs/DISPATCH.md). **Owner:** session 1f (now on Track C; this lane is parked). **Branch:** `lane/b-retrieval`, merged.
- **Owned paths:** catalogue `search`/`candidates`/`resolve` in `src/lib/server/adapters/catalog/**` (8d owns `offers` and scenario stock; 8d merges first on a shared file), `evals/retrieval/**`.
- **Acceptance:** `pnpm gate` green; `pnpm vitest run --project server retrieval --silent=false` prints recall@12 and precision@5, hybrid above id order on both.

## State (on main)
- `adapters/catalog/retrieval.ts`: one module for the file and Postgres catalogues, so both return the same pool in the same order (`pg.test.ts` parity).
- **Substitute candidates: hybrid by default** (`CATALOG_RETRIEVAL=id` escape hatch). Valio's rules first, then IDF-weighted name match with Finnish compound heads, a few synonyms and genitive stems, a minimum match (category alone never qualifies), penalties for processed, flavoured or composite candidates, and the target's named dietary property as a hard filter. Recall@12 on `evals/retrieval/substitutes.json` (30 targets): id order 36%, hybrid 73%.
- **Free-text search: substring by default**, `CATALOG_SEARCH=hybrid` opts in (precision@5 72% → 98%, top-1 52% → 100% on `evals/retrieval/queries.json`). Not default because request and agent tests pin substring first hits.
- **`resolve(query, {limit, diet})`** on both adapters, always hybrid: `resolved` with scored candidates, or `unresolved` with a reason and the nearest products with what they failed. Not yet on the `Catalog` port (lead Need).

## Open (in order)
1. `Catalog` port: optional `resolve?` so the menu module can call it.
2. Request and agent adopt hybrid search (their tests pin substring picks; the failing picks were unpickable stock, not relevance).
3. Generic one-word queries whose real products are compounds ("kerma") rank exact-word oddities first.
4. F30: "last season" baseline from committed history; k-lounas and k-central baselines.

## Traps
- Labels are LLM-made from names under a rubric, not chef-reviewed; search precision is regex-judged.
- The Postgres index loads name and filter columns of every food product once per process (~17.5k rows).

## Resume
Worktree `../junc26-lanes/baseline`; rebase on main; run the eval command above.
