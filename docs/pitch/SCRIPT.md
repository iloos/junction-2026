# SCRIPT: the pitch, the demo and the table

_S7, Sun 15 Nov, v3 (adds the hook number, the audit line, the cut-off payoff and what Valio gets). Run the web deck (`docs/pitch/deck.html`, or the published page) fullscreen with **F**; **N** shows these lines as speaker notes. Each line below matches a slide's notes. About 150 spoken words a minute; every number is from [MAP.md](MAP.md) or CLAIMS._

## Stage pitch: 3:00, mic cut at 3:00
| Time | Slide | Say |
|---|---|---|
| 0:00–0:08 | 1 Cover | "Mandate decides what a kitchen's buying agent may order by itself, and what has to wait for the chef." |
| 0:08–0:10 | 2 World | Click through, say nothing. |
| 0:10–0:28 | 3 The case | "A hotel kitchen has a Christmas buffet for 140 on Saturday. That's 21 items to buy from Valio Aimo. The ham is out of stock, and orders close Friday at five. The chef should only have to make three decisions here. Which of the rest can an agent buy alone?" |
| 0:28–0:46 | 4 The rules | "The chef sets the rules once. Here the agent may spend up to 800 euros an item. It may never swap in a different allergen, and it asks before buying anything new. The rules run as code, and each item keeps a record of the rule or the approval behind it." |
| 0:46–1:05 | 5 The buffet | "Of the 21 items, the agent orders 3 by itself, 302 euros. Another 3 can't be ordered, and each says why; anything past the cut-off is offered the next delivery day. The other 15 wait for the chef, grouped into three decisions." |
| 1:05–2:20 | 6 Live demo | Switch to the app (see below). Run both parts: A shows the chef's one yes, B shows items going through alone. Without B, the demo shows nothing ordered alone. If it fails, slide 7 is the same run. |
| 2:20–2:36 | 8 Who can say yes | "Other agents can plan with Mandate too: the chef's own Claude, or a hotel chain's system. Only the chef approves, in the app or when their own assistant asks them. If an outside agent tries to approve, it's refused and logged." |
| 2:36–2:52 | 9 Real and next | "Valio Aimo's catalogue and prices are real, and it runs on Gemini and Aiven. The order itself is simulated, and the app says so, because Valio Aimo's API has no order endpoint yet. Valio Aimo gets each kitchen's demand and exceptions before the cut-off. Next, a four-week shadow pilot with one hotel." |
| 2:52–3:00 | 10 Close | "Your agent does the buying. Your rules decide what. Try it: app.mandate.kitchen." |

## The live demo (75 s)
Prepare before going on: a fresh browser profile on the laptop, logged into nothing; the app open at `/` on a sample hotel; the Ops screen in a second tab; Wi-Fi checked; the deck in a third tab.
**A · A new menu from words (50 s)**
1. **0–8 s:** open the chat dock and type "a no-meat dinner for 120 with a peach dessert". Say: "One sentence."
2. **8–20 s:** the menu card appears. Say: "Gemini proposes six dishes." Type "plan it".
3. **20–38 s:** the plan appears: about 20 items, each a Valio product with a price. Say: "A new menu means new products, and this hotel's mandate says ask me before any new product. So the agent asks once." Point at one reason line. If asked about the items marked not covered: "Some ingredients have no product the agent can order yet; each is shown as not covered, never silently dropped." (On prod d28f43d: 20 lines, 8 not covered; the button reads "Accept all 19".)
4. **38–50 s:** tap **Accept all**, then the Ops tab: the order has arrived. Say: "One yes covers exactly these items, and the order goes to Valio Aimo."

**B · The buffet: what goes alone (25 s, don't skip)**
5. **50–75 s:** on the hotel, open the Christmas buffet and **Plan it**. Point at the three colours: "Three items fit the rules, so the agent orders them. Three can't be ordered, and each says why. The rest waits for the chef as three decisions." Switch back to the deck, slide 8.

Seen on prod b12ba71 (3 alone · 15 in 3 decisions · 3 refused). If the buffet is slow or differs, show slide 5 again for those 25 s and point at the teal line: something must go through alone on screen. If anything hangs for more than 5 seconds, say "here's the same run" and show slide 7.

**Don't demo the usual order.** On prod 57fc4b4 (S5, 02:08 UTC) the home offers Tuesday's usual after its cut-off (all 5 can't be ordered, yet the bar says "inside your rules"), and Thursday's usual holds all 4 items as new or unconfirmed. Routed to S1 and S2; re-check only if they land before 06:00.

## The room (only if the room playtest is green on the submitted deploy)
For a live room with the audience: Ops on the big screen, the join QR full screen.
1. **Joining is unlimited:** "Scan the code and name your store." Wait until stores appear on Ops.
2. **Planning goes in waves of 10 at most:** "Rows one and two: plan now." Wait about 5 seconds until those orders land, then call the next wave. The room plans one order at a time by design, so never ask the whole room to plan at once.
3. **The shortage:** the presenter fires it on Ops, and every store re-plans inside its own rules.
Make no capacity or scaling claim on stage; scaling out is a roadmap line only.

## Peer review at the table (about 2 min a visitor)
Laptop open on the deck, phone ready with the app.
1. Slide 1 (5 s), then slide 3: the ham, 140, the cut-off.
2. Slide 4: the chef's rules, the three colours.
3. Slide 5: 21 items, 3 decisions.
4. Hand them the phone, or open `app.mandate.kitchen` on theirs: "Ask it for something." Let them see an item held and tap Accept.
5. Slide 10: "Your agent does the buying. Your rules decide what."

## Questions: where the appendix helps
- "How does it turn a menu into products?" → appendix *From menu to items* (the ham: 140 × 135 g ÷ 0.7 = 27 kg → 4 × 7 kg lots).
- "Can my own agent use it?" → *Open to every agent*, then the consent slide: MCP, scoped keys, the chef's own assistant asks for the yes.
- "What's under the hood?" → *How it's built*: every door goes through one gate, the rules engine, each partner behind a port, on Aiven Runtime.
- "Why not a chatbot?" → *Why this, not a chatbot*.
- "What about many kitchens?" → *The room* (say it only if the room playtest is green).
- Never say: vector search, recipe-aware, "confirmed" without a receipt, "a real recall hit our orders", data stays in Finland. See [PITCH.md](../PITCH.md) Q&A crib.
