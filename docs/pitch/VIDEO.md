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
| 2 | 0:06–0:20 | The case | deck slide 3 | the Tue / Thu / Fri timeline, then the question | "A hotel kitchen: 140 booked, Valio Aimo is out of the ham, the cut-off is Friday at five. What may an agent buy without the chef?" |
| 3 | 0:20–0:34 | The rules | deck slide 4 | the chef's mandate, teal and amber highlights, three dots | "The chef writes the rules once: 800 euros an item, never change an allergen, ask before anything new. The rules are code." |
| 4 | 0:34–1:12 | **From words, live** | screen, tab 2 | see shot A below | "One sentence… Gemini proposes the menu… a new menu means new products, so the agent asks once… one yes, and it lands on Valio Aimo's side." |
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

## Who does what
S5 records every clip automatically (Playwright, 1080p, fresh profile) from [shots.json](shots.json). The voice-over is ElevenLabs v4, voice George (Charlotte is the alternate); S7 assembles the cut. S7 swaps the stills into the deck after the 07:20 take.

## Voice-over, timed to the clips (about 280 words; read at a calm pace)
| Clip | Length | Say |
|---|---|---|
| d1-cover | 0:06 | "Mandate decides what a kitchen's buying agent may order by itself, and what has to wait for the chef." |
| d3-case | 0:14 | "A hotel kitchen has a Christmas buffet for 140 on Saturday. That's 21 items to buy from Valio Aimo. The ham is out of stock, and orders close Friday at five. The chef should only have to make three decisions here. Which of the rest can an agent buy alone?" |
| d4-rules | 0:14 | "The chef sets the rules once. Here the agent may spend up to 800 euros an item. It may never swap in a different allergen, and it asks before buying anything new. The rules run as code, and each item keeps a record of the rule or the approval behind it." |
| A-words-live | 0:38 | "Now a new menu, from one sentence: a no-meat dinner for 120 with a peach dessert. Gemini drafts the menu, and the plan turns each ingredient into a Valio product with a price. All of them are new to this kitchen, and the rules say to ask first, so the agent asks once. The chef's yes covers exactly these items, and the order goes to Valio Aimo." |
| B-buffet-live | 0:18 | "Back to the buffet. Three items fit the rules, so the agent orders them. Another three can't be ordered, and each one says why. The other fifteen wait for the chef, grouped into three decisions." |
| d8-consent → C-consent (ba's Claude-client take, 4.3–18.3 s) | 0:14 | "Other agents can use Mandate too. Here Claude plans a dinner through it. Nothing gets ordered until the chef says yes, and an outside agent that tries to approve is refused." |
| d9-next | 0:10 | "Valio Aimo's catalogue and prices are real, and it runs on Gemini and Aiven. The order is simulated, and the app says so. Valio Aimo gets each kitchen's demand before the cut-off. Next, a pilot with one hotel." |
| d10-close | 0:06 | "Your agent does the buying. Your rules decide what. app.mandate.kitchen." |

## Assemble (one pass)
1. Lay the voice track first: one file, or one take per row with 0.3 s of air between rows.
2. Drop the clips in the order above. Trim each to its row's length. In A, speed up the model waits 2× (label "sped up", small, bottom right).
3. Cuts: a 6-frame crossfade between deck clips; a hard cut into and out of the app clips, so the switch to the live app reads.
4. If an app clip failed, use its fallback clip (`d7-recorded` for A, `d5-buffet` for B) at the same length.
5. Captions: the voice line, bottom third, IBM Plex Sans, white on a 60% dark band; skip captions over the deck slides that already show the same words.
6. Music: none, or very low under the deck clips only.
7. End on `d10-close`, held 2 s. Export 1080p H.264, under 2:00. Watch once with the sound off.

## Edit (08:30–09:00)
- Cut to the timings above. Voice first, then lay the picture to it.
- Captions: the voice line per shot, bottom third, IBM Plex Sans.
- End card for 2 s: the deck's close slide.
- Export 1080p, H.264, under 2:00. Watch it once with sound off: every beat should read without the voice.
