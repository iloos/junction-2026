# Usual order and "How ordering works": design

_Sat 14 Nov 2026. Approved direction from the user (via d0). Two app pages built from the design-session mocks `scratch/ux-mock/rhythm.html` (Usual order) and `scratch/ux-mock/journey.html` (Request to order), made real. Plan items #10, #13 (narrowed) and #16 in [handoff/ui-mockset-to-prod.md](../../handoff/ui-mockset-to-prod.md). Lanes are assigned by the lead._

## Why
- **Usual order** gives the mandate the baseline it is missing. PITCH's answer to "doesn't the agent ask too much?" is that usual products go through within the mandate and only what's new or over a limit is held. Today that baseline is a hand-written list per kitchen (`Kitchen.usualProducts`, scenario data), which `orderedBefore` in `core/mandate/tier.ts` uses for the never-delegate `new_sku` rule. A page that learns the usual order from orders, and shows how sure it is, turns that claim into something a judge can watch.
- **How ordering works** answers "what did the agent actually do with my words?" step by step, from the request to the receipt, with the real values of a run.

## Goals
1. A Usual order page in the app: per item, how settled it is and why; the share of the order that is settled; a projection for the coming weeks whose band widens as confidence drops; what changed. Every number comes from a pure function in `core/` over an order history.
2. History = **sample weeks + yours**: 16 weeks of sample orders for the demo hotel, labelled "Sample history: team estimate" wherever they appear, plus the sandbox's own committed orders, marked "Yours". Placing an order changes the page.
3. A "How ordering works" view of a real request: the mock's 13 steps, each showing what happened and the values, filled from the `/request/run` response the chef just got; and a standalone page showing one recorded run, labelled with its date and app version.
4. Both pages meet rule 12 (five-second UI), VOCABULARY, and the claims process (91 adds CLAIMS rows before anything is said in the pitch).

