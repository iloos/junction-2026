# Ring 2 review: the Mandate working roadmap v0.4 (local, gitignored at docs/roadmap/)

_Condensed by the lead from a read-only review. Roadmap snapshot 9da36dd; main f2f7864 (ring1-clean + docs)._

## Shape
8 areas, 161 entries, 11 gates/decisions (none decided), 20 views. Status counts: 15 done, 85 started (many only `evidence:contract`), 7 planned, 37 proposed, 7 exploring, 10 deferred, 7 parked. Product gates: **gate-isolated-task** (one isolated purchase across all doors), **gate-semantic-truth** (physical quantities + supply certainty agree), **gate-open-menu** (one reviewed arbitrary menu, no hidden gaps), **gate-source-action** (source-backed incident on the precise plan), **gate-assisted-value** (adaptation beats a baseline); decision-recurring; partner proofs for Gemini, Aiven, Exa.

## Stale vs main
Postgres MenuStore landed and wired; Ops reads FulfilmentView (F12-ops merged); build + e2e in the gate; subset approval merged and on; `/agents` exists. DISPATCH also stale on MenuStore, build-in-gate, deploy notes.

## Claims the code doesn't support (both docs)
- Menu proposal is modules only: /request still ends at "Menu proposal: next" (needs A4 + review UI).
- core-physical-intent: /request still calls place_order with sales qty and no `amount` (request/run.ts:494).
- Possibly unscoped clock in request/index.ts:59 (verify).
- A3 (F9) and lineage (r6-1) open; no a3 commits yet.
- Web evidence and recall card have no UI (gate-source-action unmet).
- set_mandate fails on purpose; no chat code exists.

## Gaps
- **core-current-atp:** quotes still advertise stock the simulator already consumed (judge-visible in the contention demo). Not in DISPATCH.
- Procurement task (agent-task-ledger) is "later" in the roadmap but blocks chat and chat evals: promote to now and reverse its edge with agent-handoff.
- Roadmap lacks the in-app chat, chat evals, hybrid-search adoption, the 22:00 video checkpoint, retiring /offline, SURFACES §6 visual system.
- DISPATCH lacks: read-model response parity (plan.lines vs chosen/saved), one quantity-meaning helper (done by 8d), execution context once per job, agent retarget-on-reset and review deadline seams.

## Proposed Ring 2 cut (ids from the roadmap)
Core: core-temporal-validity (A3) · core-proposal-review + client-menu-brief (A4 + review UI) · core-coherent-read-model + core-physical-intent (Request sends `amount`) · core-current-atp.
Agent/chat: agent-task-ledger (minimal, lead contract) · agent-handoff · client-context-composer (docked chat, sees selection, never approves); stretch agent-requirements.
UI/UX: client-task-continuity · experience-progressive + experience-components (task header, decision card, what-changed strip, d3 where it explains).
Sponsors/web: client-why-evidence (Exa facts in Why drawer) · ops-recall-work (Context.dev recall card).
Ops/deploy: quality-deployment (deployed commit, race smoke, reload recovery, rollback tag) → partner-proof-aiven.
Evals: quality-browser-journeys (deployed two-browser + MCP run) · agent-qualification (chat evals, REVIEW on/off) → partner-proof-gemini · quality-demo-submission (claim ledger for 22:00).

**Park:** client-rhythm + decision-recurring; ops-administration; ops-cause-cases/playbooks beyond the recall card; order history/receiving/change-cancel/usable stock; inbox; agent memory/recovery/durable continuation; schema evolution, targeted transactions, durable runtime context; most data-* operating items; all growth-* (venue catalogue only as a labelled discovery view if spare time); product-value beyond one measured number; core-fit-assessment unless Gemini proof needs it.

## Roadmap as in-app map or pitch visual
Not as a product feature (dense, own vocabulary, stale within hours). A truthful in-app "system map" should be generated from live sources (tool registry, gate, applyOps, receipts, eval results). For the pitch: the five product gates as a "proved / next" slide, one journey view as a causal path, gates marked passed only on observed evidence.
