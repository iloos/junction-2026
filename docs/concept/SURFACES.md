# SURFACES: what each door is now, and where it goes next

_Owner: session 1f (Track C). Written Sat 14 Nov; §2 updated to ring 6. §4–§6 are the Sat proposal: the Kitchen's shape now follows D29/D30 (one list, one action bar, plans as groups in the day's basket) and D28 (Swap compare panel). History of the earlier proposal is in git; comparable-product lessons are in [research/analogs](../research/analogs.md) and [research/valio-baseline](../research/valio-baseline.md)._

## 1. The frame
Valio's brief: *"not about replacing today's e-commerce UI with a chatbot … how a wholesaler can be safely and openly readable by autonomous agents."* So there is **one engine and several doors**. Every door reads the same plan through the same gate (`serveTool`), and every state change goes through `applyOps`. The kitchen screen is the human side of an agent interface: where people see consequences, decide what the agent may not, and read what happened.

Words follow [D10](../DECISIONS.md) ([ROUND6-VOCABULARY](../review/ROUND6-VOCABULARY.md)): *supplier confirmed* only for receipt-backed amounts; *planned, known stock* is not reserved; unknown supply is never cover; *needs your approval* only when a human can resolve it; need ≠ purchase quantity.

## 2. The doors today
| Door | Route | Who | What it shows / does | State |
|---|---|---|---|---|
| Kitchen | `/` | chef, exec chef, a judge on a phone | Establishment picker first ("Your own kitchen" or a sample, D25); then the delivery day's basket (day picker), plans as groups, waiting lines grouped by reason, one action bar (D29/D30); Swap opens the compare panel with steer chips (D28, `ui/SwapPanel.svelte`); Why chain; commit and receipt. `?plan=` opens a plan's group; `?chat=1` opens the dock | live, per-visitor workspace that persists (D9, D26) |
| Offline stand-in | `/offline` | presenter without a server | Same screen on a browser copy of the seeded plan, coverage borrowed from core's recorded view; labelled | labelled, engine not retired |
| Request | `/request` | buyer or chef with a one-off need | Valio's milk example as an editable step flow: parse (Gemini, rules fallback) → lookup → order → approval, with a date control and dish card; also where a chat-proposed menu is reviewed (`?menu=&rev=`). Still its own page, not D23's full-width conversation | live |
| Operations | `/ops` | Valio ops, the room's big screen | Tabs: Room (every store in `ws-judges`, D24, `RoomView.svelte`), Problems (cases), Orders, Demand, Forecast (D27 stock model, `core/stock/`), Flow, Queue, Wallboard, Engine (System only); agent traces; recall drill; deep link to the exact kitchen plan | live |
| Agent door | `/agents`, `/mcp`, `/mcp/k/<key>`, `/api/tools/<name>`, `/api/openapi.json`, `/api/agent/run` | a buyer's agent (judge's Claude) | The same tools as the UI (20; an outside key sees 17); external keys can't approve; `/agents` shows the visitor's own key, client configs and recent calls; `/agents/chat` opens the dock over the Kitchen | live |
| Phone | `/pair` | the same visitor on a second device | Single-use QR link or short code opens this browser's workspace (D17, `server/pair/`) | live |
| Canvas | `/canvas` | team | An unlinked layout experiment | not linked from the app |

There is no standalone approval page: approval happens on the Kitchen or in the chef's own dock (D13, D22).

## 3. The object model the screens render
```
Kitchen ─ Mandate (versioned; the chef's words + caps + rules)
   └ Plan (versioned, one delivery date)          ← Plan.view: asOf, mandateVersion, validUntil
        ├ Need   (dish × guests × g/guest ÷ yield, or a direct amount)
        │    └ FulfilmentView: required = supplierConfirmed + awaitingSupplier + plannedKnown
        │                               + plannedUnknown + unresolved;  excess separate
        ├ Line   (one product, sales qty, offer, state, tier, reasons, strategy)
        │    └ LineView: reviewable, committable, physical, unitPrice, comparisonPrice, blockedReason, nextAction
        └ Approval (exact lines + terms hash + plan version; decided per reason group on screen)
   Order + Receipt (immutable; per-line authority; awaiting supplier vs confirmed)
Ops: Case  ← today one held/unorderable line; target one cause across kitchens
```
Make-in-house is a strategy whose lines are an AND (all ingredients required); alternative products are an OR until one is chosen.

