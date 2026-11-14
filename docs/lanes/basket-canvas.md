# Basket canvas

Mode: Operate. User-authorized optional view of an existing purchasing plan, inspired only by the interaction pattern of the local roadmap reference. All implementation is original to Mandate.

## Ownership

- Branch `lane/basket-canvas`, worktree `scratch/worktrees/basket-canvas`, port 5198.
- Own `src/routes/canvas/**`, `src/lib/canvas/**`, this brief.
- Base `09216c39e2482e7d312ffd84e08a98ec203cdf56` (rebased on local main).
- Contracts blob `f8b00944f8ca95804617d678c1a3b374ccfbad65`; schema blob `8e9534b208e3de328e68016c2e9bf1cccafb3cf2`. No schema/seed changes.
- Do not edit Kitchen, shell, conversation, tools, core contracts, global CSS, dependencies or shared design docs.

## Context

CLAUDE.md, docs/design/DESIGN.md, existing KitchenStore, snapshot/view model, plan events, tool contracts and shared decision components. The Kitchen and conversation lanes remain authoritative for their existing surfaces.

## Slice and acceptance

- `/canvas?plan=…` reads the actual snapshot; no implicit planning and no live-error fixture fallback.
- Stable need/line identities, recipe grouping only where lineage supports it; no invented recipe relationships.
- Expand/collapse, ingredient selection, search and diet/state filtering, current purchases and replacement comparison.
- Changes use existing scoped/versioned tools and existing approval flow; no separate canvas business state.
- Agent dock receives plan context and selected ingredient question; external changes refresh the same selected need.
- The inspector browses alternatives and applies the server's sized recommendation through the existing scoped tool gate. It also opens unsent, plan-scoped replacement or comparison requests in the agent dock. The browser does not guess pack quantities for unchosen alternatives.
- Existing exact-terms decision cards approve their complete reason group. Final ordering opens the same plan in Kitchen.
- Phone outline, keyboard controls, readable empty/loading/error/read-only states.
- Targeted projection and UI tests; fixture-only local server, desktop and phone screenshots; check/lint gate.

## Needs

- Lead may link `/canvas?plan=…` from the Kitchen task menu after reviewing this optional route. Shared navigation is intentionally unedited.
- Candidate quantities and comparison-price units for unchosen alternatives remain a server seam. The canvas applies the sized recommendation; individual options open agent comparisons, and numeric unit prices appear only where their unit is explicit.
- A future typed presentation channel could let agents focus/filter the canvas directly. This slice shares domain state and event updates; it does not extend agent contracts or persist layout.
- Broad establishment/event/menu graph editing, arbitrary edges, shared camera/layout and graph persistence remain separate work.

## Architecture boundary

The plan snapshot is the only purchasing state. The pure projection groups explicit menu lineage and connects need IDs to actual line IDs; retired sources remain visible without contributing invented totals. Selection, search, collapse and density stay in the view. Domain changes carry the current rendered run/plan/version through existing commands; event bursts wait during commands and refresh the pinned plan afterwards.

The next agent presentation seam should accept a plan-scoped focus/reveal/filter intent separately from purchasing tools. It should reject missing need IDs and stale plan identities, and preserve a chef's newer manual selection over a late agent response. It needs no graph database or new business mutation path. The current dock can locate existing decisions and ask about a selected ingredient, while domain changes flow back through the shared event stream.

## Report

- Implemented: real-plan canvas, recipe lineage groups, selection and URL focus, search/diet/state filters, current and replaced purchases, scoped recommendation application, exact-terms decision cards, agent drafts and decision navigation, queued event refresh, mobile outline/details with focus return. Read-only loading never plans; missing-plan links never expose another actionable basket. Lost mutation responses refresh the plan without assuming failure or resending.
- Validated: 12 pure projection tests; seven browser integration tests as a suite plus the lost-response test separately. Browser checks exercised real local fixture APIs, replacement/no-op semantics, exact approval version/hash without ordering, external edits preserving plan/selection, and keyboard/390 px overflow. Desktop, phone and lost-response screenshots visually inspected in `scratch/canvas-*.png`. No production database, external models or secrets used.
- Reproduce: `pnpm exec vitest run --project server src/lib/canvas/model.test.ts`; `pnpm exec playwright test src/routes/canvas/canvas.e2e.ts` uses the root fixture preview on 4173. This worktree used a local server on 5198 with `KITCHEN_URL` and ignored `scratch/pw-canvas.config.ts`.
- 15 Nov 00:26 EET · done: scoped canvas and failure-path hardening · stubbed: none in this slice · needs: optional Kitchen entry link, future typed agent presentation channel · ready to merge: yes. `pnpm gate --only check,lint` GREEN (zero Svelte errors/warnings); no dependencies, contracts, schema or shared surface files changed by this lane.
