# Round 8: architecture and expansion scan

**Reviewed snapshot:** `50575b357d8eca076063d739991f80c795af15b9`, 14 November 2026. Includes the new task/chat layer, live Valio adapter, Decisions batching, shared UI components and migration 0004. The checkout was moving during the review; findings describe this snapshot. **“More stores” means additional kitchen locations and customer accounts**, as clarified by the user.

**Late integration check:** by `825874d`, `get_outcome` had been registered and composed into the served handlers. That part of the MCP integration gap is already addressed in source. The eight probes remain snapshot results; the task-turn, web persistence, projection and catalog-context files behind those findings were unchanged in the inspected integration diff.

The right direction is to extend the existing core. Its boundaries are holding better than its surrounding orchestration: the static import scan found no resolved value-import edges from core into other application layers. The largest expansion risks are inconsistent execution context, persistence acknowledgements and derived state. A rewrite or a generic agent framework would leave those problems intact.

## Findings that should drive the next work

1. **Task identity does not yet identify a purchase reliably.** Two new chat tasks with identical requests create different task IDs but reuse one plan and one order. Separately, injecting a failed task write leaves a committed order and no task, followed by “reload it and try again.” Persist a task/turn identity before executing commands; make command retries refer to that identity. Preserve the distinction between “retry this turn” and “place another order.”
2. **Kitchen access is enforced at different layers.** A context restricted to `k-hotel` can read a `k-lounas` plan and create a plan there through the core handlers, while the outcome reader refuses the same plan. Put resource authorization at the shared service boundary. This is a blocker for introducing restricted site memberships, not evidence of a demonstrated cross-visitor exploit.
3. **Postgres web storage still relies on local process truth.** A failed upsert is logged, acknowledged and marked saved; the same value is then skipped on retry. A worker can claim a database item missing from its local map and do no work. Queue claims should return durable work records, and required persistence failures must reach the caller.
4. **Shared projections still disagree.** `2 kg + 3 l` becomes “5 needed”; a completed task detail remains `awaiting_chef` in the open list; a held but committable line still produces “waits for a chef.” Use one current projection for detail, lists, action hints and agent summaries, preserving units and actual authorization.
5. **A second customer needs an explicit business context.** Offer lookup has no buyer/site/agreement argument, the configured customer defaults to `123`, and availability is re-dated onto the scenario even on the live path. Add account and delivery context before presenting live calls as operational readiness for another site.

The [architecture review](ROUND8-ARCHITECTURE.md) gives evidence, correction shapes and verification cases. It also covers chat bypassing the external-call scope wrapper, remaining MCP capability integration, enrichment that stops at research, and focused dependency cleanup.

## Expansion worth doing alongside those fixes

Build **one additional kitchen in shadow mode**, with an explicit owner, account mapping, delivery calendar, mandate and readiness record. Let an owner-supplied menu become a reviewed, measured proposal. Carry one task through preview, comparison, a bounded change and reconnect. Show which facts came from live sources and which remain estimates. Enable execution only when the account, terms and authority are established.

This exercises general architecture more effectively than adding more seeded kitchens. The [flow and expansion plan](ROUND8-FLOWS-EXPANSION.md) describes the sequence, agent interactions and acceptance cases. Public venue enrichment can proceed independently as sourced discovery; it must never create purchasing authority.

## Evidence and limits

Eight fixture/PGlite observation probes reproduced the reported gaps. Their passing assertions describe **undesired observed behavior**, not eight correctness checks. Eighteen existing tests across task, chat, external-call and Postgres-state files also passed. This demonstrates useful existing coverage and gaps between those boundaries.

No application code, dependencies or git state were changed; additions are review documents and `scratch/round8/`. No `.env` contents were read. No live provider requests, production database checks, browser pass or full merge gate were run. Round 7 defects were not comprehensively re-tested. Reproduction details are in [scratch/round8/README.md](../../scratch/round8/README.md).
