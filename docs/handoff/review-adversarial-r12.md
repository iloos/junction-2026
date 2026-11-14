# Round 12 handoff

14 November 2026. **Review only; leave uncommitted.** [Full report](../review/ROUND12-ADVERSARIAL.md) · [evidence](../../scratch/round12/README.md). Pins: first read `42dc25b`; initial archive/local runs **`b02de0b`** (ZIP-verified); final source **`95d9447`**. Full production walk **`b10cd43`**; later **`494bd09`** received spot checks, not a full repeat.

The hotel works at 1440 and 390: seven distinct event plans, held return, sign-off, **18 lines / €933.92 / 7 confirmed + 11 awaiting**, reload and retry preserving one receipt. Human sign-off followed by an outside-agent commit also works. **Four P1s still reproduce on final source.**

| Release priority | Owner | Required invariant |
|---|---|---|
| **P1 · R12-01** original ask vs purchase | 8d + lead; B/E | Quote and commit cannot purchase 250 l for a preserved 250 ml ask. Explicit unknown units ask rather than invent a sales/piece quantity. Latest prod still turns “2 buckets” into two 10 l pieces after escalation. |
| **P1 · R12-02** hard facts | 8d + 1f/da | Wheat-declared soy sauce cannot satisfy a no-gluten-cereals need. Gate, marks, lookup and answers use the same facts/semantics. |
| **P1 · R12-03** dietary intent | B/E + 8d | “Vegan milk” cannot become an eligible dairy purchase with only a prose warning. Retain the hard requirement or stop for clarification. |
| **P1 · R12-04 / R10-05** residual sizing | 8d | Retaining 2 l for a 4 l need adds only the remaining 2 l. The current repair commits 6 l. |
| **P2 · R12-05/06/07** close the user entries | 1f/lead, c3/0d, U, D/B | Establishment choice precedes unrelated planning; sources appear on a usable canvas. Usual order and ProductToken are reachable. Four profiles still have no simulated history. |
| **P2 · R12-08/09** finish the seams | da/41/lead; O/9c | `revise_menu` is registered and converges to review/plan. Ops reads stored traces and sponsor summaries. Latest trace/usual APIs now work; their UI journeys do not. |
| **P2 · R12-10/12** honest task/test state | E/1f; 91 + owners | Cancelled means no Continue CTA. Tests reach the boundary named, use current stream APIs and faithful facts, and have current OPEN flags. |
| **P2 · R12-11** one release truth | d0/91/pitch/lead | Proof numbers/rules, site CTAs, CLAIMS and PITCH match a pinned recording. Anonymous Source/Proof links work after the authorised public-repo scrub. |

**Next batch:** core ask binding, cereal facts, requirement propagation and typed contention residual; then cross-entry quote → edit/substitute → approve if required → commit → retry. Assert SKUs, amounts, remainder and receipt identity. Then mount existing entries, wire menu/trace contracts, gate/deploy one batch and repeat all nine journeys before filming.

**Keep the fixes:** unknown-pack lineage, zero restoration, composer, cancellation fence, typed causes, single-replay Ops and commandKey in Request/chat/loop. Later prod demonstrated brand retention, max_available and real escalation.

**Inherited open scope:** supplier-outage replay, partial recipe receipts, receiving DTSTART, pack equivalence, grounding identity and durable web ingestion/claiming; owners/invariants are in the disposition table.

**Evidence/limits:** `final-ask-boundary.json`, `final-wheat-gate.json`, `final-contention.json`, `final-cancel.json`, `order.json`, `outside-complete.json`, `latest.json`. Final run: **41 tests, 31 pass / 10 fail** (six domain failures, four obsolete oracles). Passing observation probes can reproduce defects. Initial build/check/format/ESLint passed; no full final-source gate or production fault/race run. Scratch includes private sandbox state: curate before sharing.

**Integration:** preserve the pure core, ports and human-only approval boundary. Response success or a checker score is insufficient; keep source fixes separate from deployed acceptance.
