# Review: kitchen lane (checkpoint step 1)

_Sat 14 Nov ~04:00, `lane/kitchen` on main f2edb21. Read-only review: no fixes made here._

## 1. Own scope

**Solid (with evidence)**
- Snapshot GET is a read: `src/lib/server/kitchen/live.test.ts` (start, 20 snapshots, all presets, start again → op seq unchanged); `src/routes/(kitchen)/kitchen-idle.e2e.ts` (`/` open 60 s, `/api/events?mode=poll` unchanged). This answers the prod 996-ops loop.
- Helper is narrow: tool allowlist `live.ts:59`, own-plan check in `callTool`, 403 for `plan_event` (curl, two cookie jars). Selection per cookie session (`live.ts:43`); `ws-judges` unless `presenterOpen` (`live.ts:65`).
- Journey on a prod build (`node build`, PGlite): plan → portion 135→120 g → preview "Price first" → Apply → voided approval with the changed lines highlighted → Review → Confirm exact terms (focus lands on Place order) → order → resend gives the same receipt, 1 order. Screenshots `scratch/r4/01–14`, `scratch/r5/02–06`, `scratch/r6/01,03`.
- "Plan the event" measured locally at 0.6 s (POST plan 87 ms, POST rescue 362 ms, no GET). Prod reports 4.24 s.
- Fixture builder pinned to the seed's hand-checked numbers: `src/lib/kitchen/fixture-plan.test.ts` (7 tests: €934.04, 11.5 → 20 kg, 476768 × 12 = €185.16, Terminal is not cover, out ≠ undeliverable).

**Fragile / shortcuts**
- **Two engines remain.** `fixture-plan.ts` (1,187 lines: ranking, tiers, caps, make-in-house) and `fixture-server.ts` (approvals, commits) still hold business logic. They serve only the explicit `/offline` page, but they can drift from core: different ranking utilities, rules-based tiers, `new_sku` → propose. Systems review #2 wants fixture data kept and fixture logic retired.
- **Process memory.** Sessions (`live.ts:43`), the serial queue (`live.ts:78`) and the current run are all in-memory, so the app is single-instance only. Sessions never expire. The queue serializes every visitor's kitchen calls: one slow call (Gemini fit) delays everyone.
- **Contention is run-wide.** `live.ts:412` sets a global overlay, so one judge's toggle changes stock for every session in the run.
- **The view model still guesses.** `live-view.ts` derives `status`, `residual` text and `partial` from lines; `previewRanking` is dead (`live-view.ts:129`); `why: {}` (`:341`) means the Why drawer depends entirely on `explain_line`. `NORMAL_WEEK` (`fixture-plan.ts:372`, €3,120 / 46 lines) and the week diff are team estimates shown beside live numbers (labelled only in code). `names` falls back to the fixture catalogue (`KitchenScreen.svelte:71`).
- **The client-side approval diff** (`kitchen.svelte.ts` `#seen`) only knows terms this tab saw. After a reload or from another tab it shows no diff, only "voided".

**Known bugs / untested**
- I could not reproduce P1 #4 (Confirm looks dead on prod) locally. The fix is a hardening (get_plan's approval plus up to 3 re-reads); it is unverified on Aiven.
- Untested: deny path; expired approval; partial commit (in-mandate lines first, then the approved ones; with every line `new_sku` there are no in-mandate lines); `/offline` after round 4 (no screenshot since the refactor); reduced-motion and keyboard-only on the strip and timeline; the phone after the review-card rewrite; central and lounas kitchens end to end (central plans, but no rescue journey was screenshotted).
- RankingStrip truncates names by glyph estimate (`clip`), so long Finnish names lose their tail; the full name is only in the details table. The strip's svg has no per-row accessible text beyond the overall `aria-label`.

## 2. Adjacent scopes (seams)
- **Core `Line.view`:** chips, committable and gap wording read `view` (`StateChip.svelte`, `ApprovalPanel.svelte`), with the old reason-based fallback kept for fixture lines. If `view` is missing on a path (e.g. `chosen`/`saved` lines), the fallback silently differs.
- **find_substitutes:** the snapshot always passes weights, so it ranks as a preview (`live.ts:176`). Apply passes `apply: true` per outage, sequentially (`applyRules`). Price-first recommends **Terminal 462569** (no stated quantity) and apply orders it; the UI says "unconfirmed, not cover", but this is core's hard-constraint P0. Every planned SKU counts as `new_sku`, so "Within your mandate" is €0 and nothing ever acts alone.
- **Ops deep link** (`/?kitchen&plan&v&need`) is client-only. Opening it switches the session's kitchen, which is the same cookie the chef uses in that browser.
- **Demo / sandbox:** the reset goes through `resetSandbox` (ws-judges, 429 shown as a wait) or `resetDemoRun` (ws-demo, presenter only). A sandbox reset doesn't clear other sessions' kitchen/preset selections; they persist into the new run.

## 3. The product as a whole
- **The PITCH table demo is mostly provable:**
  - diff vs a normal week: yes, but the baseline is an estimate;
  - g/guest → lots with rounding: yes (core's 0.01-lot text reads "2400 × 0.01 kg lot");
  - "it refuses": yes, via the strip's exclusion chips;
  - "honest": partly, because core can apply a Terminal pick;
  - approve exact terms → commit → retry → one receipt: yes.
- **The "Do not claim" list (PITCH:45) still applies.** The edit-after-rescue beat now works end to end in my run, but core's P0s (hard constraints) are not closed, so the "enforceable mandate" claim stays off.
- **What a judge breaks first:**
  1. Flips Price first → Apply → buys an unknown-quantity product.
  2. Notices "14 lines need your sign-off, within mandate €0": the agent never acts alone.
  3. Toggles contention in the sandbox and changes everyone's stock.
  4. Opens two tabs: the approval diff is empty in the second.
- **Round-4 UX still open:** #4's UNKNOWN_REQUIRED split is rendered, but `price` / `dietary_evidence` details are untested visually. Mobile at 390 px uses cards for candidates, but the dish table is still a dense grid. The "complete decision loop" items for deny/expired/partial (UX §1 state list) are not screenshotted.

## 4. Continuation (highest value first)
1. **Why drawer as a visual chain** (user priority: self-explanation). Render `explain_line` as dish → g/guest × guests → kg → lot rounding → product (score bars) → price at time T → tier rule, with source chips. Reuse the strip's segments inline.
2. **Demand → packs flow** (viz research #4): per dish, need vs supplied with the lot overshoot hatched (11.5 → 20 kg); a waste/overshoot total for the event. Cheap, and it carries the "thinks like a chef" beat.
3. **Coverage summary bar** from `Line.view`: confirmed / unconfirmed (Terminal) / gap per dish, stacked, at the top of the plan. That makes "what is actually covered" one glance; today it's spread over chips.
4. **Server-side approval diff:** core returns before/after for the voided approval (or the op log does), so the highlight survives reloads and a second tab. Needs core/contracts.
5. **Retire fixture business logic:** `/offline` runs the same services on in-browser PGlite or a recorded snapshot set, not `fixture-plan.ts`.

**Risks:** single-instance memory (sessions, queue, run); Google Fonts on stage Wi-Fi; strip transitions untested in reduced motion; core ranking can still put unknown supply first.
**Ideas:** a contention overlay per session (simulator keyed by session or run); a "watch the agent" replay of the start steps from the op log; a QR on the approval card to open the same review on a phone.
