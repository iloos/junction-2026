# UX foundation

_Sat 14 Nov. Interaction model, key screens, visual direction, demo scripts, viz choices and a cut list for the UI lane. Builds on [CONCEPT](../concept/CONCEPT.md), [SCORECARD](../concept/SCORECARD.md), [horeca](../research/horeca.md), [agent-harness](../research/agent-harness.md), [mcpcon](../research/mcpcon.md). Sources at the end. **(?)** = our judgement or a single source._

## 0. The one idea: the order is the interface
Valio's sheet says "it is not a chatbot", and the flow it requires is Request → Lookup → Order → Approval. So the screen's main object is **the plan**: order lines grouped by delivery day, in layers (base week + event + anomaly fixes). The agent edits the plan through ops (`applyOps`), and every op animates on the line it touches. Chat, voice and photo are one **input strip** at the bottom, never the main view. Every line carries three things: a **tier chip** (act / propose / sign-off), a **why** (one line, expandable into the provenance chain) and a **source** (menu, booking, API price at time T, estimate).

## 1. Agentic co-planning patterns: what works, what's gimmicky
| Pattern | Seen in | Use it as |
|---|---|---|
| **Shared state, streamed as patches.** The agent sends a snapshot, then JSON-Patch deltas; the UI applies them and can ask for a fresh snapshot | AG-UI `STATE_SNAPSHOT` / `STATE_DELTA` | Our NDJSON `ops` events are the deltas. The plan is the snapshot. Row flash + number tween on each op |
| **The plan is an editable object**, not a message. Practitioners report this is what turns approval from rubber stamp into review | agent-UX pattern catalogues | The chef edits a quantity or a g/guest rule and the agent re-plans around it |
| **Show the change in the domain's format**: rows for rows, not prose. Per-hunk accept/reject | Cursor review; pattern guides ("an approval card that hides the payload is theater") | Diff table of order lines: per-line accept, plus "accept all in tier" |
| **Visible session state.** Agent identifies itself, shows a first activity within seconds, states: working / waiting for you / done / error; humans stay accountable | Linear Agent Interaction Guidelines | One status pill per agent + an activity feed (looked up, compared, asked). Approvals carry the human's name |
| **A closed catalogue of UI components** the agent may emit, rendered natively | A2UI (trusted component catalogue, flat list by id) | The agent can only return our card types: `AnomalyCard`, `SubstituteCompare`, `ApprovalCard`, `EventDiff`. The same components render in the MCP App |
| **Approval shows the action itself, before the side effect, enforced server-side** | iProov "HAPS" talk (mcpcon); AI SDK 7 tool-approval docs warn a crafted client approval can bypass a UI-only gate | The sign-off card lists the exact ops; the server holds them until a signed approval |
| **Persistent autonomy indicator** | pattern guides | A header chip: "Acting alone within: €2,000/week, known products, no allergen changes" |

**Gimmicky (avoid):** token-by-token typing of long agent prose; spinners or "thinking…" theatre; raw confidence percentages with no meaning (show the tier, and the calibrated score from Gemini only on hover); agent avatars and personas; 3D with no question it answers; a chat transcript as the record (the op log is the record).

**Confidence → state.** Map the calibrated decision to three words, not a number: *sure* (act, quiet), *check* (propose, blue), *ask* (sign-off, amber). Numbers go in the why drawer.

