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

## Self-review (Ring 4 checkpoint, Sat 14 Nov evening)
- **Solid:** compact dish rows (one line, fixed columns, one DishChip; detail on expand), the D10 dish sentence and "kg served", What changed (planDiff from two snapshots), one deadline rule (decisionsDue over the lines' cut-offs), D13 dock approval through the Kitchen command (e2e `dock-approve`), per-store `x-kitchen-view`, adaptive titles by plan origin (CreatePlan op), the contention wow sentence. Unit tests on coverage, decisions, plan-diff, turn-view, format, words.
- **Fragile:** `planHistory` reads the whole run's op log per snapshot (catchUp, 5000 cap): fine for a sandbox, slow on a long stage run. `contentionRescue` lives in the in-memory session (lost on another instance). `rowOf` picks "the" product per dish heuristically (substitute first). `readableName` is a casing heuristic until `nameShort` is filled on prod.
- **Untested:** none of this on a production preview (lane `.env` blocks it); the calendar link only against d55da2d's shape; the dock's own KitchenStore on a phone after a reload; no-raw-ids is red from 9c/E//agents hits, not mine.
- **With one hour before 06:00:** run kitchen-order + dock-approve + no-raw-ids on the deployed prod; cap `planHistory` to the plan's ops (filter by planId in SQL) or cache per plan version; make the dock's "Decide here" survive a dock close/reopen; check the compact row at 390 with the phone tab bar and the Decide zone after D13.

## Resume (Sat 14 Nov, Ring 4 checkpoint)
- **Branch** `lane/c2-ui`, head see `git log -1` (pushed with this block); the first 8 commits since Ring 3 are on main under other SHAs, 5 are new: compact rows, dock continue only on canContinue, decision cards one-line, adaptive titles by origin, calendar subscribe link. Dev: `DATABASE_URL= LLM_PROVIDER=fixture pnpm dev --port 5178 --strictPort` (worktree `.env` = PROD; never preview with it).
- **Next, in order:** (1) rebase on the lead's next main push (E menu events + canContinue, da's chat-sources li in ChatDock: keep it, as SourceChips; 9c calendar), resolve on my side, gate subset + `kitchen-order`, `dock-approve`, `no-raw-ids` e2e, send head. (2) E's `menu` ChatEvent card in the dock (title, guests/date, first 4 dishes, € estimate, unresolved count, "Review the menu" → reviewUrl, "Reviewed ✓"). (3) Letter badges only on the user's yes.
- **Scripts** (`scratch/`, against dev): `aff.mjs` before/after 1440/390, `rows.mjs` row heights, `wow.mjs` contention, `dockapprove.mjs`, `origins.mjs` four plan origins, `partial.mjs`, `pw*.config.ts` e2e vs dev. Screens in `scratch/aff/`.
- **Traps:** rebasing or checking out under the running dev server can fake failures (restart if odd); Git Bash rewrites `/path` args (`MSYS_NO_PATHCONV=1`); the gate waits for other lanes' locks (run it in the background); /request never reaches networkidle (use domcontentloaded + a wait); the shell's Agent button needs hydration before a click works.
