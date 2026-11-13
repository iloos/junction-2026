# Mandate — adversarial review, round 2

Snapshot: supplied Sat 14 Nov ~02:45 situation; repository read during review. Times below are local Espoo/Kyiv time (UTC+2). Probes are reported evidence, not independently rerun here. Only this report changed.

## Verdict

**The rings plan is conditionally credible; five equally competitive main entries remain unlikely.** Keep the larger destination and Kitchen + Operations. Gemini and the real-stack fixture strategy now have evidence. The first failure will be five interpretations of authority, quantities and simulator truth—not coding throughput. Ring 0 still has no deployed journey ([STATUS:6](../STATUS.md#L6)); freeze those semantics before sleeping. A deployed partial rescue with an honest hold beats a falsely complete dinner.

## 03:00–11:00: checkpoints, not activity targets

| Window | What must be true at its end |
|---|---|
| 03–04 | Lead freezes minimal schemas, service signatures, migrations, ranking and five scenario expectations; peer reviews contradictions below. Select Runtime **if accessible now**, otherwise the D3 Verda VM; obtain a public container URL and prove DB connectivity. No overnight wait for Runtime activation. |
| 04–05 | Lead sleeps, provisionally until 07:00. Five lanes run against the same contracts SHA and seed checksum. Core-db implements transactional store; agent connects planner/tools; Kitchen renders/edits plan; Ops projects fixture events; jobs builds the bounded callback adapter. No contract edits or merges while the lead sleeps. |
| 05–06 | Each lane checkpoints a runnable vertical fragment and records exact command/result, SHA, fixture version and Needs. Peer runs conformance checks in its own worktree; it reviews, never becomes a second merger. |
| 06–07 | Lanes finish their first acceptance journey or report the precise blocker; stop expanding scope. Peer prepares merge order and identifies incompatible assumptions. Jobs/Ops must not add dependencies to Ring 0. |
| 07–08 | Lead integrates core-db → agent → Kitchen/interface; deploys a first complete fixture journey on the real schema. Run quote → edit → approval → commit → retry → reload. Ops can follow immediately from persisted events. |
| 08–09 | Replace shortlisted lookups and recipe-fit decision with tested live adapters; all values retain source labels. Prove 11.5 kg → 20 kg lot rounding; unknown supplier stock stays uncovered. External test client reaches the same gate. |
| 09–10 | Run all eight Ring 0 story checks, five deterministic scenarios, concurrent cap/stock tests, and public-URL phone smoke test. Tag the deployed SHA. Record 60 seconds of usable demo. |
| 10–11 | If Ring 0 passes, integrate small Operations and start Ring 1 web journeys. If it fails, invoke D4: suspend Ring 2–3 work, assign isolated fixes, re-test the spine; keep the larger roadmap. |

**Sleep prerequisite:** contracts compile, fixture boots, host/DB access works and lane briefs identify ownership. If 04:00 fails, shift the schedule and Ring 0 forecast explicitly; sleeping behind unresolved access will produce five blocked lanes. This schedule assumes disciplined reuse of the completed spikes, not eight hours of new infrastructure design. D4's gate is [DECISIONS:30](../DECISIONS.md#L30); access is still open in [STATUS:20](../STATUS.md#L20).

## Contracts checklist: freeze behaviour, not every future entity

- **Identity/data:** product's six-digit `productId` is the key; GTIN is optional packaging identity. Kitchen, mandate/version, recipe/yield, stock/inbound, event layer, plan/version, line, offer, approval, order/receipt, source/factor and op. Carry workspace/run IDs and server-derived actor; scope every lookup/mutation. Global catalogue records need an explicit shared-data policy. Money uses integer minor units or decimal strings; quantities use decimal arithmetic, unit/basis and explicit rounding. Hash canonical terms, not arbitrary JSON serialization.
- **State machines:** plan `draft → quoted → held|ready → committed`, with edits invalidating quote/authorization; line `proposed|eligible|held|rejected|committed`, with separate reason codes and fulfilment amount. Approval `pending → granted|denied|expired|invalidated`, bound to plan version, terms hash, mandate version, authority and expiry. Order commitment is immutable; failed attempts are separate outcomes. “Approved” does not mean “stock confirmed.”
- **Unknown/error:** availability discriminates `known|unknown|out|undeliverable|blocked`; preserve raw value and interpretation. `999999` Terminal is unknown. The inferred huge-number “unlimited” sentinel must remain an assumption until mentor-confirmed ([valio-data:66](../foundations/valio-data.md#L66)). Missing carbon is not zero: hold where the mandate requires it; otherwise show an incomplete comparison with an explicit policy. Missing required safety evidence holds regardless of model score. Distinguish `INVALID_INPUT`, `NOT_FOUND`, `FORBIDDEN`, `STALE_VERSION`, `TERMS_CHANGED`, `UNKNOWN_REQUIRED`, `INSUFFICIENT_STOCK`, `CAP_EXCEEDED`, `PROVIDER_UNAVAILABLE`; include retryability.
- **Ranking:** validate facts/hard constraints first; generate candidates from Valio rules, then domain search. A supplier rule is candidate provenance, not a bypass. Proposed frozen score: `Σ(w_j × utility_j) + w_fit × fit/4`, normalized weights and fixed utility scales; deterministic product-ID tie-break. Missing values never earn a favourable score. Return component scores, exclusions and residual demand; model judgement can escalate uncertainty, never grant a hard exemption.
- **Ops/ports:** close the op union: `CreatePlan`, `EditLine`, `RecordOffer`, `ProposeSubstitute`, `RecordApproval`, `CommitOrder`, `RecordAnomaly`, `RecordEnrichment`. A pure `applyOps(state, ops)` validates/reduces; one server command handler authorizes, locks and persists state + ops atomically. Freeze `Catalog.search(query, filters)`, `Offers.get(ids, customer, date)`, `Simulator.quote/commit(runId, …)`, `Decide.evaluate(input, questions)`, `Store.transact(command, expectedVersion, actor)`, `Ops.readAfter(cursor)`, `Jobs.start/status`, `Web.discover/watch`. All async calls have deadline, bounded retries, provenance and typed outcomes. Generate Python wire schemas from the same contracts.
- **Concurrency:** no pending-order stock reservation in Ring 0; explicitly revalidate and atomically consume simulator stock **at commit**. Concurrent weekly-cap checks require a locked budget row or equivalent serialization, not two independent SUM queries. Idempotency is unique per workspace/caller/key with request hash: same key + changed payload conflicts. Never hold DB locks across model/API calls. Approval cannot authorize unknown supply; only a separate verified-fact update can resolve it. Define scoped authorized spend overrides separately from non-waivable constraints.
- **Fixtures/evals:** same migrations and domain handlers on Postgres/PGlite; inject clock and IDs, freeze snapshot/seed/schema hashes. Scenarios contain initial state, source-tagged provider results, commands, expected final quantities/states/reasons/ops and invariants. Replay misses are explicit; rules outputs cannot inherit model confidence. Five baseline scenarios: routine commitment; real outage/unknown replacement; lot-constrained scarcity; stale approval; duplicate/cumulative-cap race. Include real Postgres concurrency checks—single-process PGlite cannot establish distributed behaviour.
- **Leave out of Ring 0:** generic workflow engines, learned memory, training, multi-user onboarding, vector novelty, reservation expiry machinery, product-map embeddings and MCP App rendering. Keep IDs/ports for later rings. Runtime is the chosen stack; no hardcode→JSON→SQL rewrite is needed.

**Contradictions the contracts must overrule:**

| Evidence | Required resolution |
|---|---|
| [gemini:29](../foundations/gemini.md#L29) additive ranking vs [71](../foundations/gemini.md#L71) multiplicative | Pick one equation; freeze normalizers and unknown treatment. |
| [data:48](../foundations/data.md#L48) GTIN primary key; [PRODUCT:23](../concept/PRODUCT.md#L23) 100 × KI for SKU whose sales unit is ST | Product-ID key; 1,000 L = 1,000 ST for `464201`; 100 cases is a packaging display/conversion, not its API sales unit. |
| [modal:23](../foundations/modal.md#L23) direct DB upserts vs [D5:37](../DECISIONS.md#L37) API writes | D5 wins: jobs call scoped APIs; avoid connection exhaustion and mutation bypass. |
| [PRODUCT:58](../concept/PRODUCT.md#L58) external orders always pending vs [F1:50](../concept/PRODUCT.md#L50) autonomous routine commits | Explicit caller scopes: external demo client approval-required; internal routine agent may act within mandate. |
| [modal:19](../foundations/modal.md#L19) LLM infers free-from/settles pack conflicts vs [D5:34](../DECISIONS.md#L34) unknown means hold | Estimates stay suggestions; no inferred allergen clearance or unverified size becomes an authoritative fact. |
| [profiles:91](../research/horeca-profiles.md#L91) omits inbound; [93](../research/horeca-profiles.md#L93) clamps factors ≥0.5 but closures require 0 | Use demand + target stock − usable stock − confirmed inbound; closure is an overriding mask. Published dish portion grams are not ingredient composition. |

Also: 11% versus 24% pack discrepancies use different comparison methods; neither establishes that many confirmed catalogue errors. [valio-data:89](../foundations/valio-data.md#L89) still falsely says this buffet exhausts salmon; STATUS corrects it. Foundations README still lists web/media unfinished ([19](../foundations/README.md#L19)); “all foundations done” does not settle those interfaces. Peer evals/seeds were not present in this checkout during review: require the handoff SHA, not an assumed merge.

## Hero: Christmas remains strongest, but “rescue” must admit unresolved supply

**Table, 2:00:** 0–15: “140 guests. The ham and casserole are unavailable. What can this agent actually promise?” Show event diff and the two real zero-stock SKUs. 15–40: edit g/guest; display cooked/raw yield, demand, stock and purchasable lots. 40–70: compare candidates; reject an unavailable option; the sliced ham's Terminal quantity remains **unknown**, not rescued. 70–95: demonstrate one *verified feasible* replacement or disclose the remaining shortfall. 95–115: authorize only eligible exact terms, commit and deliberately retry; one durable receipt. 115–120: show held residual and the same event in Operations if wired. Milk is a separate one-click required-flow route, not a second full story squeezed in.

**Critical preflight:** no supplied ham/casserole alternative yet proves full fulfilment. Find and hand-check one Stock alternative or a make-in-house recipe with available ingredients; otherwise present a partial rescue honestly. A chef approving an unknown Terminal product cannot make its supply known ([STATUS:28](../STATUS.md#L28)).

**Stage, 3:00:** 0–20 problem; 20–105 same Christmas journey; 105–135 external client attempts a stale/invalid commit and the server refuses; 135–160 Operations shows why kitchens are held; 160–180 proposed four-week pilot and close. Pilot thresholds are targets, not results ([PRODUCT:93](../concept/PRODUCT.md#L93)).

**Labels:** “Valio challenge mock: fetched T” / “cached T”; Christmas booking, stock-on-hand, recipe assumptions and Dec delivery clock **scenario/simulated**; order **local simulated commitment**. November's static response cannot establish December availability. Salmon contention, split milk delivery and shifted cut-offs are simulator overlays. Current salmon and trout carbon values are both 4.9: do not promise a carbon slider changes that winner ([valio-data:111](../foundations/valio-data.md#L111)). No images or invented completed-supply claim. Keep preloaded offline fixture and recorded fallback visibly labelled.

## Overnight guardrails

One merger and decision-number allocator; peer hands over SHA + review, never changes main's branch. Each lane pins base/schema/seed hashes and owned paths. Core-db owns server persistence implementations, **not** lead-owned core contracts/migrations. Ops consumes store projections; jobs never owns simulator truth. Stop on missing contract; post Needs, do not invent a replacement. While lead sleeps, replace the 90-minute rebase demand with checkpoints on the frozen base; rebase after waking. Require small commits, deterministic fixture checks, no network-dependent pass/fail, and a browser screenshot for UI. Human lead approves shared-contract changes before lanes resume. These refine [ORCHESTRATION:33](../ORCHESTRATION.md#L33), not a new coordination system.

## Challenge disposition now

“Stretch” preserves the ring, withholds the winning claim until evidence exists. Criteria: [challenge index](../event/challenges/README.md).

| Entry | Now | Single evidence gate |
|---|---|---|
| Valio | Keep | Deployed eight-story journey with a valid receipt and explicit residuals |
| Context.dev main + tech | Stretch R1 | Actual source change → matched line → held/revised plan, timestamps; replay alone is weaker |
| Exa | Stretch R1 | Unseeded judge query yields sourced evidence changing an actionable plan |
| AfterQuery | Stretch R2 | Standard harness reproduces reference/frontier gap plus inactivity baselines and exploit checks |
| S-Pankki | Stretch R3 | Supplied transactions drive mobile three-basket explanation and editable scenario |
| Gemini | Keep | Live decision changes a recipe-fit choice; trace and labelled-case baseline comparison |
| Aiven | Keep, access gate now | Real shared Postgres commit + reconnect/reload recovery |
| Modal | Stretch R2 | Useful measured batch/episodes complete and write validated results through API |
| Gemma | Stretch R2 | Actual planning episodes with reported success, latency and model identity |
| Verda | Stretch | Working useful inference or app deployment plus process/scale evidence; its model access currently fails ([models:30](../foundations/models.md#L30)) |
| Cloudinary | Drop from immediate execution; retain document seam | Document crop/source visibly grounds extracted order fields; required tool/form verified |
| Nemotron | Drop from immediate execution; retain R3 | Correct required model successfully extracts a document into the plan; no endpoint yet ([models:6](../foundations/models.md#L6)) |

## What still loses, ranked

1. **LOSE — hero has outages but no demonstrated valid replacement.** Hand-verify fulfilment, yields and lot sizes; keep unknown lines uncovered. **0.5–1 h** ([PRODUCT:52](../concept/PRODUCT.md#L52)).
2. **LOSE — undefined atomicity behind impressive approval UI.** Implement/test simultaneous stock/cap commits, changed terms and reused keys before swarm. **1.5–2.5 h**, within Ring 0 ([PLAN:18](../PLAN.md#L18)).
3. **LOSE — no host while overnight coding expands.** Public container + DB smoke test before sleep; choose the Verda VM promptly if Runtime inaccessible. **0.5–1 h**, infrastructure uncertainty may exceed this ([data:26](../foundations/data.md#L26)).
4. **WEAKENS — replay cursor can silently skip committed ops.** `bigserial` allocates before commit: transaction 2 can become visible before transaction 1; resuming after 2 misses 1. Serialize event-sequence allocation per workspace within mutation transactions, or use another proven commit-safe cursor. Subscribe-before-catch-up, deduplicate and poll on reconnect. **1–1.5 h**; current replay-first recipe is insufficient ([data:40](../foundations/data.md#L40)).
5. **WEAKENS — scaling claims outrun measurements.** Modal's 200-product CPU spike does not establish 11k LLM enrichment throughput; task IDs do not prove container count. Benchmark 50 useful cases, then expand; report completed work and actual infrastructure telemetry. **0.5–1 h** ([modal:8](../foundations/modal.md#L8), [22](../foundations/modal.md#L22), [41](../foundations/modal.md#L41)). Synthetic-history backtests mainly test your generator, not forecast skill ([profiles:97](../research/horeca-profiles.md#L97)).

## One bold idea: let the judge change the mandate

**“Same shortage. Your rules. Show me what breaks.”** On the existing compare card, the judge switches price-first to Finnish-required or changes the cap. Eligible terms, rejected options and residual dinner portions update; Operations shows the corresponding held order. If nothing qualifies, the system says so. This is a small counterfactual over existing contracts, not another product. It demonstrates that the agent understands the kitchen's mandate better than a scripted golden-path video—and survives the judge's intervention.
