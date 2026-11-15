# VIDEO: the ≤2:00 cut, the shot list and the fallbacks

_S7, Sun 15 Nov 05:30. Recording slot 07:30–09:00, after the final deploy (~07:15). The voice-over is [SCRIPT.md](SCRIPT.md)'s stage lines, cut to fit; slides come from the web deck (`docs/pitch/deck.html`, fullscreen with **F**). Film a screen shot only after its check below passes on the final deploy; otherwise use its fallback. Every number on screen is from [MAP.md](MAP.md) or CLAIMS._

## Setup (07:15–07:30)
- **Screen:** 1920 × 1080, browser at 100% zoom, a fresh Chrome profile (each one is a new sandbox), no extensions or bookmarks bar, notifications off.
- **Tabs, in order:** 1 the deck (`deck.html`, fullscreen) · 2 `https://app.mandate.kitchen/` on the sample hotel · 3 `https://app.mandate.kitchen/ops`.
- **Capture:** OBS or the OS recorder at 30 fps. Record the voice separately, so the screen can be re-taken without re-reading.
- **Before each take:** check `/healthz` shows the final commit; open tab 2 once so the first load isn't on film.
- **Raw files:** `scratch/video/<shot>-<take>.mp4` (gitignored).

## The cut (≤2:00)
| # | Time | Shot | Source | What must be on screen | Voice |
|---|---|---|---|---|---|
| 1 | 0:00–0:06 | Cover | deck slide 1 | "Order it. Hold it. Refuse it." animating in | "Mandate. Every item an agent wants to buy is ordered, held for the chef, or refused." |
| 2 | 0:06–0:20 | The case | deck slide 3 | the Tue / Thu / Fri timeline, then the question | "A hotel kitchen: 140 booked, Valio is out of the ham, the cut-off is Friday at five. What may an agent buy without the chef?" |
| 3 | 0:20–0:34 | The rules | deck slide 4 | the chef's mandate, teal and amber highlights, three dots | "The chef writes the rules once: 800 euros an item, never change an allergen, ask before anything new. The rules are code." |
| 4 | 0:34–1:12 | **From words, live** | screen, tab 2 | see shot A below | "One sentence… Gemini proposes the menu… a new menu means new products, so the agent asks once… one yes, and it lands on Valio's side." |
| 5 | 1:12–1:30 | **The buffet** | screen, tab 2 | see shot B below | "On the buffet: three items go through alone, three are impossible and say why, the rest is three decisions." |
| 6 | 1:30–1:44 | Who can say yes | deck slide 8 (or the MCP consent screenshot, if the user captures one) | the three cards | "Any agent can plan. Only the chef can say yes: in the app, or when their own assistant asks." |
| 7 | 1:44–1:54 | Real and next | deck slide 9 | the three lists | "Real Valio data, Gemini and Aiven; the order itself is simulated and labelled. Next: a pilot with one hotel." |
| 8 | 1:54–2:00 | Close | deck slide 10 | the two lines and the URL | "Your agent does the buying. Your rules decide what. app.mandate.kitchen." |

## Shot A: from words, live (38 s on screen; record about 90 s, cut the waits)
1. Tab 2, the hotel's Kitchen. Open the chat dock.
2. Type `a no-meat dinner for 120 with a peach dessert`, then Enter. → The menu card: six dishes, labelled as Gemini's estimate.
3. Type `plan it`. → The plan: about 20 items, each a Valio product with a price; each waits, with a reason (new product, or a requirement the product's record doesn't confirm).
4. Hover one reason line for 2 s.
5. Tap **Accept all**, then confirm. → "Ordered", with one receipt.
6. Switch to tab 3 (Ops). → The order is there.

In the edit, speed up the model waits (2×, with a small "sped up" label) and hold 2 s on each result.
**Check before filming:** the plan has items and Accept all orders them. **Fallback:** deck slide 7 (the same run, recorded) for 20 s.

## Shot B: the buffet (18 s)
1. Tab 2: switch the delivery day or open the Christmas buffet for 140, then **Plan it**.
2. → 3 items ordered alone (€302.62 on `b12ba71`), 15 waiting in 3 decisions, 3 that can't be ordered, each with its reason.
3. Pan slowly from the ordered-alone line to one decision header to one refused line.

**Check before filming:** S5 confirms the split on the final deploy (the counts may differ: say the new ones). **Fallback:** deck slide 5 (the buffet slide) for 18 s.

## Don't film
- The usual order: on prod `57fc4b4` it was offered after its cut-off and held every staple as new (S5). Film it only if S1/S2's fixes land and S5 re-checks.
- The room cascade, unless the room playtest is green.
- Raw ids, op names or ISO dates on screen (crop them).
- Any claim from the never-say list in [PITCH.md](../PITCH.md).

## Fallbacks to record anyway (07:30–07:50, first)
1. **The whole deck walkthrough:** slides 1–10 with their animations, about 6 s each, no voice. This becomes the video if every live take fails.
2. **Shot A and shot B, twice each.**
3. **Stills from the final deploy,** for the deck's recorded slide and for the submission: the menu card, the plan with reasons, the Accept all moment, "Ordered" with its receipt, the Ops tab with the order, and the buffet's three colours. Save them to `scratch/video/stills/`, and I'll swap them into the deck.

## Edit (08:30–09:00)
- Cut to the timings above. Voice first, then lay the picture to it.
- Captions: the voice line per shot, bottom third, IBM Plex Sans.
- End card for 2 s: the deck's close slide.
- Export 1080p, H.264, under 2:00. Watch it once with sound off: every beat should read without the voice.
