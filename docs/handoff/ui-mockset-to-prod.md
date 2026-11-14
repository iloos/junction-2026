# UI mock set → prod

_Sat 14 Nov, design session. Mockups: `scratch/ux-mock/` (gitignored; `index.html` is the map). Research: [research/ui-dataviz-patterns.md](../research/ui-dataviz-patterns.md). This page says which mock parts move into the app, as deltas on the shipped tokens (`src/routes/layout.css`) and components (`src/lib/ui`, `src/routes/ops`), ranked by demo value against risk, and placed in waves that all finish before Sun 06:00, after which nothing changes._

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
Value = what a judge feels. Risk = chance of breaking the demo. Everything we want in the demo lands before **Sun 06:00**; after that nothing changes.
- **Wave 1** (first): presentation-level, reuses shipped data and components.
- **Wave 2** (next, once Wave 1 is deployed and checked): needs a new read model or query; land behind the gate, deploy, rehearse.
- **Last stretch before 06:00**: no new parts; fixes, copy, video, rehearsal. The lead decides when it starts.
- **Post-hackathon**: worth doing, not for this demo.

| # | Mock part | Lands in (reuse) | Delta | Value | Risk | When | Lane |
|---|---|---|---|---|---|---|---|
| 1 | Per-dish status sentence: "✓ Covered · in stock", "? Valio hasn't said how many", "Covered if you approve" | `LineRow`, Kitchen dish rows; text from `FulfilmentView` | Replace the per-row `CoverageRuler` with one icon + sentence; move the ruler into `WhyDrawer` as needed-vs-buying | High | Low | Wave 1 | 1f |
| 2 | Chat turn built from the five events | `ChatDock` (already renders step/clarify/decision/ledger/done) | Steps fold into "Worked N steps · 2.1 s" (tool, sponsor, ms on expand); clarify as option chips; decision renders the shipped `DecisionCard` compact and scrolls to it (never approves); ledger as one outcome line | High | Low | Wave 1 | 1f + E |
| 3 | Ops case card: consequence first | `CaseTicket` | Title is the consequence ("Ham: 16 packs short for 6 kitchens"); one line of what agents already did; € held and time to cut-off. Only buttons that are wired; no "Pre-position" until it is | High | Low | Wave 1 | 9c |
| 4 | Ops "What happened to this case" | `OpTimeline` data + `labels.ts` `opSummary` + `TraceDrawer` | A vertical story of the case's ops: time, actor chip, one sentence, consequence; "Technical detail" opens the existing `TraceDrawer`. Built from the real op log, so it proves the system is live | Very high | Medium (sentence quality per op type) | Wave 1 if `opSummary` covers the op types; otherwise Wave 2 | 9c |
| 5 | Engine room | `OpTimeline` swimlanes, `RunGraph`, `TraceDrawer` (all shipped) | Move them under an Ops tab "Engine room", reached from the System toggle; the first Ops screen keeps only cases and stories | Medium | Low | Wave 1 | 9c |
| 6 | Story (landing and deck) | new `/story`, static Svelte | Nine slides, partner panel, gate slide (slow pulses). `/` stays the Kitchen so Ops and MCP approval links keep working. Copy checked against CLAIMS.md | High (pitch) | Low (isolated route) | Wave 1 | lead or new lane |
| 7 | Architecture | new `/how`, static Svelte + SVG | Structured map (server, lock region, pure core, port sockets with fallbacks, tables, the bus loop), state machines, "one line" trail. Scripted traces labelled illustrative | High (Q&A) | Low | Wave 1 | same as 6 |
| 8 | "What changed" strip after an agent turn | `TaskHeader` zone; diff from the turn's ledger or `get_plan.lastVoided` | Before → after for need, packs, €, decisions; dismissable; touched rows flash once | High | Medium | Wave 1 if the ledger carries the diff; otherwise Wave 2 | 1f |
| 9 | Product sheet everywhere | new `ProductSheet` in `src/lib/ui` | One sheet: availability kind, price, who wants it in this workspace, the open case, links to Ops/Kitchen. Cross-kitchen counts need an Ops query | Medium | Medium | Single workspace in Wave 1; cross-kitchen in Wave 2 | 1f + 9c |
| 10 | Request to order | `/how/request`, static; reuses `BriefAsk`, `MenuReview` visuals | Thirteen steps, four entry examples, built/planned badges | Medium | Low | Wave 1 stretch | same as 6 |
| 11 | Ops stakes chart (€ held by cut-off, next 72 h) | Ops header, small d3 | Needs € held and cut-off per case from cases.ts | Medium | Medium | Wave 2 | 9c |
| 12 | Gate paths ("91% straight through · 6% held · 2.4% same request · 0.6% refused") | Ops side panel | Needs counted sources: ops, idempotency replays, refusals. Show only counts we record | High (Q&A) | Medium (truth of counts) | Wave 2 | 9c + 91 |
| 13 | Forecast: "Will stock hold?" rows and the stock line | Ops tab | Needs a pure `projectDemand(kitchens, horizon)` in `core/demand` plus `sim_stock`; the "Valio hasn't said" band for unknown stock | High | High | Wave 2 (reads the summed projection, see memory-and-tenancy.md) | 8d + 9c |
| 14 | Demand flow (kitchen → menu → dish → product → stock) | Ops tab, `d3-sankey` | Over the workspace's real plans; top items + "other"; shortages never folded into other | Medium | Medium | Wave 2 | 9c |
| 15 | Kitchen layout A vs B | `KitchenScreen` | **Closed (user):** neither as a re-layout; 1f's in-app redesign (compact rows, Decide/Order zones, the dock, the first screen, What changed) is better than both mocks. Small details carry over instead (see Carry-over from the kitchen mocks) | | | Closed | 1f |
| 16 | Usual order / rhythm (settledness, confidence-scaled projection) | concept | Needs order history; maths in `rhythm.html`. Natural basis for the standing order and the act tier | High (pitch, as next) | n/a | Pitch, labelled next; Wave 2 if the memory projection lands | — |
| 17 | Demand at Valio scale (2,400 kitchens) | concept | Synthetic data | Medium (pitch) | n/a | Pitch only | — |

