# Round 4 triage (lead, Sat 14 Nov ~03:00)

Sources: [agent](../review/ROUND4-AGENT-QUALITY.md) · [systems](../review/ROUND4-SYSTEMS-QUALITY.md) · [UX](../review/ROUND4-UX-QUALITY.md). Round 3 P0s are with core-db already. Rule: Ring 0 = a judge can change inputs, repeat selections, edit a rescued plan, and the guarantees hold; growth items get seams and a written contract, not a build.

## Ring 0 (now → ~10:00)
| # | Item | Source | Owner |
|---|---|---|---|
| 1 | Prepare outside the transaction: offers/products/model calls before `transact`; no network or catalogue call while the workspace lock is held; tiny-pool concurrency test (prod pool is 3) | sys 1 | core-db (8d), right after the round-3 P0s, before R0-e |
| 2 | Kitchen helper is not a public chef: allowlist demo commands, snapshot GET side-effect free (explicit "start demo" command), selection scoped per session, Reset = 9c's server reset | agent H, sys 2, UX 6 | kitchen agent |
| 3 | Fallback is explicit: a live failure keeps the last live state read-only with retry; offline demo is a separate, labelled entry; never switch baskets mid-session | sys 2, UX 6 | kitchen agent |
| 4 | Server-derived line read model: `reviewable, committable, confirmedCover, unconfirmedCover, blockedReason, nextAction`; UI stops reconstructing authority from labels; UNKNOWN_REQUIRED split by cause (qty / price / dietary evidence) | UX 1 | core-db exposes (via get_plan / snapshot), kitchen renders |
| 5 | Review shows consequences first (what changed, why outside policy, totals, delivery, shortfall); hash/version as audit detail; expiry from the timestamp; changed fields highlighted after a stale approval | UX 2 | kitchen agent |
| 6 | Accessible confirm: click "Review → Confirm exact terms" alternative to hold; stepper serialized with pending state; radio semantics | UX 5 | kitchen agent |
| 7 | Agent: deadline/cancel rechecked before every dispatch; typed intent first (unsupported says so, never silently Christmas); `GoalOutcome` computed from domain state; planner sees trimmed typed facts, not raw product docs; `agent:run` permission + initiator recorded (`RunPrincipal`, narrow seam) | agent A, C, D, E | agent-quality agent (lead) |
| 8 | Event catch-up filters the run in SQL before the limit (>1,000 old ops test) | sys 4 | 9c |
| 9 | Ops: ticket → exact plan drill-down, one urgency-sorted case queue; "clear" only with coverage evidence; current board stays as wallboard mode | UX 4 | 9c |

## Ring 1–2 seams (contract notes, build only when the ring starts)
- Enrichment is a data product: `RecordEnrichment` must persist and reload; job lifecycle `queued|running|partial|succeeded|failed|cancelled` with dedup key and attempts; publish to a catalogue version by an authorized command (sys 5). Web lane writes suggestions only.
- Evals in four named suites: domain invariants, scripted journeys, live planner goal trials, adversarial authority/recovery (agent G). Gemini fit gets a labelled set with a held-out split before any "recipe-aware" claim (agent F).

## Growth contract (write, don't build)
Venue → Organization → KitchenSite → BuyerAccount/SupplierAgreement, `DataReadiness` per site and capability, `OfferContext` server-derived from membership, per-kitchen resource grants on keys, versioned documents/events (sys 6–8, agent B, UX "All Finland"). Owner: lead, short doc `docs/concept/GROWTH.md`.

## Not this weekend
Microservices, generic IAM, multi-agent graphs, nationwide map as purchasing UI, per-plan repositories (measure first).
