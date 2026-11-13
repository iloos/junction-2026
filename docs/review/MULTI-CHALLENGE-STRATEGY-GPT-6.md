# Mandate: a coherent larger build across five main challenges

**Scope:** Valio Aimo, Context.dev, Exa, AfterQuery and S-Pankki, plus the tech challenges actually used. Prepared 14 November 2026 from the repository's parsed briefs, concept, scorecard, research, foundation notes and event/process documents. This is a proposed strategy, not a claim that the features work. No credentials, private recordings or scratch material were inspected. The selected Companion Page supplied no document content.

## Recommendation: build the agent, then make its work visible from both sides

Keep the customer-facing kitchen experience **and** the internal dashboard. They can explain the product better than a chatbot. Build them as two views of the same orders, decisions and events. Add web-triggered work and an evaluation environment around that same agent. S-Pankki requires a genuinely different personal-finance experience, sharing infrastructure rather than pretending restaurant procurement is personal banking.

That gives you **one substantial product, two extensions and one separate domain module**:

- **Mandate Kitchen:** purchasing agent, editable order plan, exceptions, permissions, approval and receipts. Valio's product.
- **Mandate Operations:** cross-kitchen view of those same events and decisions, with drill-down. A product surface and the place to demonstrate useful scale.
- **Web intelligence:** Context.dev watches known sources; Exa discovers relevant sources on demand. Both change an actual plan.
- **Mandate Lab:** the purchasing simulator exposed as a reproducible agent environment. AfterQuery's deliverable, also the product's evaluation machinery.
- **Mandate Personal:** a mobile financial coach using S-Pankki's synthetic transactions. Separate entry point and data model, shared explanation, scenario and tracing infrastructure.

“Platform scope” in my earlier review meant the combined responsibility for several interfaces, jobs, integrations and shared state. It did **not** mean a SaaS subscription business. You can build that larger system. The constraint is making each additional surface reveal work the agent already does, rather than commissioning another independent engine. Do not add SaaS administration, billing, account onboarding or arbitrary workflow configuration for this weekend.