## Wave 1 acceptance: what the screenshot must show
Each lane verifies its own item with a Playwright screenshot of the production build on a fresh visitor (the seeded Christmas run), at **1440×900 and 390×844**, and attaches both to its report. "Must" items are checked by eye and, where noted, by a test. Values come from the read model; none are typed into copy.

**#1 Per-dish status sentence** (Kitchen `/`, seeded run, no action taken)
- Must: every dish row shows one icon and one sentence and no row-level bar; Joulukinkku reads as covered by known stock or "Covered if you approve"; Rosolli (supplier-delivered) reads "Valio hasn't said how many it has"; lanttulaatikko and joulutorttu read "Covered if you sign off".
- Must: opening a dish's Why shows the needed-vs-buying comparison (the `CoverageRuler` moved there) with both amounts in kg.
- Must not: "covered" on any unknown-stock line (VOCABULARY.md); text under 12 px in the sentence; horizontal overflow at 390 px.
- Test: a unit test maps each `FulfilmentView` partition to its sentence, including unknown-only and excess cases.

**#2 Chat turn from the five events** (Kitchen dock and `/agents/chat`; any turn that yields steps, a clarify and a decision; a recorded turn from the eval replay set is fine)
- Must: steps collapse to one line "Worked N steps · X s" that expands to tool names with source and ms; a clarify shows tappable option chips and the answer appears as the chef's message; a decision renders as a compact `DecisionCard` with an "Open decision" link that scrolls the Kitchen to the full card; the turn ends with one outcome line from the ledger ("1 line changed · 1 decision added · nothing ordered").
- Must not: an approve or sign-off control anywhere inside the chat; raw JSON; a typing indicator without an active step.
- Test: an e2e or component test feeds a recorded NDJSON turn and asserts the five renderings.

**#3 Ops case card, consequence first** (`/ops`, same visitor after the Kitchen loads)
- Must: each case title states the consequence with product and count (e.g. "Ham: N packs short for M kitchens", from `cases.ts`); one line starting "Agents already" from the op log; € held and time to cut-off.
- Must not: buttons for actions no tool performs; a case that stays open after its line was rescued or committed.

