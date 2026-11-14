# Lane: f-evals (Track F: evals and the merge gate)

**Branch:** `lane/f-evals` · **Worktree:** `../junc26-lanes/f-evals` · **Dev port:** 5179 · **Owner:** session 91

## Dispatch
- Track F (SYNTHESIS §5, §8). Owned: `evals/**` (except `evals/retrieval/**`, 1f), `src/lib/server/evals/**`, `scripts/merge-gate.mjs`, `scripts/smoke-race.mjs`.
- Acceptance: `pnpm gate` green on main; every open `expectFail` names an owner and a finding id; no eval repeats a unit test on the same path.

## State
- **Gate** `pnpm gate` (`scripts/merge-gate.mjs`): check → lint → checker self-test → build → test:unit (one retry, reported FLAKY) → eval → eval:agent; stops on the first red; `--from` / `--only`; `--full` adds the two Playwright e2e specs on PGlite (DATABASE_URL blanked, throwaway JUDGE_KEY_SECRET), about 7 min in all. Forces `LLM_PROVIDER=fixture`. A machine-wide lock (`os.tmpdir()/junc26-merge-gate.lock`, pid + worktree, stale after a dead pid or 45 min) lets one gate run tests at a time; the main checkout's gate goes first when it is waiting (`junc26-merge-gate.priority`, pid; dead pid = no claim).
- **Suites** (all in `pnpm eval`, PGlite, no network): scenarios s1–s5, s7, r5-f9 (passes since A3), r5-f10, r6-1…5 · fidelity (same order through REST, `/request`, agent; 5 cases) · surfaces (`get_plan` FulfilmentView vs kitchen dish status vs Ops coverage, 3 plan states) · golden briefs (2 open-event briefs through `/request`) · paraphrase (EN/FI phrasings per intent: order, event, read question; `/request` + agent).
- **Live planner** `pnpm eval:live` (opt-in, `AGENT_PLANNER=llm` + a provider): agent goals and fidelity cases × `LIVE_REPEATS`; safety asserts, task pass rate reported to `scratch/`. Smoke: g2 and 500 g butter pass live.
- **Deploy race** `scripts/smoke-race.mjs`, run by `scripts/deploy/smoke.sh` when `SMOKE_KEY` is set (key `smoke:kitchen_agent:<key>:ws-smoke` in MCP_KEYS). Passed on prod Sat 14 Nov 05:51.
- Removed today as unit-test duplicates: s6, s8, s9, s10, s11, r5-f5, r5-f8, r5-f11, r5-f22 (covered by store tests ceiling, baseline, dates, rescue, reset, pool, authority, zero).

## Open
| expectFail | where | owner |
|---|---|---|
| A3-agent-cutoff | fidelity + paraphrase butter | E |
| P1-clause-constraint, P2-fi-lexicon | `paraphrase/cases.json` | B (request) |
| P3-agent-seeded-event, LATE-agent-words | `paraphrase/cases.json` | E |
| LATE-request-words | `paraphrase/cases.json` | B |
| R6-lineage | `r6-1-lineage` | menu track (A4/B) |
| F12-ops coverage | `surfaces.test.ts` | 9c |
| A4 held plan from a brief | `briefs/golden.json` | menu track |

- Claim ledger `docs/CLAIMS.md` (owned): first pass done, deployed two-browser + MCP journey recorded on ab3a557; rerun before the 22:00 video with prod screenshots per demo beat.
- Review on/off comparison: waits for E's `REVIEW=1`; then the same trials both ways via `eval:live` (pass rate and tokens per arm).
- Ring 2 chat evals: **scaffolded** on T1 (`evals/chat/check.ts` + 8 self-tests in evals:self; trials c1 clarify, c2 approval handoff + continue, c3 edit voids approval; driver `chat.test.ts` skips until E's `src/lib/server/chat/turn.ts` exports `runChatTurn(input, deps)` yielding the turn's NDJSON events with `taskId`). On wiring: probe, then expectFail with owners. `evals/chat/*.json`: scripted turns through the real chat entry point, judged on the task record and the op log, never on the model's prose:
  - **clarification**: a turn missing a fact (kitchen, date, amount) gets exactly one question about that field; an answered field is never asked again; a typed requirement survives every later turn.
  - **approval handoff**: held lines stop the agent with a pending approval and an approval link; the agent never approves; the human approves out of band.
  - **continuation**: "go ahead" resumes the same task id and plan (no new plan, no repeated order); a turn after an edit sees the voided approval.
  - **truthful ledger**: every number and claim in the task's ledger and final message is backed by state (receipts, held lines, FulfilmentView unresolved); "ordered" only with a receipt.
  - Gate runs the scripted planner; `eval:live` runs the same files with `LIVE_REPEATS`, with REVIEW on and off as two arms (pass rate, tokens, latency per arm).

## Traps
- An `expectFail` entry hides any other mistake in the same expectation; probe today's state before writing one.
- Expectations are properties (category, `notChosen`, `excludes`), never today's first search hit.
- Gate gaps: e2e runs only with `--full`; the client (browser) project has no tests. `test:pg`, `test:live`, `eval:live` are opt-in by design. Evals also run inside `test:unit`, so they run twice per gate.
- Running the app locally on PGlite: `pnpm build`, then `node build` with `DATABASE_URL` unset (the worktree `.env` points at Aiven).

## Resume
Rebase on main, `pnpm gate`. When a lane lands, its flipped `expectFail` keys go red: delete the entry (or ask the lane to) and check what else the merge needs an eval for.