## Non-goals (before the 06:00 freeze)
- The Valio-wide stock forecast across kitchens (#13 as drawn: `projectDemand` + `sim_stock`, P(short) per product per day) and the 2,400-kitchen demand view. Pitch material, labelled "next".
- Changing what the mandate allows. The tier logic keeps reading `Kitchen.usualProducts`; see "The mandate link".
- Menu-cycle alignment (the mock's "line up weeks by menu cycle" toggle). Calendar weeks only; cycle weeks are a stretch item.
- An MCP/REST tool for the usual order. Read-only page data first; a tool can follow.
- Persisting request runs or replaying traces from the op log.

## Anti-goals (a failure even if it works)
- Sample weeks read as Valio data or as this kitchen's real history. They are never unlabelled, never mixed into "Yours", and never called Valio's.
- A number on screen that no function computed (typed into copy).
- The page changes how the agent behaves, or an eval, before the freeze.
- Raw ids, op names or ISO dates in the Kitchen-facing view (rule 12); formulas and op names belong in the depth layer only (the item panel / "Show the maths").

## Constraints
- Freeze Sun 15 Nov 06:00; nothing deploys in the last 30 minutes before judging.
- Rule 2: the maths is plain TS in `src/lib/core/usual/`, no I/O, with unit tests, and a test at 10× demo size (rule 4: 160 weeks × 90 items).
- Rule 3 is untouched: both pages are read-only. No new op types.
- Each visitor has a sandbox (`ws-j-…`); "Yours" is that sandbox's orders and resets with it. Sample weeks are the same for every visitor.
- The scenario clock (Mon 7 Dec) is "now"; weeks count back from it.
- `pnpm gate` stays green with `LLM_PROVIDER=fixture`; neither page calls a model.

## Approaches considered
**Where the order history comes from**
- *Real orders only*: true, but every fresh sandbox has at most a few orders, so the page is blank in the demo.
- *Sample only*: looks complete but never reacts; a nicer picture of made-up data.
- **Mixed (chosen):** sample weeks as the labelled base, the sandbox's committed orders on top, recomputed on each visit. It works in the demo and shows the maths reacting to a judge's own order. The lead recommended the same, with the labels "Sample history: team estimate" and "Yours".

**How the ordering view gets its data**
- *Replay from the op log / trace bus*: the most "real", but a request run is not persisted as one object and the trace bus misses some sponsor calls (CLAIMS: not claimable). Too much new plumbing before the freeze.
- **From the `/request/run` response (chosen):** the response already carries the parsed request, the lookup (shortlist, filtered-out count), the plan lines with tiers and reasons, and the cut-off check. The view renders it in the request page right after a run; nothing new is stored. The standalone page renders a recorded response saved as a fixture (`fixtures/journey/*.json`, with recordedAt and the app commit), labelled as recorded.
- *Static explainer*: no real values; the user asked for real.

## Design

### Usual order
**History.** `OrderWeek = { week: number (0 = this week, −1 = last week …), productId, amount: { value, unit } (physical, as in the plan's need basis), source: 'sample' | 'yours' }`.
- *Sample*: `fixtures/history/<kitchenId>.json`, weeks −16 to −1 for `k-hotel` (Hotel Rautatientori), generated once by a script with a fixed seed and committed. **It agrees with the mandate (d0's call):** the settled core is the hotel's standing order in `fixtures/seeds/kitchens.json` (`usualProducts`: salmon fillet 462150, potatoes 475214, lactose-free milk 464201, porridge rice 466964), so the page and the `new_sku` rule tell the same story. Around that core: one standing item whose amount steps up (lactose-free milk from week −7), one item that is forming but not on the standing order (oat drink from week −5, so it is held as new, as the rule says), and one irregular item that never settles. Butter is not in the sample, so the shipped butter demo (held as a new product) stays consistent. Product ids are real catalogue ids already used by the seed.
- *Yours*: the sandbox's committed orders for that kitchen (`state.orders`, `Order.deliverBy` → week relative to the scenario clock, each line's physical amount).
- **Merge rule (d0's call):** sample weeks end at week −1; week 0 and later are "Yours" only, so they never add up. Before any order this week, week 0 reads "No order yet this week"; after one, each item shows whether it matches its usual amount, is outside its usual range, or is new (held for the chef). That before/after is what the screenshots and the claims row prove. The Christmas one-offs are the current buffet, so they appear only if the visitor orders them, as "Yours".

**Maths** (`src/lib/core/usual/`, pure, unit-tested; formulas as in the mock `rhythm.html`, recorded in the module header):
- Per item, with older weeks weighted ×0.9 per week: `comesBack = (1 + timesOrdered) / (2 + weeksSeen)`; `steady = 1 / (1 + spread ÷ usualAmount)`; `history = 1 − e^(−weeks/2.5)`; `settled = comesBack × steady × history`.
- Projection k weeks out: usual amount ± `band(k) = 2 × spread × √k ÷ settled`; `confidence(k) = settled × e^(−1.4k(1 − settled)²)`.
- Per week: the share of the order's value that is settled (needs a price per item: the latest quoted price from the sandbox, else the catalogue's list price; items without a price are excluded from the share and counted in a note).
- "What changed": rules over the history (new item: first seen within 3 weeks; amount step: the median of the last 3 weeks differs from the median of the previous 6 by more than 40%; one-off: present only in ≤ 2 recent weeks and flagged by the scenario as an event line). Each finding names the week and the evidence.
- Edge cases are defined in tests: one week of history, zero spread, an item ordered every week at the same amount, an item seen once, an empty history.

**Read model.** One server function `usualOrder(workspace, kitchenId)` in `src/lib/server/` that loads the sample file, reads the sandbox's orders, calls the core and returns a view: items, weekly settled share, projections, changes, and the mandate baseline (`Kitchen.usualProducts`) for comparison. Served by a `+page.server.ts` load.

**Page** (`/usual`, linked from the app nav next to Kitchen; light theme, app tokens; the mock's layout):
- Header sentence with the numbers ("X% of this week's order by value is settled; N of M items are the usual order (about €Y a week)").
- "Each item, week by week": one row per item, a rhythm line per week; solid = settled, faint = forming, dashed box = new with no history, ▲▼ = outside its usual range. Sample weeks drawn in a lighter style with a "Sample history: team estimate" label on the axis; your weeks marked "Yours".
- "How much of the order is settled": the weekly share, with dashed lines where a change was detected.
- Item panel (click a row): comes back / steady / history bars, settled, the projection with its band, and "Show the maths" with the formulas filled in for that item.
- "What changed": the change findings.
- The mandate link, stated exactly: "The agent orders alone only products the kitchen already buys. Today that list is the kitchen's standing order (N products, scenario). Items settled here but not on it: …; on it but not settled: …". No claim that the page changes the mandate.
- Empty and error states: no sample file for this kitchen → a sentence saying so; no orders yet → sample weeks only, with a line inviting a first order.

### How ordering works
**Step model.** The mock's 13 steps: the request · what kind of request · questions back · a menu to review · dishes · ingredients · how much is needed · what Valio can supply · packs to buy · does it need the chef · the chef decides · order and receipt · over time. Each step has: name, status for this run (`done` | `skipped` with the reason | `waiting` for the chef), one sentence of what happened in our words, and the values (e.g. "100 catalogue matches: 78 filtered out, 5 shortlisted"; "13 packs × 1.5 kg = 19.5 kg"; "new product → needs your approval").
- **Scope (d0's call): product requests end to end.** The inputs are the `/request/run` stream and its final `RequestResult` (request, lookup, order), plus the `approve` and `commit` results the request page already holds for that run. "The chef decides" and "Order and receipt" show "waiting for the chef" until those calls happen. The event path (questions back, menu, dishes, ingredients come from `/request/menu`) is shown as skipped for a product request ("Skipped: a product request, not an event", with a link to plan an event); mapping that path is the first item after the freeze.
- A pure mapper `journeyOf({ run, approval?, commit? })` in `src/lib/ui/request/journey.ts` (unit-tested against recorded responses) turns those into the 13 steps. Skipped steps say why. "Over time" links to the Usual order page.
- In `/request`: under a finished run, a "How this was decided" disclosure renders the steps for that run.
- Standalone page `/request/how` (or the nav's "How ordering works"): renders one recorded product request run through approve and commit ("10 l lactose-free milk for Friday", the case the site already records) from `fixtures/journey/`, labelled "Recorded from the app on <date>, version <commit>", with a button to run your own on `/request`. The fixture is recorded with the site's recorder pattern (`site/record/record.mjs`) and re-recorded when the response shape changes.
- Each step carries a "built" badge only if the code path exists (the mock's status column), checked by the builder.

### Look and copy
Both pages use the app's tokens and components (`src/lib/ui`), the light theme, words from VOCABULARY. Five-second rule: each section opens with one sentence; formulas and field names only in the depth layer.

## Landing it (sequence, gates, fallbacks)
1. **Core lane** (lead suggests 8d): sample-history script + fixture, `core/usual/` with unit and 10× tests, `server` read model. Merge gate green. Contracts (the view type) land first so the page lane can start against a fixture.
2. **Page lane** (lead suggests 1f or a new lane): `/usual` page against the view type, then the journey mapper + `/request` disclosure + `/request/how`. Playwright screenshots at 1440×900 and 390×844 on a fresh visitor, before and after placing an order (the "Yours" change must show).
3. **Claims**: 91 adds rows for what was observed on staging ("the usual order updates when you order"; "every number is computed from sample weeks plus your orders, labelled"), and the words the pitch may use.
4. **Staging first** (`mandate-staging`), observe both pages, then prod. Nav links behind an env flag (`USUAL_PAGE=1`) so prod can hide them without a redeploy of code.
5. **Cut lines if late**, in order: drop "What changed" beyond new items and one-offs; drop the standalone `/request/how` (keep the disclosure); drop the weekly settled-share chart. Never cut the labels or the "Yours" layering.
6. **Rollback**: unset the flag (pages unreachable from the nav); revert the merge if a page errors.

## Calls d0 made after the builder check (the user can overrule)
- Sample history agrees with the standing order (see History).
- Sample weeks end at −1; week 0 onward is "Yours" only.
- The ordering walkthrough covers product requests through approve and commit; the event/menu path is skipped with a link, and comes first after the freeze.
- A line counts as part of the usual order at settled ≥ 0.6 (the mock's threshold); tests pin it.

## Left to the builder
- Exact component split and chart rendering (d3 or SVG by hand), following the app's existing chart conventions (`src/lib/ui/viz`).
- The fixed seed and the exact sample amounts, within the cases listed above.
- Where the "How this was decided" disclosure sits on `/request` and how it collapses on phones.
- Thresholds in "What changed" may be tuned if the tests show a better split; record the final values in the module header.
