# Lane: kitchen (Track C: the chef's workbench and self-explanation)

## Dispatch
- **Track:** C (docs/DISPATCH.md). **Owner:** session 1f. **Branch:** `lane/c2-ui` (was `lane/c-kitchen`) · **Worktree:** `../junc26-lanes/kitchen` · **Dev port:** 5178 (5173 is taken on this machine).
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

## Resume (Sat 14 Nov, before compaction)
- **Branch** `lane/c2-ui` (pushed), head `99c965d`, on main `70c30e2`. Dev: `DATABASE_URL= LLM_PROVIDER=fixture pnpm dev --port 5178 --strictPort` (worktree `.env` points at PROD: never run dev/preview without the blank URL; copying `.env` and preview builds with it are denied).
- **Merged:** Ring 2 shell + tokens (`eac4551`), shared components (DecisionCard, TaskHeader, LineRow, StrategyCard, Receipt, SourceChip, CoverageRuler, RescueCompare), Decide/Plan/Order zones, BUGS #1 #4 #5 #6 #9 + shortfall attribution + voided banner; e2e `evals/ui/kitchen-order.e2e.ts` KNOWN empty.
- **On branch, not merged:** `5127d26` global agent dock (shell "Agent" button on every page, `useShell().chat` scope: Kitchen plan, /request plan; `/agents/chat` → `/?chat=1`; "Agent API" nav); `99c965d` linked plan named on every read/command (no reliance on one process's session).
- **Next, in order:** (1) BUG-1 local-build regression: lead saw `snapshot?plan` 404 on a main preview build; fresh dev and a no-.env preview of main both pass here, branch passes 3/3; needs the lead's repro on `99c965d`. (2) Land the global dock (Ops sets `useShell().chat.planId` for the selected case: 9c). (3) Wave 1 of `docs/handoff/ui-mockset-to-prod.md`: #1 per-dish status sentence (ruler into Why), #2 chat turn from the five events, #8 "What changed" strip; acceptance criteria are in that file. Layout A vs B is the user's call: don't restructure.
- **Traps:** checking out other commits under a running dev server kills Vite and fakes failures; Git Bash rewrites `/path` args (use `MSYS_NO_PATHCONV=1`); the sandbox reset has a cooldown (retry); scripts in `scratch/` (`s1c.mjs` flow, `b-link.mjs` link, `b-stale.mjs`, `agent.mjs`, `pw1.config.ts` e2e vs dev).