## 4. The kitchen screen, top to bottom
1. **Label bar:** what is real (Valio mock, cached time), what is scenario (booking, clock), what is simulated (orders), and on `/offline` that it is a stand-in.
2. **Header:** the mandate in the chef's words; kitchen switcher; workspace · run; simulated clock; "Start over (sandbox)".
3. **Event as a diff:** normal week vs this week, what the event adds (€ and kg), **what needs you** (lines in the pending approval · can't be ordered · dishes on unknown stock · not covered), week budget meter.
4. **By when:** cut-off timeline for stock vs supplier-delivered (Terminal) lines.
5. **Menu → need → order:** per dish the g/guest stepper and need formula; each line with what it buys physically and both prices; a **coverage ruler** per need (most certain first to the needed mark, excess hatched past it); rescue compare for real outages (ranked candidates, the rejected one with its rule).
6. **Why drawer:** the worked chain (dish → g/guest → served → yield → replaced product → pack content → packs → covers by certainty → price → rule), each step with its source; make-in-house as an AND of ingredients; then the agent's own reasoning steps.
7. **Review the order:** one decision per reason group (new product; new product with an allergen change). A sign-off group takes a hold. Each group is confirmed on its own, then one grant of the exact terms goes out (core can't grant a subset yet; `SUBSET_APPROVE`). Then lines already approved, the totals, what is still not covered, and Place order → receipt → retry with the same key returns the same receipt.
8. **Same shortage. Your rules.:** presets (kitchen default / price first / Finnish required) re-rank the rescue live; the contention toggle takes stock away.

## 5. Gaps against the direction (ordered by what a judge feels)
_Ring 6 status: 1 landed (`approve{lineIds}` decides one reason group, `remainingApprovalId`); 3 landed as usual orders (D14, `server/patterns/`); 5 landed (`/agents`); 4 in part (a request's plan lands in the Kitchen; `/request` is still its own page); 2 in part (Ops cases are one per cause within a plan, `ops/cases.ts`, not yet across kitchens); 6 open (the Kitchen still diffs with `TermChange`, not `get_plan.lastVoided`)._

1. **Decisions are grouped on screen, not on the server.** Core's `approve{lineIds}` split is contract only; Ops still lists lines. Server-side reason groups would let Ops, the agent and the kitchen name the same decision.
2. **Ops is per line, not per cause.** One recall across kitchens should be one case with € at risk × time to cut-off.
3. **No routine week.** The standing order exists only as `usualProducts` on k-hotel; there is no Week view, no drift card, no pre-approved fallbacks.
4. **Request and Kitchen are two worlds.** A `/request` result doesn't land in the kitchen's plan; the composer isn't docked on the kitchen.
5. **No `/agents` page** to connect a judge's Claude without the presenter.
6. **Voided-approval diff is client-side** (`TermChange`); core's `get_plan.lastVoided` should replace it.

## 6. Next scope: UI/UX pass and the in-app agent chat (with E)
What I would change, in order:
1. **One task header across the screen.** "Christmas buffet for 140 · 2 decisions before Tue 17:00 · 3 dishes on unknown stock · €934": the persistent task summary ROUND6 asks for, replacing the four equal stat boxes.
2. **The perturbation is the hero.** Guests, g/guest and a diet or origin requirement as first-class controls at the top; after a change, a "what changed" strip (need, packs, € and decisions before → after; what stayed; what can't be met and why), built from two `get_plan` reads.
3. **Chat as a docked composer that writes to the plan, not a transcript.** It knows the selection (a line, a dish). Every agent turn ends in one outcome line computed from state ("2 lines changed, 1 decision added, nothing ordered") plus live cards by id (QuoteCard, RescueCompare, DecisionCard, ReceiptCard) that update or say "superseded by v8". It never approves; approval stays a deliberate act on a decision card. The same cards render in MCP results.
4. **Decision cards as the unit everywhere:** kitchen panel, chat, Ops and the agent outcome read one shape `{reason, lines, total, consequence if declined, due}`.
5. **d3 only where it explains:** demand → packs with overshoot per dish; the coverage partition across the event; the candidate funnel (17.5k → retrieved → eligible → chosen) with the rule that cut each step.
6. **Phone:** the dish table becomes a list of dish cards with the ruler on top; the decisions sheet is reachable from the sticky "needs you" bar.
7. **Evidence in Why:** "Find on the web" with `lookup_facts` sources and live/cache/replay labels, attached to the uncertain field it resolves.

### Visual system: three opinions
1. **Certainty is the colour system; authority is shape.** Five supply tokens, used everywhere a quantity appears (ruler, chips, chat cards, Ops): supplier confirmed = solid `ok` green; ordered, awaiting supplier = the same green hatched; planned, known stock = solid `accent` teal; planned, unknown stock = `signoff` amber hatched; not covered = `out` red outline on an empty well. Excess stays neutral grey hatch past the needed mark. Authority (within mandate / needs approval / sign-off / blocked) never borrows those hues: it is carried by the chip's icon and outline. Today "Within mandate" is green like confirmed supply, so a reader can mistake permission for delivery. Solid means observed, hatched means not yet true, outline means missing; it reads in greyscale and for colour-blind users.
2. **One family, two voices, numbers in mono.** Keep IBM Plex Sans for words and Plex Mono for every quantity, price and id, with tabular figures so columns of kg and € align. Four sizes only (22 task title, 15 section, 13.5 body, 11.5 detail); weight carries hierarchy instead of new sizes. No all-caps labels: the dish name in Finnish, then English, is the label.
3. **Dense where people compare, quiet where they decide.** The dish table stays information-dense (one row per need, ruler under it, lines inline); decisions get space and one action each. Never more than one primary button on screen at a time: it moves from "Review decision" to "Place order" as the task advances. d3 views sit inline at the row they explain (demand → packs on the dish row, the funnel inside the rescue), never in a separate dashboard tab.

## 7. Not doing
A general chat assistant; a chat transcript as the record (the op log is the record); agent avatars or typing theatre; a standalone approval page this weekend; a nationwide map with an order button; a second webshop; separate apps per persona.