**#4 "What happened to this case"** (`/ops`, select the ham case)
- Must: a time-ordered list of the case's ops, each with an actor chip (Valio data, kitchen agent, chef, outside agent via MCP, monitor job), one sentence and its consequence; "Technical detail" opens the existing `TraceDrawer` on that op; op seq numbers match the engine room's log.
- Must: after an outside agent's approve is refused (judge key, MCP), the refusal appears as its own step within one refresh.
- Must not: generic sentences ("Op recorded"); a sentence for an op type `opSummary` can't describe (hide it and count it instead).

**#5 Engine room tab** (`/ops`, System toggle on)
- Must: swimlanes, run graph and trace drawer reachable under one "Engine room" tab; the default Ops view shows only cases and their story.
- Must not: engine-room panels on the default Ops view.

**#6 `/story`** (deck)
- Must: nine slides that each fit one 1440×900 viewport and step with arrow keys; the partner panel switches on click and arrow keys; Exa reads "tools wired, no UI yet" and Context.dev "drill only"; illustrative examples are labelled; every number either links to CLAIMS.md evidence or is labelled scenario.
- Must: `/` still opens the Kitchen, and an Ops deep link and an MCP `approvalUrl` still land on the exact plan.

**#7 `/how`** (architecture)
- Must: the map shows the server, the locked region of `store.transact`, the pure core, six port sockets each with its fallback, the tables and the event bus back to the open screens; the three scripted traces run and are labelled illustrative; the three state machines have arrows, edge labels and terminal states.
- Must not: a box or table name that doesn't exist in the code (checked against ARCHITECTURE.md and `db/schema.ts`).

**#8 "What changed" strip** (Kitchen, after the #2 turn, or after editing ham g/guest)
- Must: a strip above the dishes with before → after for the touched need (kg and packs), €, and the decisions count; the touched rows highlight once; Dismiss removes it; a reload does not bring it back.
- Must not: a change the plan doesn't contain (values from the ledger or `get_plan.lastVoided`).

**#9 Product sheet, single workspace** (click HK Palvikinkku 476768 on Kitchen and on Ops)
- Must: the same sheet on both surfaces: name, id, availability kind, price, the lines in this workspace that use it, the open case if any, links back to Kitchen and Ops; Escape closes it.
- Must not: cross-kitchen counts in Wave 1 (they need the Wave 2 query).

**#10 `/how/request`** (stretch)
- Must: the four example requests each light their own path; every step carries a built or planned badge that matches STATUS.md; the questions-back step steps through one question at a time.

## Libraries
- **Wave 1: none new.** `d3` 7.9 and `d3-transition` already ship; the static pages draw SVG in Svelte with `$state.raw` data, d3 for scales and shapes only (CLAUDE.md rule 4).
- **Wave 2:** `d3-sankey` (small) for #14. **Post-hackathon:** `d3-dag` or `dagre` (~24 kB) if a menu drill needs a layered graph; `regl-scatterplot` for a 17.5k catalogue map. Not needed: `@xyflow/svelte` (the architecture map is static SVG); `elkjs` and `embedding-atlas` are over the 500 kB rule. Measure before adding.

## Ready for lanes
Wave 2 mocks that are finished and match the shipped vocabulary. Each lane builds from the read model; the mock's numbers are illustrative (`scratch/ux-mock/shared/scenario.js`) and never copied. Mocks are served from `scratch/ux-mock` (`python -m http.server 8765`).
| # | Mock | Ready because | What the lane needs first | Lane |
|---|---|---|---|---|
| 13 | `engine.html` (Forecast) | Rebuilt as a sum of per-kitchen demand in four layers (ordered, planned, usual settled, usual forming) with P(short) per product per day; unknown supply shows "can't be judged" | A pure `projectDemand(kitchens, horizon)` in `core/demand`: per kitchen, mean and spread per layer; spreads combine as squares across kitchens; `P(short) = 1 − Φ((stock − mean) / spread)`; supply with no stated quantity returns no probability. With no order history it uses only the ordered and planned layers, and the "usual" layers stay hidden | 8d (maths + tests) → 9c (Ops tab) |
| 14 | `flow.html`, `flow-scale.html` (Demand) | Kitchen → menu → dish → product → stock; top N per column + "other"; shortages never folded into other; the 2,400-kitchen version shows it scales | A read over the workspace's plans and needs, grouped by `Need.source`; `d3-sankey` | 9c |
| 11 | Stakes chart in `ops.html` | € held per case by time to cut-off, labels no longer overlap | € held and cut-off per case from `cases.ts` | 9c |
| 4 | "What happened to this case" in `ops.html` | Op-by-op story with technical detail inline | `opSummary` sentences for all 8 op types (see Review carefully) | 9c |

