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

## Design (find candidates, then choose; no word lists)
Matching an ingredient has two stages, and they need different tools:
1. **Candidates (aim for coverage).** The resolver's own answers for the query, the model's `alt` words and a trade name in the label's brackets, plus its "nearest" products (the right one is often there when the words differ). Diet flags filter the list first.
2. **Choice (aim for precision).** One model call per menu picks, for each ingredient, the candidate that *is* it as its dish needs it (same food, cut and form), or none. It is restricted to the candidate ids and returns a reason. A concern ("kassler for a pibil") becomes an open item.

Without a model (fixture), the resolver's pick stands, unchanged. What a kitchen settled is remembered: a chef's or agent's pin first, and a model's choice never replaces one. Hybrid or vector search is **held** (user, 14 Nov). If it comes back, it widens stage 1 only, and only once measured offline on the recall evals.

## Tasks
- [x] Candidates from the query, the model's `alt` words, a trade name and the resolver's nearest (`resolve.ts`)
- [x] Chooser (`choose.ts`): one batched call, restricted to the candidates, failure keeps the resolver's pick
- [x] Pins and choices remembered per kitchen; caller hints first; neither passes a whole-menu diet flag
- [x] Sides become mains while the requested courses are short
- [ ] New `editMenu` change kinds: `pin { ingredientId, productId }` and `addIngredient { dishId, label, query, amountPerCover, unit }`, with `by` on the revision; a pin is remembered for the kitchen
- [ ] `revise_menu` handler (`menu/tool.ts`): scope `plan`, kitchen check, STALE_VERSION. The agent can use amount, pin, unresolve, addIngredient, removeIngredient and removeDish, never keepOpen
- [ ] Eval `evals/menu/dinner-replay*`: the 14 Nov brief, pin the ribs, and the other products stay
- [ ] Held-out split of `evals/retrieval/resolve.json`; measure the wrong-pin rate, abstentions and precision@1

## Acceptance
- [x] For every 14 Nov miss, the right product is among the candidates (real catalogue)
- [x] Chooser: a pick outside the list counts as none; a malformed answer keeps the resolver's pick
- [ ] `revise_menu` pin → new revision; the earlier pins are unchanged; the review is cleared
- [ ] `pnpm gate` green; fixture mode works

## Needs (to the lead)
- **Contracts:**
  - `toolSchemas.revise_menu` (input `{ kitchenId, proposalId, revision, changes[], reasoning? }`; output `{ proposal, issues, meta }`), registered in `tools/handlers.ts` and on MCP (via da);
  - `EventBrief.hints?: { ingredient: string; productId: string }[]`.
- **Resolver (catalogue adapter owner), for later:** the chooser covers these on the model path, but on the fixture path the resolver's own pick is still wrong:
  - `sipuli` pins "Sipuli Jauhettu" (ground onion) instead of a whole onion;
  - `chipotle` pins chilli powder, and `chipotle adobo` is rejected even though "Del Sol Chipotle jalapeno adobo kastikkeessa" exists;
  - `keltasipuli` misses "SIPULI 10KG SÄKKI";
  - `kylkirivi` misses ribs.
- **Persistence:** pins are remembered in process for now. Persisting them needs a `MenuStore` method or a small table (port: lead).

## Report
-
- 14 Nov ~19:30 · done: candidate pool + chooser, kitchen pins (in process), course clean-up · stubbed: pins not persisted yet (lead: inside the revision via MenuStore.recent) · needs: contract (A) after 8d's D16/D18 · checks: `gate --only check,lint` GREEN; menu, briefs, adversarial-r10, chat and evals/menu tests green · ready to merge: yes (1cdba49, ed0bc1a + this brief)