## 2. Three surfaces, key screens
### (a) Kitchen app, phone-first (390 px; works at tablet width)
- **K1 Week (home, the money shot on load).** A 7-day strip: covers forecast bars (usual vs booked), delivery days with a **cut-off countdown** ("order by Tue 14:00 for Thu"), anomaly badges per day. Below: "This week: €4,312 · 61 lines · 3 need you". Seeded with the Christmas week; never empty.
- **K2 Order plan.** Lines per delivery: Cloudinary thumbnail, Finnish name + short English gloss, quantity with the pack rounding shown ("22 kg → 11 × 2 kg"), locked price, tier chip, why chevron. Agent edits stream in. Priorities sit in a bottom sheet (price, carbon, Finnish, organic, reliability); moving a slider re-ranks live and the changed lines flash.
- **K3 Event planning.** Input: "Christmas dinner, 12 Dec, 140 guests, buffet" (typed, voice or a photo of the BEO). Output: an **event layer shown as a diff against a normal week**: new lines, increased lines with a ghost bar of the usual quantity, a per-dish breakdown (guests × g/guest → kg → packs). The g/guest rules are editable (ham 150 → 120 g recomputes in place). A **waste line**: "vs your usual +15%: −38 kg, −€410, −95 kg CO₂e". Then the guarantee drops to 124 at T−72h and the top-up shrinks.
- **K4 Anomaly card.** What happened + source (booking, availability API, recall, photo), impact (lines, kg, €, which delivery), the proposed fix, two buttons.
- **K5 Substitute compare.** Three candidates as columns: €/kg, kg CO₂e/kg, delivery reliability, origin, pack fit. A small dot plot per attribute with this kitchen's weights shown as the reason for the order. Flip "price-first" to "carbon-first" and the winner changes: the who-would-have-thought moment.
- **K6 Sign-off.** What is held and the rule that held it ("over €500 single line", "new supplier", "breaks Finnish-origin preference"), the exact ops, total, the cut-off it must beat. Hold-to-approve (no accidental tap). Recorded against those lines with time and name.
- **K7 Mandate card.** "What this agent may do alone": limits, constraints, tiers. Editable; it is the policy, in plain words.
- **Why drawer (everywhere).** Dish → recipe g/guest → covers → kg → packs → product chosen because (weights) → price from API at time T → sources. This is the "explain decisions" bonus and the PROV trail.

