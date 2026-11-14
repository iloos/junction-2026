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
1. **Rebase on batch 2** (E's ChatDock task-per-plan + "Earlier conversation", D ProductToken, 8d D16/D18, da PairDevice, c3 pickers, U UsualOrder): keep E's ChatDock changes alongside the rail fold (`railFolded` effect, `unfoldTimer`, region `max-h-[35%]`). Owner 1f, waiting on the lead's push.
2. **ProductToken** (`lib/ui/ProductToken.svelte`, D) on Kitchen rows, the grouped "still not covered" chips and the decision cards' line lists; `qtyText()` from `product-card.ts` for the same text elsewhere. Owner 1f, after 1.
3. **K7/K8:** a "Valio suggests" slot on the decision card, with the comparison inside Compare, read from 8d's `Line.unmet[] {requirement, from, verdict, fact}`; diet marks via core `meets()` (D16) replacing `diet.ts`'s own codes. A name claim that conflicts with a declared allergen shows the conflict, not green codes. Owner 1f.
4. **Nothing-planned state, Basket tab, Pair a phone, dock prefill (`Shell.chatDraft`)**: c3 owns these (boundary agreed: c3 wraps only the started `<main>` content and doesn't touch `markLines`/`showApproved`/row classes). UsualOrder's "Dropped out" needs `readableName` (U or c3).
5. Older, still open: SUBSET_APPROVE flip when core splits `approve{lineIds}` (8d); the `get_plan.lastVoided` diff; `planHistory` capped per plan.

## Traps
- `approve{lineIds}` is in the contract but `core/services/orders.ts` `approve` grants the whole approval: never send a subset grant while `SUBSET_APPROVE` is false (checked on a dev server: "approve 7" granted 14).
- Store state is a Svelte proxy: key side tables by line id, not by object (`fixture-view.ts` `borrowed`).
- Offline needs and lines have their own ids; core's fixture is matched by the originally planned product, and its coverage does not move with an offline grams edit (labelled).
- Ops counts "held" as held + unorderable; the kitchen header separates "need your approval" and "can't be ordered". Same plan, different questions.
- Dev server shares one PGlite workspace across browser contexts: reset before a scripted flow.
- The rail's Decide is the page's own `decidePanel` snippet rendered by ChatDock through `shell.railHeader`. Any tab or `{#if}` around KitchenScreen's content must leave the snippets and the `inRail` effect mounted (agreed with c3).
- Folding on composer focus moves content: anything that unfolds on blur has to wait for the click to land (ChatDock's 300 ms `unfoldTimer`).
- e2e configs in `scratch/pw*.config.ts` default to :4173; export `KITCHEN_URL=http://localhost:5178` first.
- The lead runs the full gate; lanes run `pnpm gate --only check,lint` plus targeted vitest and their own e2e (rule from Sat 19:00).


## Self-review (Sat 14 Nov, evening checkpoint)
- **Done since Ring 4 (all on main unless noted):** adaptive Kitchen titles by plan origin (ac2899e); PlanEvents with one SSE per tab, `follow(workspace)`, resync/newRun, tab/dock/agent/outside attribution and e2e `dock-sync` (5 tests); the phone sheet (definite height, keyboard lift, folds while composing); C1–C5 carry-over (7f98f20: "Valio hasn't said", "If you say no:", the header's order button, a one-line deadline at 390, the mandate clamp). **Open on the lane: ecf30db, the rail rework:** one row per decision with an accordion, the region capped at 35%, folding while typing or during a turn, the decision↔lines highlight (band + dim, scroll on open, "See the lines"), one-choice actions ("Review N lines · €X" / hold, then "Keep held", "See the lines"), an "Approved" row mark plus flash, and a one-line rail result. Measured at 1440×820 with 3 decisions: history 65% collapsed, 50% with one open, 78% typing.
- **Fragile:** the highlight finds rows by `need-<dishId>` and `lineIds`, so dishes without lines (outages) can't be marked. `approve()` matches the decision by joined lineIds. `approvedNow` is page-local, so an approval from the dock's D13 block shows the flash but not the "Approved" chip. `planHistory`/`contentionRescue` as before.
- **Untested:** the rail rework on prod; a keyboard-only pass through the accordion (focus marks rows, but there's no Escape-to-close); the rail at RAIL.min 320 px with a long title (truncates, untested at sign-off).

## Resume (Sat 14 Nov, evening checkpoint)
- **Branch** `lane/c2-ui`; head = this brief commit, on top of ecf30db (the rail rework). Everything before it is on main. Dev: `DATABASE_URL= LLM_PROVIDER=fixture pnpm dev --port 5178 --strictPort` (the worktree `.env` is PROD; never preview with it).
- **First:** `git fetch && git rebase main` once the lead pushes batch 2; resolve ChatDock by keeping E's task-per-plan code and my fold code; then `pnpm gate --only check,lint`, `pnpm exec vitest run src/lib/ui src/lib/kitchen`, and with `KITCHEN_URL=http://localhost:5178` the e2e configs `scratch/pw.config.ts` (kitchen-order), `pw-dock` (dock-approve), `pw-sync` (dock-sync); then `node scratch/rail.mjs 1440 820` and `node scratch/page.mjs` (reset the sandbox first: `curl -X POST localhost:5178/api/demo/sandbox/reset`). Send the head to the lead (junc26-fd).
- **Then:** Open 2 (ProductToken), Open 3 (K7/K8).
- **Test contract with 91 (journeys/kitchen-order):** `#task-h`; exactly one region "Decide"; "Show details: <dish>", "Why this line", "Order the N lines you can now", /^Review \d+ lines?/, "Confirm exact terms", "Hold to sign off N lines"; the header button "Order N lines now · €X".
- **Scripts** (`scratch/`): `rail.mjs` (rail split, highlight, fold, approve), `page.mjs` ("See the lines" at 1440/390, phone sheet), `carry.mjs` (C1–C5), plus the older `aff.mjs`, `rows.mjs`, `wow.mjs`, `origins.mjs`. Screens are in `scratch/aff/`.
