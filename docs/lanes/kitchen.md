# Lane: kitchen

**Branch:** `lane/kitchen` · **Worktree:** `../junc26-lanes/kitchen` · **Dev port:** 5173 · **Owner:** kitchen lane agent

## Goal (one sentence, user-visible)
The chef's side of the PITCH.md table demo: the Christmas buffet for 140 as a diff against a normal week, editable g/guest → need → lots, ranked rescue with a visible rejection, approval bound to exact terms, idempotent commit, a Why drawer per line, and "Same shortage. Your rules."

## Context to read first (≤4 files)
- docs/PITCH.md (table demo beats and labels: the acceptance test)
- docs/foundations/ux.md §0–§3
- src/lib/core/contracts/{plan,tools}.ts
- fixtures/seeds/christmas-buffet-140.json (`rescue` section)

## Owned paths
- `src/routes/(kitchen)/**`, root `src/routes/+layout.svelte` and `layout.css`
- `src/lib/ui/**`, `src/lib/kitchen/**`, `docs/lanes/kitchen.md`

## Contracts used (read-only)
- Tool registry (`plan_event`, `get_plan`, `edit_line` with `needId`, `find_substitutes`, `explain_line`, `approve`, `commit_order`, `set_mandate`) through `src/lib/kitchen/api.ts`; fixture mode runs the same tools in the browser (`fixture-server.ts` over the pure `fixture-plan.ts`).

## Tasks
- [x] Pure fixture builder from the seed: contract `Plan` + view data, unit-tested against the seed's hand-checked numbers
- [x] Fixture tool server: versions, approvals bound to version + terms hash + mandate version, void on change, partial commits, idempotent retry, `Receipt.awaitingSupplier`
- [x] Kitchen page: label bar, mandate words, week diff + budget meter, dish table with g/guest stepper, state chips, rescue panels (ranked product / make in house / stated shortfall with "serve N g instead")
- [x] Approval card (what it is bound to, hold to approve), commit, deliberate retry → same receipt, activity log
- [x] Rules: kitchen default / price first / Finnish required, kitchen switcher, simulator contention toggle
- [x] Why drawer per line via `explain_line`, sources labelled (Valio cached / scenario / team estimate / chef / your mandate)
- [x] Phone layout (390 px) with a sticky "N lines need you" bar

## Acceptance
- [x] `pnpm check`, `pnpm lint` green; `src/lib/kitchen/fixture-plan.test.ts` passes
- [x] `/` on :5173 shows the journey; screenshots in `scratch/shots/`
- [x] Works offline (fixture mode is the default)

## Needs (requests to the lead)
1. **`plan_event` / `get_plan` need dish-level data**, or the live flip loses the table: per need, `{ dish, gPerGuest, gDefault, guests, yield, formula }`, plus a normal-week baseline (`usualQty` per product, normal-week total and line count). Proposal: add optional `Need.dish = { gPerGuest, gDefault, guests, yield }` to `plan.ts` and a `baseline` field on the `plan_event` output.
2. **`find_substitutes` should return the ranked `candidates`** that `ProposeSubstitute` already carries (rank, score, rejectedReasons, fromValioRule) plus `kind`, `labourNote` and residual. Today the output is `{ plan, chosen }` only, so the UI can't show the visible rejection from the real API.
3. **Product names on lines** (`Line.productName` or a `products` map in `get_plan`): the table needs them and there is no batch lookup by id in the registry (`search_products` is text search).
4. **Rule presets as a contract**: "Same shortage. Your rules." switches weights *and* origin rules and never-delegate items; `set_mandate` takes caps and weights only. Proposal: `set_mandate.input.originRules` + `neverDelegate`, or a `preset` id. Until then presets are fixture-only (`fixture-server.setPreset`).
5. **Scenario/simulator controls** (contention on 476768, week spent so far, simulated clock) need a server route when the simulator lane lands; fixture-only today.
6. **`explain_line` steps** would benefit from an optional `detail` string (the drawer shows yield notes and caveats there).
7. **Fonts**: IBM Plex Sans/Mono load from Google Fonts in the root layout; for an offline demo, approve `@fontsource/ibm-plex-sans` + `@fontsource/ibm-plex-mono` (woff2 files for the 5 weights used) so they ship in the container.
8. `static/favicon.ico` is missing (404 in the console); the SVG favicon works.

## Report
- Sat 01:50 · done: full table-demo journey on fixture tools (diff, g/guest edit with rounding, chips incl. out vs undeliverable vs unknown, ham/lanttu/torttu rescues, approval bound to v+hash+mandate, void on edit, commit, retry → same receipt, Why drawer, presets + contention, phone layout) · stubbed: all tools run in-browser (`VITE_KITCHEN_API=live` flips to `POST /api/tools/<name>`), presets/contention/kitchen switch are fixture-only · needs: 1–8 above · ready to merge: yes (no shared files touched besides the root layout/CSS this lane owns)
- Sat 03:10 · done: live R0-b fixes (serialized helper, scenario clock, real reset via resetDemoRun, no fixture overwrite); triage #2 (allowlisted tool bridge on the session's own plan, write-free snapshot GET with explicit `start`, per-cookie selection, ws-judges unless presenterOpen, regression test + 60 s Playwright idle check); #3 (live failure keeps last state read-only with retry; /offline is a separate labelled basket); #5 review card (consequences first, changed fields highlighted, expiry from timestamp, audit detail folded); #6 (Review → Confirm exact terms click path, hold cancels on blur, stepper pending/locked, native radio presets, phone candidate cards, Valio label from offer provenance); #4 render from `Line.view`; Apply these rules (preview vs saved); Ops deep link; d3 ranking strip and cut-off timeline; top nav · needs: ranking still lets Terminal/unknown-qty items rank #1 and be applied (price-first picks 462569); every planned SKU is `new_sku`, so nothing is within mandate; contention overlay is run-wide, not per session · ready to merge: yes

