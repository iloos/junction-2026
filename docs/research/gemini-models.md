# Gemini model per LLM job

_Sat 14 Nov, measured with `src/lib/server/evals/llm-models.test.ts` (opt-in: `LLM_BENCH=1`, real Gemini calls, PGlite). Latency is per model call from Espoo; "valid" = the job's schema parsed with no fallback; "pass" = the job's existing checks. ~10 runs per cell._

| Job (input) | Model · thinking | p50 / p95 ms | Valid | Pass | Notes |
|---|---|---|---|---|---|
| request.parse (5 fidelity + 5 paraphrase order texts, EN/FI) | 3.5-flash-lite · minimal | **810 / 1552** | 10/10 | 10/10 | date, physical amount, one item |
| | 3.8-flash · low | 2214 / 2395 | 10/10 | 10/10 | |
| | 4-hydrogen · low | 2957 / 3933 | 10/10 | 10/10 | |
| menu.propose (2 golden briefs × 5) | 3.5-flash-lite · minimal | 2884 / 4020 | 9/10 | 8/10 | one dish course outside the enum; one "5 courses asked, 4 proposed" |
| | **3.8-flash · low** | 10402 / 15761 | 10/10 | **10/10** | rubric: no blocking issue |
| | 4-hydrogen · low | 10019 / 14220 | 10/10 | 10/10 | |
| agent.plan (g2 routine order, g3 inspect after g1, fidelity butter; × 3) | 3.5-flash-lite · minimal | **803 / 1265** | 9/9 | 6/9 | the 3 misses are g2 (ends `awaiting_user`, no commit) for every model |
| | 3.8-flash · low | 2633 / 3775 | 9/9 | 6/9 | same g2 misses; twice the tokens (19.7k vs 10.4k per run) |
| | 4-hydrogen · low | 3063 / 7426 | 3/9 | 2/9 | planner JSON invalid in 6 of 9 runs, even at 1,200 max tokens |
| explain (3 why prompts × 3, JSON headline/reasons/trade-off) | 3.5-flash-lite · minimal | **848 / 1643** | 9/9 | 9/9 | grounded: names the product asked about |
| | 3.8-flash · low | 3055 / 3953 | 7/9 | 7/9 | two headlines over the 160-character bound |
| | 4-hydrogen · low | 4053 / 5589 | 9/9 | 8/9 | 0/9 valid at 400 max tokens: its thoughts spend the budget; numbers at 1,000 |

**Findings.** `gemini-3.8-flash` rejects `thinking_level: minimal` (400), so it was measured at `low`. On parse, plan and explain, Flash-Lite at minimal thinking matches 3.8-flash and Hydrogen on every check, at about a third of the latency. The only job where a larger model earns its cost is the menu proposal: Flash-Lite broke the schema or the course count in 2 of 10. Hydrogen is a poor fit for the JSON jobs at these budgets. It needs at least 1,000 tokens for a 3-field answer and still broke the planner's JSON in most runs. The g2 miss (the routine order stops at `awaiting_user`) is the same for all three models, so it comes from the flow, not the model.

**Routes (`LLM_ROUTES`, `adapters/llm/router.ts`), every route with its thinking level set:**
- request.parse, agent.plan, agent.review_rewrite, explain: `gemini-3.5-flash-lite`, `minimal` (600 / 600 / 200 / 400 tokens).
- menu.propose: `gemini-3.8-flash`, `low`, 4,000 tokens, which leaves room for thoughts. `proposeMenu` asks for 2,500 and is not wired to the router yet; whoever wires it should take the route's ceiling.
- chat.understand (E): not in the router yet. It has the same shape as parse (short text to a JSON intent), so start it on Flash-Lite `minimal`, and re-run this bench with `BENCH_JOBS` once it lands.

**What would change this:** a parse or plan case set where Flash-Lite fails checks that 3.8-flash passes, or a menu brief where Hydrogen beats 3.8-flash on the rubric. Re-run with `LLM_BENCH=1 BENCH_JOBS=… BENCH_CELLS=model:thinking,…`; the report goes to `scratch/llm-models-<tag>.json`.
