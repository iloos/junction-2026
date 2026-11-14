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

## Open (checkpoint Sat 14 Nov, main 32b8eb4, prod b2dfe9c)
**Done since the Ring 4 checkpoint** (all merged into main): R10 and R11 adversarial suites with the shared harness (`adversarial-harness.ts`); the judge recall table (`judge-recall.test.ts`, 9/10 reading defects flagged); substitution kinds on all 471 rows plus the order check; presets and per-line constraint evals; grounded-menu checks on the Exa replay; the vision bar (R10-14); the idle guard (R10-13); the phone dock check (R11-14); the services journey with per-request evidence (R11-13, `2cb3694`: the stored Gemini trace by `x-request-id` once O's traces deploy); the lane gate rule (`b57324b`: lanes run `--only check,lint`).

**OPEN maps by owner** (delete a line when its case goes red, "looks fixed"):
| owner | cases |
|---|---|
| 8d | R10-05, R10-06, R10-08 · R11-04a/b, R11-05, R11-09, R11-10 · kinds order 463876, 462482 |
| 9c | R10-09 (transport) · R11-06a/b · R11-07a (with 1f) |
| da | R10-15 · R11-08 |
| D | R8-web-write, R8-queue-claim |
| B | judge recall `brand-dropped` |
| 1f | R11-14 phone dock composer (`evals/ui/mobile-dock.e2e.ts`, `OPEN_R11_14`) |
| E | CHAT-add-item, CHAT-two-items (`evals/chat/free/sessions.json`) |

**CLAIMS rows pending a prod pass:** chat events (ChatDock doesn't render the `menu` event); per-request service evidence (strict once O's traces deploy); the buffet's lines ordered alone and one explicit exception (journeys rehearsal lines); Labels and grounded menus on the freeze build; refusals in Ops.

**e2e on prod b2dfe9c:** `services` green (trace part skipped: `/api/ops/traces` 404); journeys b1–b13 green on b2dfe9c including b13 (vegetarian rescue never orders meat); `mobile-dock` expected-fail (composer bottom at 1179 px of 844). The pinned pass needs prod = main: main is 32b8eb4, so after the batch deploys.

**Site reviews for d0:** /story (73's f03f1bb → 06c550e) checks before a recorded stop drawn neutral, shipped. /how map: Gemini Decisions wording ruled ("scores how well each substitute fits the dish, one input to the code's ranking, and can flag a constraint risk that holds the line; it never approves"); pool.test path is `server/store/pool.test.ts`.

**Risks:**
- The pinned journeys pass keys on UI text; D15 stage 2 (picker, composer, step cards) changes the entry steps. `evals/ui/flow.ts` is the only file to change, and the selector contract below is what it needs.
- Menu claims rest on recorded runs (menus vary per run).
- `core/services/substitutes.ts` contradicts itself: the comment near line 288 says a calibrated "violates" rejects a candidate; `VIOLATES_P`'s doc and the site say it adds a caution that holds the line. Owner 8d should settle it; CLAIMS says "holds".
- Prod BUGS still open: #7 ham weight bases, off-day hold copy, three decision deadlines, chat vs `/request` basket, Ops door label.

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
  1. After the batch with O's traces deploys (prod = main): `KITCHEN_URL=https://app.mandate.kitchen npx playwright test -c evals/ui/pw-prod.config.ts services` (the trace part turns strict), then the pinned freeze-build pass `JOURNEYS=1 KITCHEN_URL=https://app.mandate.kitchen npx playwright test -c evals/ui/pw-prod.config.ts journeys` with the two rehearsal lines; fill CLAIMS from `scratch/claims/<commit>/` and send the lead the CLAIMS-vs-prod summary.
  2. Delete `OPEN` lines as owners' fixes land (table above); tell d0 when R10-03's menu half reaches prod (/how's "On a request…" widens to menus).
  3. D15 stage 2: update `evals/ui/flow.ts` when the lead sends the branch.
  4. Re-run the full no-raw-ids sweep on prod once da's `/agents` code presentation ships; evals for 8d's order-scope, prefer and best-try constraints (`constraints.test.ts` `it.todo`) and 1f's carbon/reliable presets when they land.
