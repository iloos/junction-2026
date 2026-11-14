# Ring 3 review: UX/UI walk of prod, as each persona

_Sat 14 Nov evening. Independent reviewer. Prod `/healthz` commit `70c30e2` (main is `1922679`, so `d8feb8b` "prepared, not placed" and the counted-diet fix are **not on prod yet**). Playwright 1440×900 and 390×844, a fresh sandbox per walk. Scripts and shots are in `scratch/ux-ring3/` (gitignored): `walk1.mjs` (all doors), `k1–k3.mjs` (Kitchen buffet: plan → approve → order → reload), `m1.mjs` (phone Kitchen + dock), `c1.mjs` (desktop dock + approval link), `r1–r4.mjs` (Request), `o1.mjs` (Ops), `a1.mjs` (/agents/chat), `mock.mjs` (kitchen A/B). The dock **is on prod** ("Ask the agent", bottom right on every page, and `/agents/chat`)._

## Verdict in one paragraph
The Kitchen is much better than at ring 2. On a phone it has Decide/Plan/Order tabs and is 1,617 px tall instead of 7,900. There is one decision card per reason. After an order the screen says "Ordered · 15 supplier confirmed, 3 awaiting the supplier". The receipt now survives a reload (BUGS #6 is fixed on prod). The weakest parts are now **the chat dock and the event menu**. The dock contradicts the screen behind it, sends the chef "to the Kitchen" while they are in the Kitchen, and is full of raw ids. The event menu matches dishes to plainly wrong products. A judge will try both, so tonight should go into those two and into fixing the 5-second reading of the Kitchen rows.

## Per screen

### Kitchen `/` (exec chef, approver). Shots: `kitchen-d-fold`, `k-planned-d-fold/full`, `k-review-d`, `k-approved1/2-d`, `k-ordered-d(-full)`, `k-reload-d`, `km-planned-0..3`, `km-decide-tab`
- **First 5 s (idle):** one sentence and "Plan the event". That is clear, but the explanation ("menu × guests → needs → Valio lines") is engine talk. A chef wants "Plan the Christmas buffet for 140 → see what to order and what needs you". The 4 s wait shows no progress.
- **First 5 s (planned):** "2 decisions before Tue 8 Dec, 15:00" is the right headline. But it is set in **mono at 28 px**, so the date looks like code. Use sans and keep mono for numbers in tables. The next action is clear on the right ("Review 7 lines" / "Hold to sign off 7 lines").
- **Hierarchy:** the task header, then three chips, then the budget, then the dish table. The table still draws a **coverage ruler under every row** and a 7-swatch legend. That fails the 5-second test, and the design plan (#1) says to drop it. The rescue table shows a score bar, a number, "fit 2.2/4 · Gemini" and "Qty unknown: not cover" chips. **Rank 3 scores 0.84 and rank 2 scores 0.69**, so the order looks wrong unless you know supply tier sorts first.
- **Contradictions a judge reads:** the ham row says "13 ST ≈ 19.5 kg net" with "27 kg planned, known stock · +0.86 kg over" right below it, while the rescue says "18.9 kg served" (BUGS #7, still open). The header says "4 lines, €319.78 can be ordered now" while the Decide panel says "14 lines · €614.14". Both are true, but nothing frames them as "now" vs "waiting on you". After the hold, the Decide headline reads **"You approved these terms · 7 lines"** when 14 were approved (a remnant of BUGS #5). "Approval valid until Tue 8 Dec, 21:40" comes after the 15:00 cut-off.
- **Make in house:** every ingredient repeats "Replaces Saarioinen Lanttulaatikko 700g: out of stock at Valio" (5×) and carries its own "Needs sign-off" chip. Say it once on the AND group.
- **Decision naming:** "New product · Allergen change" is a policy label. Mock B's "Make 2 dishes in house · adds milk, egg and gluten" passes the 5-second test; the shipped label doesn't.
- **Steps to approve and order:** Review 7 lines → Confirm exact terms → hold 2 s → Place order: 18 lines = 4 actions. That is good. "Confirm exact terms" hides the terms (they sit under a collapsed "Audit detail").
- **After the order:** the lock icon, "Ordered" and "Editing is locked" are good. But the g/guest steppers still render as active inputs, and the line chip says **"Committed"**. Chefs and D10 would say "Ordered", with confirmed vs awaiting shown on the same row. The receipt id `rc-70e741ecb382` wraps across two lines in the heading.
- **Vocabulary:** mostly clean. Leaks: "Committed", "ST/KI/RAS/PRK/BAG" unit codes on every line, "event only", "normal week 36 ST", "Needs sign-off" vs "Needs your approval" vs "Hold to sign off" for one concept, and "Rescue." as a heading.
- **Trust signals:** the mandate quote in the chef's words, "planned, not reserved", "Qty unknown: not cover" and "The supplier is simulated; nothing is sent to Valio". All good.
- **Mobile:** this is the best screen in the app now. Tabs are right under the header, and Decide is the default. One issue: the **"Ask the agent" pill sits on top of the "Hold to sign off" / "Order" buttons** at both widths (`k-planned-d-fold`, `k-ordered-d`, `km-planned-0`).

### Chat dock (Kitchen, `/agents/chat`). Shots: `kd-dock-open`, `kd-chat-decision`, `kd-chat-butter`, `km-dock-open`, `km-chat-0..2`, `a-chat-d`, `a-chat-d-butter`
- **Wrong answer:** with the buffet planned, I asked "what still needs my decision?". The dock rendered both buffet decision cards and a ledger saying "14 held lines wait for a chef", and then the Gemini answer said **"There are no held lines waiting for your approval in the Kitchen screen."** (`kd-chat-decision`). This is the most damaging line in the app. The answer has to be computed from the ledger, or checked against it, not written freely (`src/lib/server/chat/turn.ts`).
- **Dead loop:** it says "Open the approval in Kitchen ↗" and "Only a chef approves, in the Kitchen screen" **while the chef is in the Kitchen**. The link then *replaces* the buffet with an "Opened by link" butter plan, so the chef's buffet decisions disappear from view. The dock should scroll to and highlight the decision card in place, and the Kitchen needs a plan switcher ("Buffet · 2 decisions | Butter Wed · 1 decision").
- **Raw ids and jargon in every turn:** "Task task-mwg6q2d230lq", "Plan pl-run-mwg6pq6d18xns-64b03272735a v1 (k-hotel)", "0 needs not fully covered of 1", "1 decision(s)", "103.57 kg + 10.5 l needed", "via Gemini · 488 ms". Fold the steps into "Worked 4 steps · 2.1 s" (plan #2) and hide ids behind System.
- **Free text works:** "need 4kg butter lactose free for wensday pls" → 4 kg Eila lactose-free, 8 × 500 g, Wed 9 Dec, €26.48, held as a new product, in under 1 s. The delivery day never appears in the chat card, though; it only appears on the Kitchen page. "approve it" gets the right refusal ("I can't approve… only the chef"), but the full card and ledger are reprinted three times in one thread.
- **"I've decided: continue"** is a bright primary button on every turn, even when nothing was decided. Show it only after an approval event lands.
- **Layout:** the dock overlays the Decide column at 1440 instead of pushing it. `/agents/chat` is an almost empty page with the chat squeezed into a 360 px right rail (`a-chat-d`). On that route the chat should be the main column.

### Request `/request` (purchaser). Shots: `request-d-fold`, `r-milk-d`, `rm-milk-approved`, `rm-butter`, `rm-event-0`, `r-event-d-1`, `r-menu-d`, `r-accepted-d`, `r-planned-d(-tail)`
- **Milk:** this is still the cleanest flow. The stepper reads Request → Lookup → Order → Approval, with "Why this one" and the skipped Valio substitute rule in plain words. Issues:
  - "by Monday: today is Monday; read as next Monday" sits in an **amber warning box**, which reads as an error. Make it a grey note with "change".
  - The parser line ("gemini-3.5-flash-lite · 275 in / 129 out") shows by default; it belongs behind System.
  - "Placed by the kitchen agent … key rq-…" still appears on prod before approval (fixed on main `e58c840`; needs a deploy).
  - Approving needs one more step than you'd expect: hold → "Commit order as chef". The approval panel shows "Terms hash 227e0524…" and "Plan version v1" to a purchaser.
  - It's the **second approval design** in the app. It doesn't reuse `DecisionCard`, and the Kitchen has no "terms hash".
- **Butter tomorrow:** a passed cut-off gives a clear sentence and one button, "Deliver Wed 9 Dec instead". Good. Steps 3–4 stay "waiting".
- **Event:** the brief → Buffet → €25/guest → menu takes about 14 s, with only "Proposing a menu..." as feedback. Then:
  - **The products are visibly wrong:** graavilohi → *Feelia Lohimurekepihvi* (fish patty) or cold-smoked salmon; porkkanasose → *Perunasose* (potato mash); puuroriisi → *Linssi-porkkanapullat*; luumusose → *Puljonki Luumutomaattikastike*; saaristolaisleipä → gluten-free white bread; korppujauho → the gluten-free one. "Every amount is an estimate" doesn't cover a wrong *product*. A judge from Valio will spot it in seconds.
  - Dietary "vegetarian:2" is raw. The lactose-free count is still dropped on prod.
  - "Model path not used: the model found no item" shows in orange.
  - "delivery falls on a Sunday" is applied to the *event* date.
  - Each run proposes a different menu.
  - After "Plan it": "Planned: 19 needs, 19 lines. Open the plan in your Kitchen →" works. But steps 2–4 stay grey "waiting" under it, so the page looks unfinished.

### Ops `/ops`. Shots: `ops-d-fold`, `ops-m-full`, `o-d-queue(-full)`, `o-d-Timeline`, `o-d-traces`, `o-m-queue`
- **First 5 s:** five big zero-stats and three **red "Detected" recall rows**. Each row is a ~250-word block of Finnish recall text and all of them end in "Nothing held". They are the only things "To act on", and they stay there after the kitchen orders. Ops looks either alarmed or empty. Put recalls that hold nothing in a quiet "Watched, nothing affected (3)" row, and make the title the consequence (plan #3).
- **Jargon:** `ws-j-… · run-…`, "seq 19", "Simulated run", "commits refused", `web:contextdev`, "Live seq".
- **What just happened** reads well ("Hotel Rautatientori. Committed €933.92, supplier confirmed 15 of 18 lines"). But "Asked a named approver to sign off 7 lines" is attributed to **Chef** in the same second as "Chef approved 7 lines", so the actor looks wrong.
- **Timeline:** a clean swimlane, but it has no sentences. **Agent traces is empty** ("No agent has run since this page opened") right after the kitchen agent ran. That is a dead end on the screen meant to prove the agent is real.
- **Mobile:** the whole first screen is sandbox chrome (tabs, ids, five stats, buttons), and the queue starts below the fold.

### Agents `/agents` (agent developer). Shots: `agents-d-fold/full`, `agents-m-fold/full`
- This is clear and honest. It has a copyable key, Claude Code / Desktop / generic configs, the server's instructions, and the tool list. Issues:
  - The raw workspace id appears in the copy.
  - The expiry reads "16/11/2026, 00:00:00", in a different date format from the rest of the app.
  - "Your agent's changes" is empty and the link to the chat is buried.
  - On a 390 px screen the URL and config blocks scroll sideways inside their boxes, which is acceptable.

## Polish batch tonight (S/M, ranked by judge impact)
1. **S · Chat must not contradict the ledger** (`src/lib/server/chat/turn.ts`): answer read questions from the ledger counts, with a deterministic template, and use Gemini only to phrase it. If the model's text disagrees with `held`/`decisions`, drop it.
2. **S · Dock in the Kitchen doesn't send you to the Kitchen** (`src/lib/ui/chat/ChatDock.svelte`): on `/`, change "Open the approval in Kitchen ↗" to "Show the decision", which scrolls to and highlights the `DecisionCard`. Remove the ↗. Show "I've decided: continue" only after an approval event.
3. **S · Hide ids and plumbing in chat by default** (`ChatDock.svelte`, `src/lib/server/tasks/outcome.ts`): no task/plan ids. "1 decision" not "1 decision(s)". Drop "0 needs not fully covered of 1". Fold steps into "Worked 4 steps · 2.1 s". Show the delivery day on the card.
4. **S · Dock pill must not cover the primary action** (`ChatDock.svelte` launcher): offset it above the sticky action, or dock it in the header on Kitchen.
5. **M · Per-dish status sentence replaces the per-row ruler** (`LineRow.svelte`, `CoverageRuler.svelte` → `WhyDrawer.svelte`): "✓ Covered · in stock", "? Valio hasn't said how many", "Covered if you approve" (design plan #1). Remove the 7-swatch legend from the main surface.
6. **S · Fix the visible basis and count mismatches** (`KitchenScreen.svelte`, `ApprovalPanel.svelte`): the ham row says "27 kg planned" next to "19.5 kg net". The approved headline says "7 lines" for 14. The approval is valid until after the cut-off.
7. **S · Name decisions by consequence** (`DecisionCard.svelte`, `src/lib/ui/decisions.ts`): "Make 2 dishes in house · adds milk, egg, gluten" instead of "New product · Allergen change". In make-in-house, say "Replaces …" once per AND group (`StrategyCard.svelte`).
8. **S · Task headline in sans, not mono** (`TaskHeader.svelte`). Lock the steppers visibly after the order, and say "Ordered" instead of "Committed" (`StateChip.svelte`, `GramsStepper.svelte`).
9. **M · Event menu: refuse obviously wrong matches** (`src/routes/request/menu`, the server menu resolve): if the product's name doesn't share the ingredient's head noun (lohi/porkkana/luumu/riisi), show "No good match: pick a product" instead of a wrong SKU. Avoid "gluten-free" variants unless they were asked for. Show "vegetarian: 2 guests". This is the riskiest item; if it can't be fixed safely, keep the event demo on the seeded buffet.
10. **S · Ops: quiet the recalls that hold nothing** (`src/routes/ops/Queue.svelte`, `CaseTicket.svelte`, `cases.ts`): collapse them into one "Watched, nothing affected" line, out of red. Truncate the recall text to the product and the hazard.
11. **S · Agent traces should show the latest run, not only live ones** (`TraceDrawer.svelte`): load the last run on open.
12. **S · /request copy** (`src/routes/request/+page.svelte`, `parse.ts:403`): date notes as grey notes, not amber; no Sunday warning on an event date; parser tokens behind System. When the event plan is done, mark steps 2–4 "in the Kitchen" instead of "waiting". **Deploy main** so "prepared, not placed" and the diet counts reach prod.
13. **S · `/agents/chat` makes the chat the main column** (`src/routes/agents/chat/+page.svelte`).
14. **S · Ops mobile:** put the queue above the stats and sandbox chrome at 390 px (`src/routes/ops/+page.svelte`). Move ids under System.

## Interaction improvements (fewer steps)
- **Chat → decision in place:** today it's link → page swap → find card → review → confirm → back to chat → "I've decided". It should be: the card in the dock scrolls to the Kitchen card, the chef approves, and the dock posts the outcome on its own (it already listens for decision events).
- **Many plans per kitchen:** the chat and /request create plans that hide the buffet. Add one "Open tasks" switcher on Kitchen (Buffet · 2 decisions; Butter Wed · 1; Milk Mon · signed off), and make it the target of every approval link.
- **Approve and order in one go for a simple decision:** "Confirm exact terms" followed by "Place order" could be one "Approve and order 18 lines €933.92" once every group is cleared, with the terms visible on the card (not under "Audit detail").
- **/request milk:** hold to approve → "Commit order as chef" should be one action for the chef who approved. The second step only makes sense for a named approver who is a different person.
- **Event:** brief questions as chips *before* the 14 s menu wait. Then show the menu dish by dish as it streams, rather than one spinner line.

## Design plan: pull in first
1. **#2 Chat turn from the five events** (it fixes the worst current impressions: ids, a repeated card, the wrong-answer risk).
2. **#1 Per-dish status sentence** (the biggest 5-second gain on the hero screen; low risk).
3. **#3 Ops case card, consequence first**, plus quieting the recalls (Ops is where judges look for "is it live").
4. **#8 "What changed" strip** only if the ledger already carries the diff; otherwise skip it.
5. **#6/#7 `/story` and `/how`** belong to the pitch owner. Isolated routes, so keep them off the critical path.
Hold back #4 (sentence quality per op type) unless `opSummary` already covers every op type seen in `o-d-Timeline`. Hold back #15 as a full re-layout.

## Kitchen layout: A vs B
**B (plan first)**, shot `mock-kitchen-b.png`. In under 5 s the chef reads the title, "2 decisions before Tue 15:00 · €319.78 can be ordered now · 10 of 13 covered · 3 not sure", and then two decision cards named by consequence with "If you say no: 5 dishes not covered". The plan rows read as sentences. B is also closest to what ships: `TaskHeader`, the Decide zone and the right-hand order column already exist. So B can be reached with deltas #1, #2 and #7 tonight, with no re-layout.

**A (conversation first)**, shot `mock-kitchen-a.png`. A puts the chat summary above the plan, and the decisions slide below the fold behind the composer. That repeats the failure the dock shows today: the transcript competes with the plan for authority.

Take B's composer bar at the bottom of the plan column ("plan v8 · Ask or tell your agent…", with replay chips) as the shape for the shipped dock's launcher. That also fixes polish item 4.
