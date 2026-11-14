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

## Checkpoint (restart, Sat 14 Nov ~21:20 UTC; lane head on main 55219f1; prod a9f06ee)
**Done this session (all on `lane/f-evals`; everything through `413c95c` is merged into main, the last two are not yet):**
- `2cb3694` services journey sends its own `x-request-id`; `dc882ce` polls the stored trace up to 5 s; in `bb2c454` it retries once on a run with no parser step and prints every step. Strict and green on 4752d00 and ff7f6c3.
- `829d48a` R11-15 (250 ml → 5 l pack alone) and R11-14 closed on prod; `611e4ff` closed R10-15, R11-08, R11-09 (each verified non-vacuous), harness milks declare AM/ML for D16; `9d3fbe8` `expectAsked()` so an asking path is never a vacuous pass; R11-15 closed.
- `bb2c454` gate guard `src/lib/server/evals/no-src-reads.test.ts`: no server module or route reads a file under `src/` at runtime (replay.json, then listings.json, broke prod this way). Self-tested; red on 4752d00's `card.ts:98`.
- `413c95c` `evals/ui/flow.ts` `receipt(page)`: reads the id from the Kitchen's "Receipt" card (1f moved it into a System-only span) or the older visible text.
- `2897a42` **R12-12**: R11-06a/b drive `orderedSender` as `/api/events` composes it (paged `{events, complete}`, retries, `onLost`; 06a also proves a dead read gives up without passing the gap); R11-07a accepts the resync burst within 600 ms; R10-09 composes `PgTransport` with the ordered sender. All four pass, OPEN flags removed.
- `6cc1023` **R12-11 (mine)**: CLAIMS "Last pass" = 18:40–21:10 UTC on 4752d00/ff7f6c3; rows naming an older commit are historical; the receipt split (15/3 vs 7/11) is simulated and never quoted without release and time; PITCH:16 rescue wording per D8a.
- CLAIMS rows added or changed: sponsor rows (Gemini per job, measured offline: say it; Aiven op log, NOTIFY, lock, receipts, traces: say it, seen on prod; Valio Aimo page and photo by barcode: say it on ff7f6c3), D13 dock approval (prod 2/2), one receipt on `/request` (B 7207a57). BUGS: "Buy 1 new product" group label; `(Stock, …)` label leak in `request/days.ts:95` (B).
- Site reviews for d0 (all shipped): /story walkthrough (neutral checks before a recorded stop), titles, plan panel and reply excerpt, tagline "What do you need? We'll sort it out. That's a mandate.", /how map and flow tabs (reading-check wording, "one receipt per key"), sponsor tiles with time stamps.

