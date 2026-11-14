# Lane: f-evals (Track F: evals and the merge gate)

**Owner:** peer session (f-evals). **Branch:** `lane/f-evals`, worktree `junc26-lanes/f-evals`, port 5179.
**Owned paths:** `evals/**`, `src/lib/server/evals/**`, `scripts/merge-gate.mjs` (and other merge-gate scripts).
**Context:** SYNTHESIS F24, §5 Track F, §7; evals/README; R5 reviews (ROUND5-DATAFLOW-AND-CORRECTNESS, ROUND5-DOMAIN-AND-PERSISTENCE).

## Tasks
1. [x] Merge gate `node scripts/merge-gate.mjs`: check → lint → test:unit --run → eval → eval:agent, stops on first red, `--from <step>` / `--only a,b`. Forces `LLM_PROVIDER=fixture`.
2. [x] Evals for shipped behaviour (s6–s11): hard ceiling / over_hard_limit, recall hold + void, usualProducts baseline / new_sku, scenario dates (cut-off Tue 8 Dec 15:00, delivery Thu 10 Dec), find_substitutes preview vs apply, sandbox reset.
3. [x] R5 domain journeys (r5-*) as expected-fail evals tagged F5, F8, F9, F10, F11, F22.
4. [ ] Cross-entry intent fidelity (/request, REST place_order, agent → same basket); expected-fail until F3/F4.
5. [ ] Opt-in live-planner suite (AGENT_PLANNER=llm, 3 repeats).
6. [ ] pg race in deploy smoke (with 9c).
7. [x] Round-6 foundation evals r6-1…r6-5 (expectFail R6-lineage, R6-fulfilment, R6-units, R6-diff).

## Needs
- 8d/A: fix `NEW-apply-wipe` (substitutes.ts:286: an apply that finds nothing deletes an existing rescue; s10) and `F32-total` (s6).
- 9c/G: `F1-idem` (reset leaves idempotency rows; s11).
- `package.json` (lead): add `"gate": "node scripts/merge-gate.mjs"` so it is `pnpm gate`.

## Report
- Sat 14 Nov 04:19 · gate script done, green on ddf874c (~100 s) · stubbed none · needs pnpm gate alias · ready to merge yes
- Sat 14 Nov · s6–s11 + expectFail + recall/reset adapter steps + gate retry/self-test; gate green on 91f034a · stubbed none · needs fixes above · ready to merge yes
- Sat 14 Nov · r5 journeys (F5 F8 F9 F10 F11 F22) + r6-1…5, all reproduce as expectFail; gate green except main's own lint error in tools-next.ts · stubbed none · needs s4 edited with F5 · ready to merge yes
