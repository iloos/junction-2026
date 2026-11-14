# UI mock set → prod

_Sat 14 Nov, design session. Mockups: `scratch/ux-mock/` (gitignored; `index.html` is the map). Research: [research/ui-dataviz-patterns.md](../research/ui-dataviz-patterns.md). This page says which mock parts move into the app, as deltas on the shipped tokens (`src/routes/layout.css`) and components (`src/lib/ui`, `src/routes/ops`), ranked by demo value against risk, and what waits for after the Sun 06:00 freeze._

## The shape the mocks settled on
Three audiences, one model (request → menu → dish → need → offer → line → decision → receipt, over delivery dates):
- **Kitchen** (chef, light): Today (the plan, decisions, chat), Usual order (concept).
- **Valio** (ops, dark): Operations (problems by cause, the story of each), Demand, Forecast, Engine room.
- **How it works** (judges, dark): Story (landing and pitch), Request to order, Architecture.

Rules that held up in review: every element readable in under 5 s (sentences and icons before encoded bars); depth on demand (the System toggle and the engine room hold the mechanics); the same object opens the same sheet everywhere; numbers come from one read model, never written into copy.

## Deltas against what ships (no new visual system)
- **Type:** keep Plex Sans/Mono and the shipped scale (28/20/15/14/12.5/11). The mocks' Instrument Serif display face is a user decision: use it only on `/story` and `/how` (presenting pages), never in Kitchen or Ops.
- **Colour:** keep the D10 supply tokens (`sup-confirmed/known/unknown/missing/excess`) and authority tokens (`propose`, `signoff`, `auth`). The mocks' near-black dark is replaced by the shipped navy Ops theme. No new hues.
- **Micro text:** the shipped 11px `micro` size fails the mocks' 12px floor on body copy; keep it for labels only.

## Moves, ranked
Value = what a judge feels. Risk = chance of breaking the demo before freeze. **Tonight** = safe before 06:00. **After** = post-freeze.

| # | Mock part | Lands in (reuse) | Delta | Value | Risk | When | Lane |
|---|---|---|---|---|---|---|---|
| 1 | Per-dish status sentence: "✓ Covered · in stock", "? Valio hasn't said how many", "Covered if you approve" | `LineRow`, Kitchen dish rows; text from `FulfilmentView` | Replace the per-row `CoverageRuler` with one icon + sentence; move the ruler into `WhyDrawer` as needed-vs-buying | High | Low | Tonight | 1f |
| 2 | Chat turn built from the five events | `ChatDock` (already renders step/clarify/decision/ledger/done) | Steps fold into "Worked N steps · 2.1 s" (tool, sponsor, ms on expand); clarify as option chips; decision renders the shipped `DecisionCard` compact and scrolls to it (never approves); ledger as one outcome line | High | Low | Tonight | 1f + E |
| 3 | Ops case card: consequence first | `CaseTicket` | Title is the consequence ("Ham: 16 packs short for 6 kitchens"); one line of what agents already did; € held and time to cut-off. Only buttons that are wired; no "Pre-position" until it is | High | Low | Tonight | 9c |
| 4 | Ops "What happened to this case" | `OpTimeline` data + `labels.ts` `opSummary` + `TraceDrawer` | A vertical story of the case's ops: time, actor chip, one sentence, consequence; "Technical detail" opens the existing `TraceDrawer`. Built from the real op log, so it proves the system is live | Very high | Medium (sentence quality per op type) | Tonight if `opSummary` covers the op types; otherwise After | 9c |
| 5 | Engine room | `OpTimeline` swimlanes, `RunGraph`, `TraceDrawer` (all shipped) | Move them under an Ops tab "Engine room", reached from the System toggle; the first Ops screen keeps only cases and stories | Medium | Low | Tonight | 9c |
| 6 | Story (landing and deck) | new `/story`, static Svelte | Nine slides, partner panel, gate slide (slow pulses). `/` stays the Kitchen so Ops and MCP approval links keep working. Copy checked against CLAIMS.md | High (pitch) | Low (isolated route) | Tonight | lead or new lane |
| 7 | Architecture | new `/how`, static Svelte + SVG | Structured map (server, lock region, pure core, port sockets with fallbacks, tables, the bus loop), state machines, "one line" trail. Scripted traces labelled illustrative | High (Q&A) | Low | Tonight | same as 6 |
| 8 | "What changed" strip after an agent turn | `TaskHeader` zone; diff from the turn's ledger or `get_plan.lastVoided` | Before → after for need, packs, €, decisions; dismissable; touched rows flash once | High | Medium | Tonight if the ledger carries the diff | 1f |
| 9 | Product sheet everywhere | new `ProductSheet` in `src/lib/ui` | One sheet: availability kind, price, who wants it in this workspace, the open case, links to Ops/Kitchen. Cross-kitchen counts need an Ops query | Medium | Medium | Single-workspace tonight; cross-kitchen After | 1f + 9c |
| 10 | Request to order | `/how/request`, static; reuses `BriefAsk`, `MenuReview` visuals | Thirteen steps, four entry examples, built/planned badges | Medium | Low | Stretch tonight | same as 6 |
| 11 | Ops stakes chart (€ held by cut-off, next 72 h) | Ops header, small d3 | Needs € held and cut-off per case from cases.ts | Medium | Medium | After | 9c |
| 12 | Gate paths ("91% straight through · 6% held · 2.4% same request · 0.6% refused") | Ops side panel | Needs counted sources: ops, idempotency replays, refusals. Show only counts we record | High (Q&A) | Medium (truth of counts) | After | 9c + 91 |
| 13 | Forecast: "Will stock hold?" rows and the stock line | Ops tab | Needs a pure `projectDemand(kitchens, horizon)` in `core/demand` plus `sim_stock`; the "Valio hasn't said" band for unknown stock | High | High | After | 8d + 9c |
| 14 | Demand flow (kitchen → menu → dish → product → stock) | Ops tab, `d3-sankey` | Over the workspace's real plans; top items + "other"; shortages never folded into other | Medium | Medium | After | 9c |
| 15 | Kitchen layout A (conversation first) vs B (plan first) | `KitchenScreen` | Pending user choice from `kitchen-a.html` / `kitchen-b.html`. B is closest to the shipped TaskHeader + Decide zone + docked ChatDock | High | High (layout churn) | After, unless B's deltas are #1, #2, #8 | 1f |
| 16 | Usual order / rhythm (settledness, confidence-scaled projection) | concept | Needs order history; maths in `rhythm.html`. Natural basis for the standing order and the act tier | High (pitch, as next) | n/a | Pitch only, labelled next | — |
| 17 | Demand at Valio scale (2,400 kitchens) | concept | Synthetic data | Medium (pitch) | n/a | Pitch only | — |

