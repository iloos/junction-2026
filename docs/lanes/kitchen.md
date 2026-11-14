# Lane: kitchen (Track C: the chef's workbench and self-explanation)

## Dispatch
- **Track:** C (docs/DISPATCH.md). **Owner:** session 1f. **Branch:** `lane/c-kitchen` · **Worktree:** `../junc26-lanes/kitchen` · **Dev port:** 5178 (5173 is taken on this machine).
- **Owned paths:** `src/routes/(kitchen)/**`, `src/lib/kitchen/**`, `src/lib/ui/**` (shared components: tell the request lane when one it uses changes).
- **Reads (never edits):** `get_plan` with `Plan.view` (PlanView, FulfilmentView) and `lines[].view` (LineView) from core; `src/lib/server/kitchen/live.ts` (snapshot assembly) and `src/lib/server/demo/visitor.ts` (9c).
- **Depends on:** 8d for `approve{lineIds}` splitting (contract only today) and `get_plan.lastVoided`; E for the in-app agent chat.
- **Acceptance:** `pnpm gate` green; Playwright screenshots at 1440 and 390 px in the worktree's `scratch/`, no console errors, live (`/`, PGlite: `DATABASE_URL= pnpm dev --port 5178`) and offline (`/offline`).

## State (main `0623b19` plus this branch)
- **Unit bases (F14), merged `7d1a3b5`:** each line shows what it buys and both prices (`13 ST ≈ 19.5 kg net`, `€15.43/ST · €10.29/kg`) from `LineView.physical/unitPrice/comparisonPrice`; no weight is guessed. `lib/ui/coverage.ts` `lineBasis`.
- **Coverage ruler, merged `7d1a3b5`:** one bar per need from `Plan.view.fulfilment`, most certain first up to a "needed" mark, excess hatched past it, D10 labels. `lib/ui/CoverageBar.svelte`, `CoverageLegend.svelte`, `coverage.ts`.
- **Why chain, `e053ad6`:** the Why drawer opens with the worked calculation (dish → g/guest → served → yield → replaced product → pack content → packs → covers by certainty → price → rule), each step with its source; make-in-house as an AND of ingredients. `lib/ui/why-chain.ts`, `WhyDrawer.svelte`.
- **Per-reason approval (F13), `88e0340`:** one decision card per reason group; a sign-off group needs a hold. `SUBSET_APPROVE=false` (`lib/kitchen/capabilities.ts`): the chef confirms each group on screen, then one grant of the exact terms is sent, worded as one decision. Includes 9c's F16 kitchen side (deep link `ws`/`run`, sandbox reset label).
- **Cleanup (this commit):** header counts on the panel's basis plus FulfilmentView gaps (F15); "Still not covered" from FulfilmentView; D10 copy ("known stock for the whole need", "planned, not reserved"); `/offline` labelled a stand-in.
- **Offline (`/offline`):** the browser engine (`fixture-plan.ts`, `fixture-server.ts`) plus core's recorded view borrowed from `fixtures/views/christmas-rescued.json` (`fixture-view.ts`, matched by originally planned product; pack facts only for lines, never states).

## Open (in order)
1. Flip `SUBSET_APPROVE` when core's `approve` splits on `lineIds` (8d), then per-group "Keep held" returns.
2. Before → after diff on a voided approval from `get_plan.lastVoided` (A2): replaces the client-side `TermChange` diff in `kitchen.svelte.ts`.
3. d3 views where they explain: demand → packs with overshoot, the coverage partition across dishes, the candidate funnel (17.5k → candidates → chosen).
4. "Find on the web" in the Why drawer: `lookup_facts` results with sources and live/cache/replay labels (Track D exposes typed evidence).
5. Retire the browser purchasing engine: `/offline` replays recorded core outputs; keep only rules/presets/`NORMAL_WEEK` (used by `server/kitchen/live.ts` and `store/baseline.test.ts`) in a small module.

## Traps
- `approve{lineIds}` is in the contract but `core/services/orders.ts` `approve` grants the whole approval: never send a subset grant while `SUBSET_APPROVE` is false (checked on a dev server: "approve 7" granted 14).
- Store state is a Svelte proxy: key side tables by line id, not by object (`fixture-view.ts` `borrowed`).
- Offline needs and lines have their own ids; core's fixture is matched by the originally planned product, and its coverage does not move with an offline grams edit (labelled).
- Ops counts "held" as held + unorderable; the kitchen header separates "need your approval" and "can't be ordered". Same plan, different questions.
- Dev server shares one PGlite workspace across browser contexts: reset before a scripted flow.

## Resume
`git -C ../junc26-lanes/kitchen rebase main` → `DATABASE_URL= LLM_PROVIDER=fixture pnpm dev --port 5178` → `node scratch/live.mjs http://localhost:5178/ scratch/x` (plans the event and screenshots both widths) and `node scratch/f13.mjs http://localhost:5178/ scratch/y 1440` (approval flow).
