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
- Round 10 suite (`src/lib/server/evals/adversarial-r10.test.ts`, `adversarial-transport-r10.test.ts`): open 8d R10-03/04/05/06/08, da R10-15, 9c R10-09, E R10-02b (a cancel after the fence's re-read). Substitution kinds: one definition agreed with 8d; accuracy check open until `basekey.ts` matches the 253 pairs sent to 8d.
- When the journeys check "a vegetarian dish's rescue never orders meat" goes green on prod (0d's 36c3d60, then D16): tell d0 to bring back the landing's "can be ordered now" figure and re-record.
- When R10-03 (a menu's lactose-free requirement) is fixed and on prod: tell d0 (`junc26-d0`) to widen /how's "On a request, a product that breaks a stated requirement…" to menus.
- Waiting on deploys: 8d's unknown-availability fix (re-word CLAIMS/PITCH, re-record d0's case cards 3 and 7); 9c's g7 `services[]` (`evals/ui/services.e2e.ts` then runs).

## Self-review (Ring 4 checkpoint, 14 Nov)
- **Solid:** the gate and its eval layers (scenarios, fidelity, paraphrase, chat replay, adversarial and kinds suites with owned `it.fails`); prod evidence for every "say it" row, with page text and screenshots in `scratch/claims/obs*`; `evals/ui` against prod after each deploy.
- **Fragile:** the prod observation scripts in `scratch/claims/*.e2e.ts` are untracked and key on UI text (the chat's "Working…" changed under me); the menu proposal varies between runs, so menu claims rest on one recorded run; the substitution kinds are derived from grades plus name rules (only kind 1 hand-checked).
- **Untested:** the UI void of an approval after an edit and a UI retry on prod; chat as a fidelity entry; the review on/off arms; the full gate without `data/valio/` (it fails: the fixture catalogue reads the dataset).
- **Plan to the deadline** (Sat 15:30 → Sun 06:00 feature freeze, 10:00 submission):
  1. Now: `evals/ui/journeys.e2e.ts` is tracked (prod-only, `JOURNEYS=1`; page text and screenshots per beat); run it on every deploy and fill the CLAIMS rows for the freeze build.
  2. Evening: the open adversarial and kinds cases as owners fix them (delete `OPEN` lines); chat events and the off-day copy re-tested as they land; the UI void and UI retry made observable beats.
  3. Before 06:00: one final journeys pass on the freeze build; CLAIMS, PITCH and the site's cases re-checked against it.
  4. 06:00–10:00: no code; re-run the journeys after the last deploy, check the video and submission texts against CLAIMS, and keep prod evidence current until submission.
- **Owned slip today:** I called the core's outside-agent approval guard missing (d0 corrected it with `core/state.ts`); claims about code get a grep before they're sent.

## Traps
- An `expectFail` entry hides any other mistake in the same expectation; probe today's state before writing one (the chat items probe found two wrong expectations of mine).
- Expectations are properties (category, `notChosen`, `excludes`), never today's first search hit. Catalogue free-from codes are upper case (`LACTOSE`).
- `evals/ui` `KNOWN` tracks main's build (`gate --full`), not prod. Against prod use `KITCHEN_URL=<url> npx playwright test -c evals/ui/pw-prod.config.ts`: the root config's webServer builds and previews the worktree with its `.env`, which is the prod `DATABASE_URL`.
- Dev, preview and tests run with `DATABASE_URL=` blank. Kill local servers you start.
- Chat replay: `evals/chat/free/replay.json` is keyed by the normalised request. A prompt change in chat v2 makes the gate miss (it fails, it doesn't fall back); re-record with `CHAT_LIVE=1 CHAT_RECORD=1 LLM_PROVIDER=gemini node --env-file=.env node_modules/vitest/vitest.mjs run --project server src/lib/server/evals/chat-free.test.ts`.
- Gate gaps: e2e only with `--full`; `test:pg`, `test:live`, `eval:live` are opt-in; evals run twice per gate (inside `test:unit` too).

## UI entry steps (D15)
Every UI check enters through `evals/ui/flow.ts` (`planBuffet`, `approveAll`, `openWhy`, `request`, `chat`). D15 stage 2 changes that file only. Selector contract asked of the owners (via the lead, 14 Nov): the picker (c3) is a region "Who are you cooking for" with one button per seeded kitchen by name and `data-kitchen-id`, and the field "Describe your kitchen"; the canvas (1f, `junc26-ab`) keeps `#task-h`, `aria-label="Decide"`, "Show details: <dish>", "Why this line", "Order the N lines you can now", "Review N lines" / "Confirm exact terms" / "Hold to sign off N lines"; the composer (E) keeps `#chat-text`, "Send" and a "Working…" status that disappears when a turn ends; the request step cards (B) carry `data-testid="step-card"` with `data-step` and `data-status`. `/request` redirects into the chat with the text sent in stage 2 (the lead confirms when).

## Resume
- **Branch** `lane/f-evals` (local; not pushed: the lead merges the local head). Merge the local head, never `origin/lane/f-evals` (stale at `ddf701a`; merging it reverted this brief once, in `d9ee3ee`).
- **Own:** `scripts/merge-gate.mjs`, `scripts/smoke-race.mjs`; `evals/**` and `src/lib/server/evals/**` (kind labels in `evals/retrieval/substitutes.json` by agreement); `docs/CLAIMS.md`, `docs/BUGS.md`; `evals/ui/*.e2e.ts` (order summary, clocks, approval link, services, journeys, no-raw-ids) and the idle guard; `src/lib/server/images/score.ts`; the chat suites and `replay-llm.ts`; the Exa replay recordings for the golden menus.
- **Next:**
  1. When prod = main (`journeys` checks it first): the pinned freeze-build pass `JOURNEYS=1 KITCHEN_URL=https://app.mandate.kitchen npx playwright test -c evals/ui/pw-prod.config.ts journeys`, with the two rehearsal lines (the buffet's lines ordered alone; one explicit exception), then CLAIMS from `scratch/claims/<commit>/`.
  2. Delete `OPEN` lines as owners' fixes land (adversarial, R10, kinds); tell d0 when R10-03 lands.
  3. Re-run the full no-raw-ids sweep on prod once da's `/agents` code presentation ships.
