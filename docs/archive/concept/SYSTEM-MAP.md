# Mandate: system map (content source for /story and /how)

_Written Sat 14 Nov from `main` at `b10cd43` (prod runs `70c30e2`/`2c28b4b` per STATUS). Paths are relative to the repo root; `core/` = `src/lib/core/`, `server/` = `src/lib/server/`, `routes/` = `src/routes/`. Claim status uses PITCH.md: **seen live** (observed on prod), **tested** (test/eval on main), **wired** (in code, not seen deployed), **planned** (decision or doc only). "Unverified" = I could not confirm it in code._

One engine, several doors. Every door calls the same tool registry (`core/contracts/tools.ts`) through one gate (`server/tools/serve.ts`), and every state change goes through one pure function (`applyOps`, `core/state.ts`).

---

## 1. Actors and doors

| Actor | Door (route) | Identity comes from | Scopes (`SCOPES_BY_ACTOR`) | May | May not |
|---|---|---|---|---|---|
| **Chef** (head chef / purchaser) | Kitchen `/`, `/request`, chat dock, ApprovalPanel / DecisionCard | signed visitor cookie `mandate_visitor` → own sandbox `ws-j-<id>` (`server/demo/visitor.ts`) | read, plan, order, **approve**, mandate:write, agent:run | plan, edit g/guest, approve exact terms (hold-to-confirm), place order, start an agent run | change the mandate in the app (`set_mandate` is registered but answers `PROVIDER_UNAVAILABLE`; mandates come from the seed) |
| **Kitchen screen** (server side) | `/kitchen-api/{snapshot,scenario,tool/<name>,web/<action>}` | acts as the visitor's chef in-process (`server/kitchen/live.ts`); browser holds no key | chef's | everything the chef clicks, through the same handlers | anything the chef can't |
| **In-app agent** (routine agent, `kitchen_agent`) | chat dock (`/api/chat/{turn,task}`), `/api/agent/run`, Ops presenter button | server-built principal (`server/agent/principal.ts`); scopes = starter ∩ agent | read, plan, order | plan, quote, find substitutes, commit **only what the mandate allows**; ask one clarifying question | approve, change the mandate; "approve it" in chat is refused by rules (`server/chat/understand.ts`) |
| **Outside agent** (judge's Claude, a hotel chain's bot) | MCP `/mcp`, `/mcp/k/<key>`; REST `/api/tools/<name>`; `/api/openapi.json`; `/.well-known/agent.json` | bearer key or path key: judge key `jk_<ws>.<exp>.<hmac>` (`server/demo/judge-key.ts`), env keys, `MCP_KEYS` (`server/auth/`) | read, plan, order (`external_agent`) | 16 of 18 tools (15 while `read_image` is unadvertised), MCP resources `mandate://<kitchen>`, `decisions://open`, 3 prompts | approve (no tool, no scope), `set_mandate`; never acts alone: **every external order line is held** (`external_agent_needs_approval`, `core/mandate/tier.ts`); a refused attempt is logged as `RecordRefusal` (`server/tools/refusals.ts`); metered 120 calls / 30 writes / 20 quotes a minute (`server/tools/key-limits.ts`) |
| **Approver** | (env key only) | `MANDATE_KEY_APPROVER` | read, approve | grant/deny | plan or order |
| **Valio ops** | `/ops` (Problems, Orders, Demand, Queue, Wallboard, Engine room with System on) | same visitor resolver; presenter session for `ws-demo` | read (no approve affordance) | see held/unorderable lines by cause, the op log, traces, recall cases, deep-link to the exact kitchen plan | approve for a kitchen |
| **System / job** | Context.dev webhook `/api/web/contextdev`, synthetic stream `ws-synth` | `system` / `job` actors | system: read, plan, order; job: read | ingest recall notices as `RecordAnomaly`; play the labelled simulated run | approve |