## Libraries
- **Tonight: none new.** `d3` 7.9 and `d3-transition` already ship; the static pages draw SVG in Svelte with `$state.raw` data, d3 for scales and shapes only (CLAUDE.md rule 4).
- **After:** `d3-sankey` (small) for #14; `d3-dag` or `dagre` (~24 kB) if a menu drill needs a layered graph; `regl-scatterplot` for a 17.5k catalogue map. Not needed: `@xyflow/svelte` (the architecture map is static SVG); `elkjs` and `embedding-atlas` are over the 500 kB rule. Measure before adding.

## Drop
- Per-row coverage bars on the main surface (they fail the 5-second test; keep the ruler inside Why).
- Buttons whose action isn't wired ("Pre-position 16 packs", "Ask the 2 chefs") until a tool exists; no fake affordances.
- Hand-written numbers in app surfaces. The mocks' `shared/scenario.js` exists only so mocks agree; the app reads the read model.
- The mocks' near-black dark theme and any serif in working surfaces.
- Three equal columns (chat · plan · decisions) from the first kitchen mock.

## Review carefully before it ships
- **Every sentence generated from ops** (#4): wrong or vague wording is worse than the swimlane. Test on the seeded run and a perturbed run.
- **Counts and percentages** (#12, Ops hero "96% settled by agents"): show only what is counted; otherwise remove.
- **Partner claims** on `/story`: Exa is "tools wired, no UI yet", Context.dev is "drill only", per PITCH "Not yet claimable"; illustrative examples labelled.
- **Words** (VOCABULARY.md, D10): "covered" only for known stock or receipts; unknown stock is "Valio hasn't said"; "supplier confirmed" only with a receipt.
- **Contrast and size** on the navy theme at 390 px, after the per-dish sentences replace bars.

## Open decisions (user)
1. Kitchen direction: A (conversation first) or B (plan first, my pick).
2. Serif on `/story` and `/how`: keep or drop.
3. Whether `/story` is linked from the Kitchen header or only shared as a URL.
