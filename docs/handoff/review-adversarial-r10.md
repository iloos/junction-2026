# Round 10 handoff: close composed purchasing journeys

14 November 2026. Reviewed from `6af9c1b` through `9513abb`. App source was not changed by this reviewer. [Full report and evidence](../review/ROUND10-ADVERSARIAL.md).

The new reproductions qualify Ring 4's “guarantees hold” conclusion: the original guards improved, but the composed journeys below still fail.

## Release priorities

| Priority | Reproduction | Owner / acceptance |
|---|---|---|
| P1 · R10-01/10 | Chat Continue after `TERMS_CHANGED` collides with its earlier failed command. The agent loop also assigns one key to different line subsets at the same version. | E + core/lead: one durable command identity across both paths; same retry → same receipt, changed terms/subset → deliberate new command. |
| P1 · R10-02 | Pause a reserved Continue before `get_plan`; cancel successfully elsewhere; resume → purchase and task resurrected as done. | E + core/lead: cancellation fence at the effect boundary; reconcile without overwriting terminal state. |
| P1 · R10-03 | Reviewed lactose-free menu → plan → substitute → commits ordinary milk under the mandate. The claim survives only in prose, not `Need.requirements`. | Core contract + B/E: hard requirements survive the entire menu/purchase lineage. |
| P1 · R10-04 | Replace original milk with substitute, then edit menu amount to 8 l → both lines become 8 l; commit buys 16 l. | Core: amend the active strategy; superseded originals stay superseded. Test seeded plans and splits too. |
| P1 · R10-15 | Late agent-door merge: “Arla whole milk” origin question answers for Valio semi-skimmed, despite both being in the catalogue with different origins. | Agent-door + B: preserve explicit brand/variant/SKU or ask which product before origin, recall or allergen checks. |

## Next batch

- **Core:** contention on a 4 l need with 2 l left adds another 4 l; compute typed residuals. Recipe partial receipts ignore confirmed quantities and overstate confirmed cover; current simulator does whole lines, so fix before a partial supplier adapter.
- **D/9c:** two web defects remain expected failures (`R8-web-write`, `R8-queue-claim`). Notification arrival order can still differ from op order across concurrent publishers; use durable sequence/gap recovery, not only receiver serialization. The latter was reproduced with a mocked NOTIFY schedule, not live Postgres.
- **D/B:** recipe comparison cache uses only dish name, so a revised ingredient list inherits an obsolete comparison. Key comparisons by content/revision; cache source retrieval separately.
- **1f:** make-in-house card says all ingredients have known quantity while the dish/order correctly show unknown supply. Use canonical certainty everywhere.
- **E/B:** JSON `null` gives 500 at Chat/Menu routes; malformed supplied task IDs are silently discarded. Validate envelopes and refuse invalid references.
- **Agent-door:** the new agent card advertises `read_image` while `toolsFor` hides it without `VISION_LIVE=1`; share capability policy. Question/outside steps also label every web result live, including fixture/cache paths.
- **91/vision:** the live vision test passes if all three readings are error rows. Require successful readings and quality thresholds; score wrong units and duplicate lines correctly.

## The release gate needs repair

The seven-step gate passed: **791 unit tests, 2 expected failures, 42 skipped**. Current observation probes reproduced **12/12** defects; late merge's focused tests passed **32/32**. These counts mean different things.

The committed browser suite was **4 passed / 4 failed**. Clocks, dock chef approval/order, receipt totals/reload and approval links passed. Two wording sweeps fail on `/agents` tool names; decide the developer-code/System-layer presentation. Idle/isolation tests stop at obsolete `#event-h`; current heading is `#task-h`. The idle reader also needs authenticated context, status and schema assertions, or a 403 can compare `undefined === undefined`.

Corrected scratch checks passed: authenticated idle **12 → 12 ops over 60 s**, plus visitor/key/forged-cookie/reset isolation. Sixteen captures at 1440/390 had no document overflow or page exceptions. They do not make the committed gate green. Browser build reports `commit:unknown`; the late agent-door merge was source/probe/unit checked and still needs a pinned rendered pass.

## Integration order

1. E/core/lead command identity + cancellation ownership.
2. Core/B/E requirement lineage + active replacement/split/recipe strategy.
3. Agent-door exact product identity; D/9c durable work and ordered recovery.
4. 91/1f fix full-gate guards and certainty copy, rehearse one known-stock autonomous line plus one explicit exception, then pin source/deployed SHA and refresh claims/site recordings.

Keep new sponsor surfaces, memory and forecast behind those gates. The existing core/ports architecture can support these fixes. Evidence and runnable probes: [scratch/round10](../../scratch/round10/README.md). Other sessions' working changes were preserved; no branch switch, commit or production operation was performed.
