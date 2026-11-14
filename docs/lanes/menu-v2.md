# Lane: menu-v2

**Branch:** `lane/menu-v2` · **Worktree:** `../junc26-lanes/menu-v2` · **Dev port:** 5193 · **Owner:** junc26-41 (assigned by the lead, 14 Nov)

## Goal
A menu converges: one ingredient resolves to the same right product every time, and the agent or chef fixes one thing (pin a product, add an ingredient) without regenerating the menu or losing what was already right.

## Why
A 7-guest dinner over MCP on 14 Nov ([agent-door-v2](agent-door-v2.md) has the full story):
- The model's Finnish word decides whether an ingredient resolves: `porsaankylki` stays unresolved while `porsaan kylki` resolves; `limettimehu` fails while `limetti mehu` gives Limmi lime juice; `wonton` misses "WON TON sheets".
- Re-proposing lost products that had already matched.
- A dish labelled `side` left 5 courses asked against 4 dish courses, which blocked acceptance.
- Kassler (smoked) was pinned for cochinita pibil, a dish that cooks raw pork.

## Owned paths
- `src/lib/server/menu/**` and its tests; `evals/menu/**`

## Alignment (lead)
- D16/D18 (8d): carry the dish codes and the ingredient asks through to the plan, and let core enforce them. Add no diet or quantity checks of our own here.
- The fit check is a **warning**, never a block.

## Tasks
- [ ] **Search-word variants:** the model gives up to 3 alternative catalogue words per ingredient (`alt`), and compound words are split (`porsaankylki` → `porsaan kylki`, `limettimehu` → `limetti mehu`), together with any trade name in the label. Variants are tried in order. A match from a variant, rather than the original word, can't pin a processed form (ground, dried, smoked, cooked) that the ingredient doesn't name.
- [ ] **Pins remembered per kitchen:** a pinned product is used first the next time the same ingredient comes up in that kitchen. Hints from the brief work the same way.
- [ ] **Course clean-up:** when fewer dish courses come back than were asked, `side` dishes are relabelled `main` (with a note) until the count is met. The prompt also says one dish per requested course and never to file a requested course as `side`.
- [ ] **New `editMenu` change kinds:**
  - `pin { ingredientId, productId }`: the product must exist and must not break a whole-menu diet flag the resolver already enforces.
  - `addIngredient { dishId, label, query, amountPerCover, unit }`: resolved like a proposal ingredient.
  - The revision records who made the change (`by`).
- [ ] **`revise_menu` handler** (`menu/tool.ts`): scope `plan`, kitchen check, STALE_VERSION on a stale revision. The agent can use `amount`, `pin`, `unresolve`, `addIngredient`, `removeIngredient` and `removeDish`, but never `keepOpen`. The result says the new revision needs a chef's acceptance.
- [ ] **Fit warnings** (`menu/fit.ts`): a smoked or cooked product (kassler, savu, kypsä) in a dish that cooks the meat from raw (pibil, braise, haudutettu, hong shao, carnitas), and meat or fish in a dish offered as vegetarian. Each is `warn` with targets.
- [ ] **Eval** `evals/menu/dinner-replay*`: the 14 Nov brief on the fixture model, then pin the ribs, and the other ingredients keep their products.

## Acceptance
- [ ] `porsaankylki`, `limettimehu` and the wonton case resolve through variants. `keltasipuli` never pins ground onion.
- [ ] A pin survives into the next proposal for the same kitchen.
- [ ] A 5-course brief whose model output has a `side` main is not blocked.
- [ ] `revise_menu` pin → new revision; the earlier pins are unchanged; the review is cleared.
- [ ] `pnpm gate` green; fixture mode works.

## Needs (to the lead)
- **Contracts:**
  - `toolSchemas.revise_menu` (input `{ kitchenId, proposalId, revision, changes[], reasoning? }`; output `{ proposal, issues, meta }`), registered in `tools/handlers.ts` and on MCP (via da);
  - `EventBrief.hints?: { ingredient: string; productId: string }[]`.
- **Resolver (catalogue adapter owner):** add these to `evals/retrieval/resolve.json`, so the resolver itself pins the right product:
  - `sipuli` pins "Sipuli Jauhettu" (ground onion) instead of a whole onion;
  - `chipotle` pins chilli powder, and `chipotle adobo` is rejected even though "Del Sol Chipotle jalapeno adobo kastikkeessa" exists;
  - `keltasipuli` misses "SIPULI 10KG SÄKKI";
  - `kylkirivi` misses ribs.
- **Persistence:** pins are remembered in process for now. Persisting them needs a `MenuStore` method or a small table (port: lead).

## Report
-
