# Basket canvas

Mode: Operate. User-authorized optional view of an existing purchasing plan, inspired only by the interaction pattern of the local roadmap reference. All implementation is original to Mandate.

## Ownership

- Branch `lane/basket-canvas`, worktree `scratch/worktrees/basket-canvas`, port 5198.
- Own `src/routes/canvas/**`, `src/lib/canvas/**`, this brief and `docs/lanes/basket-canvas-graph.md`.
- Merged local main `ed20a829ac2aea2cc1062c4c1fe53ac3479c3cb4` into this branch with `26462bc`.
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
- Product rows share the cached `thumbFor` loader and deliberate ProductToken inspection. Fixed photo slots preserve layout and label exact, approximate, brand, absent and failed images: 64 px on ingredient cards, 96 px in the inspector and 48 px for alternatives. Ingredient selection and product inspection are separate controls.
- Desktop board and inspector share a viewport-aware height with independent scrolling; the inspector heading stays visible. Phone board and details use natural page flow.
- Phone outline, keyboard controls, readable empty/loading/error/read-only states.
- Targeted projection and UI tests; fixture-only local server, desktop and phone screenshots; check/lint gate.

## Needs

- Keep `/canvas?plan=…` unlinked until the lead explicitly authorizes navigation. Wave J is merging `c4a4981` as an optional route.
- Candidate quantities and comparison-price units for unchosen alternatives remain a server seam. The canvas applies the sized recommendation; individual options open agent comparisons, and numeric unit prices appear only where their unit is explicit.
- Main's `SwapPanel` sends a product-only `edit_line` patch, which retains the old sales quantity/unit. The core/UI owners must resolve authoritative resizing and strategy semantics before arbitrary candidate picking is reused here.
- The current thumbnail endpoint returns recorded photos or null. The shared photo owner can connect the richer cached `photosFor` ladder and promote the owned row's error handling/match labels into shared components. This lane does not silently trigger live image searches or Cloudinary processing.
- A future typed presentation channel could let agents focus/filter the canvas directly. This slice shares domain state and event updates; it does not extend agent contracts or persist layout.
- Broad establishment/event/menu graph editing, arbitrary edges, shared camera/layout and graph persistence remain separate work.

## Next: shared Kitchen components (lead review, wave J/K)

Rebase after wave J contains `c4a4981`, then consume the landed shared APIs; do not copy in-flight shared files into this lane. Local main `5ed5bdf` does not yet contain that commit.

- Replace inspector DecisionCards with `LineRow` per-line Accept, Reject, Swap and Why. Use `lineDecisions` over all snapshot approvals, `acceptAll` over the whole plan (including filtered-out lines) to exclude sign-off lines from bulk acceptance, and `KitchenStore.decideLines` so each selection uses its own approval/version/hash. Focus the relevant line wrapper when the dock locates a decision. Show Why through an actual visible shared drawer; keep product inspection separate from expanding the purchase basis. Keep final ordering in Kitchen.
- Remove the canvas alternatives section, comparison-price mapping and recommendation handler. Open the shared `SwapPanel` through the selected line's `LineRow`; consume S1's landed steer, authoritative sizing and need-total behavior. Shared-owner need: an ambiguous/lost pick response must refresh authoritative state without automatically resending; current SwapPanel refreshes only after success.
- Remove owned image loading from `ProductRow`; use shared `ProductThumb` and retain deliberate product inspection. Shared-owner needs on current main: expose 64/96/48 px slots (including a LineRow size prop), match labels, image error/reset handling and click-to-enlarge. Current ProductThumb allows only 32/36/40 px. Preserve the approved larger photo sizes and stable geometry when switching.
- Use VOCABULARY and shared state/reason labels. Hide raw IDs/codes outside System; unknown reason fallback must remain readable. Current owned leaks to remove: requirement labels such as `EU_ORGANIC_FARMING`, origin `FI`, producer-authored unresolved strings containing product IDs, and unknown `reasonLong` fallbacks. Request missing reason/requirement labels from the shared owner rather than duplicating their vocabulary. The current shared LineRow also needs Reject exposed for pending sign-off lines.

Proof for the follow-up: single-line grant/reject and split approval identity; Accept all excludes sign-off lines; shared SwapPanel steer/pick updates the same selected need; stale/refused/lost responses never authorize or order; shared photos enlarge with keyboard access and keep fixed error/loading geometry. Recheck equal desktop panes and natural phone flow at 1440/390 px. The current card implementation above remains the verified baseline; this convergence is not implemented yet.

## Architecture boundary

