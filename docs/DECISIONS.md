# DECISIONS

`D#` · choice · why · what would reopen it. Append only.

### D0 · SvelteKit 2.70, scaffolded with `sv@0.17.1`, not Kit 3 — 13 Nov
_Adapter superseded by D3 (Aiven, `adapter-node@^5`); the Kit 2 choice stands._ Kit 3.0 shipped 1 Oct 2026 (six weeks ago), and `sv` ≥1.0 scaffolds it by default. We stay on Kit 2 because the coding agents' training knowledge and our own experience are Kit 2. On Kit 3 every agent would be guessing at changes, which is costly with parallel lanes in auto mode. Kit 2.70.4 is still maintained, and its peers (Svelte 5.57, Vite 8) are the same versions, so we lose nothing we'd use. Pair it with `adapter-vercel@^6` (7.x requires Kit 3). Reopen if: a library we need requires Kit 3.

### D0b · IndexedDB (Dexie) for datasets, localStorage for prefs, both behind StoragePort — 13 Nov
_Superseded by D3 (Postgres; localStorage only for UI prefs)._ "Lots of data points" exceeds localStorage's ~5 MB, and having no server DB keeps the overhead low. Reopen if: the challenge needs state shared across users (then use a tiny hosted SQLite behind the same port), or it's the MariaDB challenge.

### D0c · d3 for maths and 2D; one optional 3D hero view behind a 1h spike — 13 Nov
3D impresses but costs readability and time. Reopen if: the spike shows 50k nodes smooth *and* 3D reveals structure 2D can't.

### D0d · Deploy on Vercel (`adapter-vercel`); fallback Fly (`adapter-node`) — 13 Nov
_Superseded by D3 (one container on Aiven Runtime, fallback a Verda VM; not Vercel)._ Least ceremony for SvelteKit: git push deploys, streaming responses work, preview URLs per branch. `fly` CLI is already installed as the fallback. Deploy the *empty scaffold* at 19:30 so deploy problems surface before anything matters. Reopen if: we need long-running jobs over 5 min (move them to Modal, not off Vercel), or Hostinger offers a prize for hosting there.

### D0e · LLM behind one port with four adapters plus a fixture — 13 Nov
`@ai-sdk/anthropic`, `@ai-sdk/google`, and `@ai-sdk/openai-compatible` (Featherless, Verda), plus fixture. Lets us pick the best model per task and show sponsor use without rewiring. Reopen if: the `ai` SDK fights a needed feature (then call the raw SDK inside the same adapter).

### D1 · First going plan: Valio Aimo "trusted trade agents" with a live immune system (Mandate) — 13 Nov ~21:30
Main challenge Valio Aimo, with Gemini API, Nemotron, Modal, Verda and Context.dev stacked as load-bearing parts ([concept/CONCEPT.md](concept/CONCEPT.md)). Why: the biggest software-only main prize. Its rubric (end-to-end 30, autonomy and controls 20, robustness 15, openness 15) rewards the gate, mandate and provenance design we already have. Every side prize gets a central role, and the swarm plus a judge's own agent gives the peer-review "no way" moment. Beat: finance slice (crowded, mobile-first scoring) and Wikipedia through time (original, but smaller prizes and needs a MariaDB server). Reopen if: Valio's mock API is too thin (spike), or a better idea scores higher in `idea-pick` before lanes fan out.

### D2 · Team name `j(x)`, ASCII fallback `jx` — 13 Nov
Solo team, so `j` can be all three at once: Junction, the person, and the function that turns the unknown challenge x into a demo. It reads as `f(x)` at a glance, and the pitch closes on `x = <challenge>` → `j(x) = <product>`. Reopen if: the platform refuses brackets (use `jx`) or the name is already taken.