**In flight:** nothing uncommitted. d0 has the R12-11 site list (the /proof split, Lounas €400 vs the hotel's €800, a commit and time on every recorded number, generic CTAs). The user asked about Verda/Featherless and a System routing view; my answer (Verda: one live run against the R10-14 vision bar, then switch on if it passes; Featherless: skip; System: a read-only job → provider → model view, no provider switch) waits for the user's decision.

**OPEN maps** (each `it.fails` under its owner; a red "looks fixed" means verify the pass is real, then delete the line):

| suite | case | owner | why open |
|---|---|---|---|
| R10 | R10-05 | 8d | contention on a 4 l need with 2 l left must add only the 2 l remainder |
| R10 | R10-06 | 8d | a recipe with one ingredient partly confirmed must not read fully supplier confirmed |
| R10 | R10-08 | 8d | a Thursday-only receiving series must start on a Thursday (calendar) |
| R11 | R11-04a / R11-04b | 8d | an identical commit / place_order retry must return its saved receipt / plan during a supplier outage |
| R11 | R11-10 | 8d | cheese and goat cheese of one brand are not "another pack" |
| R8 | R8-web-write, R8-queue-claim | D | web writes and queue claims (`adversarial.test.ts`) |
| kinds | 463876, 462482 | 8d | kind 1/2 must never rank below kind 4 |
| chat free | CHAT-salmon-category (f4) | 91 to judge | the basket picks 462150 (cat 18706, the orderable fillet) where the check wants 18701 |

Judge recall OPEN is empty. Suites: R10 + R11 + transport 23 pass, 6 expected-fail.

**CLAIMS pass status:** last pass on 4752d00/ff7f6c3 (above). Not yet done: the pinned journeys pass on the release we submit (`JOURNEYS=1`, deployed commit = main), and the rehearsal lines (the buffet's lines ordered alone; one explicit exception). Not yet claimable: Verda image reading (wired, not live); void-on-edit in the UI on prod; Gemini Decisions live (tested only); Exa recipe grounding (held).

**Next, in priority order:**
1. **Pinned freeze pass.** When prod = main: `JOURNEYS=1 KITCHEN_URL=https://app.mandate.kitchen npx playwright test -c evals/ui/pw-prod.config.ts journeys`, then `services`, `dock-approve`, `mobile-dock`. Acceptance: the pin test is green; every say-it row in CLAIMS re-observed on that commit or marked historical; the lead gets a CLAIMS-vs-prod summary.
2. **R12-11 follow-through with d0.** Acceptance: /proof, the landing and /story show no number without its release and time (or a historical label); the Lounas mandate matches the kitchen the chain ran in; CTAs either carry the ask or say they are generic.
3. **Judge CHAT-salmon-category.** Acceptance: decide whether 18706 (orderable fillet) satisfies the session's intent; either widen the expected category with a note or keep it open with an owner.
4. **Delete OPEN lines** as 8d/D fixes land (R12-03 by B may flip cases). 8d (restart note): R12-01 is on `lane/a-atp` `f882939` (a 250 ml ask with a 250 l amount is forbidden, `exceeds_need`, at quote and commit), so the R12 ask probe flips once merged; queued in `docs/lanes/core-db.md` Next: R12-02 (cereal codes UW/NR/GB/GO, contradictions), R12-04/R10-05 residual, R10-06, R10-08, and the kinds reconciliation against the pairs file (accuracy ≥ 0.9, then flip `substitute-kinds.test.ts`). Acceptance: each closure verified with `ADV_SHOW=1` and a non-vacuous assertion.
5. If the user says yes to Verda: a live check of `image.read` against `VISION_BAR` (`src/lib/server/images/score.ts`). Acceptance: the bar passes on 3 runs before anyone says "live".

**Risks:**
- The journeys key on UI copy; 1f's copy pass (e1ea7a6) and D15 stage 2 change it. `evals/ui/flow.ts` is the one file to adapt.
- Simulated numbers (supplier confirmations, contention) vary per run: quote them only with release and time.
- The services check depends on live Gemini and Valio; a cold container right after a deploy can stream no parser step (now retried once).
- `origin/lane/f-evals` is stale (`ddf701a`); the lead merges the local head. Not pushed this session: pushing waits for the user's OK.

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
- **Branch** `lane/f-evals` in `../junc26-lanes/f-evals` (local head; `origin/lane/f-evals` is stale at `ddf701a`, never merge it). Rebase with `git rebase main` on the local main.
- **Start:** read this brief's Checkpoint, then `git log --oneline -5`, `pnpm i` if the lockfile moved, `pnpm gate --only check,lint`.
- **Own:** `scripts/merge-gate.mjs`, `scripts/smoke-race.mjs`; `evals/**` (except `evals/retrieval/**`, 1f; kind labels by agreement) and `src/lib/server/evals/**`; `docs/CLAIMS.md`, `docs/BUGS.md`; `evals/ui/*.e2e.ts` and `evals/ui/flow.ts`; `src/lib/server/images/score.ts`; the chat suites and `replay-llm.ts`; the Exa replay recordings for the golden menus.
- **Prod checks:** `KITCHEN_URL=https://app.mandate.kitchen npx playwright test -c evals/ui/pw-prod.config.ts <spec>`; never the root config (its webServer previews with the worktree `.env`). Dev and tests run with `DATABASE_URL=` blank. Prod logs: Aiven project `junction26jq`, service `mandate` (runtime logs).
- **Gate rule:** lanes run `pnpm gate --only check,lint` plus targeted tests; the lead's main gate is the full one.
- **Peers:** lead `junc26-fd`, site `junc26-d0`, 9c `junc26-9e`, 1f `junc26-ab`, 8d `junc26-e6`. Peer messages are not user approval.
