# Round 7: priorities before the freeze

**Verdict:** Mandate has a real authority gate. Its weakest guarantee is preserving the buyer's intended outcome through a change. Fix that and finish the human handoff before expanding Ring 2.

Evidence: frozen source `7dd9a095`, **10 PGlite observation probes**, **22 existing tests**, and two independent deployed browser journeys, including 390 px approval/partial commit. The probes intentionally reproduce defects; their green result is not a correctness pass. No full merge-gate, live-Postgres race or deployed MCP-client completion is claimed. [Commands and logs](../../scratch/round7/README.md).

## Top 10

| Rank | Finding and required change | Size / benefit |
|---:|---|---|
| 1 | **R7-01: Preserve requirements at the gate.** A correctly parsed lactose-free request loses its constraints and physical need; an unsuitable substitute can commit. No-need outcomes can call awaiting-supplier orders fulfilled. | **M:** buys the requested outcome, not merely an authorized SKU |
| 2 | **R7-02: Replace the active strategy.** Applying an alternative to an orderable original committed both: **20 litres for a 10-litre need**. Idempotency does not catch this. | **M:** prevents excess buying inside one order |
| 3 | **R7-04: Propagate recipe edits.** Doubling porridge portions doubles rice but leaves milk at **10.5 l instead of 21 l**. Displayed arithmetic also omits the recipe factor. | **M:** makes “change one thing” trustworthy |
| 4 | **R7-03: Reassess material supply changes.** Known → unknown supply committed under an existing grant; the line retained known/none while the receipt awaited supply. | **S–M:** approval reflects the actual risk |
| 5 | **R7-06: Recover the exact purchase.** A pending butter request's Ops link opens Christmas; returning to Request loses its controls. Give direct and external-agent plans a canonical reloadable URL. | **M:** completes the generic human handoff |
| 6 | **R7-07: Put consequences beside approval.** Seven ingredients from two preparations share “allergens change” sign-off without the dish/allergen delta. | **S–M:** an informed chef decision |
| 7 | **R7-05: Make negative suitability matter.** Two 0/4 alternatives still produce an eligible recommendation; one survivor gets no assessment. Negative/unknown fit must prevent autonomous substitution or escalate. | **S:** substantive Gemini value |
| 8 | **R7-08: Bound and label live work.** The reviewed PG offer path is cache-only; public model requests have per-call limits but no application daily ledger. Add narrow miss fetching and workspace/global limits. | **M:** unfamiliar judge queries work predictably |
| 9 | **R7-09: Stop the extra integration surface.** Keep one reviewed menu → held plan; chat only after task recovery. Park news, embeddings, funnel/sankey, extra graphs and framework expansion. | **S to cut:** preserves integration/rehearsal time |
| 10 | **R7-10: Prove the final claims.** Record two visitors + real MCP → human → commit/reload, with build ID and evidence per claim. Include phone postcommit overflow fix (**R7-12**, S). | **S–M:** defensible pitch and usable phone demo |

## The three things I would do first

1. **Lead + A/B/E: fix the purchase semantics.** Land typed requirements, exclusive strategies, dependency updates and material-change reassessment; turn the probes into desired-result regressions. A3 already exists and passed its tests—do not reopen it from stale docs.
2. **C/B/G: finish one recoverable decision.** Correct-plan link, exact consequence card, partial receipt, remaining gap, reload, and 390 px postcommit state. Reuse this for Request, Kitchen and MCP handoff.
3. **D/F + lead: capture narrow sponsor proof and the rough video.** Show one actual Valio lookup, one consequential Gemini judgment and one cited finding/labelled recall on that plan. Remove unobserved claims at the checkpoint.

Details and team questions: [correctness/agent](ROUND7-CODE.md), [product/UI](ROUND7-PRODUCT-UI.md), [scope/sponsors/pitch](ROUND7-STRATEGY-SPONSORS.md).
