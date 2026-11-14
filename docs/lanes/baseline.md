# Lane: baseline (1f: standing-order baseline, SURFACES, retrieval research)

**Branch:** `lane/baseline` · **Worktree:** `../junc26-lanes/baseline` · **Dev port:** 5178 · **Owner:** session 1f

## Goal (one sentence, user-visible)
Routine products go through within the mandate, so only what is genuinely new reaches a person; and the product shape (doors, objects, journeys) is written down in SURFACES.

## Owned paths (as of this handoff)
- `docs/concept/SURFACES.md`, `docs/research/{sibling-repos,analogs,valio-baseline,substitutes,product-images,pitch-notes}.md`, `docs/lanes/{agent-door,composer,subs-retrieval,images,ops-cases}.md` (proposals), this file
- Baseline code (merged, lead now owns the shared parts): `usualProducts` in `core/contracts/kitchen.ts`, `orderedBefore` in `core/mandate/tier.ts`, seed `fixtures/seeds/kitchens.json`, `lib/kitchen/fixture-plan.ts` `NORMAL_WEEK`, `store/baseline.test.ts`
- Proposed next (SYNTHESIS §5 Track B, retrieval half): catalog `search`/`candidates` (`src/lib/server/adapters/catalog/**`)

## Handoff (Sat 14 Nov)
**State.** All my work is merged (main `5615a58`); worktree clean, ff to main. Deployed shows 10 held + 4 "Within mandate" on the Christmas plan (was 14 held). Commit with approval buys approved ∪ act-tier lines (`orders.ts` commit, `actAlone`). Checkpoint review: `docs/handoff/review-1f-surfaces.md`.

**Non-obvious knowledge**
- `orderedBefore(state, kitchen)` = `kitchen.usualProducts` ∪ products in this kitchen's committed orders. It is the only `new_sku` source; events.ts and orders.ts import it.
- The Postgres backfill in `drizzle-store.ts` `ensure` sets `doc.usualProducts` only when it is null, so a later seed change does **not** reach existing workspaces. To change a baseline, reset the workspace or write a migration.
- `NORMAL_WEEK` is built from the seed and `USUAL_QTY`; it throws at module load if they disagree (fail-loud; a seed edit can crash the kitchen bundle).
- Only k-hotel has `usualProducts`. On k-lounas and k-central everything is "new" and held (F30).
- 8 of the 10 held lines are event staples (herrings, rosolli, casseroles). The real fix is order history (Valio's *Usein ostetut* / *tilauspohjat*), not a mandate setting.
- Valio webshop facts (from a logged-in walk): order templates (private/shared/central), cart per delivery date, *pääkäyttäjä*, *reklamaatiot*; "Katso korvaavat" lists similar products with no reason; A.I.mo cannot answer the milk example. See `research/valio-baseline.md`.
- Images: never Valio webshop/media images (terms §2), never commit images. Measured chain: Open Food Facts → manufacturer page via Exa + Gemini vision verdict → icon; 14/50 verified, ~$0.35.
- Retrieval today: substitute candidates = same category + temp class + unit, ordered by product id, cut to 12 (`catalog/pg.ts:146`); `products.embedding vector(768)` exists, unfilled. Plan in `research/substitutes.md` and `lanes/subs-retrieval.md`.
- Not MariaDB: its challenge is Wikipedia-only; no honest touchpoint.

**Open threads**
- Track B retrieval (if assigned): lexical (Finnish name normalisation, compounds, minimum match) ∪ Valio rules ∪ category, then fact filters; embeddings only behind a spend cap. Changing candidate sets changes what Track A's F5 ranking test sees: agree fixtures with 8d first.
- F30: baselines for k-lounas/k-central; baseline from committed history + a seeded "last season" list; align `stub-handlers.ts:294` with core `orderedBefore`.
- F8 (per-line authority) touches my mixed-commit change; 8d owns it.
- Valio mentor message on own-brand packshots: drafted, given to the user, not known to be sent.
- Stale: `sibling-repos.md` says findings C/D open (closed on main); `SURFACES.md` §3 says 14 held.

**Traps**
- Never commit from the main checkout (I did once, `eb5f458`); commit here, send the SHA.
- Playwright MCP browser may be held by another session: use the repo's Playwright via a node script.
- Valio login is in gitignored `Misc/aimo_challenge_deets.png`; never write it into repo files; no saved session state kept.
- Open Food Facts rate-limits (429): back off; don't bulk-crawl.

**Artifacts outside git (only I know where)**
- Image chain: `chain.py`, `products.json`, `off.json`, `exa.json`, `verify.json`, `verify2.json` in session 1f's scratchpad `…/34f036e5-…/scratchpad/images/`. Copy `chain.py` to `scripts/images/` when an images lane starts.
- Valio webshop screenshots (18): main checkout `scratch/valio-baseline/` (gitignored).
- Deployed-walk screenshots (desktop 1440, phone 390): 1f's scratchpad.

**How to resume**
1. `git -C ../junc26-lanes/baseline merge --ff-only main`; `pnpm i` in the worktree if deps changed; `pnpm dev --port 5178`.
2. Read SYNTHESIS §3 rulings and §5 Track B, then `research/substitutes.md` and `lanes/subs-retrieval.md`.
3. Start from a labelled set: 20–40 out-of-stock lines with acceptable substitutes listed by hand; measure recall@12 for id order vs the new retrieval before swapping it in.