The plan snapshot is the only purchasing state. The pure projection groups explicit menu lineage and connects need IDs to actual line IDs; retired sources remain visible without contributing invented totals. Selection, search, collapse and density stay in the view. Domain changes carry the current rendered run/plan/version through existing commands; event bursts wait during commands and refresh the pinned plan afterwards.

The next agent presentation seam should accept a plan-scoped focus/reveal/filter intent separately from purchasing tools. It should reject missing need IDs and stale plan identities, and preserve a chef's newer manual selection over a late agent response. It needs no graph database or new business mutation path. The current dock can locate existing decisions and ask about a selected ingredient, while domain changes flow back through the shared event stream.

## Report

- Implemented: real-plan canvas, recipe lineage groups, selection and URL focus, search/diet/state filters, current and replaced purchases, scoped recommendation application, exact-terms decision cards, agent drafts and decision navigation, queued event refresh, mobile outline/details with focus return. Read-only loading never plans; missing-plan links never expose another actionable basket. Lost mutation responses refresh the plan without assuming failure or resending.
- Validated: 12 pure projection tests; seven browser integration tests as a suite plus the lost-response test separately. Browser checks exercised real local fixture APIs, replacement/no-op semantics, exact approval version/hash without ordering, external edits preserving plan/selection, and keyboard/390 px overflow. Desktop, phone and lost-response screenshots visually inspected in `scratch/canvas-*.png`. No production database, external models or secrets used.
- Reproduce: `pnpm exec vitest run --project server src/lib/canvas/model.test.ts`; `pnpm exec playwright test src/routes/canvas/canvas.e2e.ts` uses the root fixture preview on 4173. This worktree used a local server on 5198 with `KITCHEN_URL` and ignored `scratch/pw-canvas.config.ts`.
- 15 Nov 00:26 EET · done: scoped canvas and failure-path hardening · stubbed: none in this slice · needs: optional Kitchen entry link, future typed agent presentation channel · ready to merge: yes. `pnpm gate --only check,lint` GREEN (zero Svelte errors/warnings); no dependencies, contracts, schema or shared surface files changed by this lane.
- Follow-up: merged main `ed20a82`; added fixed photo slots, explicit exact/approximate/missing/failed states, shared cached loading and keyed product inspection. Separated ingredient selection from product links, clarified shared approval coverage, highlighted changed cards and reduced phone header/filter overhead. No live image search or Cloudinary upload is triggered by rendering.
- Current proof: 12 projection tests, all 10 browser cases, and the two image cases again on the final photo renderer passed. At 1440/390 px, photo fixtures proved fixed geometry, lazy batching/reuse, error fallback, deliberate read-only product inspection and unchanged plan/approval/order/event state. `scratch/canvas-photos-*.png` were inspected; these image-state QA captures use labeled synthetic assets and do not establish catalogue photo coverage.
- Proposed D3 direction, decision criteria and complete agent-view acceptance journey: [basket-canvas-graph.md](basket-canvas-graph.md). The graph and typed presentation channel remain proposed.
- 15 Nov, 01:04 Kyiv · done: card photos, product inspection, mobile cleanup and D3 design proposal · stubbed: graph remains proposed · needs: shared replacement sizing and typed agent presentation channel · ready to merge: yes for this card slice. Type check passed with zero errors/warnings; the final lint gate is GREEN after the spacing fix. Implementation remains within the lane's owned paths; main's updates are preserved.
- 15 Nov, 01:21 Kyiv · done: enlarged card/inspector/alternative photos to 64/96/48 px and matched desktop pane heights with independent scrolling; kept natural phone flow · stubbed: none in this fix · needs: existing shared seams above · ready to merge: yes. Final type check found zero errors/warnings; lint gate GREEN. All 10 browser cases passed, including equal-height/viewport bounds, independent scrolling to alternatives and approval, no nested board scroll and no phone overflow. Four fresh 1440/390 px captures were visually inspected in `scratch/canvas-photos-*.png`; deterministic photo fixtures verify presentation rather than catalogue coverage. No shared files or dependencies changed.
- 15 Nov, 01:34 Kyiv · done: reviewed the lead's D28/D29 convergence against local main `5ed5bdf`, recorded exact shared APIs, approval-split semantics, test criteria and vocabulary leaks; retained the unlinked route · stubbed: no new source changes · needs: wave J containing `c4a4981`, S1/S2 shared component landing and photo API extension above · ready to merge: no for the convergence follow-up; `c4a4981` remains the verified baseline. Rebase is deliberately pending the requested wave-J landing. Markdown formatting and diff checks passed; source tests were not repeated for this documentation-only checkpoint.
