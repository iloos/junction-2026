# Round 7: final shape, sponsor evidence and freeze risk

**Verdict:** The strongest product is a kitchen's recoverable exception decision: preserve the requirement, repair the purchase, ask one informed question, show exactly what remains uncertain. Ring 2's five integration gates are right; its feature inventory is too large. Spend the remaining hours proving those gates, with fewer simultaneous infrastructure and presentation changes.

This is an independent assessment of the reviewed source, supplied challenge briefs and two deployed browser journeys. It does not establish live provider configuration, monitor cadence or production database state. Static execution snapshot and limitations are in [CODE](ROUND7-CODE.md); live screenshots are in [PRODUCT-UI](ROUND7-PRODUCT-UI.md). S = <=1 hour; M = 1–3 hours; L = larger/integration-heavy.

## 1. R7-08 · P1 before more public model use · Runtime truth and limits must precede sponsor expansion

**Source-verified:** With a database URL, `store/server-ports.ts:35` selects `createPgCatalog`; its `offers` implementation reads cache rows (`adapters/catalog/pg.ts:157`), without live miss fetching or freshness enforcement. The file adapter has a separate optional live path. This confirms the internal review's wiring gap in the reviewed source; I did not independently observe a production Valio HTTP call or inspect environment values.

The public Request endpoint can invoke a parser repeatedly (`routes/request/run/+server.ts:55`, `server/request/index.ts:111`). The LLM adapter caps output per call and time (`adapters/llm/index.ts:14`, `:63`), but has no visitor/day or application-wide spend ledger. Web calls have a ledger; model calls do not. A global one-agent-run lock does not protect these direct request calls. Provider console caps may limit billing, as CLAUDE requires; they do not give each visitor a predictable service budget.

**Recommendation — M, A/D/E:** For Valio, finish one narrow PG cache-through path on actual shortlisted products, with source/fetch time, bounded concurrency, timeout and half-open retry. A stale or missing offer must remain visibly stale/unknown. Separately cap public model work per workspace **and globally**, with bounded concurrency and a clear 429/cooldown. Share these limits across Request, menus and chat. Add tracing at the existing adapters; do not block these fixes on a generalized ExternalCall framework.

**Buys:** A judge's unfamiliar SKU can be quoted, and one visitor cannot consume everyone else's model availability. Live refresh also makes R7-03's supply-change defect more likely, so land that fix first. Quotations must account for simulator stock already consumed; the internal `core-current-atp` finding remains relevant.

## 2. R7-09 · P1 delivery risk · Reduce the integration surface before creating more surfaces

**Evidence:** DISPATCH Ring 2 proposes Task persistence, chat streaming, a new shell/component family, menu planning, Valio live fetch, web-state migrations, several visualisations, revised Decisions integration and retrieval changes in overlapping waves. These touch the same contracts, plan identity, evidence and outcome semantics. Meanwhile R7-01–05 expose gaps in those semantics, and R7-06 shows the deployed human handoff does not yet finish a generic task.

**Inference:** Five sessions multiply implementation capacity; they do not eliminate the serial dependency through shared contracts, migrations and a working deployed journey. A broader rollout could deliver five individually plausible panels without one more reliable purchase.

**Recommendation — S to cut; M/L saved:** Keep the five product gates, but give each a concrete example and stop condition. A minimal Task needs stable identity, requirement/slots, plan/proposal refs, pending decision and a computed ledger. Persisting a second copy of fulfilment as authoritative state creates another reconciliation problem; always rebuild it from current plans and receipts.

| Remaining work | Decision before freeze | What it buys |
|---|---|---|
| Requirement preservation, strategy replacement, material supply change, dependency edits | **Must fix**, with focused regressions | The purchasing promise survives a change |
| Exact-plan URL, reload recovery, approval consequences, phone postcommit widths | **Must finish**, M across B/C/G | A judge can finish an interrupted purchase |
| Reviewed menu → deterministic held plan | **Keep one vertical slice**, M/L, explicit unresolved ingredients | A genuine arbitrary-menu capability instead of an attractive dead end |
| In-app chat | **Conditional**, M: one task, typed clarify, propose, human handoff, continue | Another input to the same finished purchase |
| Valio miss fetch and visible Decisions effect | **Keep narrow**, M | Two load-bearing sponsor moments |
| One cited web finding/labelled recall on that same plan | **Keep if demonstrated**, M | A source visibly changes the user's next action |
| News-on-vendors, full-catalogue embeddings, funnel, gate sankey, extra run graph/timeline, infrastructure strip | **Stop for this freeze**, L combined | Integration and rehearsal time |
| New shared cache/trace framework, broad web-queue redesign, staging workflow expansion | **Defer architecture expansion**; keep necessary existing durability fixes | Fewer cross-lane seams late at night |

Do not make chat the new primary screen. Do not enable the LLM planner in production simply to make the agent appear more autonomous. Its genuine next capability is repairing one requirement without damaging the others, then continuing the correct task after a human decision.

## 3. R7-10 · P1 pitch credibility · Replace architecture claims with observed outcomes

**Verified:** The supplied pitch claims exact-term approval, no double orders, cross-entry parity and individual sandboxes. The narrow authority/retry controls survived the local checks; broader meanings need qualification. Static PITCH and STATUS entries are already stale about A3, group approval, Agents and the gate's build step. `scripts/merge-gate.mjs:23` includes build. Do not spend time rebuilding completed items because an older checklist says they are absent.

**Recommendation — S, F + lead:** At the 22:00 checkpoint, freeze a claim ledger with a deployed build identifier and one observed journey/evidence link per claim. Record the rough video immediately. Use these distinctions:

