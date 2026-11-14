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
