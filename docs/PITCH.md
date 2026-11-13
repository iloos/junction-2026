# PITCH

_Lead-owned until a pitch owner exists. Built from docs/review/REVIEW-GPT-6-ROUND2.md and PRODUCT.md; claims only what is wired (CLAUDE.md rule 8)._

## One-breath opener
"140 guests on Saturday. The ham and the swede casserole are out. What can an agent actually promise this kitchen, and what must it refuse?"

## Table demo (2:00)
| Time | Beat | What they see | Real or simulated (label on screen) | Status |
|---|---|---|---|---|
| 0–15 | The problem | Christmas event as a diff vs a normal week; ham `462490` and lanttulaatikko `462482` at 0 stock | Real Valio mock data (fetched/cached T); booking is a scenario | [ ] |
| 15–40 | It thinks like a chef | Edit grams per guest; demand → stock → lots (11.5 kg → 20 kg) | Recipe and stock-on-hand are scenario data | [ ] |
| 40–70 | It refuses | Candidates ranked; one visibly rejected; Terminal items stay **unknown**, not counted as cover | Real data + our rules | [ ] |
| 70–95 | It's honest | One verified feasible replacement, or the remaining shortfall disclosed | Hand-checked (see preflight) | [ ] |
| 95–115 | Trust you can test | Approve exact terms → commit → deliberate retry → one receipt | Local simulated commitment | [ ] |
| 115–120 | The other side | The same held lines in Operations | If wired | [ ] |

Valio's own "1,000 L lactose-free milk by Monday" runs as a separate one-click route (their required flow), not inside this story.

**Bold beat ("Same shortage. Your rules."):** the judge flips price-first to Finnish-required, or changes the cap; eligible terms, rejections and residual portions update live; if nothing qualifies, the system says so.

## Stage pitch (3:00)
0–20 the problem · 20–105 the Christmas journey · 105–135 an external agent tries a stale/invalid commit and the server refuses · 135–160 Operations shows why kitchens are held · 160–180 the 4-week hotel pilot (targets, not results) and close.

## Labels (always visible)
"Valio challenge mock: fetched T / cached T" · booking, stock-on-hand, recipe and the December clock = **scenario/simulated** · order = **local simulated commitment** · salmon contention, split milk delivery and shifted cut-offs = simulator overlays. Salmon and trout share carbon 4.9: don't promise a carbon flip there. No images. Offline fixture and recorded fallback are labelled too.

## Preflight before claiming a rescue
Find and hand-check one **Stock** (not Terminal) alternative for the ham and for the casserole, or a make-in-house recipe from available ingredients; otherwise present an honest partial rescue.

## Claims → evidence
| Claim we say out loud | Backed by |
|---|---|
| Approval is bound to exact terms | eval s4 (price change voids approval) |
| No double orders | eval s1 retry → 1 receipt; concurrency test on Postgres |
| Never over the cap, even split | eval s5 |
| Below a lot step is unorderable | eval s3 |

## Q&A crib
- Why won't Valio's own A.I.mo do this? (We're the exception layer and the open agent gate it can adopt.)
- What breaks it? (Unknown supply: we hold and say so.)
- What did you build vs use? · Who pays? (Valio, free to kitchens.)
