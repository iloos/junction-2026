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
- [x] Sides become mains while the requested courses are short
- [x] `editMenu`: `pin` and `addIngredient`, with `by` and the changer's reasoning; a chef or agent turning a product down stops its reuse
- [x] `revise_menu` handler (`menu/tool.ts`; input schema local until da's contract)
- [x] Pins persisted inside menu revisions: `DishIngredient.pinnedBy`, `MenuStore.recent` on both adapters, `kitchenPins`; `EventBrief.hints`
- [ ] Dinner-replay eval (see Next)
- [ ] Held-out split of `evals/retrieval/resolve.json` with the wrong-pin rate

## Acceptance
- [x] For every 14 Nov miss, the right product is among the candidates (real catalogue)
- [x] Chooser: a pick outside the list counts as none; a malformed answer keeps the resolver's pick
- [x] `revise_menu` pin → new revision; the other products unchanged; the review cleared; marked `pinnedBy: agent`
- [x] A pin is used first by the kitchen's next proposal, across store instances (`recent()`), and not by another kitchen
- [ ] Over MCP: propose → revise_menu pin → reviewUrl → accept → plan_event (da's R12-08 e2e)

## Needs (to the lead)
- **Contract 49e6514** (`pinnedBy`, `EventBrief.hints`, `MenuStore.recent`): land it with 906cdbe, which implements `recent()`. The contract alone doesn't compile.
- **revise_menu contract and wiring:** da, under R12-08. menu/tool.ts then imports the schema from core. Agreed shape: amount 0–2000, ids ≤64, `ProductId`, trimmed label/query, no keepOpen.
- **Resolver (catalogue adapter owner), for later:** on the fixture path the resolver's own pick is still wrong for `sipuli` (ground onion), `chipotle` (chilli powder; `chipotle adobo` is rejected though Del Sol's exists), `keltasipuli` (misses the onion sack), `kylkirivi` (misses ribs). The chooser covers these with a model.

## Report
- 14 Nov ~19:30 · done: candidate pool + chooser, kitchen pins (in process), course clean-up · stubbed: pins not persisted yet (lead: inside the revision via MenuStore.recent) · needs: contract (A) after 8d's D16/D18 · checks: `gate --only check,lint` GREEN; menu, briefs, adversarial-r10, chat and evals/menu tests green · ready to merge: yes (1cdba49, ed0bc1a + this brief)
- 14 Nov ~20:30 · done: editMenu pin/addIngredient with `by` and reasoning, the revise_menu handler (local schema) · needs: (A) once the lead pushes the batch with 8d's 362edd4 · checks: server/menu 56 passed · merged: 212daa7 in the lead's batch

- 14 Nov late · done: pins persisted (49e6514 CONTRACT + 906cdbe) · split: revise_menu contract and wiring are da's (R12-08) · checks: check clean; menu, briefs, adversarial-r10, chat, evals/menu 139 passed; store recent() on both adapters · ready to merge: yes (49e6514 + 906cdbe together)

## Checkpoint for the lane restart (14 Nov, late)
**Done (branch `lane/menu-v2`, pushed):**
- 1cdba49, ed0bc1a: find then choose. Candidates are the resolver's answers for the query, the model's `alt` words and a bracketed trade name, plus its nearest products; one model call per menu picks from them, restricted to the ids; concerns become open items. Sides become mains while courses are short. No word lists. (Merged.)
- 212daa7: editMenu `pin` / `addIngredient` with `by` and reasoning; the `revise_menu` handler. (Merged.)
- bb5aae3: the first checkpoint. (Merged.)
- **49e6514 CONTRACT**: `DishIngredient.pinnedBy`, `EventBrief.hints`, `MenuStore.recent`. **Not merged.**
- **906cdbe**: pins persisted inside menu revisions, read through `recent()` (both adapters, tested), replacing the in-process map; a person's pin beats a model's pick, the newest of equals wins, a turned-down product stops being reused; brief hints remembered as the caller's pin. **Not merged.**

**In flight:** none. da owns the `revise_menu` contract, registry, MCP title, reviewUrl to the new revision and the MCP e2e (R12-08).

**Next, in priority order:**
1. **Merge 49e6514 + 906cdbe** (the lead), and rebase on da's revise_menu contract when it lands: `menu/tool.ts` imports `toolSchemas.revise_menu.input` instead of `ReviseMenuInput`.
   *Accept:* `pnpm check` green on main; `server/menu` tests green.
2. **Dinner-replay eval** `evals/menu/dinner-replay.test.ts`: the 14 Nov two-cuisine brief through a scripted model (menu JSON, then chooser picks), then `revise_menu` pins the ribs (462201), then accept, then `plan_event`.
   *Accept:* the other ingredients keep their products across the revision; the plan carries the dish diet codes (D16) through untouched; the held lines have reasons. A second run with `LLM_PROVIDER=gemini` is logged as the chooser's first live measure (not in the gate).
3. **Held-out resolve eval:** split `evals/retrieval/resolve.json` into tuning and held-out sets, and add non-Finnish cuisines.
   *Accept:* the wrong-pin rate, abstentions and precision@1 are reported per set; the gate fails if the wrong-pin rate rises.
4. **Chooser trace:** confirm the chooser call shows as its own step in the trace drawer (model, tokens, latency); name its purpose if it doesn't.
   *Accept:* screenshot of the trace drawer with both menu calls.
5. **The next ring merges menus into one "conversation" session with chat and request.** propose_menu, revise_menu and accept become steps of that one session. The chooser and kitchen pins stay as they are (server-side, tool-shaped), so the conversation calls the same handlers; only the UI entry moves. Don't build menu UI on `/request` meanwhile.

**Risks:**
- The chooser has only been tested with stubs. Its quality on live Gemini is unmeasured until Next 2.
- The chooser adds one model call per menu (~1–2 s).
- `recent()` reads the 20 latest menus per kitchen, and the PG adapter scans up to 160 rows. That's fine at demo scale; a busy kitchen would want an index on (workspace_id, kitchen_id, created_at).
- The contract 49e6514 alone doesn't type-check; merge it with 906cdbe.
- Hybrid search is held (D19). Coverage beyond the resolver's nearest depends on the model's `alt` words.

## Resume
- **Branch:** `lane/menu-v2` (pushed) · **Worktree:** `../junc26-lanes/menu-v2` (`.env` and `data/valio/` copied; run everything with `DATABASE_URL=` blank) · **Head:** this commit
- **Start:** use the `lane` skill with this brief. `git fetch && git rebase origin/main`, `pnpm i`.
- **Checks (no full gate in lanes):** `pnpm gate --only check,lint`; `DATABASE_URL= pnpm vitest run --project server src/lib/server/menu/ src/lib/server/evals/briefs.test.ts src/lib/server/evals/adversarial-r10.test.ts src/lib/server/chat evals/menu`.
- **Map:** `menu/resolve.ts` (candidate pool, kitchenPins) · `menu/choose.ts` (chooser) · `menu/proposal.ts` (propose: pins → resolver → pool → chooser) · `menu/flow.ts` (editMenu kinds, accept, plan) · `menu/tool.ts` (propose_menu, revise_menu handlers) · `menu/store.ts`, `menu/pg.ts` (`recent()`).
- **Then:** Next 1–5 above. Send SHAs to the lead.