### (b) Valio control room (1920×1080, dark, read at 3 m)
Grid: **left** live agents (500 kitchens as a dot grid, colour = state: idle / working / waiting / signed), counters (orders/min, € committed, held for sign-off); **centre** the hero, a **product-space map of 17.5k products** lit by live demand (points brighten as orders hit them; anomalies ripple); **right** the anomaly stream (tier-coloured, one line each, click → the kitchen's plan); **bottom** demand heatmap (product cluster × next 14 days) and **enrichment coverage** (carbon 63% → 100%, reliability 25% → 100%, stacked by provenance: measured / sourced / estimated). One swarm button. Note: the catalogue has category **codes only**, so map clusters need LLM-generated labels.

### (c) Open agent interface (what the judge sees)
A public **"Agent door"** page: MCP URL with copy button and QR, the tool list with one-line descriptions, `/openapi.json`, the assumptions. The judge's own Claude calls `search → compare_by_priorities → place_order`; the order is held, and an **ApprovalCard renders inside Claude as an MCP App** (the same component as K6). In the same moment the judge's order appears in the control-room stream marked "external agent". The approval can also be completed on the phone.

## 3. Visual direction
| | **A. Pass** (the kitchen ticket rail) | **B. Instrument** (calm SaaS) | **C. Frost** (cold-chain Nordic) |
|---|---|---|---|
| Feel | Warm paper, order lines as tickets, tabular mono, one signal-yellow | Neutral LCH greys, one accent, dense tables, quiet motion | Ice-blue on deep navy, birch white, data as light |
| References | Kitchen display systems, receipt printers, Teenage Engineering | Linear (LCH theme from base + accent + contrast), Vercel dashboard, Stripe | Nordic weather and grid-operator dashboards |
| Risk | Kitsch; weak on the big screen | Generic if no signature | Reads as Valio branding (we must not imitate it); low contrast |

**Recommend B with one A signature:** a Linear-grade neutral system, plus order lines drawn as **ticket strips** (perforated left edge = tier colour, mono quantities). Kitchen app **light** by default (bright kitchens; dark available), control room **dark** (glowing data on a big screen). Same tokens, two themes, generated from base / accent / contrast as Linear does.
- **Type:** Inter Variable (or Geist) for UI with `font-variant-numeric: tabular-nums`; Geist Mono / JetBrains Mono for quantities, GTINs and ops. Phone: 15/20 body, 13 meta, 28 the one big number per screen. Control room: 18 minimum.
- **Colour:** neutral ramp + one accent (deep teal). Semantic tiers: act = neutral, propose = blue, sign-off = amber, blocked/recall = red. Carbon on a sequential green ramp. Never colour alone: each tier also has an icon and a word.
- **Motion:** an op lands in 180–250 ms (row slides in, background tint fades over 1.2 s, numbers tween). Re-rank uses FLIP. Stream events are coalesced to ~4–10 UI updates/s. `prefers-reduced-motion` turns tweens into instant swaps.
- **Readable density:** right-aligned tabular numbers, units de-emphasised, direct labels instead of legends, small multiples instead of one busy chart, one thing to read per screen (WINNING anti-patterns).
- Run the **impeccable** skill at build start to turn this into `DESIGN.md` + tokens, and again as a critique pass before Sun 06:00.

## 4. Demo scripts mapped to the SCORECARD
**2-minute peer review (phone in the judge's hand via QR, laptop with the control room beside it).**
| Time | Screen | Beat | Criterion |
|---|---|---|---|
| 0:00 | K1 Week | "This hotel didn't write its order this week. Its agent did, and it needs you for three things." | hook |
| 0:10 | Input strip → K2 | Valio's own example: "1,000 L lactose-free milk by Monday". The Request → Lookup → Order → Approval stepper runs; only 640 L for Monday → split delivery; over the limit → held | E2E 30, robustness 15 |
| 0:40 | K3 Event | "Christmas dinner, 140 guests" → diff vs a normal week; the judge drags ham 150 → 120 g; waste number drops | user need 20 |
| 1:05 | K4 → K5 | "Salmon is out": three substitutes; flip price-first → carbon-first, the winner changes | robustness, need |
| 1:25 | K6 Sign-off | The exact lines and the rule that held them; hold to approve; audit row appears | autonomy 20 |
| 1:40 | Control room | 500 kitchens live; the judge's approval just landed in the stream. "Your own Claude can order too: here's the door." | openness 15, Modal, Aiven |

**3-minute stage pitch (one presenter, one hand on a hotkey-driven demo route).** 0:00–0:20 problem (a chef reworking the order at 23:00; the week never goes to plan). 0:20–1:50 live: K1 → milk example (the required flow) → Christmas diff → salmon substitute → sign-off. 1:50–2:20 why hard: agents do things nobody listed (the vending machine); our answer is the mandate, tiers and the clean-context check, shown on the K7 card. 2:20–2:50 control room + the swarm + the open door (path to production: MCP + OpenAPI, Valio sees every agent). 2:50–3:00 close on the name.

## 5. Viz choices for scale
| View | Marks | Pick | Notes |
|---|---|---|---|
| Product map | 17.5k (175k at 10×) | Precompute embeddings + UMAP offline (Modal), ship `Float32Array` x/y. Render with **embedding-atlas** `EmbeddingView` (Svelte entry, Mosaic, density) or **regl-scatterplot** (WebGL, authors report smooth to millions) | 1-hour spike: can we recolour/resize 17.5k points at 10 Hz from the stream? If not, regl-scatterplot. SVG is out |
| Demand time series | thousands of points | **uPlot** (canvas; ~166k points in ~25 ms in its own bench) | Bad at scatter; use it for lines only |
| 500 kitchen agents | 500 (5k at 10×) | One canvas, glyph per kitchen | Not 500 components |
| Heatmap | cluster × 14 days | Canvas 2D + d3 scales | |
| Order diff, plans | ≤ ~200 rows | Svelte keyed rows, inline SVG delta bars; `@tanstack/svelte-virtual` above 200 | Animations live here |
| Substitute compare | tens | SVG + d3 | |
| Anomaly stream | unbounded | Virtual list, cap 200 DOM rows | Batch per animation frame |

**Rules:** datasets in `$state.raw`, reassigned; typed arrays for positions; pass ids, resolve via `Map`; coalesce LISTEN/NOTIFY events per frame; filtering in a worker or duckdb-wasm; Playwright heap + FPS check at 10×.

## 6. UI build list (cut from the bottom)
| | Item | h |
|---|---|---|
| **Must** | Tokens, shell, tier chips, light/dark (impeccable → DESIGN.md) | 2 |
| | K2 order plan with op-stream animation + why drawer | 5 |
| | Request → Lookup → Order → Approval stepper on the milk example (partial availability, split) | 3 |
| | K5 substitute compare + priority sheet with live re-rank | 3 |
| | K6 sign-off (exact ops, rule, hold-to-approve, audit row) + K7 mandate card | 3 |
| | K3 event diff with editable g/guest and the waste line | 4 |
| | Control room v1: agent grid, anomaly stream, counters, swarm button | 4 |
| | Seeded demo route, QR, no empty state, hotkeys, reduced motion | 1 |
| **Should** | Product-space map (after the spike) | 3 |
| | K1 week view with cut-off countdowns | 2 |
| | Approval card as an MCP App in Claude + the Agent door page | 3 |
| | Enrichment coverage panel with provenance mix | 1.5 |
| | Demand heatmap | 2 |
| | Photo input (broken fridge → chilled lines rescheduled) | 1.5 |
| | Trace drawer (model, tokens, latency per call) | 2 |
| **Could** | Recall flow UI (Context.dev), guarantee-drop animation, 10× stress slider, op-log time travel, voice, product images polish | 1–2 each |

Must ≈ 25 h, Should ≈ 15 h. A solo lead with agent lanes cannot do both serially: run the control room as its own lane.

## Open questions for the user
1. At peer review, does the judge hold **their own phone** (QR, needs venue Wi-Fi) or ours? Is there room for a laptop beside it for the control room?
2. Product name on screen: **Mandate**, or j(x)?
3. Light kitchen app + dark control room: agreed?
4. Which embedding model for the 17.5k product map (Gemini embeddings via Modal?), and is the map worth 3 h against the K1 week view?
5. Show Finnish product names raw with an English gloss, or English first?
6. Is the MCP App inside Claude (Should) worth more to you than the photo input?
7. Do we have a real chef's or Valio mentor's numbers (orders/week, minutes per order) for the 0:00 hook?

## Sources
- AG-UI state management: https://docs.ag-ui.com/concepts/state
- A2UI: https://github.com/google/A2UI · CopilotKit on v0.9: https://www.copilotkit.ai/blog/a2ui-whats-new-in-google-generative-ui-spec
- Linear Agent Interaction Guidelines: https://linear.app/developers/aig.md · https://linear.app/developers/agent-interaction · https://linear.app/now/our-approach-to-building-the-agent-interaction-sdk
- Linear LCH theming: https://linear.app/now/how-we-redesigned-the-linear-ui
- Cursor review: https://docs.cursor.com/agent/review · per-hunk debate: https://forum.cursor.com/t/bring-back-per-change-apply-inline-diff-review-you-re-throwing-away-your-best-ux-advantage/160856
- Agent UX patterns (practitioner, (?)): https://aiuxplayground.com/guides/how-to-design-human-in-the-loop · https://ai-design-patterns.pages.dev/frameworks/agentic · https://inference.sh/blog/ux/agent-ux-patterns
- AI SDK tool approval: https://ai-sdk.dev/cookbook/next/human-in-the-loop · https://app.unpkg.com/ai@7.0.40/files/docs/03-agents/06-tool-approvals.mdx
- Embedding Atlas: https://apple.github.io/embedding-atlas/overview.html · regl-scatterplot (JOSS): https://joss.theoj.org/papers/10.21105/joss.05275.pdf · deck.gl performance: https://deck.gl/docs/developer-guide/performance
- uPlot: https://github.com/leeoniya/uPlot · competitor benchmark (?): https://apexcharts.com/blog/javascript-chart-library-benchmark/
- iProov human-approval talk, AG-UI talk: [../research/mcpcon.md](../research/mcpcon.md)