| Claim | Review judgment / required evidence |
|---|---|
| “No double orders” | Same-key replay and concurrent line uniqueness are narrower than no excess purchasing. Fix R7-02; state the proven scope. |
| “Approval binds exact terms; any change voids it” | Price changes were refused. Supply certainty can change under a grant (R7-03). State protected fields until repaired. |
| “Unknown supply never counts as confirmed” | Fulfilment distinguishes it, but a no-need plan's agent outcome can report fulfilled (R7-01). Require parity on Request-created plans too. |
| “Any outside agent can complete this flow” | Registry/scopes are good; a direct plan's human link currently opens another plan. Record a real MCP client → human → commit journey after R7-06. |
| “Recipe-aware / calibrated scoring improves choices” | A live SDK call is integration proof, not evidence of better decisions. 0/4 still wins today. Show the corrected negative case and a small labelled comparison. |
| “Supplier confirmed” | Current receipts are simulated supplier acceptance, not actual Valio acceptance or delivery. The deployed UI's explicit simulator label is good. Keep it in speech and video. |

No new full test program is needed. Add the failure cases from this review to the existing scenario system with desired expectations; do not preserve the scratch probes' deliberately bad-result assertions as correctness tests. The existing expected-failure mechanism is honest about known gaps, but a green run including expected failures cannot support the corresponding product claim.

## Sponsor decisions: keep the role, require a visible consequence

| Sponsor | What is substantive now | Smallest convincing finish | What to stop / qualify |
|---|---|---|---|
| **Valio** | Real catalogue, pack/lot semantics, customer rules, cached outages, one order/approval gate | Judge-specified shortlist → observed live/cache-labelled price/availability → exact purchase decision | A catalogue import is not live API use; local commitment is not a supplier order |
| **Gemini** | Request interpretation and fit port, with explicit fallback provenance | Actual task context → negative fit escalates/removes autonomous choice → positive alternative plus visible source/latency | Do not batch origin and hard-allergen questions merely to repeat facts code already enforces; do not call displayed confidence proof of correctness |
| **Aiven** | Runtime and transactional Postgres genuinely carry the product; race tests are well targeted | Deployed reload recovery + one same-key retry/race receipt + op-log evidence from that exact purchase | Embeddings are optional. A database status strip is weaker than seeing persistence and concurrency work |
| **Context.dev** | Recall extraction, revisions, webhook/queue/application logic | Stored notice or clearly labelled drill → affected product/plan → visible hold or replacement action, with notice and detection times | No independent proof here of a real recall matching a user's order or actual monitor cadence. A polling interval alone is not detection latency |
| **Exa** | Sourced facts and outside options behind scoped tools, suggestions kept distinct | One missing field → live cited primary product/spec source → inspectable finding attached to that field, or a sourced preparation alternative held for review | A citation must support the precise fact. Finding a similar product does not verify this SKU's allergen clearance; an empty result is an acceptable truthful outcome |

The relevant brief weights favor this ordering: Valio gives 30% to the complete flow and 20% to matching the buyer's request (`docs/event/challenges/main/valio-aimo--trusted-trade-agents.md:36`). Aiven gives 40% to meaningful use (`tech/aiven--best-use-of-aiven.md:35`). Exa explicitly scores source clarity and judge live queries (`main/exa--the-internet-butler-your-personal-assist.md:38`). These are supplied event sources, not independently refreshed external rules.

**Where I go beyond the internal sponsor review:** batching more questions and showing probabilities is not enough. The model's answer must alter an outcome the kitchen cares about. Test a wrong-but-available substitute, an impossible preparation deadline or a task-specific dietary gap. Models should escalate uncertainty; they must never replace authoritative product evidence. Likewise, a citation can explain why an exception exists even when it cannot safely clear it: that is useful sponsor value, not a failed integration.

## The review mechanism and the customer story

The optional review pass has bounded retries and does not authorize purchases; that separation is sound. But `menu/rubric.ts:69` checks preservation of dietary claims, including the model's own `claimedCompatible` labels, rather than independently verifying every ingredient. The parse reviewer accepts words retained in raw item text (`review/parse.ts:43`); retaining words is not the same as turning them into enforceable constraints. The current request bug survives a correct parse anyway.

**Recommendation — S, E/F:** Keep REVIEW behind its flag. Compare on/off on the same changed-requirement tasks, measuring unmet requirements, bad commits, unnecessary holds, manual corrections, latency and call count. Another model approving text is not a new safety guarantee. Do not spend a late-night rewrite expanding review checkpoints without measured benefit.

For the pitch, use the Christmas shortage, one changed requirement, the informed human decision and the resulting receipt/gap. The arbitrary menu is a second proof only when complete. A chef would pay in attention for saved exception work, not for the number of agents, sponsor calls or charts. Measure one honest quantity: number of chef corrections or actions needed to reach a correctly held/committed plan. Do not present waste or time savings as observed results.

Questions for the team:

1. Which exact deployed journey will pass each gate at 22:00, and which scope stops if it fails?
2. Has one Valio mentor confirmed that the two demonstrated preparation changes are plausible at the stated kitchen/deadline? Existing team estimates are not that validation.
3. Can an unfamiliar visitor finish the direct request and MCP handoff without the presenter recovering the plan for them?
4. Which sponsor claim will be removed if no source-to-user consequence is observed before the video?
5. Who owns the existing public-repository scrub checklist and final submission assets while the coding sessions integrate? Keep this already-required work on the landing path.
