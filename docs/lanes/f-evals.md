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
| CHAT-add-item: "and 2 l of whipping cream too" adds no line | `evals/chat/free/sessions.json` f1 | E |
| CHAT-two-items: the milk in "perunoita ja maitoa" is dropped | `evals/chat/free/sessions.json` f2 | E |

- Prod defects: `docs/BUGS.md` (bug bash of 825874d, re-tested on eefe4db and f3591fd; #1, #2 and the cut-off dead end fixed on prod; #5, #6 and #9 fixed on main, prod re-test pending).
- BUG-1 regression: an agent's approvalUrl fails on a fresh local PGlite build of main ("not in this browser's sandbox", `snapshot?plan` 404) and passes on prod. 1f is bisecting with `scratch/bugbash/link-main.mjs <base>`; `gate --full` stays red on BUG-1 until it's fixed.
- Claims pass before the 22:00 video: `docs/CLAIMS.md`, a prod screenshot per demo beat.
- Review on/off arms: wait for `REVIEW=1` on prod paths; the same trials both ways via `eval:live`.

## Traps
- An `expectFail` entry hides any other mistake in the same expectation; probe today's state before writing one (the chat items probe found two wrong expectations of mine).
- Expectations are properties (category, `notChosen`, `excludes`), never today's first search hit. Catalogue free-from codes are upper case (`LACTOSE`).
- `evals/ui` `KNOWN` tracks main's build (`gate --full`), not prod. Against prod use `KITCHEN_URL=<url> npx playwright test -c evals/ui/pw-prod.config.ts`: the root config's webServer builds and previews the worktree with its `.env`, which is the prod `DATABASE_URL`.
- Dev, preview and tests run with `DATABASE_URL=` blank. Kill local servers you start.
- Chat replay: `evals/chat/free/replay.json` is keyed by the normalised request. A prompt change in chat v2 makes the gate miss (it fails, it doesn't fall back); re-record with `CHAT_LIVE=1 CHAT_RECORD=1 LLM_PROVIDER=gemini node --env-file=.env node_modules/vitest/vitest.mjs run --project server src/lib/server/evals/chat-free.test.ts`.
- Gate gaps: e2e only with `--full`; `test:pg`, `test:live`, `eval:live` are opt-in; evals run twice per gate (inside `test:unit` too).

## Resume
- **Branch** `lane/f-evals`, head `HEADSHA` (rebased on origin/main 70c30e2; eb9e03b merged).
- **Own:**
  - `scripts/merge-gate.mjs`, `scripts/smoke-race.mjs`;
  - `evals/**` (not `retrieval/`) and `src/lib/server/evals/**`;
  - `docs/CLAIMS.md`, `docs/BUGS.md`;
  - `evals/ui/*.e2e.ts` (the Kitchen order and clock prod checks);
  - the chat suites: scripted c1–c4, free-text plus `replay-llm.ts`.
- **Next:**
  1. After each deploy (watch `/healthz` commit), run `evals/ui` against prod with `pw-prod.config.ts` and mark BUGS rows fixed with that commit.
  2. Follow up the BUG-1 local regression with 1f.
  3. Do a claims pass with prod screenshots before the video.
  4. When E fixes CHAT-add-item or CHAT-two-items, re-record and delete the entries.
