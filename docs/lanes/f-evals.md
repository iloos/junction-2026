# Lane: f-evals (Track F: evals and the merge gate)

**Owner:** peer session (f-evals). **Branch:** `lane/f-evals`, worktree `junc26-lanes/f-evals`, port 5179.
**Owned paths:** `evals/**`, `src/lib/server/evals/**`, `scripts/merge-gate.mjs` (and other merge-gate scripts).
**Context:** SYNTHESIS F24, §5 Track F, §7; evals/README; R5 reviews (ROUND5-DATAFLOW-AND-CORRECTNESS, ROUND5-DOMAIN-AND-PERSISTENCE).

## Tasks
1. [x] Merge gate `node scripts/merge-gate.mjs`: check → lint → test:unit --run → eval → eval:agent, stops on first red, `--from <step>` / `--only a,b`. Forces `LLM_PROVIDER=fixture`.
2. [ ] Evals for shipped behaviour: hard ceiling / over_hard_limit, recall hold + void, usualProducts baseline / new_sku, scenario dates (cut-off Tue 8 Dec 15:00, delivery Thu 10 Dec), find_substitutes preview vs apply, sandbox reset.
3. [ ] R5 domain journeys as expected-fail evals tagged F5, F8, F9, F10, F11, F22.
4. [ ] Cross-entry intent fidelity (/request, REST place_order, agent → same basket); expected-fail until F3/F4.
5. [ ] Opt-in live-planner suite (AGENT_PLANNER=llm, 3 repeats).
6. [ ] pg race in deploy smoke (with 9c).

## Needs
- `package.json` (lead): add `"gate": "node scripts/merge-gate.mjs"` so it is `pnpm gate`.

## Report
- Sat 14 Nov 04:19 · gate script done, green on ddf874c (~100 s) · stubbed none · needs pnpm gate alias · ready to merge yes