**Authority in one line:** only a person with a chef session grants (Kitchen ApprovalPanel or the dock's DecisionCard, D13); links (`approvalUrl`, `reviewUrl`) only locate, never authorise (D17); the core refuses an approval recorded by an external actor (`core/state.ts`).

---

## 2. Entities

| Entity | What it is (product words, VOCABULARY.md) | Where it lives |
|---|---|---|
| Workspace / scenario run | A visitor's sandbox (`ws-j-…`), shared room `ws-judges`, stage `ws-demo`, simulated `ws-synth`; a run is one resettable scenario context | `core/contracts/primitives.ts`; `server/demo/{visitor,sandbox,run}.ts`; tables `workspaces`, `runs` |
| Kitchen (profile) | One of **7 fictional seed kitchens**: hotel, lunch restaurant, public central kitchen, à la carte, care home, café, ski resort; kind, city, size, receiving days, menu cycle | `core/contracts/kitchen.ts` `Kitchen`; `fixtures/seeds/kitchens.json` |
| Preferences (priorities) | `weights` over price, reliability, Finnish, carbon, organic; normalised; **rank, never authorise**. Presets on Kitchen: kitchen default, price first, Finnish required, lowest carbon, most reliable (preview only) | `Kitchen.weights`; `src/lib/kitchen/view-model.ts` `PRESETS`; `routes/(kitchen)/RulesPanel.svelte` |
| Constraints (requirements) | Hard: origin rules (`prefer`/`require` per category group), allergens `freeFrom` + `unknownCounts` hold/reject + `traces`, tender list only, labels; per need: `NeedRequirements` (e.g. vegetarian label) | `Kitchen.constraints`, `core/contracts/plan.ts` `NeedRequirements`; category words → Valio codes in `core/mandate/categories.ts` |
| **Mandate** | The chef's words + enforceable numbers: line cap, order cap, weekly cap, hard limit (default max(5× order cap, 2× weekly cap)), never-delegated list (`allergen_change`, `new_sku`, `substitute_breaks_preference`, `off_tender_list`, `origin_requirement`); versioned | `core/contracts/kitchen.ts` `Mandate`; MCP resource `mandate://<kitchen>` (`server/tools/mcp-extras.ts`) |
| Usual products / usual order | Standing-order baseline (`usualProducts`, counts as "bought before" for `new_sku`); detected usual orders from a **simulated history** (D14) | `Kitchen.usualProducts`; `core/patterns/{history,usual}.ts`; `server/patterns/usual.ts` (slice in `get_context`) |
| Purchase request | The buyer's words parsed into items, quantity, unit, date, constraints | `server/request/parse.ts`, `classify.ts` |
| Procurement task | Durable objective every surface opens; typed slots, linked plans, pending clarify/decision, ledger computed (never model-written) | `core/contracts/task.ts`; `server/tasks/`; table `agent_tasks` |
| Event / event brief | Occasion, guests, date, requirements; seeded event `event-xmas-140` or a brief built one question at a time | `core/contracts/event.ts` `EventBrief`; `core/demand/event-seed.ts`; `server/menu/brief.ts` |
| Menu proposal | Versioned dishes with amount per guest, each ingredient resolved or visibly unresolved, estimates labelled; `proposed → chef_reviewed → planned`; only the server writes `review` | `core/contracts/event.ts` `MenuProposal`; `server/menu/{proposal,flow,store,pg}.ts`; table `menu_proposals` |
| Dish / dish ingredient | Dish template with yield, ingredient amount per cover; make-in-house recipes | `core/contracts/event.ts` `DishTemplate`, `DishIngredient` |
| **Need** | Physical demand (kg, l, pcs) with lineage (`source`) and requirements; ≠ purchase quantity | `core/contracts/plan.ts` `Need`; `core/demand/{event,menu,sizing}.ts` |
| Product | Normalised Valio product: GTIN, category, origin, pack hierarchy, lot step, carbon, reliability | `core/contracts/product.ts`; `server/adapters/catalog/normalize.ts`; table `products` |
| Offer / candidate | Date-specific price + availability (`AvailabilityKind`: known, unknown, out, undeliverable, blocked…) with `closingTime`; candidates carry a `SupplyTier` | `core/contracts/product.ts` `Offer`; `core/contracts/plan.ts` `SupplyTier`; table `offer_cache` |
| **Plan** | Versioned proposed purchases for one delivery date; `draft → quoted → ready | held → committed` | `core/contracts/plan.ts` `Plan`; table `plans` |
| Purchase line | One SKU + sales qty serving a need; `proposed → eligible | held{tier, reasons} | rejected | unorderable → committed`; `strategy` (product or make in house) | `core/contracts/plan.ts` `Line`, `LineReason` |
| Line / plan views | `LineView` (committable, physical, unit and comparison price, blockedReason, nextAction); `PlanView` (asOf, mandateVersion, validUntil); `FulfilmentView` (exact partition) | `core/mandate/{view,fulfilment,next,due}.ts`; `core/services/views.ts` |
| Approval / decision | Human grant of exact terms: plan version + `termsHash` + mandate version + expiry; `pending → granted | denied | expired | invalidated`; decided per **reason group** | `core/contracts/plan.ts` `Approval`; `core/hash.ts`; table `approvals`; UI `src/lib/ui/DecisionCard.svelte` |
| Order / receipt | Immutable local simulated commitment; per-line `authority` (mandate or `{approvalId}`); receipt lists supplier confirmed vs `awaitingSupplier` | `core/contracts/plan.ts` `Order`, `Receipt`; table `orders` |
| Anomaly / incident | Outage, contention, recall with evidence and affected targets | `Anomaly` in `plan.ts`; `RecordAnomaly` op; `server/web/ingest.ts` |
| Case | Ops work item: one held/unorderable line or recall, with cause (Valio / kitchen rules / the order) | `core/services/cause.ts`; `routes/ops/{Queue,CaseTicket,ProblemCard}.svelte` |
| Enrichment / finding | Web facts as suggestions with sources; never overwrite catalogue facts | `RecordEnrichment` op; `server/web/findings.ts`; tables `enrichments`, `web_findings` |
| **Op log** | Closed union of **9 ops** (CreatePlan, EditLine, RecordOffer, ProposeSubstitute, RecordApproval, CommitOrder, RecordAnomaly, RecordEnrichment, RecordRefusal) in an envelope with seq, actor, via (door), initiatedBy | `core/contracts/ops.ts`; table `ops`. (ARCHITECTURE.md still says 8: stale) |
| Order stages | What was asked / proposed and why / signed / ordered, read from the op log | `core/services/stages.ts`; Ops Orders tab |
| Budget | Locked row per kitchen-week (ISO week of delivery) | table `budgets` |
| Idempotency record | (workspace, caller, tool, key) + request hash, run-scoped | table `idempotency`; `server/demo/idempotency.ts` |
| External call trace | One shape for every Valio, Gemini, Exa, Context.dev, Featherless call | `core/contracts/task.ts` `ExternalCallTrace`; `server/external/call.ts` |
| Calendar feed | iCalendar of decisions due, deliveries, receiving days, Finnish holidays | `core/calendar.ts`; `server/calendar.ts`; `/kitchen-api/calendar.ics`, `/api/calendar/<kitchen>.ics` |
| Scenario clock | One clock: Monday evening, cut-off Tuesday, delivery Thursday, buffet Saturday | `core/scenario.ts` |

---

## 3. Flows, step by step

### (a) One item: request → parse → lookup → rank → gate → order
| # | Step | Entry point |
|---|---|---|
| 1 | Words in ("1,000 L lactose-free milk by Monday") on `/request` or chat | `routes/request/run/+server.ts`, `/api/request`; `server/request/run.ts` |
| 2 | Classify: purchase vs event vs dish-with-count | `server/request/classify.ts`, `server/agent/classify.ts`, `server/request/dish.ts` |
| 3 | Parse: rules first, then Gemini Flash-Lite (`request.parse`); the reading is checked so no stated word is lost (lactose-free survives) | `server/request/parse.ts`, `reading.ts`, `server/review/parse.ts` |
| 4 | Dates against the scenario clock; past cut-off → named, next day offered | `server/request/{dates,days}.ts`; `evals/check.ts` `checkLate` |
| 5 | Lookup: static catalogue search → shortlist ≤5 with reasons → contradicting products filtered → `quote` **only the shortlist** (live Valio, cache-through) | `server/request/{lookup,checks}.ts`; `core/services/quote.ts`; `server/adapters/catalog/valio-live.ts` |
| 6 | Convert the physical amount to sales units by printed content (1 L in 0.5 L packs = 2 packs); conflicting content → hold, no guess | `server/request/convert.ts`; `core/demand/{content,convert,rounding}.ts` |
| 7 | Optional "Rank by" re-orders the shortlist (never changes tier) | `server/request/rank-by.ts` |
| 8 | Size check against the kitchen's own numbers | `server/request/sanity.ts`; `ui/request/OverLimit.svelte` |
| 9 | `place_order` → quote + tier → eligible or held; `commit_order` for what the mandate allows; approval for the rest | `core/services/orders.ts`; `core/mandate/tier.ts` |

### (b) Event / brief → menu → needs → packs → plan → decisions → commit
| # | Step | Entry point |
|---|---|---|
| 1 | Open brief ("Christmas dinner for 50 on 20 Dec") → brief questions one at a time, as chips (guests, date, diet, budget) | `server/menu/brief.ts`; `ui/request/BriefAsk.svelte` |
| 2 | `propose_menu`: Gemini 3.8 Flash (`menu.propose`), zod-bounded, every amount an estimate; fixture path uses team dish templates; rubric issues (block/warn) | `server/menu/{proposal,rubric,tool}.ts` |
| 3 | Grounding: each dish's ingredients compared with 1–2 cited web recipes (Exa) resolved against the catalogue | `server/web/grounding.ts` (called from `server/menu/flow.ts`) |
| 4 | Chef reviews: edit amounts (new revision, `user` provenance), accept → server records review | `server/menu/flow.ts`; `ui/request/MenuReview.svelte`; `/request/menu` |
| 5 | `plan_event{proposal:{id,revision}}`: deterministic, no model; one need per ingredient = guests × amount ÷ yield, with lineage | `core/services/events.ts`; `core/demand/menu.ts` |
| 6 | Seeded event path (`event-xmas-140`): seed → needs (calendar factors, target stock − usable stock − inbound) → lot-rounded lines | `core/demand/{event,event-seed,factors}.ts` |
| 7 | Quote + tier every line; outages trigger substitutes (flow c) | `core/services/{quote,substitutes}.ts`; `core/mandate/tier.ts` |
| 8 | Kitchen shows the event as a diff of a normal week, dish → need → order, coverage rulers, cut-off timeline | `routes/(kitchen)/KitchenScreen.svelte`; `ui/CoverageRuler.svelte`, `ui/viz/CutoffTimeline.svelte` |
| 9 | g/guest edit → one `EditLine` + `RecordOffer`, recomputed in the same call; approval voided | `core/services/events.ts`; `edit_line` |
| 10 | One decision per reason group → approve → `commit_order` → receipt | `routes/(kitchen)/ApprovalPanel.svelte`; `core/services/orders.ts` |

### (c) Substitute / rescue when out of stock
| # | Step | Entry point |
|---|---|---|
| 1 | Line quoted `out` / `undeliverable` / unknown (wording never confuses the two) | `core/services/wording.ts` |
| 2 | Candidate pool: Valio's own substitution rules → seed's hand-checked rescues → same-category catalogue products; lexical retrieval + name normaliser | `core/services/substitutes.ts`; `server/adapters/catalog/retrieval.ts`; `core/demand/basekey.ts` |
| 3 | Size each candidate to the same need (served basis) | `core/demand/sizing.ts` |
| 4 | Rank: hard constraints exclude (with every reason); then **supply tier first** (known stock / make in house > unknown stock > none), then Σ weights·utility + Gemini Decisions fit (0–4); tie on productId | `core/rank/rank.ts`; `server/adapters/decide/index.ts` |
| 5 | Make in house: recipe as AND of ingredients, team-estimate labour note, sign-off tier; D8a lets an all-orderable recipe beat an unknown-supply product | `ProposeSubstitute{kind:'make_in_house'}`; `/api/web/make-in-house` (Exa recipe) |
| 6 | Apply → line held (new SKU, allergen change, broken preference) → decision card; rejected candidate shown with its rule | `ui/RescueCompare.svelte`; `ui/StrategyCard.svelte` |
| 7 | Contention re-rescue: another kitchen takes stock → keep what's left, size next candidate to the rest, approval voids with its diff, Ops anomaly | `core/services/contention.ts`; `/kitchen-api/scenario` contention toggle |
| 8 | Still unresolved → `find_outside` options outside the catalogue, info only, never ordered | `server/chat/outside.ts`; `server/web/lookup.ts` |

### (d) Outside agent over MCP
| # | Step | Entry point |
|---|---|---|
| 1 | Visitor opens `/agents`: own judge key, MCP URL `/mcp/k/<key>`, client configs, tools the key sees, recent calls | `routes/agents/+page.svelte`; `/api/demo/judge-key` |
| 2 | Agent calls `get_context`: who it is, scopes, kitchens, events, mandates, cut-off, open plans with next action, usual-order slice | `server/agent/get-context.ts` |
| 3 | `search_products` → `quote` (unknown ids → `NOT_FOUND` before any Valio call) → `place_order` or `plan_event` → `find_substitutes` → `get_plan` | `server/tools/{mcp-endpoint,mcp,serve,handlers}.ts` |
| 4 | `commit_order`: external lines always held → result carries our own `summary`, `nextAction`, `approvalUrl` | `server/tools/present.ts`; `core/contracts/tools.ts` `ResultMeta` |
| 5 | Agent tries `approve` / `set_mandate` → 403 and a `RecordRefusal` in the op log; Ops shows "an outside agent tried to approve; refused" | `server/tools/refusals.ts` |
| 6 | Chef approves in Kitchen; agent's `get_outcome` reads the receipt | `server/tasks/outcome.ts` |

### (e) Chef approval and void-on-edit
| # | Step | Entry point |
|---|---|---|
| 1 | Held lines grouped by reason (routine vs new product vs allergen change); `approve{lineIds}` decides one group, the rest move to `remainingApprovalId` | `core/services/orders.ts`; `groups.test.ts` |
| 2 | Hold-to-confirm on the exact terms (Kitchen or dock DecisionCard, D13) | `ui/HoldButton.svelte`, `ui/DecisionCard.svelte` |
| 3 | Grant bound to plan version + `termsHash(deliverBy + sorted lines)` + mandate version + expiry | `core/hash.ts`; `core/state.ts` |
| 4 | Any `EditLine` / `ProposeSubstitute` → plan back to `draft`, hash cleared, approvals `invalidated`; `get_plan.lastVoided` returns the `TermsDiff` ("what changed") | `core/state.ts`; eval r6-5 |
| 5 | Commit re-checks under lock: version, hash, mandate version, expiry, cut-off, caps; mismatch → `TERMS_CHANGED` | `core/services/orders.ts`; eval s4 |

### (f) Ops / control room
| Tab | Shows | Entry point |
|---|---|---|
| Problems | Held/unorderable lines and recall cases grouped by cause, biggest first, with "What happened" story | `routes/ops/{ProblemCard,StoryPanel}.svelte`; `core/services/cause.ts` |
| Orders | Each order's four stages from the op log: asked → proposed and why → signed → ordered | `routes/ops/OrdersTab.svelte`; `core/services/stages.ts`; `/ops/orders` |
| Demand | Valio's view per delivery day: ordered / signed / still proposed per product, across kitchens | `routes/ops/DemandTab.svelte`; `/ops/demand` |
| Queue / Wallboard | Cases per kitchen; deep link `?ws&run&plan&v&need` to the exact Kitchen plan | `routes/ops/{Queue,CaseTicket}.svelte` |
| Engine room (System on) | Agent run graph, traces, gate panel ("through the rules, this run"), op timeline, outside-service status/breakers | `routes/ops/{RunGraph,TraceDrawer,GatePanel,OpTimeline,ServiceStatus}.svelte`; `server/external/status.ts` |
| Simulated run | Labelled scripted run across demo kitchens (`ws-synth`): real products, invented quantities | `server/bus/synthetic.ts` |
| Live feed | SSE `/api/events`; Postgres NOTIFY (in-memory bus on PGlite), in-order delivery | `server/bus/{pg,memory,ordered}.ts` |

### (g) Enrichment and recall watch
| # | Step | Entry point |
|---|---|---|
| 1 | Why drawer "from the web": Exa `outputSchema` search for net content, origin, ingredients; per-field citations; labelled live / cache / replay | `server/web/{exa,evidence,lookup}.ts`; `/api/web/{facts,evidence}`; tool `lookup_facts` |
| 2 | Findings stored as suggestions (`RecordEnrichment`), never overwriting catalogue facts | `server/web/findings.ts`; table `enrichments` |
| 3 | Context.dev page monitor on Ruokavirasto's recall list (every 5 min) → webhook → durable queue (written before the 202) → structured extraction | `server/web/{contextdev,watch,queue}.ts`; `/api/web/contextdev` |
| 4 | Match tiers: exact GTIN = hit; brand + words = probable; shared supplier only = lead, never a hold | `server/web/recall.ts`; tool `check_recall` |
| 5 | Hit → `RecordAnomaly` in each run; line reason `recall` holds it; per-run application ledger with retry; new sandboxes get known notices applied | `server/web/{ingest,applications,sandbox}.ts`; eval s7 |
| 6 | Supplier news leads (Context.dev News Search) on open plans' vendors: leads only | `/api/web/leads` |
| 7 | All web calls: response cache, daily caps per key and instance (429 + Retry-After), breaker; state in Postgres (`web_*` tables) | `server/external/{call,ledger,breaker}.ts`; `server/web/{spend,pg-state}.ts` |

### (h) Also real (not in the brief's list)
- **Chat dock** on every page: one turn = classify → (ask one slot) → run the agent → decision card → ledger-checked reply (Gemini `explain`, every number must exist in the ledger). `server/chat/{turn,understand,explain,question}.ts`; `ui/chat/ChatDock.svelte`.
- **Agent loop**: ≤8 steps, deadline, cancel; intents `routine_order`, `seeded_event`, `shortage_repair`, `adjust_need`, `inspect`, `unsupported` (deterministic, before any model); scripted planner on prod, LLM planner opt-in (`AGENT_PLANNER=llm`); planner reads typed, length-bounded facts, never raw supplier text. `server/agent/{loop,intent,facts,runs}.ts`.
- **Usual orders** (D14): detection over simulated history, exposed in `get_context`. `core/patterns/usual.ts`.
- **Calendar subscribe**: decisions due and deliveries in the chef's calendar. `ui/CalendarSubscribe.svelte`.
- **`read_image`** (photo of prep list/delivery note → reading): wired, not live.

---

## 4. Mechanisms that make it trustworthy

| Mechanism | The claim, plainly | How it works | Backed by |
|---|---|---|---|
| One gate | Every caller passes the same checks | `serveTool`: known tool, scope check, zod input, actor from key/cookie never the body | `agent/adversarial.test.ts`; eval s5 `externalAgentMustNotHave`; `routes/ops/visitor-gate.e2e.ts` |
| One state change | Nothing changes except through one function, and every change is logged | `applyOps` over 9 op types; version checks; op envelope with seq, actor, door | `core/state.test.ts` |
| Pure core | The rules are plain code you can read; no model or network decides | `src/lib/core` lint-forbids Svelte, Node, SDKs, server | eslint rule (CLAUDE.md rule 2) |
| No lock across a call | Slow APIs can't block or corrupt orders | Valio/Gemini/web finish before `store.transact` | ARCHITECTURE command flow; `server/store/prepare.test.ts` (a catalogue call inside `transact` throws; the whole Christmas journey must pass) |
| Idempotency | Same order sent N times → one receipt | key per (workspace, caller, tool, key) + request hash; reused key with new payload → `DUPLICATE`; unique per plan + key in Postgres | eval s1, s5; `pg-race.test.ts` (`pnpm test:pg`); `scripts/smoke-race.mjs` after deploy (seen live) |
| Terms-bound approval | A "yes" covers exact price, qty, date only | `termsHash` + plan version + mandate version + expiry; edit voids; commit re-checks | `server/store/gate.test.ts`; eval s4; `view.test.ts` |
| Voided approval shows the diff | You see what changed | `get_plan.lastVoided` `TermsDiff` | eval r6-5 |
| Caps | Never orders alone over line/order/weekly caps, even split | caps gate the act tier; weekly budget row locked in the transaction | eval s5 `CAP_EXCEEDED.weekly` |
| Hard limit | No approval passes the ceiling | `over_hard_limit` forbid | `server/store/ceiling.test.ts` |
| Never delegated | Allergen change, new product, broken preference, off tender list, origin requirement always go to the chef | `neverDelegate` → sign-off/propose tier | `groups.test.ts`; `tier.ts` |
| Reason groups | An allergen change never rides with routine lines | `approve{lineIds}`, remainder re-bound | `server/store/groups.test.ts` |
| Unknown never cover | Valio's ≥999999 "no quantity" is unknown supply, never counted as covering a dish | `FulfilmentView` partition; `UNKNOWN_REQUIRED` for must-cover needs; receipts list `awaitingSupplier` | `core/mandate/fulfilment.test.ts`; `server/store/pool.test.ts` |
| Known stock first | A stated-quantity product outranks any unknown-supply one | lexicographic tier then score | `core/rank/rank.ts`; `pool.test.ts` |
| Cut-off | Can't buy after Valio's closing time; never moved silently | commit `FORBIDDEN.cutoff`; request names the cut-off and offers next day | `server/store/cutoff.test.ts`; eval r5-f9; `evals/paraphrase late-tomorrow` |
| Lot rule | No part packs | round up to lot step; below lot → `BELOW_LOT` | eval s3; `core/demand/rounding.ts` |
| Physical amounts | 10 L of milk is sized in litres, not packs | content from name/net weight, cross-checked | `server/store/direct.test.ts` |
| Hard requirements | A vegetarian dish stays vegetarian; lactose-free survives | need requirements; request checks filter contradictions | `vegetarian.test.ts`; `server/request/fixes.test.ts` |
| Per-line authority | Every committed line names what allowed it | `authority: mandate | {approvalId}`; mandate never for external callers | `server/store/authority.test.ts` |
| Model can hold, never allow | A model's caution can only add a hold | `CAUTION.model_fit/_constraint` reasons | `core/services/substitutes.ts` |
| Supplier text is data | Injected product text can't steer the agent | planner gets typed, bounded facts; MCP instructions say so | `server/agent/facts.test.ts`, `adversarial.test.ts` |
| Chat never approves | "approve it" is refused; approval is a UI act | rules guard around `chat.understand` | `evals/chat`; `evals/ui/dock-approve.e2e.ts` |
| Honest words | "Supplier confirmed" only with a receipt | ledger-checked `explain`; outcome review | `server/chat/explain.ts`; `server/review/outcome.ts` (review behind `REVIEW=1`) |
| Sandboxes | Each visitor's world is their own; a key works only there | HMAC cookie + stateless judge keys | `server/demo/{visitor,judge-key,sandbox}.test.ts` |
| Tracing | Every outside call logged with model, tokens, latency | one `ExternalCallTrace`; Ops TraceDrawer; spend caps per workspace/instance | `server/adapters/llm/trace.ts`; **not all** sponsor calls reach the drawer yet (PITCH) |
| Fidelity | Same words → same basket via `/request`, agent and REST | cross-entry suite | `evals/fidelity/cases.json` (`pnpm eval`) |

---

## 5. Models and sponsors

| Partner | Where it sits | Job / model | Fallback | Status |
|---|---|---|---|---|
| **Valio Aimo** | Catalog port: 17,546-product catalogue (static, `data/valio/`); live `price` + `availability` for shortlisted ids only (≤200/call), cache-through, availability refetched after 15 min | `server/adapters/catalog/{valio-live,pg,valio}.ts` | cached offer labelled with its age; file catalogue; simulator overlay for scenario stock | seen live |
| **Gemini Flash-Lite** (`gemini-3.5-flash-lite`, minimal) | LLM port, router jobs `request.parse` (600), `chat.understand` (400), `explain` (400), `agent.plan` (600, opt-in), `agent.review_rewrite` (200) | `server/adapters/llm/router.ts` | rules parser / deterministic classifier / ledger's own text; `LLM_PROVIDER=fixture` | parse + chat seen live; agent.plan not on prod |
| **Gemini 3.8 Flash** (low, 4,000) | `menu.propose` | `server/menu/proposal.ts` | team dish templates | seen live |
| **Gemini Decisions** (`gemini-decision-1`) | Decide port: dish-fit score 0–4 inside substitute ranking; optional rubric scores in review | `server/adapters/decide/index.ts` | recorded replay (`replay.json`) → rules | tested (`DECIDE_LIVE=1 pnpm test:live`); "recipe-aware" not claimable |
| **Aiven** | Runtime (one container, `adapter-node`), Postgres (Frankfurt) for all tables, NOTIFY for live Ops, web state | `server/db/client.ts`; `server/bus/pg.ts` | PGlite + same migrations (fixture, tests, offline) | seen live; pgvector enabled but **unused** |
| **Exa** | Web port: cited product facts (Why drawer), outside-catalogue options, make-in-house recipes, menu grounding | `server/web/{exa,lookup,evidence,grounding}.ts` | recorded responses (`web/fixtures/exa.json`); daily caps | Why-drawer facts seen live |
| **Context.dev** | Recall monitor on Ruokavirasto (5 min), structured extraction, webhook; News Search leads | `server/web/{contextdev,watch,recall}.ts` | recorded notices; labelled drill (`/api/web/replay`) | cases seen in prod Ops; no real recall has hit an order |
| **NVIDIA Nemotron VL on Verda** | `image.read` for `read_image` | `server/adapters/llm/verda.ts`; `server/images/` | tool not advertised without `VISION_LIVE=1` | wired, not live |
| **Featherless (Gemma)** | LLM provider option in the router; no job routed to it | `router.ts` provider `featherless` | n/a | wired, unused |
| Modal, Gemini Live, 500-kitchen swarm | none | n/a | n/a | parked (D7, D19) |

---

## 6. Surfaces

| Route | What a judge sees |
|---|---|
| `/` Kitchen | Label bar (real / scenario / simulated); mandate in the chef's words; kitchen switcher; task header; the Christmas buffet for 140 as a diff of a normal week; dish → need → order with g/guest stepper and coverage ruler; cut-off timeline; rescue compare; Why drawer (worked chain + web facts); "Same shortage. Your rules." presets + contention toggle; one decision per reason group; Place order → receipt; Start over (sandbox) |
| `/?plan=` · `/?chat=1` | Opens a plan; opens the agent dock |
| `/offline` | Same screen on a browser copy of the seeded plan, labelled stand-in |
| `/request` | Valio's milk flow as steps: request → reading → lookup (shortlist with reasons, live/cache label) → order → approval; date control, over-limit, dish path; event briefs → questions → menu review → plan |
| Chat dock (every page), `/agents/chat` | Plain words → held plan + DecisionCard; one clarifying question; refuses "approve it"; answers from the task ledger; chef can approve on the card (D13) |
| `/ops` | Problems, Orders (four stages), Demand, Queue, Wallboard, Engine room (System toggle); simulated-run view; deep links to Kitchen |
| `/agents` | Your judge key, MCP URL, client configs, recent calls, what the agent reads first, tools (16/15), resources and prompts, a typical session, assumptions |
| `/mcp`, `/mcp/k/<key>`, `/api/tools/<name>`, `/api/openapi.json`, `/.well-known/agent.json` | The machine doors |
| `/api/agent/run` | Start an agent run (chef key), NDJSON trace stream, cancel |
| `/healthz` | Deployed commit |
| Calendar `.ics` | Decisions due and deliveries in a calendar app |
| Site `mandate.kitchen` (`/`, `/story`, `/how`, `/proof`) | Landing, nine-slide story, step-by-step how, claims with evidence |

---

## 7. Built vs planned vs simulated

| Item | Status | Label on screen |
|---|---|---|
| Approve → order → one receipt in Kitchen | **seen live** (prod `70c30e2`, `kitchen-order.e2e.ts`) | local simulated commitment |
| Race: same key ×4 → one receipt | **seen live** (smoke) + tested | |
| Judge key can't approve (403) | **seen live** | |
| Menu from a brief (Gemini 3.8 Flash) → plan | **seen live** on `/request` (50 guests → 20 lines) | estimates |
| Chat → held plan + decision card; refuses approve | **seen live** `/agents/chat` | |
| Why drawer with Exa facts | **seen live** (ham `462490`) | live / cache / replay |
| Recall cases in Ops (Context.dev, 5 min) | **seen live**; no real recall matched an order | drill = labelled |
| Cut-off caught on `/request` | **seen live** | |
| Terms-bound approval, ceiling, caps-split, lot, unknown-not-cover, per-line authority, reason groups, cut-off at commit, rescue resize, vegetarian kept | **tested** | |
| UI void-on-edit, rank presets on prod, ranked rescue on prod | **wired**, rehearse before claiming | |
| External agent's stale commit refused over MCP on prod | **tested**, not seen deployed | |
| Gemini Decisions in ranking | **tested** (one live call); "recipe-aware" not claimable | |
| Every sponsor call in the trace drawer | **partly**: Valio live, chat Gemini text, MCP `propose_menu` not traced there | |
| Review mechanism | **wired** behind `REVIEW=1`, off | |
| Usual orders (D14) | **wired** (core + `get_context`); no Week view | simulated history |
| Contention re-rescue | **tested** (`contention.test.ts`) | simulated |
| Ops coverage numbers per cause | **not claimable** (Track G) | |
| New events from chat | **planned**: chat plans only the seeded buffet | |
| Menu product picks | **not claimable** (BUGS #11: trout → pork) | |
| `read_image` / Nemotron | **wired, not live** | |
| Featherless | **wired, unused** | |
| Establishment picker, chat-first home, `/request` merge (D15) | **planned**; not found on main (unverified) | |
| One `meets()` evaluator for hard constraints (D16) | **planned**; not in core | |
| Need-bound lines + core `commandKey` (D18) | **partly**: per-entry fixes (R11-01/02/03), core `commandKey` not landed | |
| pgvector hybrid retrieval (D19) | **held**; retrieval is lexical, never claim vector search | |
| Kafka/Debezium op-log stream, margin-aware suggestions, Exa monitors | **planned** ("next") | |
| Data residency in Finland | **never** (Frankfurt) | |
| Scenario data | booking, stock-on-hand, recipes, December clock = **scenario**; normal week = **team estimate**; mandate amounts = **team estimates**; kitchens fictional; salmon contention, shifted cut-offs, Ops simulated run = **simulated** | |

---

## 8. Site coverage gap (current /story and /how)

| Item | /story | /how | Note |
|---|---|---|---|
| Actors: chef, kitchen screen, in-app agent, outside agent, ops | partly (gate diagram: Kitchen, chat, outside agent) | partly (doors band) | Ops as an actor, approver, system/job: no |
| Authority differences (who can approve) | yes | yes | D13 dock approval, D17 links-only: no |
| Kitchen profiles (7 kinds) and their differing mandates | no (hotel only) | no | "same shortage, different kitchens" is a strong unused beat |
| Preferences / weights / presets | no | partly ("origin preference") | "Same shortage. Your rules." absent |
| Mandate words + caps + never-delegated | yes | yes | tender list, origin `require`, allergen `unknownCounts`: no |
| Hard limit vs caps | partly | yes | |
| Event brief → menu → needs → packs | yes (cascade) | yes (steps) | grounding with web recipes: no |
| Menu review as a chef act / revisions | no | partly | |
| Rescue: swap, make in house, move the day, hold | yes | partly | contention re-rescue: no |
| Ranking (known stock first, weights, Decisions fit, rejection with rule) | partly | partly | candidate funnel / rejected candidate: no |
| Coverage certainty (5 states) | yes | partly (honest receipts) | |
| Approval bound to terms, void-on-edit, "what changed" | partly (claim line) | yes (state machines) | the diff itself: no |
| Reason groups | no | partly (allergen change apart) | |
| Idempotency / one receipt | yes | yes | |
| Cut-off | yes (move the day) | yes | calendar feed: no |
| Agent itself: intents, loop ≤8 steps, scripted vs LLM planner, facts not raw text | no | no | **biggest gap** |
| Chat dock: clarifying question, ledger-checked reply, refuses approve | partly (one line) | partly (one line) | |
| Procurement task + ledger + `get_outcome` | no | no | |
| MCP/REST door: `/agents`, judge key, tools, resources, prompts, rate limits | partly (CTA + URL) | partly (doors) | `get_context` first, `nextAction`, refusals logged: no |
| Ops / control room (Problems, Orders stages, Demand, Engine room) | no (one proof line) | no (link only) | **big gap** |
| Op log (9 ops, actor, door) | no | partly (applyOps line) | |
| Enrichment: Exa facts as suggestions, never overwrite | partly (partners tab) | partly | |
| Recall watch: monitor → match tiers → hold | partly (partners tab) | partly (`recall` hold) | match tiers, leads, durable queue: no |
| Sponsors and their roles | yes (partners tabs) | yes (ports table) | Verda/Nemotron, Featherless: no (correctly not claimed) |
| Fallbacks per port | partly (one line each) | yes (ports table) | breaker, spend caps, cache labels: partly |
| Tracing / spend caps | no | partly (fixture rule) | |
| Sandboxes per visitor, judge keys | partly | no | |
| Usual orders (D14) | no | no | wired, simulated history |
| Built vs planned vs simulated | partly (labels, proof list) | partly | no single honest table; /proof covers claims |
| Old /how assets dropped | — | — | 5-zone clickable system map and "one order line through the system" (ham NEED→RECEIPT) were on `8f21187`, removed since |
