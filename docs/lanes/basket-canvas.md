# Basket canvas

Mode: Operate. User-authorized optional view of an existing purchasing plan, inspired only by the interaction pattern of the local roadmap reference. All implementation is original to Mandate.

## Ownership

- Branch `lane/basket-canvas`, worktree `scratch/worktrees/basket-canvas`, port 5198.
- Own `src/routes/canvas/**`, `src/lib/canvas/**`, this brief.
- Base `7fca68340a0ff15e18584d1beb06cfe8c8687ef3`.
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
- The inspector browses alternatives and opens an unsent, plan-scoped replacement request in the existing agent dock. Individual alternatives seed a comparison question; the browser does not guess pack quantities for them.
- Existing exact-terms decision cards approve their complete reason group. Final ordering opens the same plan in Kitchen.
- Phone outline, keyboard controls, readable empty/loading/error/read-only states.
- Targeted projection and UI tests; fixture-only local server, desktop and phone screenshots; check/lint gate.

## Needs

- Lead may link `/canvas?plan=…` from the Kitchen task menu after reviewing this optional route. Shared navigation is intentionally unedited.
- Direct one-click recommendation application needs the kitchen helper owner to add `find_substitutes` to `src/lib/server/kitchen/live.ts`'s `ALLOWED` set (existing run/plan/version and tool gates still apply). A real API test caught its current 403; this lane removed that direct browser command and uses the existing agent conversation. Do not bypass the allowlist with a new endpoint. Candidate quantities for unchosen alternatives also remain a server seam, so comparisons show only unit prices whose unit is explicit.
- A future typed presentation channel could let agents focus/filter the canvas directly. This slice shares domain state and event updates; it does not extend agent contracts or persist layout.
- Broad establishment/event/menu graph editing, arbitrary edges, shared camera/layout and graph persistence remain separate work.

## Architecture boundary

The plan snapshot is the only purchasing state. The pure projection groups explicit menu lineage and connects need IDs to actual line IDs; retired sources remain visible without contributing invented totals. Selection, search, collapse and density stay in the view. Domain changes carry the current rendered run/plan/version through existing commands; event bursts wait during commands and refresh the pinned plan afterwards.

The next agent presentation seam should accept a plan-scoped focus/reveal/filter intent separately from purchasing tools. It should reject missing need IDs and stale plan identities, and preserve a chef's newer manual selection over a late agent response. It needs no graph database or new business mutation path. The current dock can locate existing decisions and ask about a selected ingredient, while domain changes flow back through the shared event stream.

## Report

- In progress: bounded canvas route and projection; no production services or database used.
