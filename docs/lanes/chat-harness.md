# Chat harness: the model leads the conversation, the rules guard the order

_Lead, Sun 15 Nov 06:55. Owner: S3 (conversation), with S1 for search and S2 for the dock's chip components. The patterns below are ones we have seen work in conversational co-writing tools in general; no code or prompt text is taken from anywhere._

## Why

On prod the chat feels stupid ("wym" read as a product, "one product per routine order", a unit question looping). The cause is the order of operations, not the model:

| Step | Today | Target |
|---|---|---|
| Read the turn | Rules first (`agent/intent.ts` resolveIntent, `request/parse.ts` parseRules); Gemini only fills a schema the rules then reinterpret | The model reads every turn first: question, meta-talk, new ask, answer to the open question, several items, a dish or a product |
| Decide what to ask | Code picks a slot (unit, date) and a fixed sentence | The model picks the one thing it most needs that only the chef can know, and proposes the rest |
| Chips | Code-generated per slot (days, units) | The model proposes them, from tool results (products with pack and price, amounts, days the rules accept), best guess first, an escape chip when they are alternatives |
| State | Slots on the task; refusals when a slot is unfillable | A visible "order so far" (the goal) updated by tools every turn; never a dead end |
| Acting | The script calls tools | The model calls the same tools (`search_products`, `quote`, `place_order`, `plan_event`, `find_substitutes`, `edit_line`, `get_plan`, `commit_order` as the chef); `applyOps` and the mandate gate decide, unchanged (D23, F1) |
| Done | When the parser had product + amount + date | When the goal is satisfied: every item resolved, sized, dated and through the gate, or held for the chef with its reason |

## The harness

1. **One agent loop per turn** on Gemini (Flash-Lite for speed, 3.8 Flash for menus), at most 8 steps, tools from `core/contracts/tools.ts` with the chat principal (the chef). Fixture path: today's script stays as the fallback, labelled.
2. **A goal object** the model maintains through a tool (`update_order_draft`): items with product reading, confidence, amount, unit, date, status. The dock renders it live as the order-so-far card; the Kitchen page shows the same plan once it exists (one conversation, two views, D23).
3. **Chips as a typed output**, not text: the reply is `{ text, chips: [{ label, value, kind: product|amount|day|action|other, productId?, price?, pack? }] }` under a response schema. The dock renders product chips with photo, pack and price; a click sends `value` as the chef's turn. Max ~6, best first, "Something else" when they are alternatives, none when the turn is a yes/adjust.
4. **Turn rules in the prompt** (our words): ~1–2 sentences then chips; ask only what only the chef knows (how many, when, which of these), propose the rest; one decision per turn; "idk / ? / huh" means narrow the choices and restate the order so far, never repeat the last question; a new noun is a new item; never end on "I could not"; no praise, no narrating what it is about to do; say it once after the work.
5. **A steer each turn** computed by code and put in the context, never shown: what is still missing on the goal, which day the rules accept next, which lines are held and why. The model aims its next question there. It steers, it never blocks.
6. **Sync with the app**: every state change goes through tools → `applyOps` → the op log → `/api/events`, so the Kitchen page, Ops and the dock move together; the dock's order-so-far card reads the same projection. Approval stays the chef's, in the dock or on the page (D22); an outside agent never approves.
7. **Traced**: every model call and tool step in the trace drawer (rule 7), so a judge can see the model choose and the rules decide.

## Evals

The user's transcripts as multi-turn trials (cow/steaks, 100 pasta, coffee + cheesecake + biscuits, "wym", "huh?"): a turn fails if it refuses, has no chips when a fork exists, asks about a product it does not believe in, or repeats the previous question. Plus the existing adversarial suite: the model may make an order more careful, never less.

## Plan

- Today before 09:00: build behind `CHAT_HARNESS=llm` (default off), the three transcripts passing locally with the real key, the gate green. The lead decides with the user at ~09:00 whether to flip it on prod (an env change in the Aiven console, reversible). If not, it ships after submission.
- Waves X and Y carry the deterministic fixes regardless.
