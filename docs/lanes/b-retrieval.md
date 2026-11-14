# Lane: b-retrieval (Track B, retrieval half; F18)

**Branch:** `lane/b-retrieval` · **Worktree:** `../junc26-lanes/baseline` (reused) · **Dev port:** 5178 · **Owner:** session 1f

## Dispatch
- Track B retrieval (SYNTHESIS §8). Owned: catalogue `search`/`candidates`/`resolve` in `src/lib/server/adapters/catalog/**` (8d owns `offers` and scenario stock; 8d merges first on a shared file), `evals/retrieval/**`.
- Acceptance: `pnpm vitest run --project server retrieval --silent=false` prints recall@12 (substitutes) and precision@5 (search); hybrid must beat id order on both.

## State
- `retrieval.ts`: one shared module, so the file and Postgres catalogues return the same pool in the same order.
- Substitute candidates: **hybrid by default** (`CATALOG_RETRIEVAL=id` is the escape hatch). Recall@12 on the 30-target labelled set: id order 36%, hybrid 73%; precision@12 38% → 67%.
- Free-text `search`: substring by default; `CATALOG_SEARCH=hybrid` opts in (precision@5 72% → 98%, top-1 52% → 100% on 25 ingredient queries; nonsense stays empty). Not the default because the request parser's case question and the routine agent's first-hit pick are pinned in their tests to substring order (`request/answers.test`, `cases.test`, `agent/goals.test` g2, `stop.test` cancel): their owners adopt it.
- `resolve(query, {limit, diet})` on both adapters (always hybrid): `resolved` with scored candidates, or `unresolved` with a reason (no product words / names match but diet fails / nothing close enough) and the nearest products with what they failed.

## Needs (lead)
- Add `resolve?(query, opts): Promise<Resolution>` to the `Catalog` port (optional, so fixtures stay valid); `Resolution` is exported from `adapters/catalog/retrieval.ts` and could move to contracts.

## Known weak spots
- Generic one-word queries whose real products are all compounds ("kerma" → kuohukerma, ruokakerma) rank exact-word oddities first ("kerman stabilointiaine"): a genitive modifier counts like a head. Onion, oat drink, chicken, eggs ≈ 50% recall.
- Labels are LLM-made from names under a rubric, not chef-reviewed; regex-judged search precision is approximate.

## Report
- Sat 14 Nov ~05:00 · done: labelled set, hybrid candidates (default), hybrid search (opt-in), resolve() · needs: Catalog port `resolve?` · ready to merge: yes
