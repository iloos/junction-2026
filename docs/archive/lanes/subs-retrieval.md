# Lane: subs-retrieval (proposal, for the lead to assign)

**Branch:** `lane/subs-retrieval` · **Worktree:** `../junc26-lanes/subs-retrieval` · **Dev port:** 517N · **Owner:** unassigned

## Goal (one sentence, user-visible)
For a dish the seed doesn't know, the rescue shows sensible candidates (same product in another pack first), each with a one-line reason saying what changes.

## Context to read first (≤4 files)
- docs/research/substitutes.md (the design; read all of it)
- src/lib/core/services/substitutes.ts, src/lib/server/adapters/catalog/pg.ts (`candidates`, ordered by product id today)
- src/lib/server/db/schema.ts (`products.embedding vector(768)`, unused)

## Owned paths (only these may be edited)
- src/lib/server/adapters/catalog/** (candidate generation)
- src/lib/core/services/substitute-reason.ts (new: attribute diff → reason line)
- scripts/catalog/embed.* (new batch job), tests for the above
- One call site in substitutes.ts to attach the reason (coordinate with core-db)

## Contracts used (read-only; fixtures exist)
- `Catalog.candidates(productId, limit)`; Product facts (allergens, origin, pack, temperature); D6 ranking stays unchanged.

## Tasks (small; each one ends in a commit)
- [ ] Pack-swap finder: same base product in another pack (name normalisation + brand + form), ranked first. Deterministic.
- [ ] Product card text (name + category hints + ingredients + form) and a batch job writing Gemini embeddings (768) into the existing column on Aiven; PGlite fixture gets a small precomputed set.
- [ ] Hybrid candidates: Valio rules ∪ pack swaps ∪ lexical ∪ vector top-k, then the existing fact filters; replaces id-order truncation for unknown dishes.
- [ ] Reason line per candidate from the attribute diff ("same product, 6 × 400 g", "no new allergens, +3 %", "raw, needs cooking"); allergen and origin facts only from source data.
- [ ] Labelled recall set: 20 out-of-stock lines with hand-listed acceptable substitutes; report recall@12 for id order vs hybrid.

## Acceptance (observable)
- [ ] Recall@12 improves over id order on the labelled set (numbers in the lane report)
- [ ] A rescue card shows reason lines (screenshot); no candidate claims an allergen clearance from an estimate
- [ ] `pnpm check`, `pnpm test:unit`, `pnpm eval` pass; the fixture path needs no network

## Out of scope
Roles/ontology for all 17.5k products (the batch product profile is a later step); changing the D6 formula; Decide prompt changes.

## Needs (requests to the lead; keep working on the fixture meanwhile)
- Gemini embedding spend cap; whether the embedding batch runs locally or as the Modal job (D7 extension).
- Partners: Gemini (embeddings + fit), Aiven (pgvector in our Postgres: strengthens "meaningful use"), Modal (batch). MariaDB's challenge is Wikipedia-only and doesn't fit.
