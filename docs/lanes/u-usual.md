# Lane: u-usual (usual order)

**Branch:** `lane/u-usual` · **Worktree:** `../junc26-lanes/u-usual` · **Owner:** lead / lane agent U

## Goal
Per-kitchen order history and detected usual orders (D14), server and core only; the UI builds on the contract below.

## Owned paths
- `src/lib/core/patterns/**` (detection, dates, simulated history; tests)
- `src/lib/server/patterns/**` (read path, get_context slice, plan via place_order; tests)
- `fixtures/seeds/usual-history.json` (recipes per profile)
- one additive field in shared files, see Needs

## Contract for the UI
Core (`$lib/core/patterns/usual`, pure):
- `usualOrder({ lines, deliveryDate, asOf?, window?, deliveryDays?, overrides? }): UsualOrder`
- `detectPatterns(lines, { asOf, window?, overrides? }): ProductPattern[]` (one pattern per product per weekday rhythm)
- `windowRange(asOf, window?)`, `periodText(period)`, `dueOn(pattern, date, deliveryDays)`
- Types: `HistoryLine {productId, qty, unit, date, source?}`, `HistoryWindow {n, unit: days|weeks|months}` (default 12 weeks, capped at 184 days), `PeriodOverrides {kitchen?, products?: Record<id, {every, unit}>}`, `Period` (`weekly {weekday, everyWeeks}` · `every_n_days {days}` · `monthly {day, everyMonths}` · `irregular`), `PatternStatus` (`settled` ≥ 80% · `forming` 50–80% · `not_settled` · `joined` · `dropped` · `occasional`).
- `UsualOrder { deliveryDate, weekday, window {from,to,days}, lines: UsualLine[], joined, dropped, notSettled: UsualChange[], settled, sentence }`
- `UsualLine { productId, unit, qty, low, high, score 0–1, status, period, source detected|override, seen {k,n}, lastSeen, sentence }` — sentence e.g. "seen 9 of the last 10 Tuesdays", "every other Wednesday: seen 6 of the last 6".
- `UsualChange { productId, unit, qty, period, date, dueOnDay, sentence }` — "joined Wed 18 Nov: on 3 of 3 Wednesdays since", "dropped: last ordered Fri 30 Oct, every Friday before that".

Server (`$lib/server/patterns/usual`):
- `readUsualOrder(ports, kitchen, { deliveryDate?, asOf?, window?, overrides? }): Promise<UsualOrderView>` — read-only; defaults: asOf = sim today, deliveryDate = next receiving day. Adds `label: "simulated history"`, `kitchenId`, `asOf`, per line `name, unitCents, lineCents, availability, rhythm`, and `totalCents`, `unpriced`.
- `planUsualOrder(handlers, ctx, view, { lines?, nonce? })` — the chef's confirmed lines (edited, plus top-ups) through `place_order` → gate → mandate → `applyOps`. Idempotent per lines + nonce.
- `usualSlice(kitchen, asOf)` — the get_context slice (product ids, qty, score, our sentences; no catalogue names or prices).
- `kitchenHistory(kitchen, asOf)` — the raw simulated history (`SimulatedHistory {label, kitchenId, profile, from, to, lines}`).

HTTP (`/kitchen-api/usual`, this browser's sandbox via `visitorWorkspace`):
- `GET ?kitchen=<id>&date=<YYYY-MM-DD>&window=12w|3m|30d&every=<productId>:2w` → `UsualOrderView & {kitchenName, deliveryDays}`; `every` is a session-only override.
- `GET ?q=<text>` → `{hits: {productId, name, unit, lotStep}[]}` (top-up search, food only).
- `POST {kitchenId, deliveryDate, lines: {productId, qty, unit}[], nonce?}` → `{ok, planId, version, state, approvalId, summary}`; `place_order` as the chef (`kitchen-ui`) through `serveTool`. Errors come back as `{error: {code, message}}` with 400/404/409.

Component `$lib/ui/UsualOrder.svelte` (self-contained; reads and plans through the route):
- Props: `kitchenId: string`, `date?: string` (YYYY-MM-DD; default next receiving day), `endpoint?: string` (default `/kitchen-api/usual`), `onplanned?: ({planId, state, approvalId}) => void`.
- Shows: title "Usual Thursday order · Thu 10 Dec", the history sentence, a "Simulated history" chip; lines with tick, name, editable qty (lot step), unit words, price, status icon + word, the seen-sentence and usual range; a per-line "Rhythm" select (session only); joined and dropped with Add / Add back; a top-up search; total and "Plan this order", then "Planned, waiting on your decisions: open it" linking `/?plan=<id>`.
- Dev preview: `/dev/usual?kitchen=k-hotel&date=2026-12-10` (404 outside dev).

UI rules: show "simulated history" wherever these appear; a usual order is a suggestion until the chef confirms it; render `sentence` (no ISO dates in it).

## Needs (lead)
- **Shared file touched, additive:** `src/lib/core/contracts/tools.ts` — `get_context` output `kitchens[].usual` (optional) and one sentence in its description; `src/lib/server/agent/get-context.ts` fills it. Revert both if you'd rather keep get_context unchanged; nothing else depends on them.
- No new tool. The page's door is `/kitchen-api/usual` (below); a `get_usual_order` read tool for outside agents would need its own contract.
- Period overrides have no storage yet: they are a function argument. Storing them belongs with the mandate/kitchen settings.

## Report
- 14 Nov 18:20 · done: /kitchen-api/usual (read, search, plan as chef via serveTool), UsualOrder.svelte, dev preview, screenshots at 1440/390 for k-hotel Thu 10 Dec and k-lounas Wed 9 Dec (planned once end to end); a chef-set rhythm now keeps its product in the order · stubbed: overrides live in the component only · needs: mount in KitchenScreen (1f) · ready to merge: yes if gate GREEN
- 14 Nov 17:30 · done: core detection + tests, seeded history for P1–P3, priced read path, get_context slice, plan via place_order · stubbed: overrides not persisted · needs: see above · ready to merge: yes if gate GREEN