The new foundation evidence improves the outlook: [gemini.md:8](../foundations/gemini.md#L8) reports working batched decisions, and [mcp.md](../foundations/mcp.md) reports stateless transport and shared-schema spikes. Those are meaningful reductions in uncertainty. They do not yet establish integration. The UX estimate alone is approximately 25 must-have hours plus 15 should-have hours ([ux.md:80](../foundations/ux.md#L80)); plan integration and evidence work separately from UI agent effort.

## What should be shared, and what should stay distinct

| Shared capability | Reuse across challenges | Boundary to preserve |
|---|---|---|
| Versioned plans and deterministic calculations | Purchase alternatives; personal spending scenarios | `OrderPlan` and `BudgetScenario` remain different types |
| Source records and provenance | Catalogue, web notices, recipe assumptions, transaction IDs | A web claim is evidence, not verified authority |
| Decision/explanation ports | Substitute fit; uncertain classification; explanations | Model confidence cannot waive hard rules |
| Event and op store | Kitchen edits, approvals, dashboard, replay | Simulator events never mutate live-demo orders |
| Agent tool registry | App, MCP, REST, lab harness | Distinct scopes and domain tools; no universal “execute anything” tool |
| Evaluation runner | Purchase task outcomes, model comparisons, coaching checks | Each domain has its own ground truth and success measure |

**Proposed flow:** source/input → typed request → retrieved facts → proposed plan → deterministic validation → model judgement where useful → authorization → committed result → persisted events. The kitchen renders the plan; Operations aggregates the persisted events; Lab repeats the flow in an isolated simulated world. Personal uses the same infrastructure but ends in a saved scenario or coaching plan, not a financial transaction.

Keep MCP + REST + OpenAPI: the foundation now proposes one registry, making them relatively cheap projections. Keep the phone approval URL even if an MCP App is added. Host-rendered approval is still untested according to [mcp.md, §3](../foundations/mcp.md); do not make it the only way to authorize.

## Optimize each main challenge for its own rubric

### 1. Valio Aimo — the anchor and strongest direct fit

Source: [verbatim brief, criteria](../event/challenges/main/valio-aimo--trusted-trade-agents.md#L30); current mapping: [SCORECARD:9](../concept/SCORECARD.md#L9).

| Weight | Build for the points | Judge-visible evidence |
|---|---|---|
| End-to-end 30 | Request → narrow lookup → fixed-price order proposal → authorization → local simulated commitment | Durable receipt with exact quantity, sales unit, price and delivery date; reload retains it |
| User need 20 | A normal order plus a booking change, with recipe/stock assumptions visible | Chef changes one portion rule; required quantities and packs recompute without retyping the order |
| Autonomy/controls 20 | Server-side mandate, separate human authority, exact-term approval | In-limit routine action succeeds; changed or over-limit terms are held; retries do not duplicate orders |
| Exceptions 15 | Partial availability, incompatible substitute, missed delivery/cut-off | One rescue with explicit residual shortfall if no complete solution exists |
| Openness/path 15 | External client uses the same gated service; assumptions and limitations documented | MCP/REST example, trace and approval receipt for that external order |

**Winning framing:** “The chef tells the agent what changed. The agent repairs the order and asks only for the decisions outside its mandate.” An order diff, not chat, is the main interface. Operations shows the same repair landing across kitchens. That retains the ambitious shape while matching Valio's requested customer-agent experience.

**Data opportunity:** catalogue normalization is useful infrastructure, not decoration. The new [valio-profile.json:1667](../foundations/valio-profile.json#L1667) reports net weight on any packaging level for only 55.8% of products, and base-unit weight for 45.7%. This is less optimistic than the earlier menu-spike note. Its name/weight comparison reports 11.1% flagged discrepancies in the checked subset ([line 2214](../foundations/valio-profile.json#L2214)); heuristic flags are not all proven errors. Normalize the whole catalogue structurally, enrich uncertain candidates on demand, and show unresolved fields. Do not promise safe quantity conversion for every SKU.

### 2. Context.dev — make web changes cause a visible decision

Source: [five equally weighted criteria](../event/challenges/main/context-dev--the-web-is-your-real-time-database.md#L34).

**Build:** one monitored public source → extracted change → deduplicated event → product/order exposure matching → held or revised purchase proposal. A recall is a strong example, provided ambiguity is handled. A manufacturer specification change is another useful input. Menu ingestion supplies context, but a one-time menu scrape alone does not satisfy the strongest real-time story.

- **Impact 20:** identify which planned orders need attention, not merely summarize a notice.
- **Creative live data 20:** connect notice + manufacturer identity + the kitchen's existing order; three unrelated scrape widgets are weaker.
- **Completeness 20:** ingestion, match, action, review and final state all run; unmatched notices remain inspectable.
- **Execution 20:** capture source URL, fetch time, extraction result, match basis and failure state.
- **Real-timeness 20:** demonstrate change detection across two source versions. Record publication time when known, first observation, ingestion and plan update separately.

**Evidence strategy:** prepare a clearly labelled historical recall replay and a controlled changing test page exercised through the actual monitor. The test page proves pipeline reaction, not real-world food-recall detection. Show a genuine fetched authority notice as well. Ask the mentor which demonstration they accept; never imply an official site published your planted event. GTIN without lot/best-before identity means “potentially affected,” not confirmed exposure ([horeca:19](../research/horeca.md#L19)).

**Dashboard value:** affected kitchens, unknown matches, held lines and review state give Operations an immediate purpose. Estimated carbon completeness is less compelling than “these kitchens need action, and here is why.”

### 3. Exa — finish a chef's research task, not another search panel

Source: [20 points each for Exa use, usefulness, clarity, originality and live implementation](../event/challenges/main/exa--the-internet-butler-your-personal-assist.md#L34).

**Build:** “Find a suitable replacement for this ingredient for this dish, with these requirements.” Exa discovers current manufacturer/specification sources; the agent matches evidence to catalogue candidates, performs targeted Valio lookups and produces an actionable order change. Final approval can remain human, consistent with the brief.

**Clean division:** Context.dev watches sources you already know and structures change events; Exa discovers sources needed to answer a new question. Do not make both providers fetch the same page merely to claim both prizes. A manufacturer page may resolve culinary use, pack format or a product claim; it must not silently override contradictory authoritative catalogue data. Unresolved evidence routes to review.

**Rubric optimization:** current retrieved details establish Exa use; a kitchen-specific finished task establishes usefulness; field-level links establish clarity; recipe-compatible rescue establishes originality; an unseeded judge query establishes working implementation. Support free text beyond the one demo SKU and explain when no supported answer exists. Prepare a live-query attempt, not just a cached golden path.

**Incremental UI:** source cards inside the existing substitute comparison and why drawer. No separate “internet butler” application. Ask Exa's mentor whether the professional chef use case fits their intended personal-agent interpretation; the brief includes business information, but judging preference is still uncertain.

### 4. AfterQuery — turn the simulator into an honest learning environment

Source: [full rubric and rerun procedure](../event/challenges/main/afterquery--break-the-agent.md#L74). This is the most demanding extension in evaluation work, not in interface work.

**Environment:** a kitchen must fulfil a set of meals by delivery deadlines under a budget and hard ingredient constraints. Tools expose recipes, inventory, offers, pack units, delivery windows, draft edits and commitment. Simulated time advances explicitly. Inject a stock change or new booking at a documented step. Every fact needed for a good decision must be discoverable through the tools.

| Criterion | Specific optimization |
|---|---|
| Gap 30 | Run the supplied frontier harness and a demonstrably stronger reference policy on identical seeds and budgets; report repeated results, including failures |
| Difficulty 30 | Explain planning failures: consuming scarce budget early, missing pack rounding, committing before checking delivery, failing to replan after new information |
| Reward integrity 25 | Score fulfilment from committed delivery/inventory state; infeasible or unauthorized orders cannot earn fulfilment credit; no reward for prose or number of tool calls |
| Craft 15 | Seeded reset, documented observations/actions, bounded episodes, one-command runner compatible with their Harbor/OpenCode-over-MCP setup |

Use a small deterministic fixture set with a feasible reference solution, then held-out variations. A bounded search/reference solver is sufficient; do not call it an optimal solver unless verified. Normalize fulfilment and costs so buying everything, duplicate orders, doing nothing and stopping early cannot beat successful completion. Keep reward computation outside the agent's writable world. Judge it against the exact do-nothing/stop-early baselines in the brief.

**Important tension:** your Valio gate should prevent unsafe commitments; AfterQuery therefore needs meaningful difficulty in producing a *good feasible plan*, not merely tricks that defeat a missing gate. If all frontier runs already score near the reference, report that: you have a useful regression suite but not a strong AfterQuery gap. Never manufacture a gap with withheld information or impossible timing.

**Operations reuse:** lab mode displays pass rates and failure categories beside simulation activity. That turns the swarm from decorative motion into a visible explanation of where agents fail. Confirm harness access early; a home-made runner alone is not evidence of compatibility. Training a smaller model is a tiebreaker stretch, not a prerequisite.

### 5. S-Pankki — make a real personal-finance module

Source: [five equally weighted criteria and synthetic-data brief](../event/challenges/main/s-pankki--personal-economic-trainer.md#L34). The repository does not yet establish a parsed S-Pankki dataset or working adapter. Verify access and schema before estimating the adapter confidently.

**Product:** a mobile view of one synthetic customer's money, with the three requested baskets: regular essentials, irregular essentials and everyday discretionary spending. The user asks a question or changes an assumption; the app explains and updates a structured scenario.

**Hero:** “If my irregular essential expenses rise this month, what changes in my weekly spending plan?” Show upcoming regular obligations, an editable irregular-expense reserve and discretionary scenarios. If the data lacks balances, income or upcoming obligations, do not infer a reliable safe-to-spend number from historical expenses alone. Display an illustrative scenario with those assumptions explicitly provided. No payments or bank account connection are needed.

- **Financial literacy 20:** explain why an irregular essential expense differs from habitual discretionary spending; show the arithmetic and let the user recategorize a transaction.
- **AI originality 20:** answer an individual question with cited transaction IDs and a changed scenario, not generic advice.
- **Mobile clarity 20:** three baskets, one primary number, one editable scenario and a compact explanation. Reuse components, not kitchen terminology.
- **Feasibility 20:** exact calculations, documented input coverage, explicit uncertainty and saved/reloadable scenarios.
- **S-mobiili potential 20:** a self-contained embeddable route and a credible read-only transaction-data contract. Do not claim actual bank integration.

**What transfers:** source drawer, deterministic totals, model explanations, scenarios, event trace and visual design components. **What does not:** procurement stock rules, food recalls, sales-unit conversion, purchasing approvals and the Valio operator story. This is the weakest direct reuse. If you genuinely want five competitive entries, allocate a separate domain/UI work package rather than relabelling kitchen spend as financial coaching.

## Tech challenges: assign each a useful job

The target stack in [CONCEPT:60](../concept/CONCEPT.md#L60) is defensible when responsibilities are distinct. The following is a proposed division; all claims need actual traces.

| Challenge | Meaningful role in the larger build | Evidence that raises it above eligibility |
|---|---|---|
| **Gemini API** | Batched recipe-fit/ambiguity decisions, intent extraction, explanations; deterministic arithmetic and permissions remain in code | Questions, outputs, latency, and outcomes against a simpler rules baseline. The foundation reports ~0.56 s for 120 questions; label that as a spike measurement, not app latency |
| **Modal** | Run reproducible Lab episodes and catalogue processing as bounded parallel jobs | Sequential versus parallel completion time, jobs completed, useful artifacts, cost, failures and a working deployed endpoint. Do not create meaningless fan-out to inflate container count |
| **Verda** | Serve a chosen open model for simulated kitchen agents, with actual inference workloads | Model/deployment identity, throughput/latency at measured concurrency, documented process and scale estimate. A CPU-hosted web app alone is a weaker ambition story |
| **Aiven** | Shared authoritative orders, approvals, source records, ops and evaluation summaries | Commit on phone appears in Operations; refresh/reconnect recovers it; transaction protects order + log. One well-used service is enough under its brief |
| **Context.dev tech** | The monitored change visibly triggers the same core purchasing flow | Live endpoint trace, source-to-action chain and change-over-time evidence; reuse the main-challenge package |
| **Gemma** | The open model for a meaningful subset of kitchen planning/evaluation jobs, if selected | Task success and latency/cost versus a baseline; explicit actual model. Configuring a model name without showing useful work is weak |
| **Cloudinary** | Receipt/BEO/prep-document upload and readable crop/original comparison, linked to extracted fields and order changes | A visual evidence workflow, not product thumbnails alone. Confirm which of the four tools named in the brief is required; required entry form is separate |
| **Nemotron — later** | Extract structured event details or delivery discrepancies from the document input, grounded to page/crop | Correct required model, labelled extraction cases, improvements after prompt/schema changes, visible downstream order effect and submission explanation |
| **Codex** | The actual agent-assisted development process already used to build the product | One concrete feature from brief → implementation → failing check/fix → shipped evidence, with sanitized artifacts. No extra runtime integration needed |

Sources: [Gemini](../event/challenges/tech/google-deepmind--best-use-of-gemini-api.md#L40), [Modal](../event/challenges/tech/modal--best-use-of-modal.md#L29), [Verda](../event/challenges/tech/verda--verda-compute-track.md#L33), [Aiven](../event/challenges/tech/aiven--best-use-of-aiven.md#L44), [Context tech](../event/challenges/tech/context-dev--best-use-of-context-dev-fully-structured.md#L50), [Gemma](../event/challenges/tech/google-deepmind--best-use-of-gemma.md#L30), [Cloudinary](../event/challenges/tech/cloudinary--best-use-of-cloudinary.md#L36), [Nemotron](../event/challenges/tech/nvidia--best-use-of-nemotron.md#L52), [Codex](../event/challenges/tech/openai--best-use-of-codex.md#L34).

**Modal + Verda can coexist:** Modal owns episode scheduling/batch execution; Verda owns actual open-model inference. That is a credible split only if the network hop and concurrency work acceptably. Use bounded queues; jobs can fail/retry without losing authoritative state. Avoid deploying the same large model twice just to use both clouds. Which provider serves the selected Gemma/Nemotron model remains an access/latency spike, not a settled fact.

**Gemini confidence needs careful framing.** The new note proposes a threshold slider and ~20 eval scenarios ([gemini.md:61](../foundations/gemini.md#L61)). Twenty cases can reveal obvious errors; they cannot establish broad kitchen-specific calibration. Present “observed performance on our labelled cases,” distinguish task probability from answer confidence, and keep unknown allergens/origin held regardless of probability. The note also contains additive versus multiplicative ranking formulations: freeze one before lanes implement different rankings. Rules/replay results must retain their source label and must not inherit a live model's assurance merely by sharing its output shape.

Other tech prizes are not automatically part of this plan. Add one only if the delivered system already uses it meaningfully. Hardware/chain/database substitutions or extra voice services solely for another entry would create a new project dependency. No sponsor outreach or submission is authorized by this report itself.

## A bigger scope that remains understandable

**Kitchen:** editable plan, event diff, substitute compare, mandate/approval and why drawer. Keep chat/photo/voice as ways to supply intent, not the product's main screen. Normal week and event are layers on the same order, not separate applications.

**Operations v1:** kitchens needing attention, orders held, fulfilment/shortfall, event stream and click-through to an exact order. Then add batch progress and lab outcomes. A product map can come later if it answers “which products drive unresolved demand?” It should not be the only thing the operator can understand. Supplied, externally sourced, estimated and unknown enrichment must remain separate; “100% coverage” cannot mean 100% measured truth.

**Scale honestly:** distinguish synthetic events, replayed decisions and live-model agents. Start with 20 kitchens and expand to 500 after measuring throughput. Simulated kitchens use the fixture API, consistent with Valio's prohibition on bulk dynamic sweeps. If using shared simulated stock, commitments must consume it consistently; if each kitchen has an independent world, say so. Different workload semantics cannot support the same scale claim.

**Personal:** its own mobile home and scenario screen, reached directly in S-Pankki's demo. No personal-spending widgets on the wholesaler dashboard. A common codebase does not require forcing every judge through the same navigation.

## Execution: agent first, scaffold the rest, integrate by complete workflow

This is a suggested overlay on the existing plan, not a replacement of lead-owned PLAN/STATUS. Estimates are implementation effort ranges, not guarantees or additive elapsed time. A solo lead still owns integration, judgement and presentation.

| Stage | Deliverable and gate | Indicative effort |
|---|---|---|
| **A: core contracts + deployed fixture path** | Request, offer, plan, mandate, authorization, receipt, event/source schemas; first complete kitchen order | 4–6 h |
| **B: kitchen + Operations** | Live Valio adapter and useful decision step; order diff; minimal shared-state dashboard | 5–8 h, overlapping UI work after A's contracts |
| **C: web intelligence** | One Context change and one Exa discovery each alter the same plan with sources | 3–5 h |
| **D: Lab** | Seeded environment, reference, frontier runs, baselines, exploit checks and harness compatibility | 5–8 h; establish feasibility early |
| **E: Personal** | S-Pankki data adapter, exact queries, three baskets, editable scenario and mobile explanation | 5–8 h; data access may increase this |
| **F: proof and finish** | Reconnect/offline checks, challenge evidence, video/deck, public links and rehearsal | Reserve 4–6 h of lead attention |

These total roughly **22–35 implementation hours, plus the 4–6-hour proof reserve**, spread across partially parallel work. So all five are possible as a larger coordinated build, but all five are not equally low risk in the original ~30-hour envelope. More agents reduce coding time; they do not eliminate contract changes, data discovery or the lead's merge queue. Scaffold all surfaces early; judge readiness by completed journeys, not populated routes.

**Work packages:** lead owns core/service/DB contracts and deploy; kitchen lane owns the client workflow; operations/data lane owns dashboard projections and bounded jobs; research lane owns web evidence; Lab and Personal become dedicated domain packages once contracts stabilize. Stagger these if the agent environment cannot run that many workers. Keep shared-file edits with the lead; require fixtures and one acceptance journey per package, as [ORCHESTRATION:32](../ORCHESTRATION.md#L32) prescribes.

**Early feasibility gates preserve the bigger ambition:** get S-Pankki data and AfterQuery's harness now; run one query/episode before polishing either UI. Test the chosen open-model endpoint before designing the swarm around it. Run the document-input spike before adding Nemotron to the pitch. If a gate fails, retain the scaffold but label that entry aspirational; do not count it as a competitive submission.

## Demonstrations and evidence: five entrances, one honest system

| Audience | Lead with | Finish with |
|---|---|---|
| Valio | Booking change repairs a real order | Exact authorization, receipt, external-agent interoperability |
| Context.dev | A source changed | Affected kitchen/order, source timestamps, proposed action |
| Exa | A new question the judge chooses | Retrieved evidence changes a valid, actionable substitute plan |
| AfterQuery | Reproducible task and measurable frontier failure | Reference + three agent runs + inactivity baselines; reward attack |
| S-Pankki | One customer's transaction-grounded question | Three baskets, editable what-if, plain-language learning moment |
| Peer review / grand jury | Chef rescue in the first 30 seconds | Zoom out to Operations: this decision is inspectable across kitchens |

Do not cram all five main challenges into the two-minute public video or three-minute stage pitch. The main story remains the kitchen and its visible trust boundary. Use challenge-specific descriptions, direct demo routes and evidence sections to explain the other entries. Confirm how the platform associates a common video/deck with separate drafts before relying on per-entry attachments.

For each retained challenge record: **claim → working route/command → artifact → source/live/fixture status → limitation**. This supplies the scorecard, sponsor summaries and rehearsal script without inventing five different products. Verda requires a process summary link in its Discord; Cloudinary requires its own form; Nemotron requires text explaining model/use/improvement. Prepare those materials, and send/post only when explicitly authorized.

**Three immediate choices:** (1) freeze the shared agent/state/event contracts while scaffolding Kitchen and Operations; (2) assign separate feasibility checks for S-Pankki data and the AfterQuery harness, because those are the two genuine additions; (3) choose sponsor responsibilities once—Gemini for bounded judgement, Context for watching, Exa for discovery, Modal for jobs, Verda for inference, Aiven for state—and require the first end-to-end trace before expanding each one.

The ambitious version is credible when the internal dashboard shows the real agent's work, the lab tests that same agent, and web evidence changes that same plan. The banking coach deserves its own small, complete experience. That is how to pursue all five without disguising unrelated features as a single kitchen workflow.