### D3 · One container on Aiven; data in Aiven Postgres — 13 Nov ~23:00
The app ships as one container (`adapter-node` + Dockerfile), so the host is a config change. Primary host: Aiven Runtime (needs enabling by Aiven, in #aiven). Fallback: a Verda CPU VM. Emergency: Vercel. Data lives in Aiven Postgres in a Finnish region: orders, pending approvals, mandates, learned rules, the op log as JSONB, pgvector for the novelty check, and LISTEN/NOTIFY to stream ops to the live dashboard. Local dev uses Docker Postgres or PGlite as the fixture adapter. Browser storage keeps only UI preferences (replaces D0b for this concept). Why: outside agents, the swarm and the phone approval view all share state, so it has to live on a server. Vercel's function time limits clash with long dashboard streams and MCP sessions, and it isn't a sponsor; Aiven is (€1k best-use prize, mentors on site, EU). MariaDB was considered for its system-versioned tables, but its prize is Wikipedia-only, it would need self-hosting, and our op log already gives history. Reopen if: Runtime isn't enabled by Sat 10:00 (go to the Verda VM), or Aiven Postgres latency hurts the swarm.

### D4 · Big scope, built straight on the real stack, in rings — 14 Nov ~01:30
We build the big version (Kitchen, Operations, open agent interface, web intelligence, Lab, Personal), but in rings with one integration target each: Ring 0 spine (one kitchen, a Christmas event as a diff, one real shortage rescue, approval bound to exact terms, idempotent commit, cumulative caps, Gemini decisions, Postgres, MCP gate, deployed) → Ring 1 visible value (Operations, Context.dev change, Exa discovery) → Ring 2 scale and proof (Lab/evals, Modal jobs, Gemma/Verda) → Ring 3 extra entries (Personal for S-Pankki, Nemotron documents). No serial hardcode → JSON → SQL ladder: contracts first, then lanes build directly on the real stack (Drizzle + Postgres, with PGlite as the fixture), each with a fixture path; isolated experiments only where something is unknown. Lanes run in parallel; a ring counts as done only when a full journey works deployed. Why: the user wants the big version and moves fast with many agents; the outside review (docs/archive/review/REVIEW-GPT-6.md) is right that disconnected pieces lose, so integration is the gate, not the build order. Reopen if: Ring 0 isn't deployed by Sat ~10:00 (then pause rings 2–3 lanes and swarm on the spine).

### D5 · Service roles and integration choices, from the foundation notes — 14 Nov ~02:00
- **Valio:** cache-through adapter (key = endpoint + customer + date + sorted ids; `data/valio/cache/`), ≤4 concurrent, ≤200 ids per call, backoff; **our simulator owns time, cut-offs and stock** because the mock API ignores date/customer and is static. Validate ids against the catalogue first (unknown id looks like "not deliverable"). Rank Valio's own `substitutions` rules first. Availability 999999 = unknown; empty schedule lines = undeliverable.
- **Unknown means hold:** missing availability, carbon or allergen data never counts as fine or as zero.
- **Gemini:** Decisions API (`gemini-decision-1`, v1beta, `@google/genai`) for recipe fit, hard-constraint checks per candidate and the act/propose/sign-off grey zone; hard limits stay in code. Price, carbon and reliability are weighted in code (one formula, frozen in the contracts). Fallbacks: replay of recorded answers, then rules, each tagged with its source.
- **Models:** Gemma (`gemma-4-E4B-it` on Featherless, or Modal endpoints) for the simulated kitchens; Nemotron 3.5 Super VL for documents only once a key works (stretch). Images as bytes.
- **Modal:** jobs only (catalogue normalisation/enrichment, Lab episodes, swarm, Sandboxes), writing back through our API; the Valio simulator stays in the app.
- **Data:** Drizzle + postgres-js on Aiven (Hobbyist, Helsinki); PGlite snapshot as the fixture for lanes, tests and offline demo; append-only `ops` with `seq` cursor; NOTIFY → SSE with replay.
- **MCP:** v2 server, stateless, inside SvelteKit; one tool registry → MCP + REST + OpenAPI; scoped keys so contexts that read untrusted text never see `place_order`; approval only via a separate authority, bound to a terms hash + version; idempotency keys on commit; cumulative spend caps.
- **Cloudinary:** Valio data has no product images, so only a document workflow (receipts, prep lists) or drop it. **No data-residency claim** (Modal runs in US regions).
Reopen if: a foundation assumption breaks in the lanes (note it here with the evidence).

### D6 · Contract rulings (from the round-2 review, docs/archive/review/REVIEW-GPT-6-ROUND2.md) — 14 Nov ~03:15
These overrule any conflicting foundation or research note; the contracts implement them.
- **Keys and numbers:** the six-digit Valio `productId` is the product key (GTIN is optional packaging identity). Money in integer cents; quantities as decimals with an explicit unit, basis (sales unit vs comparison unit; gross / net / drained weight) and rounding. `allowedLotSize` is a hard minimum and step. Terms hashes are over a canonical serialisation. Every record and op carries `workspaceId`, `runId` (simulation/demo run) and a server-derived `actor`.
- **Availability kinds:** `known | unknown | out | undeliverable | blocked`, keeping the raw value. Terminal 999999 = `unknown`; the huge-number "unlimited" sentinel is an assumption until a mentor confirms it. Unknown supply never counts as cover, and an approval can't make it known.
- **State machines.** Plan: `draft → quoted → ready | held → committed`; any edit invalidates the quote and approvals. Line: `proposed → eligible | held{tier: propose|sign_off, reason} | rejected | unorderable → committed`, with a fulfilment amount and residual; "acted" in the evals = committed by the agent within the mandate (tier `act`). Approval: `pending → granted | denied | expired | invalidated`, bound to plan version + terms hash + mandate version + authority + expiry. A committed order is immutable; failed attempts are separate outcomes. Approved ≠ stock confirmed.
- **Errors:** `INVALID_INPUT, NOT_FOUND, FORBIDDEN, STALE_VERSION, TERMS_CHANGED, UNKNOWN_REQUIRED, INSUFFICIENT_STOCK, BELOW_LOT, CAP_EXCEEDED, DUPLICATE, PROVIDER_UNAVAILABLE`, each with `retryable`.
- **Ranking (frozen):** hard constraints and verified facts first; candidates from Valio's `substitutions` rules, then domain search (a supplier rule is provenance, not a bypass). Score = Σ wⱼ·utilityⱼ (price, carbon, origin, reliability; weights normalised, fixed utility scales) + w_fit · fit/4 (Gemini recipe fit, 0–4). Missing values never score favourably. Deterministic tie-break on productId. Return component scores, exclusions and residual demand. A model can escalate uncertainty, never grant an exemption.
- **Ops (closed union):** `CreatePlan, EditLine, RecordOffer, ProposeSubstitute, RecordApproval, CommitOrder, RecordAnomaly, RecordEnrichment`. A pure `applyOps` validates and reduces; one server command handler authorises, locks and persists state + ops in one transaction.
- **Concurrency:** Ring 0 has **no pending reservations**: revalidate and atomically consume simulator stock at commit (`… where available >= qty`). Cumulative caps use a locked budget row, not two SUM queries. Idempotency is unique per (workspace, caller, key) with a request hash; same key + different payload = conflict. Never hold DB locks across model or API calls. Reservations with expiry (research/supply-chain.md) come in Ring 1.
- **Event cursor:** a per-workspace sequence allocated under lock inside the mutation transaction (bigserial can skip under concurrency). Clients subscribe first, then catch up, deduplicate, and poll on reconnect.
- **Caller scopes:** the external demo client is approval-required; the internal routine agent may act within the mandate. Jobs (Modal) write only through scoped APIs, never straight to the DB.
- **Estimates stay suggestions:** an LLM-inferred allergen clearance or pack size never becomes an authoritative fact.
- **Demand:** demand + target stock − usable stock − confirmed inbound, rounded up to lots; a closure is an overriding mask (factor 0); published dish portion grams are not ingredient composition.
- **Leave out of Ring 0:** workflow engines, learned memory, training, multi-user onboarding, vector novelty, reservation expiry, product-map embeddings, MCP App rendering (keep ids and ports for later rings).
Reopen if: an eval or the peer review shows a ruling blocks a Ring 0 story.

### D7 · Sponsor focus (sponsor audit + user, 14 Nov ~02:40)
Pursue: **Valio** (main), **Gemini** (Decisions inside substitute ranking + request parsing), **Aiven** (Runtime + Postgres, race proof, reload recovery), **Context.dev** (recall/change monitor → anomaly → held lines + ranked substitutes) and **Exa** (discovery: manufacturer/spec facts for missing allergen/pack data and outside-Valio alternatives, always suggestions with sources). Extensions if convenient: **Modal + Gemma** (one enrichment job writing back through the API). Parked, reopen with spare time: AfterQuery, Verda, S-Pankki, Nemotron, Cloudinary. Why: each kept sponsor strengthens the core product and can be shown working; the parked ones are separate products or need harnesses we don't have. Reopen if: Ring 0 + R1 are deployed and green with time to spare. Source: docs/archive/prep/research/sponsor-touchpoints.md.

### D8 · Supply tier ranks first (lead, 14 Nov ~08:30; amends D6 ranking)
_Tier names amended by D10: `known_stock` / `unknown_stock`._ Substitute ranking is lexicographic: `SupplyTier` first (`confirmed` stock or `make_in_house` from confirmed ingredients > `unknown` Terminal > `none`), then the weighted score. Unknown candidates stay visible and labelled, never recommended over confirmed ones. Why: D6 already says unknown never counts as cover; ranking it first contradicted that (F5: lanttulaatikko's recommended rescue was Terminal 462157). Reopen if: suppliers give reservations with expiry (then confirmed-by-reservation joins the top tier).

### D9 · One visitor identity: signed per-visitor workspace + stateless judge keys (lead, 14 Nov ~08:30)
Each public visitor gets `ws-j-<id>` from a signed cookie (HMAC with `JUDGE_KEY_SECRET`), lazily seeded; Ops, Request, Kitchen, SSE, web actions and resets resolve through one resolver (Track G). External agents get runtime judge keys `jk_<ws>.<exp>.<hmac>`: bound to that workspace's current run, judge scopes (no approve), expiring at the event's end. `ws-judges` stays as a named shared room. Approval links locate a plan; they never grant authority. Why: peer review means many concurrent visitors (F1/F2), and HMAC needs no key table or migration. Reopen if: we need revocation of a single key before expiry (then a DB key table).

### D10 · Shared purchasing vocabulary and requirement lineage (lead, 14 Nov ~09:30; from GPT round 6)
Adopt [concept/VOCABULARY.md](concept/VOCABULARY.md) as the semantic contract for active code and copy: **supplier confirmed** only for receipt-backed quantities; **planned**, **ordered, awaiting supplier**, **known-stock candidate** are distinct; "needs your approval" only when a human can resolve it; need ≠ purchase quantity; scenario run ≠ agent run ≠ procurement task; request budget ≠ delegated limit ≠ hard limit. T0.1 renames `SupplyTier` to `known_stock | make_in_house | unknown_stock | none`, adds lineage (`Need.source`, `Line.strategy`, `Plan.source`, receipt `lineId`) and a server-recorded menu review (`MenuProposal.review`, `MenuStore`, `plan_event{proposal:{id,revision}}`). Legacy wire fields (`LineView.confirmedCover`) stay with adapters; no repo-wide rename mid-fan-out. Why: names are promises; three certainty levels shared one word. Reopen if: a judge-facing label still overclaims after Integration 2.

### D11 · Ring 2 shape: procurement task, live sponsors, System layer (lead + user, 14 Nov ~14:00)
The procurement **task** is the primary object every surface opens (Kitchen task page with Decide / Plan / Order, chat dock, Ops, MCP `get_outcome`); its ledger is computed from FulfilmentView and receipts, never written by a model (T1: `contracts/task.ts`, `agent_tasks`, `Plan.taskId`). Prod uses **live sponsor calls** (Valio cache-through with short TTL, Gemini Decisions batch with probabilities shown, Exa/Context.dev surfaced) with fixtures only for tests and labelled fallback. The UI speaks plain words by default and a **System layer** toggle shows the mechanics (formula, funnel, gate, approval seal, op ids); Ops is the explainer. Chat never approves. Why: four Ring 2 reviews (archive/handoff/ring2/) found an honest engine behind a flat UI, an agent not yet chat-safe, and sponsors used invisibly or through mocks. Reopen if: the task page or chat can't reach a green deploy by the 22:00 video checkpoint (then ship the task page without chat).

### D12 · Gemini model per LLM job, chosen by measurement (lead + user, 14 Nov ~19:00)
The user questioned Flash-Lite everywhere. D measured each router job on our own eval inputs (~10 runs per cell; [research/gemini-models.md](research/gemini-models.md)): `gemini-3.8-flash` (low; it rejects `minimal`) matched Flash-Lite's pass rate on parse, plan and explain at ~3× the latency, and `gemini-4-hydrogen` broke the planner's JSON. So **Flash-Lite (minimal) stays for request.parse, agent.plan, review_rewrite and explain; menu.propose moves to 3.8-flash (low, 4,000 tokens)**, the one job where quality rose (rubric 10/10 vs 8/10) and a one-off ~10 s wait is acceptable. Every route sets a thinking level; models come from the router job, never hard-coded. Decisions stays `gemini-decision-1`. **Reopen** per job when a new job (chat.understand) is measured, or an eval shows a model-bound miss.

### D6 amendment · Valio's availability semantics confirmed (Valio Aimo mentor, event Discord, 14 Nov)
Availability ≥ 999999 = **unknown**, and orders of any quantity are allowed (so every such sentinel maps to `unknown`, not only Terminal 999999; 8d). Empty = not available. `closingTime` = the cut-off for `availableDate`. `allowedLotSize` 0.01 → 1. HTTP 429 = a 30 s block. The "unlimited is an assumption" note in D6 is closed: it is unknown, and unknown never counts as cover. Reopen if: Valio publishes real quantities above the sentinel.

**D3 amendment (14 Nov evening):** the database and the app run in AWS `eu-central-1` (Frankfurt) on Aiven, not a Finnish region; pgvector is enabled but unused. Claim "EU (Frankfurt)", never Finland. See [concept/PRIVACY.md](concept/PRIVACY.md).

### D13 · The chef approves from the dock too; the agent never approves (lead, 14 Nov evening)
The chat dock shows the same DecisionCard as the Kitchen, and a human chef can approve there: the same exact terms, the same hold-to-confirm, the same Kitchen approve command bound to the rendered plan version. It is a UI control acting as the signed-in chef, never a chat turn, a model output or an agent tool, so D9/D11 hold: no agent, key or model can approve. Why: the user, testing on prod, got stuck in the dock without the Kitchen page ("continue" repeated the same held decisions). Reopen if: approving in the dock ever happens without the full terms on screen.

### D8a · Make in house from ingredients Valio states no stock for (lead + 8d, 14 Nov; amends D8)
D8 preferred the seed's recipe over a product of unknown supply only when every ingredient was known stock. Valio confirmed that availability ≥ 999999 means orderable in any quantity with availability unknown, and four of the five lanttulaatikko ingredients carry it. So **a recipe whose ingredients are all orderable (known stock, or ≥999999-unknown; none out, blocked or undeliverable) beats a product no better than unknown supply**; a known-stock product still beats any recipe, and an all-known recipe is still the strongest rescue. The line says so ("Valio doesn't state stock for 4 of 5 ingredients"), reads unknown supply (never cover) and is held at propose. Reopen if Valio states stock for those ingredients, or a recipe from unknown ingredients is shown to fail more often than the product it replaced.

### D14 · Order history and usual orders: per kitchen, a window of days to months, patterns detected (user, 14 Nov evening)
**Choice:**
- Order history is per kitchen (client).
- The window is the kitchen's to set in days, weeks or months. The default is 12 weeks and the range tops out at a few months: beyond that, history only says how settled a pattern is.
- Patterns are detected, not configured. Per product, find the period it recurs on (weekly per weekday, every n days, or monthly) and how settled it is (seen k of the last n periods, quantity spread). The result is a "usual order" per delivery day.
- A usual order is a suggestion until the chef confirms it. Confirmed, it becomes a plan through the normal path (`applyOps`), with top-ups on top. It grants nothing on its own: a standing order is a commitment only through the mandate (memory-and-tenancy, GROWTH rule 1).
- The mock has no real history, so it uses a seeded history per kitchen, generated from the kitchen's profile rhythm (horeca-profiles §3) and labelled "simulated history" wherever it shows.

**Why:** recurring orders make demand dependable for Valio and routine ordering one tap for the kitchen (booth notes). Detection over a short window is honest and cheap. Explicit period settings serve kitchens whose rhythm detection misses.

**Reopen if:** Valio supplies real order history (then it replaces the seed), or detection proves unstable on a 12-week window.

### D15 · One entry: join as an establishment, then chat-first, then the Kitchen as a canvas (user, 14 Nov night)
**Choice:** the app's flow is one shape, built before the freeze:
1. **Join as an establishment.** The first screen in a fresh sandbox asks who you are cooking for. Pick one of the seeded kitchens (hotel, lunch restaurant, school kitchen, à la carte, care home, café, ski resort), each with its profile, rules and preferences, or describe your kitchen in a sentence. The description maps to the nearest profile (rules in the fixture path, Gemini when live), stays visible, and is editable as the kitchen's notes. It changes no rule without the chef.
2. **Chat-first home.** One composer is the entry, with chips suited to the profile. The request pipeline (parse → lookup → order) runs inside the agent: its steps show as cards in the chat (B's step cards), with the date control and edit-in-place inside the card. A dish with a count goes down the dish path (ready-made vs from raw, ratio reasoning). `/request` as a page is retired and redirects to the home with the text; `/request/menu` stays as an API.
3. **The Kitchen is the canvas.** When the first plan exists, the Kitchen view (the basket) opens as the main area and the chat docks into the right rail (Decide at the top of the rail). Edits on either side show on the other.

**Why:** today the demo lands on one hard-coded Christmas buffet, and request, chat and Kitchen are three doors to one job. One path from who-you-are, to what-you-need, to the basket is the clean shape the user asked for.

**Staged (user, same night):** stage 1 lands the current request and chat rework as they are (B: date control, edits, dish path, over-limit, personalisation on /request, with `interpretDish` and the pipeline exposed as server functions; E: chat bugs, calling `interpretDish`), plus the establishment picker and joinable kitchens. Stage 2, the merge (cards in chat, the home's three states, /request redirects), starts once B's and E's stage-1 work is on main. Ops and the landing page proceed in parallel.

**Reopen if:** stage 2 isn't green and deployed by Sun 04:00. Then ship the picker plus the chat-first home, and keep /request linked from the chat cards.

### D16 · One requirement vocabulary and one evaluator for every hard constraint (lead, 14 Nov night)
**Choice:** the four layers stay as they are:
- **authority:** the Mandate (caps, never-delegate, version);
- **hard constraints:** kitchen-wide `Kitchen.constraints` plus per-need `Need.requirements`;
- **soft preferences:** weights and ranking presets, which rank and never authorise;
- **words:** the mandate's words, the establishment notes and what the chef says in chat. Words grant nothing until the chef confirms a rule.

What changes is that hard constraints get **one vocabulary and one evaluator in core**:
- `NeedRequirements` grows the missing terms: diet (vegetarian, vegan), excludes (meat, fish, pork, milk, gluten cereals), plus the existing freeFrom, origin and labels.
- One pure `meets(product, requirements, kitchenConstraints) → { ok | unknown | no, why }` serves ranking, the validator (quote and commit), the request lookup filter, the substitutes and the UI's diet marks.
- A dish's diet codes (G, L, VL, M, VEG, VE) compile into requirements on each of its needs.
- An unknown answer (no allergen or diet record) is never "ok": it holds per the kitchen's `unknownCounts`.
- A free-from claim that the record's own allergen list contradicts (claims gluten-free, lists wheat) is unknown: held and named ("claims free from gluten but lists wheat"), never ok and never refused outright, since gluten-free breads on gluten-free wheat starch and gluten-free oats are legal (R12-02, 14 Nov). One allergen table (`core/mandate/allergens.ts`) defines each group's codes; gluten is AW, UW, NR, GB, GO, GS, GK.

**Why:** today three places interpret diet separately: the UI marks (lib/ui/diet.ts), the request filter (server/request filterHits, B's meatContradiction) and the core requirements (freeFrom/origin/labels only). Dish diet codes are display-only, which is how a vegetarian dish was substituted with meatballs on prod. The authority model and the single commit gate are sound. The vocabulary under them was too narrow and was enforced at the edges.

**Reopen if:** a constraint can't be stated as a product predicate (e.g. a per-order mix such as "75% beef"). Those stay as quantities on needs, not requirements.

### D17 · Links point; only the human grants (lead, 14 Nov night)
**Choice:** approval and menu acceptance stay human acts, reachable from any device but never through the agent's channel:
- every tool result carries absolute links (`approvalUrl`, `reviewUrl`) that only say where to go;
- a second device gets the sandbox by pairing from the browser that owns it (a single-use QR or short code, never in a tool result);
- the in-app dock shows approve cards (UI actions under the chef session);
- later, OAuth gives identity from the token, and approval is a human step-up (a passkey or a push), never a scope the agent's token can hold.

**Why:** a session over MCP had no way to reach the approval: the link was relative and bound to one browser's cookie. The obvious fix, a signed approve link in the tool result, would let the agent follow it and approve itself. That breaks "your agent never approves", and a catalogue string could exploit it by prompt injection. OAuth plus billing proves who pays, not that a person reviewed these lines. Verda's `confirm: true` is a flag the model sets; Mandate's gate must not be.

**Reopen if:** an MCP client ships a human-only approval primitive (URL elicitation that the model can't complete) that works in the demo clients. Then use it for approval in chat, under the same rule.

### D18 · The ask is first-class: every entry makes a need, lines are bound to it, one command identity (lead, 14 Nov night; from Round 11)
**Choice:** three invariants in core, so an entry can no longer hand the gate a valid but wrong command:
1. **Every entry makes a need**, including packs, cases and sales units. The need carries the ask: the words, the quantity, and the unit as stated, or `unknown` with the token. It also carries the requirements (D16). An unrecognised explicit unit never becomes a quantity: the entry asks a question first.
2. **Lines are bound to their need's amount.** When a need's physical amount is known, the validator forbids a line whose physical amount exceeds the need by more than one lot step (lot rounding), and holds it when the size is unknown. "250 ml asked, 250 l bought" fails at quote and commit, whatever the entry did.
3. **One command identity** in core: `commandKey(plan, version, termsHash, exact line ids)`. Request, Chat, the agent loop and the Kitchen all use it. A transport retry replays the same receipt. A newly authorised remainder is a new command.

**Why:** Round 11 showed the core checks authority faithfully, but trusts what entries construct. The request parser turned an unknown "ml" into sales units (R11-01). Pack requests carried no need, so they lost their requirements (R11-02). Request built its own commit key and replayed an old receipt (R11-03). Chat and the loop had the same class of bug in Round 10. Patching each entry hasn't converged; the invariants have to live where every entry passes.

**Reopen if:** a legitimate order deliberately buys well over the ask, e.g. stocking up. That needs an explicit "more than asked" reason on the line, chosen by the chef. The rule itself doesn't loosen.

### D19 · Retrieval upgrade (pgvector hybrid + Modal reranker) is one post-freeze step, taken together (user + lead, 14 Nov night)
**Choice:** not before the freeze. Retrieval stays lexical plus the name normaliser, and safety stays with hard predicates (D16 `meets()` over `facets()`). After the freeze, if taken, it is one step:
1. Gemini embeddings over the catalogue into the existing `products` embedding column, with pgvector and an HNSW index on the Aiven Postgres.
2. Hybrid retrieval in the Postgres catalogue adapter (lexical top-k + vector top-k, reciprocal rank fusion).
3. A multilingual cross-encoder reranker (e.g. bge-reranker-v2-m3) on Modal GPU, re-scoring the top ~50 substitute candidates.
It ships only if the substitute recall@12 (70% today) and the retrieval evals improve and the unsafe-ok rate stays 0. Vectors and the reranker only widen and order candidates that already passed `meets()`; they never decide what is allowed.

**Why:** similarity is the right tool for coverage (cross-category, paraphrase, English → Finnish), not for safety (meatballs embed next to vegetable balls). Modal earns its place for the GPU-shaped reranker, not for the embeddings. Reranking alone is a thin sponsor story, so it's only worth it with the hybrid step and a measured gain.

**Reopen if:** a measured run before the freeze shows a large recall gain cheaply. CLAIMS keeps "never pgvector" until it ships.

**Amendment (user, via 41, same night):** held. If it returns, measure offline first: embed the 17.5k names into a gitignored file, run exact in-memory search, and check the substitute recall@12 and the retrieval evals. Migrate to pgvector only if recall rises with no regression. No Modal: the reranking role is covered by menu-v2's "find then choose" (a batched model pick restricted to the resolver's candidate pool).

### D20 · The agent reads intent into a general shape; no special cases, examples are few-shot, generalisation is measured (user, 14 Nov night)
**Choice:** the reading step (request, chat, outside agents) maps words onto a small, general intent shape. Code then acts on the shape, never on phrases:
- **What:** a product, a dish (with portions), a menu or event, a question, or a change to something open.
- **How much:** exact (qty and unit), a range, "as much as available", "enough for N people/covers", or unknown (ask).
- **Constraints:** requirements (D16) and preferences, each with where it came from.
- **When:** a date, "earliest", a range, or unknown.

"All your apples", "everything you've got", "as many as you can" and "kaikki omenat" are all "as much as available". No phrase gets its own branch. The model fills the shape. Deterministic code handles each kind of the shape once, and the reading check (D18) verifies the shape against the words.

Prompts use a few short, varied few-shot examples that teach the shape. They don't mirror eval cases or user reports. Every new behaviour is tested on held-out paraphrases written separately from the prompt's examples, so overfitting shows as a generalisation gap.

**Why:** patching each reported phrase (a word list here, a regex there) passes the reported case and fails its neighbours, and examples copied from tests bias the model toward them. The user asked for the agent to understand intention, with examples as few-shot rather than lookup.

**Reopen if:** a held-out paraphrase eval shows a kind of the shape the model can't fill reliably. Then improve the shape or the model (D12's cascade), not the phrase list.

### D21 · A yes in chat takes only the action just offered, on the version just shown (lead, 14 Nov night)
An affirmative reply ("great lets do it", "ok") counts as the chef's act only when the agent's previous turn offered exactly one named action, and only for the plan version or menu revision that turn showed: "plan it" accepts that menu revision (the chef's review, D13) and plans it, and "order these" commits the lines the offer named. If the shown version is stale, or there is an open question, or more than one action was offered, the yes asks which. A yes never widens the mandate, never approves lines that need sign-off unless the offer named them, and never acts for an outside agent (D17).

**Why:** the user's chat test showed "great lets do it" acting on another task's plan. The chef typing in their own dock is the person D13 requires, so a named offer plus a yes is consent; an unnamed or stale one is not.

**Reopen if:** a trial shows a bare yes buying something the previous turn didn't name, or the menu accepted differs from the revision the card showed.

### D23 · One conversation, two views: the dock is the door, the Kitchen is the workbench (lead, 14 Nov 23:00)
Every ask enters one conversation, whatever its form (words, an order, an event, a menu, a photo): the chat dock on any page, or `/request`, which becomes that same conversation full-width (same transcript, same cards; `/request?text=` still prefills). The work shows as cards in the transcript as it happens: reading → dishes → products → bill. The result lands in the Kitchen as the basket for that kitchen and delivery day, with a ledger line saying what the agent did. Every line is managed with one row and one set of actions (approve this line, hold, swap with compare, change amount, remove, why), identical in a dock card and on the page, both calling the same tool. A reading never dead-ends on "nothing matched": it proposes its likeliest interpretation as one tap, and a product search returns labelled near-misses (best try) unless the ask is a hard requirement (allergens and the chef's hard rules stay strict).

**Why:** the user: /request feels jarring and rule-based, only perfect matches; the chat and the page should be one flow from ingestion to approving and managing items.

**Reopen if:** a chat-only journey and a page-only journey on the same ask end with different baskets, or a best-try near-miss is ordered without its label.

### D24 · Room mode: everyone in the room runs their own store, Ops watches them all (lead, 14 Nov 23:00)
A QR or link puts a visitor in the shared room (`ws-judges`) as **their own store**: a name and a kitchen type make a new kitchen copied from the nearest seeded profile (its own mandate, usual order and history, copied not linked, per ARCHITECTURE Tenancy), owned by that browser. They order by chat or on the page. Ops on the big screen shows the room: orders arriving live, demand per delivery day, and a presenter shortage that re-plans every store inside its own rules. The shared stock makes contention real. Each visitor's own sandbox stays the default; the room is opt-in and says that others can see it (`roomNotice`).

**Why:** the user: an IRL demo where others sign on as their own store and we see the orders come in on Ops. It shows the machinery a cart can't: many kitchens, one stock, one gate.

**Reopen if:** room load breaks the provider caps or one visitor can act on another's store.

### D25 · The picker leads with "Your own kitchen"; the seeded kitchens are sample profiles (user + lead, 14 Nov 23:20)
"Who are you cooking for?" offers **Your own kitchen** first: a name and an optional one-line description make a new, blank kitchen (default rules the chef can edit, no history, no booking), through the same `create_kitchen` as D24 with no profile to copy. Below it, under "Or try a sample kitchen", the seven seeded kitchens, labelled as sample profiles with simulated history. In the room (D24) the same card makes the visitor's store. Choosing still plans nothing; a blank kitchen's home says what to do first (tell the agent what you need, or set a usual order).

**Why:** the user: the seeded kitchens are mock profiles; a blank kitchen of your own could even be the default.

**Reopen if:** a blank kitchen's first screen is empty or dead-ends, or judges skip the samples and never see prediction from history.

### D26 · Your workspace persists: your kitchens, baskets, phone and agent key all point at it (user + lead, 14 Nov 23:30)
A visitor's own sandbox is a durable workspace, not a demo session. What they create stays: kitchens (D25), plans and baskets (one per kitchen per delivery day), orders and receipts. They come back to it on the same browser (signed cookie, 14 days), on their phone through pairing, and from their own agent through their MCP key, which acts in the same workspace. Runs are already stored in Postgres, so a deploy keeps them. "Start over" (System) clears plans and orders but keeps the kitchens the visitor made, re-seeding only the sample kitchens. The kitchen selector lists "Your kitchens" first. Every door (page, chat, phone, MCP) sees the same kitchens and the same baskets.

**Why:** the user: let people create something that stays, jump back into their workspace, make more baskets and order; it also makes the mobile link and the MCP link mean something.

**Reopen if:** a deploy, a reset or the visitor cap loses a visitor's own kitchens, or one door shows kitchens another door doesn't.

### D27 · A stock model inside the simulator, not a separate backend or a scraped copy of Valio (user + lead, 14 Nov 23:30)
Valio's availability is a static snapshot (re-probe, valio-data.md), so every movement is ours. We add a pure stock model in core (`src/lib/core/stock/`): per product and delivery day, the level starts from Valio's own answer (cached, fetched only for products a plan needed), then moves by rules we can state: every kitchen's committed orders drain it, restocks arrive on the product's logistic rhythm (warehouse items on Valio's delivery days, supplier items with their lead time), and scenario events (a shortage spike, a festive demand bump from the forecast) shift it. Seeded and deterministic, so a demo replays the same; every level carries its source (Valio, simulated drain, simulated restock, scenario). It feeds Ops' forecast ("where stock will run short", moment 4) and, later, the contention overlay. Products never fetched get no invented level: they stay "no stock info".

No separate service and no bulk scrape: Valio's brief says "query the APIs only when needed" (a judged criterion), and a second backend is a second deploy six hours before the freeze.

**Why:** the user wants realistic stock that moves (restocks, shortage spikes, history) and a layer we control like a signal generator.

**Reopen if:** the model needs data we can't get without bulk calls, or two lanes need to write stock rules at once.
