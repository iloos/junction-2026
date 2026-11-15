# PITCH

_Working doc, not final copy. Owner: S7 (pitch lane) since Sun 01:55; the deck is [pitch/DECK.md](pitch/DECK.md), the capability map [pitch/MAP.md](pitch/MAP.md). Claims only what is wired on `main` (CLAUDE.md rule 8); anything unverified sits under "Not yet claimable" until a test, eval or observed deployed run backs it. Words on screen and in speech follow [concept/VOCABULARY.md](concept/VOCABULARY.md) (D10): **supplier confirmed** (receipt-backed only), **ordered, awaiting supplier** (committed, Terminal), **planned**, **known-stock candidate** (Valio states a quantity; not reserved)._

## One-breath opener
"140 guests on Saturday. The ham and the swede casserole are out. What can an agent actually promise this kitchen, and what must it refuse?"

**The problem, in Valio's words** (Valio Aimo mentor, official answer on the event Discord, Sat 14 Nov): "Currently there are no approval gates… In agentic scenario a human approval would be required… maybe that could be dropped in the future if reliability is good enough." Our mandate tiers are that approval gate: what the agent may do alone, what a chef approves, what nobody can. Earned autonomy is their "dropped in the future": the mandate widens as the record shows it can be trusted, line type by line type, never all at once.

## Table demo (2:00)
| Time | Beat | What they see | Label on screen | Status |
|---|---|---|---|---|
| 0–15 | The problem | Christmas buffet for 140 (`event-xmas-140`); whole ham `462490` and lanttulaatikko `462482` out in Valio's own data | Valio mock data (fetched/cached); booking and the December clock are the scenario | [x] live kitchen |
| 15–40 | It thinks like a chef | Edit grams per guest; demand → packs with unit bases; the Why drawer shows the arithmetic (135 g × 140 ÷ 0.7 yield → 4 × 7 kg lots) with each step's source | Recipes and stock-on-hand are team estimates | [x] seen on prod `70c30e2` (Why drawer); the edit itself to rehearse |
| 40–70 | It refuses | Candidates ranked known stock first; a rejected candidate with its reason; Terminal items labelled unknown stock, never counted as cover | Real data + our rules | [x] in code and tests; see it deployed before saying it |
| 70–95 | It's honest | Ham → HK Palvikinkku `476768` (known-stock candidate); lanttulaatikko made in house from ingredients in Valio's catalogue (D8a: most have no stated stock, so they wait for the chef with the allergen change); any shortfall shown | Hand-checked rescue in the seed | [x] tests; prod check open |
| 95–115 | Trust you can test | Approve exact terms → commit → deliberate retry → one receipt; an edit after approval voids it | Local simulated commitment | [x] approve → one receipt seen on prod `70c30e2`; retry on prod via the race smoke; the UI void to rehearse |
| 115–120 | The other side | The same held lines in Operations, grouped by cause, in the visitor's own workspace | | [x] seen on prod `70c30e2`; don't point at the count tiles until `a5ca1f5` deploys |

Valio's own example ("1,000 L lactose-free milk by Monday") runs as its own route, `/request` (their required flow: request → lookup → order → approval), not inside this story.

**Bold beat ("Same shortage. Your rules."):** the judge flips price-first to Finnish-required or changes a cap; eligible terms, rejections and residuals update; if nothing qualifies, it says so. [~] rehearse on the deployed app first.

## Video shot list (≤ 2:00, filmed after the freeze on the tagged deploy)
Order (lead, Sun 01:40): the hero journey first, then the room and a shortage, then an outside agent stopped. Each shot is a URL, the clicks, and what must be on screen. Film a shot only when its playtest journey is green on the deployed commit (`KITCHEN_URL=https://app.mandate.kitchen node evals/playtest/run.mjs --grep <id>`); otherwise cut it or say "next". A fresh browser profile per take (each is a new sandbox); 1440 × 900, plus one 390 phone insert. Status below is from prod 4de483a, Sun 01:30.

