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
- [x] New `editMenu` change kinds: `pin { ingredientId, productId }` and `addIngredient { dishId, label, query, amountPerCover, unit }`, with `by` on the revision; a pin is remembered for the kitchen
- [x] `revise_menu` handler (`menu/tool.ts`): scope `plan`, kitchen check, STALE_VERSION. The agent can use amount, pin, unresolve, addIngredient, removeIngredient and removeDish, never keepOpen (input schema local until (A))
- [ ] (A) Contract commit, on main after the lead's push: `toolSchemas.revise_menu` (the local schema moved), `MenuChange` as zod, `DishIngredient.pinnedBy`, `EventBrief.hints`, `MenuStore.recent(workspaceId, kitchenId, limit)`, and revise_menu in the server-served list in `core/services/handlers.ts`
- [ ] Pins persisted: `pinnedBy` written on pin, read back through `recent()` (both store adapters), replacing the in-process map
- [ ] (B) Wiring: `tools/handlers.ts`, `stub-handlers.ts`, `trial-harness.ts`, the `mcp.ts` title (da's and the lead's paths, as a separate commit)
- [ ] Eval `evals/menu/dinner-replay*`: the 14 Nov brief, pin the ribs, and the other products stay
- [ ] Held-out split of `evals/retrieval/resolve.json`; measure the wrong-pin rate, abstentions and precision@1

## Acceptance
- [x] For every 14 Nov miss, the right product is among the candidates (real catalogue)
- [x] Chooser: a pick outside the list counts as none; a malformed answer keeps the resolver's pick
- [x] `revise_menu` pin → new revision; the earlier pins are unchanged; the review is cleared (`revise.test.ts`)
- [x] Fixture mode unchanged; `gate --only check,lint` green (the full gate is the lead's, from Sat 19:00)
- [ ] Over MCP: propose → revise_menu pin → reviewUrl → accept → plan_event (after (B))

## Needs (to the lead)
- **Contracts:**
  - `toolSchemas.revise_menu` (input `{ kitchenId, proposalId, revision, changes[], reasoning? }`; output `{ proposal, issues, meta }`), registered in `tools/handlers.ts` and on MCP (via da);
  - `EventBrief.hints?: { ingredient: string; productId: string }[]`.
- **Resolver (catalogue adapter owner), for later:** the chooser covers these on the model path, but on the fixture path the resolver's own pick is still wrong:
  - `sipuli` pins "Sipuli Jauhettu" (ground onion) instead of a whole onion;
  - `chipotle` pins chilli powder, and `chipotle adobo` is rejected even though "Del Sol Chipotle jalapeno adobo kastikkeessa" exists;
  - `keltasipuli` misses "SIPULI 10KG SÄKKI";
  - `kylkirivi` misses ribs.
- **Persistence:** decided by the lead: inside the menu revision (`pinnedBy` on the ingredient), read through `MenuStore.recent`; no new table.

## Report
- 14 Nov ~19:30 · done: candidate pool + chooser, kitchen pins (in process), course clean-up · stubbed: pins not persisted yet (lead: inside the revision via MenuStore.recent) · needs: contract (A) after 8d's D16/D18 · checks: `gate --only check,lint` GREEN; menu, briefs, adversarial-r10, chat and evals/menu tests green · ready to merge: yes (1cdba49, ed0bc1a + this brief)
- 14 Nov ~20:30 · done: editMenu pin/addIngredient with `by` and reasoning, the revise_menu handler (local schema) · needs: (A) once the lead pushes the batch with 8d's 362edd4 · checks: server/menu 56 passed · merged: 212daa7 in the lead's batch

## Checkpoint (14 Nov, ~20:30)
**Done (in the lead's batch at 212daa7):**
- Menu ingredients are matched by **find then choose**:
  - candidates are the resolver's answers for the query, the model's `alt` words and a bracketed trade name, plus its nearest products;
  - one model call per menu picks from them, restricted to the candidate ids; its concerns become open items;
  - the fixture path is unchanged.
- No word lists: they were tried and removed for overfitting.
- Kitchen pins and choices are remembered, in process; a person's pin beats a model's choice.
- Sides become mains while the requested courses are short.
- editMenu has `pin` and `addIngredient`, with `by` and the changer's reasoning.
- The `revise_menu` handler.

**Open:**
1. (A) the contract diff on main;
2. pins persisted through `recent()`;
3. (B) wiring;
4. the dinner-replay eval;
5. a held-out split of the resolve eval, with the wrong-pin rate.

**Risks:**
- **Pins are in process until (2).** A restart or a second container forgets them; the fixture path never relied on them.
- **The chooser adds one model call per menu (~1–2 s) and isn't traced separately.** It goes through the menu's Llm port, so it's capped and traced like the proposal call. Check that the trace drawer shows it as its own step.
- **The chooser's quality is unmeasured on live Gemini.** Tests use a stub; the dinner replay with `LLM_PROVIDER=gemini` is the first real measure.
- **On the fixture path the resolver still has the wrong picks listed under Needs** (sipuli → ground onion, chipotle → powder).
- **Hybrid search is held (D19).** Coverage beyond the resolver's nearest depends on the model's `alt` words.

## Resume
- **Branch:** `lane/menu-v2` · **Worktree:** `../junc26-lanes/menu-v2` (`.env` and `data/valio/` copied; `DATABASE_URL=` blank for every run) · **Head:** this commit
- **Checks:** `pnpm gate --only check,lint`, then `DATABASE_URL= pnpm vitest run --project server src/lib/server/menu/` (plus `evals/menu`, `src/lib/server/evals/briefs.test.ts`, `src/lib/server/evals/adversarial-r10.test.ts`). No full gate in lanes.
- **Next 3:**
  1. After the lead pushes: `git fetch && git rebase origin/main`. Write (A) as one commit touching only `core/contracts/{event,tools}.ts`, `core/ports.ts` and `core/services/handlers.ts`; move `ReviseMenuInput` from `menu/tool.ts` into `toolSchemas.revise_menu` and carry the D16 `dietCodes` through untouched. Send the SHA.
  2. Pins persisted: write `pinnedBy` on pin in editMenu; implement `recent()` in `menu/store.ts` and `menu/pg.ts`; make `pinnedFor` read it; delete the in-process map (keep `clearPins` out of the API).
  3. (B) wiring, then the dinner replay `evals/menu/dinner-replay.test.ts`: the 14 Nov brief through a scripted model, pin the ribs (462201) by revise_menu, the other products unchanged, accept, plan_event, and the held lines carry the reasons.