Not ready: #16 and the memory panel in `rhythm.html` (need order history and the Patterns layer in memory-and-tenancy.md; pitch as next), #12 (counts must come from recorded sources first).

## Carry-over from the kitchen mocks
Compared on prod `b2dfe9c` (app.mandate.kitchen, Hotel Rautatientori after "Plan the event") with `kitchen-b.html`, at 1440 and 390. Screenshot pairs live in `scratch/ux-mock/` (gitignored): live `live-1440.png`, `live-1440-full.png`, `live-390.png`; mock `b-now.png` (1440), `b-1440-full.png`, `b-390.png`. The live page is the better whole; these are five small details, copy and hierarchy only, no new layout.

| # | Detail | Live now | Mock B | Touches | Size |
|---|---|---|---|---|---|
| C1 | Name unknown stock the way the chef would say it | "Stock unstated" on 8 of 13 dish rows, the most common state on the page (`live-1440-full.png`, State column) | "? Valio hasn't said how many" (`b-1440-full.png`, dish rows) | `src/lib/ui/coverage.ts:269` (the chip word, e.g. "Valio hasn't said"; "Rescued · Valio hasn't said") | One string, plus any test that asserts it |
| C2 | The order button where the eye already is | "3 lines, €302.62 can be ordered now" is a sentence in the header; the button "Order the 3 lines you can now" sits at the bottom of the rail, below the fold at 1440 (`live-1440-full.png`, y≈1300) | "Can be ordered now €319.78 · Place order" is the top card of the rail (`b-now.png`) | `src/lib/ui/TaskHeader.svelte` (make the "can be ordered now" phrase a button, or a link that scrolls to and focuses the ApprovalPanel button) | Small |
| C3 | One-line deadline at 390 | "3 decisions before / Tue 8 Dec, 15:00" in large mono takes two lines and most of the first screen (`live-390.png`) | "2 decisions before Tue 15:00" on one line in body type (`b-390.png`) | `src/lib/ui/TaskHeader.svelte` (inside the cut-off's week drop the date: "before Tue 15:00"; the large mono only from `sm:`) | Small |
| C4 | Mandate words don't push the task down on a phone | The chef's mandate quote is four lines above the task at 390 (`live-390.png`) | "Your agent may…" lives in the rail on desktop, out of the first screen on a phone (`b-now.png`) | `src/routes/(kitchen)/KitchenScreen.svelte:651` (below `sm`, clamp to one line with a "more" toggle; desktop unchanged) | Small |
| C5 | "If you say no" instead of "If held" | "If held: 7 lines not ordered, 7 dishes lose cover." ("held" is the system's word) (`live-1440.png`, Decide rail) | "If you say no · 5 dishes not covered" (`b-now.png`, Needs you cards) | `src/lib/ui/DecisionCard.svelte:53` | One string |

Not carried: B's serif title, the "Needs you" row above the menu (the rail does that job), the System lens toggle (System in the shell covers it), the per-row "Covered if you approve" sentences (the State column already says it in fewer words). "Subscribe in your calendar" in the header is replaced by the "Add to calendar" menu on `lane/c3-daypicker`.

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
1. ~~Kitchen direction A or B~~: decided, neither as a re-layout (#15).
2. Serif on `/story` and `/how`: keep or drop.
3. Whether `/story` is linked from the Kitchen header or only shared as a URL.
