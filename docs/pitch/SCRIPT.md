# SCRIPT: the pitch, the demo and the table

_S7, Sun 15 Nov 05:00. Run the web deck (`docs/pitch/deck.html`, or the published page) fullscreen with **F**; **N** shows these lines as speaker notes. Each line below matches a slide's notes. About 150 spoken words a minute; every number is from [MAP.md](MAP.md) or CLAIMS._

## Stage pitch: 3:00, mic cut at 3:00
| Time | Slide | Say |
|---|---|---|
| 0:00–0:10 | 1 Cover | "Mandate. Every item an agent wants to buy ends in one of three places: ordered, held for the chef, or refused." |
| 0:10–0:15 | 2 World | Click through without stopping: "One agent per kitchen, on Valio Aimo." |
| 0:15–0:32 | 3 The case | "A hotel kitchen. 140 booked for Saturday, Valio is out of the ham, and the cut-off is Friday at five. Today a person places every order. An agent could do it faster. So what may it buy without the chef?" |
| 0:32–0:50 | 4 The rules | "The chef writes the rules once: 800 euros an item, never change an allergen, ask before anything new. The rules are code. A chatbot can suggest a ham; only a mandate lets an agent buy one." |
| 0:50–1:10 | 5 The buffet | "21 items. 3 ordered alone, 302 euros. 3 impossible, each with its reason. The other 15 come down to three decisions for the chef." |
| 1:10–2:25 | 6 Live demo | Switch to the app (see below). The three outcomes were the buffet; the demo shows the words-to-plan path and the chef's yes. If it fails, slide 7 is the same run. |
| 2:25–2:40 | 8 Who can say yes | "Any agent can plan: the chef's own Claude, a hotel chain's system. Only the chef can say yes, in the app or when their own assistant asks. Any other agent that tries is refused and logged." |
| 2:40–2:52 | 9 Real and next | "Real Valio catalogue, Gemini, Aiven. The order itself is simulated and labelled, since Valio's API has no order endpoint yet. Next: a four-week shadow pilot with one hotel." |
| 2:52–3:00 | 10 Close | "Your agent does the buying. Your rules decide what. Try it: app.mandate.kitchen." |

## The live demo (75 s)
Prepare before going on: a fresh browser profile on the laptop, logged into nothing; the app open at `/` on a sample hotel; the Ops screen in a second tab; Wi-Fi checked; the deck in a third tab.
**A · A new menu from words (50 s)**
1. **0–8 s:** open the chat dock and type "a no-meat dinner for 120 with a peach dessert". Say: "One sentence."
2. **8–20 s:** the menu card appears. Say: "Gemini proposes six dishes." Type "plan it".
3. **20–38 s:** the plan appears: about 20 items, each a Valio product with a price. Say: "A new menu means new products, and this hotel's mandate says ask me before any new product. So the agent asks once." Point at one reason line.
4. **38–50 s:** tap **Accept all**, then the Ops tab: the order has arrived. Say: "One yes covers exactly these items, and it lands on Valio's side."

**B · The buffet: what goes alone (25 s)**
5. **50–75 s:** on the hotel, open the Christmas buffet and **Plan it**. Point at the three colours: "Here, three items are inside the rules and go through alone; three are impossible and say why; the rest is three decisions." Switch back to the deck, slide 8.

Seen on prod b12ba71 (3 alone · 15 in 3 decisions · 3 refused). If the buffet is slow or differs, end after A and give the 25 s to slide 8. If anything hangs for more than 5 seconds, say "here's the same run" and show slide 7.

**Don't demo the usual order.** On prod 57fc4b4 (S5, 02:08 UTC) the home offers Tuesday's usual after its cut-off (all 5 can't be ordered, yet the bar says "inside your rules"), and Thursday's usual holds all 4 items as new or unconfirmed. Routed to S1 and S2; re-check only if they land before 06:00.

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