| Time | Shot | URL and clicks | On screen (must) | Journey · status |
|---|---|---|---|---|
| 0:00–0:08 | Opener | `/` → "Who are you cooking for?" → Hotel Rautatientori | Seven sample kitchens, each with its rules; "Your own kitchen" form above them | j1 · [x] |
| 0:08–0:40 | **Hero: words → a costed plan** | Dock: "a no-meat dinner for 120 with a peach dessert" → tap Sat 12 Dec → Buffet → "plan it" → menu card (6 dishes) → "plan it" | The agent's steps as they happen; the menu; then the plan: every ingredient a Valio product with a price, or labelled ("No stock info", "Not covered", swaps) | m2 · [x] 1440 on 4de483a (20–25 lines, 17–24 held, all in decisions) |
| 0:40–0:55 | The chef decides, the order lands | "Accept all" (D29; until then the page's Review → Confirm) → "Order K lines now" | Held lines in decisions, approved by a person; "Ordered · N lines", one receipt; "supplier simulated" visible | m2 · [x] 1440 (rc-e8b34dbe4396); [ ] 390 after 6cbc89a; [ ] approving from the open dock until S2's 508db7d |
| 0:55–1:05 | Valio sees it | `/ops` → Orders, then Forecast | The order arrives; demand per delivery day; two weeks of stock, labelled simulated | m2 last step · [x]; m4 Forecast · [x]; Flow (sankey) · [ ] cut |
| 1:05–1:25 | **The room** | `/ops?ws=ws-judges` → Room tab on the big screen; "Show the code full screen"; two phones scan, name a store, order | The QR with app.mandate.kitchen/?ws=ws-judges; stores appear by name; "First order" lights up | r1 · [x] QR link; [ ] stores named (S4 461a4a8); [ ] first order (needs an order to complete in r1) |
| 1:25–1:40 | A shortage, every store re-plans | Presenter: scenario `shortage` in the room → Room tab | Per store: kept, swapped, held, short, and what its own mandate allowed | m1 · [x] own sandbox (contention); [ ] room cascade on screen (presenter-only `shortage`, S1 812d714) |
| 1:40–1:55 | An outside agent is stopped | Claude with the visitor's key: place_order over the €800 line cap, then approve | Held; approve refused with the rule named; the chef approves on the paired phone (390 insert) | m3 · [x] held + 403; [ ] own-store order by the visitor's key (S1 46e2669, wave H) |
| 1:55–2:00 | Close | `mandate.kitchen` | "What do you need? We'll sort it out. That's a mandate." | j9 · [x] |

Cut list if time is short: Valio sees it (fold into the room shot), then the opener.

Deck: [pitch/DECK.md](pitch/DECK.md) (six slides: the case · the approach · the slices · the sponsor round · why us · real and next).

## Stage pitch (3:00)
0–20 the problem · 20–105 the Christmas journey · 105–135 an outside agent on the judge's own key plans in the judge's sandbox and cannot approve · 135–160 Operations shows why kitchens are held · 160–180 the 4-week hotel pilot (targets, not results) and close.

## Labels (always visible)
"Valio challenge mock: fetched T / cached T" · booking, stock-on-hand, recipes and the December clock = **scenario** · order = **local simulated commitment** · salmon contention and shifted cut-offs = **simulated** overlays · the "normal week" a plan is diffed against is a **team estimate** · Valio's huge "unlimited" stock figure (≥ 999999) means **availability unknown**, confirmed by Valio on 14 Nov: say "Valio doesn't state a quantity", never "unlimited" or "in stock". Check each label is on screen before the video (the normal-week label was missing at the last review; the "unlimited" figure must read as unknown once 8d's mapping fix lands). Salmon and trout share carbon 4.9: don't promise a carbon flip there. No product images.

## Provable now (claim → evidence on main)
| Claim we say out loud | Backed by |
|---|---|
| An enforceable mandate: approval is bound to the exact terms | `server/store/gate.test.ts`; eval s4 (price change voids the approval, commit → `TERMS_CHANGED`); `view.test.ts` (missing price never passes) |
| A hard limit no approval can pass | `server/store/ceiling.test.ts` (forbidden outright, split lines included) |
| No double orders | eval s1 (retry → the same receipt), s5 (`DUPLICATE` on a reused key with another payload); Postgres race `pg-race.test.ts` via `pnpm test:pg` (opt-in, on Aiven) and `scripts/smoke-race.mjs` after each deploy |
| Never auto-orders over its caps, even split | eval s5 (`CAP_EXCEEDED.weekly` on a split second order) |
| Below a lot step is unorderable | eval s3 |
| Unknown supply never counts as cover, and known stock ranks first (D8). Valio confirmed the semantics (Discord, 14 Nov): an availability of 999999 or more means **unknown**, orderable in any quantity; empty means not available | `core/rank/rank.ts`; `server/store/pool.test.ts` (lanttulaatikko made in house, Terminal `462157` ranked below); `FulfilmentView` partition (`core/mandate/fulfilment.test.ts`) |
| Each committed line names what allowed it: the mandate or a specific approval | `server/store/authority.test.ts` |
| Edit after a rescue resizes the substitute and re-plans; any edit voids the approval | `server/store/rescue.test.ts` (resize, replace, commit only the new product); `core/state.test.ts` (approval invalidated on edit) |
| Physical amounts, not pack counts: 10 L of milk is sized in litres | `server/store/direct.test.ts`; `fixtures/views/milk-direct.json` |
| For the cases we test, the same words give the same basket through `/request`, the agent and REST | `evals/fidelity/cases.json` (`pnpm eval`); paraphrase gaps open in `evals/paraphrase` |
| Decide per reason group: an allergen change never rides with routine lines | `server/store/groups.test.ts` |
| Cut-off enforced at commit (F9) | `server/store/cutoff.test.ts`; eval r5-f9 |
| Knows the cut-off: "tomorrow" after 17:00 is caught before ordering, the cut-off named and the next day offered | `evals/paraphrase` `late-tomorrow`, chat trials c1/c4; seen on prod `70c30e2` `/request` ("earliest delivery is Wed 9 Dec") |
| An event in words becomes a plan: brief questions → a menu proposed by Gemini (3.8 Flash), every amount an estimate → the chef accepts → a plan | `core/services/events.ts` `plan_event{proposal}`, `MenuReview.svelte`; seen on prod `70c30e2` (50 guests → 20 lines) |
| Chat: plain words → a held plan and a decision card; "approve it" is refused; answers come from the task's ledger | `server/chat/`, `evals/chat` (scripted trials + 15 messy EN/FI turns replayed in the gate); seen on prod `70c30e2` in the dock (`/agents/chat` now opens the dock over the Kitchen) |
| The Why drawer cites the web (Exa): net content, origin and ingredients, GTIN-cited, with sources | `server/web/evidence.ts`; seen on prod `70c30e2` (ham `462490`, hk.fi) |
| Context.dev watches Ruokavirasto's recall list every 5 minutes; each notice becomes an Ops case matched against the catalogue | `foundations/web.md`, `/api/web/contextdev`; recall cases seen in prod Ops |
| A voided approval shows what changed | eval r6-5 (`get_plan.lastVoided`) |
| Each visitor mints a judge key on `/agents`; it reads but cannot approve | `server/demo/judge-key.test.ts`; observed on prod: `approve`/`set_mandate` → 403 |
| Outside agents get the same tools over MCP and REST and can never approve | `SCOPES_BY_ACTOR` (`core/contracts/tools.ts`); `agent/adversarial.test.ts` (`pnpm eval:agent`); eval s5 `tools.externalAgentMustNotHave` |
| Every visitor gets their own sandbox; a judge key works only there | `server/demo/{visitor,judge-key,sandbox}.test.ts`; two-browser gate `src/routes/ops/visitor-gate.e2e.ts` (production build) |
| Substitutes are ranked with Gemini Decisions, with replay and rules fallbacks (not "recipe-aware": no labelled fit set has run) | `server/adapters/decide`; `DECIDE_LIVE=1 pnpm test:live` (one live call) |
| Valio's milk example runs on `/request`, keeping "lactose-free" | `server/request/fixes.test.ts`, `request.test.ts`; seen deployed with the Gemini parser |
| Approve → order → one receipt, in the Kitchen; the order summary adds up and survives a reload | `evals/ui/kitchen-order.e2e.ts`, green against prod `70c30e2` |

Every claim's observed status and verdict: [CLAIMS.md](CLAIMS.md).

## Not yet claimable
- **The room cascade on screen**: waits for wave K's room fix to be playtested (r1, m1). The hero journey is 10/10 at 1440 and 390 on prod `ea9f4d5` (S5).
- **The menu's product picks up close**: a trout ingredient resolved to pork (BUGS #11); show the menu, not the picks, until fixed.
- **Every sponsor call in the trace drawer**: Valio live, chat Gemini text and MCP `propose_menu` aren't traced there yet.
- **Review mechanism**: on main behind `REVIEW=1`, off until the on/off arms run.
- **Ops coverage numbers**: not until Ops cases close per cause (Track G, F12-ops).
- **Recipe-aware**: no labelled fit set has run; say "ranks by the kitchen's rules" instead.
- **"Ordered the buffet"**: the default agent goal commits nothing; it plans and holds.
- **Context.dev**: not "a real recall hit our orders" (drill only); say "every 5 minutes", never "hourly".
- **Vector search on Aiven / pgvector**: never; the column exists but retrieval is lexical. Also never "schema-constrained" model output.
- **An external agent's stale commit refused on prod over MCP**: covered in tests, not yet observed deployed.
- **Simulator events "labelled simulated"** in the kitchen's own workspace: the synthetic stream runs only in `ws-synth`.
- **Data residency** ("data stays in Finland"): never; D5.
- Parked by D7, never in the pitch: Gemini Live voice, photo input, a 500-kitchen swarm, Nemotron, Modal jobs.

## Next (say as next, never as built)
- **Valio's systems subscribe to the op log (Aiven Kafka + Debezium).** The op log stays the source of truth. Aiven's Debezium connector streams it into Kafka topics, so Valio's ERP, warehouse, forecasting and recall systems can subscribe to held lines, orders and shortfalls with no app change and no dual writes.
- **Usual orders across many kitchens** (D14): detected standing orders make demand dependable for Valio; the app has detection over a simulated history.
- **Margin-aware suggestions**: the "Valio suggests" slot ranks by a stated reason today; with Valio's margin data it could weigh margin, still inside the mandate and never the default.
- **Hybrid retrieval** (D19, held): pgvector on Aiven to widen substitute coverage, only if an offline measurement shows a recall gain; safety stays with hard product checks.
- **Exa monitors for web-wide watch** (supplier and recall news before the official list), next to Context.dev's page monitor.

## Framing we can say truthfully (docs/research/agentic-commerce.md)
- "Our mandate is what Google's agent payments protocol (AP2) calls an open mandate; our approval is a closed mandate bound to the exact terms by a hash; the approval surface is not an agent, and every check runs in deterministic code." Don't claim AP2/ACP compliance, payments or signatures.
- Numbers (cite on a slide, docs/research/pitch-numbers-and-viz.md): Finnish food services waste ~61 Mkg of edible food a year (Luke); ~1 plate in 6 on a serving line is never eaten (Luke field study); EU law requires a 30% per-person cut by 2030; public kitchens serve ~380 M meals a year; buyers beat the algorithm only where they know something it doesn't (Kesavan & Kushwaha 2020), so we ask only at the exceptions. No Finnish online-order or fill-rate figures (none found).

## Q&A crib
- **Why won't Valio's own A.I.mo do this?** We asked it Valio's own example (1,000 L lactose-free milk by Monday); it said it can't confirm availability or price and pointed to sales service. That is right for a knowledge assistant. The missing layer is transactional: stock, price and authority. We built that layer and an open gate A.I.mo could sit on; we don't replace A.I.mo or the webshop. (Say the date we asked.)
- **Isn't this Choco's OrderAgent Autopilot?** Choco claims "only genuine exceptions reach a person" as a vendor feature inside its own app. Ours: the exception rule is the customer's own mandate, enforced in an open interface any agent can use, with approval bound to exact terms.
- **What breaks it?** Unknown supply: we hold and say so, and never call it covered.
- **How are substitutes better than "Katso korvaavat"?** Theirs lists similar products with no reason. Ours gives a reason line per candidate and a rule-based rejection (e.g. an allergen difference).
- **Doesn't the agent ask too much?** What the mandate allows goes through alone: in the buffet, 3 lines (€302.62) are ordered before the chef decides anything. New products, allergen changes, anything over a limit, and products Valio states no quantity for wait for one tap. Most dairy is in that last group: Valio's own figure for it means "unknown". Held lines are grouped into one decision per reason, so an allergen change never rides with routine lines.
- **Images?** None from Valio's data; we show none rather than guess.
- **Valio's words:** order templates (*tilauspohjat*), cart per delivery date, main user (*pääkäyttäjä*), claims (*reklamaatiot*). Our standing order is their template read as the agent's baseline.
- **What did you build vs use? Who pays?** Built: the gate, mandate, ranking, planning, request flow, Ops, MCP/REST. Used: Valio's mock data and API, Gemini, Aiven, Exa, Context.dev. Valio pays; free to kitchens.
