# MAP: every capability, where it lives, how to see it, what proves it

_S7 (pitch lane), Sun 15 Nov 02:00. Read from `main` at `815a689` plus the wave K commits after it, and from prod `/healthz` (commit `5ed5bdf`, 23:55 UTC). This map supersedes [archive/concept/SYSTEM-MAP.md](../archive/concept/SYSTEM-MAP.md) (written at `b10cd43`, before ring 6). Paths: `core/` = `src/lib/core/`, `server/` = `src/lib/server/`, `routes/` = `src/routes/`. Claim wording follows [CLAIMS.md](../CLAIMS.md): **nothing here widens a CLAIMS verdict.**_

**Status legend.** **prod**: seen on the deployed app (CLAIMS row or playtest). **prod\***: the code is on prod `5ed5bdf`, but not yet observed on prod in CLAIMS. **main**: merged but not on prod yet (wave J deploying, wave K gating). **tested**: a test or eval green on main, not observed deployed. **wired**: in code, off or not reachable. **held / never**: a decision keeps it out.

## 0. The shape in one breath
A chef says what the kitchen needs (words, a menu, an event). The agent **understands** it (dishes → ingredients → Valio products, sized in Valio's sales units), **decides** (ranks substitutes known stock first, re-plans on a shortage, labels a best try), then **the mandate gate** sorts every line: ordered alone, held for one tap by a person, or refused. Every door goes through the same gate: the Kitchen page, the chat dock, `/request`, REST, MCP and the room. Every state change is one op through `applyOps`, and every step is traced.

The user's three sketches map onto this (`scratch/user-diagrams.png` in the pitch worktree):
1. **Suppliers → Valio Aimo → mandate.kitchen → establishments** (hotel, care home, school, restaurant, hotel, café). One stock serves many kitchens: the room and the shortage cascade (§E).
2. **Establishment has menu has recipe has ingredients; mandate.kitchen and Valio Aimo supply the ingredients.** The domain chain is `core/demand/` plus the menu path (§A).
3. **Food requirements (words, menu, photo) → mandate.kitchen → ships order; Valio inventory API in.** The architecture. Photo input is wired, not live (§H).

## 1. Doors and actors
| Actor | Door | Identity | Scopes (`SCOPES_BY_ACTOR`, `core/contracts/tools.ts`) | Can't |
|---|---|---|---|---|
| Chef (visitor) | Kitchen `/`, chat dock (every page), `/request`, `/pair` phone | signed cookie → own sandbox `ws-j-<id>` (`server/demo/visitor.ts`), 14 days (D26) | all 6: read, plan, order, approve, mandate:write, agent:run | change the mandate in the app (`set_mandate` fails explicitly) |
| In-app agent | dock (`/api/chat/{turn,task}`), `/api/agent/run` | server principal (`server/agent/principal.ts`) | read, plan, order | approve. Exception: the chef's own typed yes on shown lines, in their own dock (D21, D22) |
| Outside agent (judge's Claude) | MCP `/mcp`, `/mcp/k/<key>`; REST `/api/tools/<name>`; `/api/openapi.json`; `/.well-known/agent.json` | judge key `jk_<ws>.<exp>.<hmac>` (`server/demo/judge-key.ts`), bound to the visitor's workspace | read, plan, order | approve, set_mandate; every external line is held (`core/mandate/tier.ts`); refusals logged (`RecordRefusal`) |
| Room visitor | `/?ws=ws-judges` via QR | same cookie, room flag | as chef, **only on a store they own** (D24 addendum, `0332013`/`0fae82a`) | write to seeded room kitchens or other visitors' stores |
| Presenter / Valio | `/ops` | presenter flag (`server/demo/presenter.ts`) | read; fires scenarios | — |
| Approver | — | — | read, approve | plan or order |

## 2. Capabilities

### A · Understand: words, menus, events → needs
| Capability | Where | How to see | Evidence | Status |
|---|---|---|---|---|
| Free text → structured items (qty, unit, date, requirements) | `server/request/parse.ts`; Gemini 3.5 Flash-Lite job `request.parse`; 3.8 Flash escalates an unsure reading | `/request` "10 l lactose-free milk for Friday" | CLAIMS "Gemini, one model per job" (44/45 held-out, offline); `request.test.ts`, `fixes.test.ts` | prod |
| Intent shape, not phrase rules (product, dish, menu, question, change; exact, range, all available, per covers, unknown) | `server/agent/intents.ts`, D20 | dock "all your apples" | `evals/paraphrase` (6 intents, EN/FI) | tested |
| Reading checked back against the words (units, diet and origin words kept, one-pack echo) | `request.reading` checkpoint, D18 | — | `server/evals/judge-recall.test.ts`: 9 of 10 reading defects flagged | narrow it (CLAIMS) |
| Physical amounts, not pack counts | `core/demand/`, `server/store/direct.test.ts` | dock "4 kg butter" → "4 kg needed; 4 kg planned" | eval r5-f10; fidelity `butter-grams-weekday` | prod |
| Cut-off known before ordering; next day offered, never moved silently | `evals/check.ts` `checkLate`; `core/scenario.ts` | `/request` "…for tomorrow" after 17:00 | CLAIMS (prod `70c30e2`) | prod |
| Event brief → questions → menu (Gemini 3.8 Flash, rubric, team templates as fallback) | `server/menu/`, `propose_menu`, `revise_menu` | dock or `/request`: "a no-meat dinner for 120 with a peach dessert" | CLAIMS A4 row; playtest m2 | prod |
| Menu dishes checked against cited web recipes (Exa) | `server/web/grounding.ts` | menu card, "Matches N sourced recipes" | `menu-grounding.test.ts`; CLAIMS b7 | prod (word it "checked against cited web recipes") |
| Menu → dishes → needs → packs (g/guest, yield, lot rounding) | `core/demand/`; Why drawer arithmetic | Why on the ham: "135 g × 140 ÷ 0.7 → 4 × 7 kg" | CLAIMS demo beat "Thinks like a chef" | prod |
| One conversation, two views: the dock is the door, `/request` the same conversation full-width (D23) | `routes/request`, `server/chat/turn.ts` | `/request?text=…` | `b4e401e` (wave K) | main |
| Establishment from a sentence → nearest profile | `core/establishment.ts`, `/kitchen-api/establishment` | picker, "describe your kitchen" | `evals/establishment` (7 cases) | prod\* |
| Photo of a prep list or delivery note → lines | `server/images/`, `read_image`, Verda Nemotron VL | — | hidden unless `VISION_LIVE=1` | wired, not live |

### B · Decide: products, substitutes, shortages
| Capability | Where | How to see | Evidence | Status |
|---|---|---|---|---|
| Catalogue retrieval (17.5k Valio products, lexical + normaliser) | `server/adapters/catalog/retrieval.ts` | any search | `evals/retrieval` (27 queries, 69 resolve cases, 30 substitute targets); substitute recall@12 ≈ 70% (D19) | prod |
| Live price + availability only for shortlisted ids, 15-min cache-through | `adapters/catalog/valio-live.ts`, `offer_cache` | `/request` step label "Valio live / cached" | CLAIMS Aiven row (trace `valio` 102 ms) | prod |
| Ranking: supply tier first, then the kitchen's weights (price, reliability, carbon, Finnish, organic) | `core/rank/rank.ts` | `/request` "Rank by"; Kitchen rule presets | `presets.test.ts`; CLAIMS | prod (demo on eggs) |
| Gemini Decisions: dish fit 0–4, P(breaks a hard rule), P(Finnish); replay → rules fallback | `server/adapters/decide/` | trace drawer | `DECIDE_LIVE=1 pnpm test:live` | narrow it: "ranks with Gemini Decisions and falls back to rules" |
| Unknown supply (Valio ≥ 999999) never counts as cover | `core/mandate/fulfilment.ts`, `rank.ts` | "Valio doesn't state a quantity" on a line | `pool.test.ts`, `fulfilment.test.ts`; CLAIMS b6 | prod |
| Make in house from orderable ingredients (D8a) | `server/store/pool.test.ts`; `/api/web/make-in-house` | the buffet's lanttulaatikko | tests | tested |
| One hard-constraint evaluator `meets()` (diet, excludes, freeFrom, origin, labels; unknown never ok) | `core/mandate/meets.ts`, D16 | diet marks, sorbet fix | facets eval "0 unsafe" (number from S5) | prod\* |
| Compare panel behind every Swap: pick + alternatives, one reason each, per-kg price (D28) | `74b9ab1` | Kitchen line → Swap | — | prod\* |
| Steer chips (cheaper, Finnish, in stock) + free text; chef's pick wins, labelled "your choice", still under hard rules | `bc52e98` | Swap → chips | — | main |
| Shortage on an open plan: why, what changed, rows flash (moment 1) | `2065791`, `core/services/shortage.ts` | presenter fires `shortage` | playtest m1 | prod\* |
| Contention: another kitchen took the stock → keep what's left, add the next product | `core/services/contention.ts` | — | `contention.test.ts`; CLAIMS b5 | prod |
| A swapped line re-sized to what the old one delivered | `52d5a83` | — | test | main |
| Best try: a near-miss proposed as one tap, labelled, never for hard rules (D23) | chat, request | — | — | main (partial; check with S3) |

### C · The mandate gate
| Capability | Where | Evidence | Status |
|---|---|---|---|
| Each line sorted: act alone / propose / sign-off / unorderable | `core/mandate/tier.ts`, `validate.ts` | `server/store/*.test.ts` | prod |
| Weekly and per-order caps, held even when an order is split | `validate.ts` | eval s5 `CAP_EXCEEDED.weekly` | tested |
| A hard limit no approval can pass | `server/store/ceiling.test.ts` | — | tested |
| Never-delegate list (e.g. an allergen change), reason groups so an allergen change never rides with routine lines | `server/store/groups.test.ts` | prod Kitchen signs off per group | prod |
| Approval bound to the exact terms (`termsHash` = date + sorted lines); any edit voids it and shows what changed | `core/hash.ts`, `core/state.ts`; eval s4, r6-5 | — | tested (UI void not seen on prod) |
| Lot step and cut-off enforced at commit | eval s3, r5-f9; `cutoff.test.ts` | — | tested |
| Lines bound to their need's amount (≤ one lot step over) | D18; validator | `fixes.test.ts` | tested |
| One command identity → a retry replays the receipt | `core/command.ts` | evals s1, s5; `pg-race.test.ts`; `smoke-race.mjs` on prod: 4 × one key → 1 receipt | prod |
| Each committed line names what allowed it | `authority.test.ts` | — | tested |
| A model can add a caution that holds a line, never one that allows it | `adapters/decide`, `server/review/` | — | tested |
| Off-delivery-day held for sign-off | adversarial R9-06 | CLAIMS (prod `04c4394`) | prod |
| Lactose-free never bought as ordinary milk, through substitutes and edits | adversarial R7-01 | CLAIMS | prod + tested |

### D · Act: approve and order
| Capability | Where | How to see | Evidence | Status |
|---|---|---|---|---|
| What the mandate allows goes through alone (buffet: 3 lines €302.62 before any decision) | Kitchen "Order the K lines you can now" | `/` sample hotel → plan | CLAIMS b3 | prod |
| Per-line Accept · Reject · Swap; one "Accept all" | `a371c2c`, `29dc193` | Kitchen | playtest j1 | prod\* |
| One list of lines, one sticky action bar, no right rail (D29) | `ce157cd` | Kitchen | — | main |
| One Kitchen view: the delivery day's basket, plans as groups (D30) | `5844d9b` | Kitchen `?plan=` scrolls to its group | — | main |
| Chef approves in the dock (DecisionCard, hold-to-confirm) (D13) | dock | dock → Review → Confirm | `dock-approve.e2e.ts` 2/2 on prod `b2dfe9c` | prod |
| Chef approves shown lines by a typed yes in their own dock (D22); sign-off lines still need the Confirm card | `fd7d6ae` | dock "approve all" | — | main |
| Chef's own MCP key asks the chef by elicitation (D22) | — | — | parked until after the freeze; MCP agents get the approval link (D17) | next |
| Approve → order → one receipt; survives a reload | Kitchen | Place order | `kitchen-order.e2e.ts` on prod `70c30e2`; hero m2 10/10 at 1440 and 390 on prod `ea9f4d5` | prod |
| Product photos with a labelled ladder (exact → pack may differ → brand → category), loaded once per plan | `6c08d11`, `73ecd36`, `server/web/photo.ts` | Kitchen rows | — | prod\* |
| Product card: Valio Aimo public page and photo, verified by barcode | `server/products/card.ts` | tap a product | CLAIMS (prod `ff7f6c3`) | prod |
| Calendar feed (.ics): decisions with deadlines, deliveries, receiving days | `core/calendar.ts`, `/api/calendar/[kitchen].ics` | — | CLAIMS b11 | prod |
| Basket canvas (S6, user-run) | `routes/canvas/` | `/canvas` (not in nav) | 9 e2e tests | main, unlinked |

### E · Many kitchens, one stock
| Capability | Where | How to see | Evidence | Status |
|---|---|---|---|---|
| "Your own kitchen" first; seven sample profiles below, simulated history (D25) | `f21db02`, `create_kitchen` (`e2842bd`) | `/` fresh browser | playtest j1 | prod\* |
| Workspace persists: kitchens, baskets, phone, agent key (D26) | `2fde6d1`, `server/demo/visitor.ts` | reload, new tab, `/pair` | D26 persistence journey `926dc28` | prod\* |
| Room: QR full-screen, join as your own store, live orders, first-order light-up (D24) | `routes/ops/RoomView.svelte`, `3512380`, `50ad21f` | `/ops?ws=ws-judges` → Room | playtest r1 (stores named and first order: check with S5) | prod\* |
| Room is fail-closed: a visitor writes only to a store they own, seeded room kitchens included, at the core gate for every door (judge keys too) | `core/services/handlers.ts` `ctx.sharedRoom` (S1 `f76d42f`); selector `0fae82a`; chat `8673da2` | — | `room-gate.test.ts` | fixed in wave L, not yet on prod |
| One shortage re-plans every kitchen inside its own rules | `812d714`, `core/services/shortage.ts` | presenter `shortage` → Room tab | playtest m1 | prod\* (room cascade on screen: check with S5) |
| Usual orders detected from history (D14) | `core/patterns/`, `get_context` | — | tests; simulated history | wired (no Week view) |

### F · Valio's view (Ops)
| Capability | Where | How to see | Evidence | Status |
|---|---|---|---|---|
| Problems: held lines grouped by cause, in the visitor's own sandbox | `routes/ops` | `/ops` | CLAIMS (prod `70c30e2`) | prod |
| Orders by stage; demand per delivery day | `OrdersTab`, `DemandTab` | `/ops` | playtest m4 | prod |
| Forecast: two weeks of stock, where it runs short (D27 stock model, simulated, sourced) | `core/stock/`, `ForecastTab.svelte` (`5b7154e`) | `/ops` → Forecast | playtest m4 | prod\* |
| Refused outside-agent attempts shown, "Nothing changed" | `RecordRefusal` | `/ops` | CLAIMS (prod `e9ec36c`) | prod |
| Recall cases (Context.dev, every 5 min), matched against the catalogue | `server/web/{contextdev,watch,recall}.ts` | `/ops` | CLAIMS (narrow it) | prod |
| Engine room: traces, service status, sponsors, gate | `TraceDrawer`, `ServiceStatus`, `SponsorsPanel`, `GatePanel` | `/ops` System on | `/api/ops/traces` persisted rows | prod |
| Flow (sankey) | `FlowTab.svelte` | — | — | cut from the video |

### G · Outside agents
| Capability | Where | Evidence | Status |
|---|---|---|---|
| One registry, three transports (MCP Streamable HTTP, REST, OpenAPI) | `core/contracts/tools.ts`, `server/tools/serve.ts` | prod `/api/openapi.json` lists 19 REST paths | prod |
| An outside key sees **17 tools** (20 registered, minus approve, set_mandate and read_image) | `advertised()` in `server/tools/serve.ts` | this session's mandate MCP lists 17 | prod\* (**CLAIMS says 15: stale**) |
| Approve → 403, logged in Ops; per-key limits 120 calls, 30 writes, 20 quotes a minute | `server/tools/key-limits.ts` | CLAIMS b10 | prod |
| `get_context` first, `meta.nextAction`, `approvalUrl` / `reviewUrl` links that point and grant nothing (D17) | `server/tools/present.ts` | MCP server instructions | prod |
| MCP resources `mandate://<kitchen>`, `decisions://open`; 3 prompts; agent card | — | CLAIMS b12 | prod |
| A judge key acts in the visitor's own workspace and kitchens (`46e2669`) | `server/demo/judge-key.ts` | playtest m3 | prod\* |
| Pairing a phone by single-use QR | `routes/pair` | — | prod |

### H · Web, models, sponsors
See §3 for the sponsor round. Capabilities: Exa facts in the Why drawer, GTIN-cited (prod); `lookup_facts` and `find_outside` tools (prod\*); Context.dev recall monitor + webhook + extraction (prod; no real recall has hit an order; the held line is a labelled drill); Context.dev News supplier leads (`/api/web/leads`, wired); spend caps per key and per day in Postgres (prod).

### I · Trust infrastructure
| Capability | Where | Evidence | Status |
|---|---|---|---|
| Pure core, lint-enforced; 9 op types through `applyOps` | `core/state.ts`, `eslint.config.js` | CLAIMS "How" row | prod |
| Op log on Postgres, LISTEN/NOTIFY → SSE to every open screen | `server/bus/pg.ts`, `/api/events` | CLAIMS Aiven row | prod |
| Two Aiven app machines on one Aiven Postgres: a store made on one shows live on the other in about 0.15–0.5 s (no added capacity: Postgres is the shared limit) | `server/bus/pg.ts` | S4, prod (1 vCPU) ↔ mandate-staging (0.2 vCPU) on `b12ba71`: raw SSE 88–92 ms prod→staging, 275 ms staging→prod, ~230–250 ms in the browser; screenshots in the main checkout's `scratch/cross-*.png` | measured once; not for the pitch (staging is being stopped; no capacity claims) |
| Every model and Valio call traced (model, tokens, latency), stored 7 days | `server/obs/traces.ts` | `services.e2e.ts` strict; `traced.test.ts` (S3 `01cccb6`: chat, `/request` and every scoped tool incl. MCP `propose_menu` trace through the caller's scope) | prod for Valio and `/request`; chat and MCP model calls once `01cccb6` (wave O) is merged and deployed |
| Breaker + fallback per port; fixture path for every flow; `/offline` | `server/external/`, `routes/(kitchen)/offline` | gate runs on fixtures | prod |
| Per-visitor sandbox; a judge key works only there; forged cookies select nothing | `server/demo/` | two-browser gate on prod `ab3a557` | prod |
| 30 visitors at once, 0 errors | `scripts/deploy/visitors.mjs` | prod `68cb2d8` | prod (planning ran one at a time) |
| `/healthz`: commit, per-service mode, 24 h counts per source | `routes/healthz` | prod | prod |

## 3. Sponsors: what each does, and the 24 h numbers
`/healthz` `day` on prod `5ed5bdf`, Sun 15 Nov 01:55 local (calls over the last 24 h, from stored traces):

| Sponsor | Job in the hero journey | Not removable because | 24 h | Status |
|---|---|---|---|---|
| **Valio Aimo** | catalogue (17.5k), live price and availability for shortlisted products, cut-offs, sales units and lot steps; product pages and photos by barcode | the plan is Valio's products in Valio's units at Valio's prices; without it nothing is orderable | 372 calls, 372 live ok | live |
| **Gemini** | Flash-Lite reads the request and the chat; 3.8 Flash proposes the menu; Decisions scores dish fit and hard-rule risk | words → a menu → needs is the model's job; rules alone need forms | 828 calls, all live ok | live |
| **Aiven** | Runtime hosts the one container; Postgres holds the op log, locks, receipts, caches, spend caps, traces; LISTEN/NOTIFY drives Ops | "one receipt under a race" and the live Room are Postgres guarantees | (no call counter; `db: ok`, TLS verified) | live |
| **Exa** | cited product facts for gaps in Valio's records; menu grounding; make-in-house recipes; outside options | Valio has no allergen record for many products; the Why drawer cites the web instead of guessing | 410 calls (222 live ok, 188 cache) | live (mode now: cache) |
| **Context.dev** | recall monitor on Ruokavirasto every 5 min, signed webhook, JSON extraction; News leads; photo fallback | the recall watch is the one outside event that can hold a line | 187 calls (123 live, 107 ok, 64 cache) | live; 4 recent fails |
| Verda (Nemotron VL) | photo → lines | — | — | wired, not live |
| Featherless (Gemma) | selectable provider for parsing | — | — | wired, unused |

## 4. Numbers we stand behind
Waiting on S5 (junc26-fb) for the current figures; until then, only the CLAIMS-backed ones: hero m2 10/10 at 1440 and 390 on prod `ea9f4d5`; 4 commits on one key → 1 receipt on prod; 30 visitors, 0 errors (`68cb2d8`); Flash-Lite 44/45 held-out paraphrases, 845 ms median (offline); 9 of 10 reading defects flagged; outside key: approve 403, 20 quotes/min then 429. Repo: 246 `*.test.ts` files + 12 Playwright specs; evals: 14 scenarios, 5 fidelity cases × 3 entries, 9 chat trials, 7 agent goals, 27 + 69 + 30 retrieval cases.

## 5. Never say
Vector search / pgvector (column exists, never read or written) · schema-constrained output · recipe-aware · "confirmed" without a receipt · data stays in Finland · a real recall hit our orders · "ordered the buffet" by the agent · every sponsor call in the trace drawer · "unlimited" or "in stock" for ≥ 999999.

## 6. Stale docs (for the lead)
- `CLAIMS.md`: outside agents see **17** tools now, not 15 or 13 (create_kitchen, get_outcome, revise_menu and others added). It also cites `/agents/chat` as a page, but `/agents/chat` now opens the dock over the Kitchen.
- `concept/SYSTEM-MAP.md`: pre-ring-6 (D15/D16/D18 shown as planned); archived to `archive/concept/`.
- `PITCH.md` "Not yet claimable": "new events from chat" is out of date (the hero journey plans a new event from the dock, m2). Deck outline replaced by `pitch/DECK.md`.
- `SUBMISSION.md`: Gemini says "the in-app agent's tool calls are chosen by a deterministic scripted planner": re-check against the chat path (S3). It doesn't mention the room, own kitchens, Forecast or the compare panel (S5).
- More in [FINDINGS.md](FINDINGS.md).
