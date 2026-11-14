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

- Adversarial suite (`src/lib/server/evals/adversarial*.test.ts`): 15 open cases in `OPEN` with owners (E: R9-01…05, R8-task-*, R8-next-action; 8d: R7-03/05/11; 9c: R9-08…10; D: R8-web-write, R8-queue-claim). Substitution kinds: 2 open targets (8d). Grounded menu: green on the Exa replay.
- Prod defects: `docs/BUGS.md`, re-tested through `7b3daf1`/`e9ec36c`. Open: #7 (ham weight bases), off-day hold copy, three different decision deadlines, chat vs `/request` basket, Ops door label (REST shown as MCP).
- Waiting on deploys: 8d's unknown-availability fix (re-word CLAIMS/PITCH, re-record d0's case cards 3 and 7); 9c's g7 `services[]` (`evals/ui/services.e2e.ts` then runs).

## Self-review (Ring 4 checkpoint, 14 Nov)
- **Solid:** the gate and its eval layers (scenarios, fidelity, paraphrase, chat replay, adversarial and kinds suites with owned `it.fails`); prod evidence for every "say it" row, with page text and screenshots in `scratch/claims/obs*`; `evals/ui` against prod after each deploy.
- **Fragile:** the prod observation scripts in `scratch/claims/*.e2e.ts` are untracked and key on UI text (the chat's "Working…" changed under me); the menu proposal varies between runs, so menu claims rest on one recorded run; the substitution kinds are derived from grades plus name rules (only kind 1 hand-checked).
- **Untested:** the UI void of an approval after an edit and a UI retry on prod; chat as a fidelity entry; the review on/off arms; the full gate without `data/valio/` (it fails: the fixture catalogue reads the dataset).
- **One hour before 06:00:** move the claims journeys from `scratch/` into `evals/ui/journeys.e2e.ts` (prod-only, page text saved as artifacts) so the video's evidence is reproducible by anyone; then the full demo-beat re-test after the last deploy.
- **Owned slip today:** I called the core's outside-agent approval guard missing (d0 corrected it with `core/state.ts`); claims about code get a grep before they're sent.

## Traps
- An `expectFail` entry hides any other mistake in the same expectation; probe today's state before writing one (the chat items probe found two wrong expectations of mine).
- Expectations are properties (category, `notChosen`, `excludes`), never today's first search hit. Catalogue free-from codes are upper case (`LACTOSE`).
- `evals/ui` `KNOWN` tracks main's build (`gate --full`), not prod. Against prod use `KITCHEN_URL=<url> npx playwright test -c evals/ui/pw-prod.config.ts`: the root config's webServer builds and previews the worktree with its `.env`, which is the prod `DATABASE_URL`.
- Dev, preview and tests run with `DATABASE_URL=` blank. Kill local servers you start.
- Chat replay: `evals/chat/free/replay.json` is keyed by the normalised request. A prompt change in chat v2 makes the gate miss (it fails, it doesn't fall back); re-record with `CHAT_LIVE=1 CHAT_RECORD=1 LLM_PROVIDER=gemini node --env-file=.env node_modules/vitest/vitest.mjs run --project server src/lib/server/evals/chat-free.test.ts`.
- Gate gaps: e2e only with `--full`; `test:pg`, `test:live`, `eval:live` are opt-in; evals run twice per gate (inside `test:unit` too).

## Resume
- **Branch** `lane/f-evals`, head: the commit that adds this block (rebased on main `6b0d7b6`'s base). Not pushed: the lead merges from the shared local refs.
- **Own:** `scripts/merge-gate.mjs`, `scripts/smoke-race.mjs`; `evals/**` and `src/lib/server/evals/**` (kind labels in `evals/retrieval/substitutes.json` by agreement); `docs/CLAIMS.md`, `docs/BUGS.md`; `evals/ui/*.e2e.ts` (order summary, clocks, approval link, services); the chat suites and `replay-llm.ts`; the Exa replay recordings for the golden menus.
- **Next:**
  1. After the next deploy: the full prod journey re-test, every demo beat (the checkpoint's prod evidence), and `evals/ui` incl. `services.e2e.ts` once g7 is live.
  2. When 8d's unknown-availability fix is on prod (a watcher checks `normalize.ts` of the `/healthz` commit): re-word CLAIMS/PITCH from the screen in the lead's words, and have d0 re-record case cards 3 and 7.
  3. Move the `scratch/claims` journeys into a tracked prod-only `evals/ui` spec; keep re-testing BUGS rows per deploy.