## Handoff (Sat 14 Nov)

**Owned paths and branch.** `lane/kitchen` in `../junc26-lanes/kitchen` (dev port 5173). Paths: `src/routes/(kitchen)/**` (incl. `kitchen-api/{tool/[name],snapshot,scenario}`, `offline/`), root `src/routes/+layout.svelte` (top nav, fonts) and `layout.css` (tokens), `src/lib/ui/**` (chips, Why drawer, stepper, hold button, `viz/RankingStrip`, `viz/CutoffTimeline`), `src/lib/kitchen/**`, `src/lib/server/kitchen/**`. Everything is merged to main up to 3aa692f plus this section.

**State.** Live by default: the browser calls `/kitchen-api/*`, which acts as the chef server-side on the session's own plan. Journey verified on a prod build (PGlite): plan (two steps with real progress) → g/guest edit → preview a preset → Apply → voided approval with the changed lines highlighted → Review → Confirm exact terms → Place order → resend gives the same receipt. `/offline` is the explicit browser-fixture demo. Tests: `src/lib/kitchen/fixture-plan.test.ts` (7), `src/lib/server/kitchen/live.test.ts` (snapshot writes nothing), `src/routes/(kitchen)/kitchen-idle.e2e.ts` (60 s, no ops). Screenshots: `scratch/r4`, `r5`, `r6` (gitignored, local only).

**Non-obvious knowledge.**
- Snapshot GET must stay a read: it finds the plan via `store.load` (never `plan_event`) and always passes weights to `find_substitutes`, so it is a preview. Planning happens only in `scenario('start' | 'plan' + 'rescue')`. A violation once wrote 996 ops in 100 s.
- Every scenario command answers with the snapshot; the store uses that answer instead of a GET (`#run` in `kitchen.svelte.ts`). Fixture commands answer `null`, so the store reads the fixture snapshot.
- `live.ts` serializes all kitchen calls through one promise queue (`serial`), so a snapshot's several tool calls see one plan version.
- Sessions: cookie `kitchen_sid` → `{workspaceId, kitchenId, preset, contention}` in a module Map. The workspace comes from `kitchenWorkspace()`: `presenterOpen` gives ws-demo, otherwise ws-judges; `KITCHEN_WORKSPACE` overrides.
- The approval shown is the one `get_plan` names, with its state; the store re-reads up to 3× if a fresh grant still reads pending (the P1 #4 hardening).
- The voided-approval diff is client-side (`#seen` in the store): only terms this tab saw.
- Chips and committable come from `Line.view`; the reason-based fallback exists only for fixture lines.
- Sandbox reset: ws-judges goes through `resetSandbox()`, whose 429 is shown as a wait; ws-demo goes through `resetDemoRun`.
- `NORMAL_WEEK` (€3,120 / 46 lines) in `fixture-plan.ts` is a team estimate also used by `live-view.ts`.

**Open threads (next steps).** Track C per SYNTHESIS:
- F13 per-reason approval (needs core's `approve{lineIds}` or one UI confirm per group);
- F14 unit bases: `live-view.ts` candidate `coverValue = line.qty.value` treats ST as kg; use `FulfilmentView`;
- coverage bar from `FulfilmentView`;
- Why drawer as a chain;
- demand → packs overshoot view.

Kitchen must follow G's per-visitor workspace (replace `kitchenWorkspace()`).

**Traps.**
- Never call a writing tool from `buildSnapshot`.
- Never auto-fallback to the fixture: a live error keeps the last state read-only.
- d3 needs the explicit `import 'd3-transition'` (prod builds drop the side effect).
- Import from `d3`, not the sub-packages (pnpm strict).
- `pnpm i` after merges that touch package.json.
- Python heredocs with `''` inside bash fail; write patch scripts to `scratch/` instead.
- The old dev server keeps running after a code loop bug: kill port 5173 before restarting.

**How to resume.**
```powershell
cd ..\junc26-lanes\kitchen; git merge main; pnpm i
$env:DATABASE_URL=''; pnpm dev --port 5173 --strictPort        # dev on PGlite
$env:DATABASE_URL=''; pnpm build; $env:PORT='5173'; $env:ORIGIN='http://localhost:5173'; node build   # prod build (ws-judges)
npx vitest run --project server src/lib/kitchen src/lib/server/kitchen
$env:KITCHEN_URL='http://localhost:5173'; npx playwright test --config scratch/pw.config.ts   # idle check
```
Playwright scripts use the local Chromium at `%LOCALAPPDATA%\ms-playwright\chromium-1248\chrome-win64\chrome.exe` (the headless shell 1254 isn't installed).

**Only I know.**
- Finnish-required picks the same palvikinkku already in the order (nothing to apply); Price first is the preset that changes the pick (to Terminal 462569, see F5).
- The fit score currently reads "fit 2/4 · rule estimate, model unavailable" (Gemini out of credits).
