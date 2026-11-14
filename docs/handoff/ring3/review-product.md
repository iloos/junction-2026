# Ring 3 review: product and judging (strategist + judge view)

_Sat 14 Nov evening, read-only. Prod at `70c30e2` (`/healthz`). I walked prod in fresh sandboxes at 1440 and 390 px (scripts and shots in `scratch/product-ring3/`, gitignored): Kitchen buffet plan → rules flip → both approvals → place order → resend → reload; simulator contention; `/request` milk and an open Christmas menu through "Plan it"; `/ops`; `/agents`; `/agents/chat`. No .env values read, no app or git changes._

## Verdict
**A top-3 Valio entry if the demo stays on the paths that hold up. It drops to mid-table if a judge types their own menu.** The trust core is real and visible on prod:
- approval bound to exact terms;
- "Hold to sign off" for an allergen change;
- one receipt after a resend, and it survives a reload;
- Terminal stock "never counted as cover";
- a judge key that cannot approve;
- live Valio lookup economy on `/request` ("2 catalogue searches, 1 quote for 5 shortlisted ids, 178 ms").

That matches Valio's own question ("when does your agent know it's safe to order on its own?") better than any chatbot entry will. Three things hurt it:
1. **The open-menu path shows wrong products.** Seen on prod: whitefish → breaded chicken fillet, vanilla pod → Atria sausage in a *vegetarian* dessert, glögi → chicken fond, celeriac → elk grill sausage.
2. **The first five seconds are an empty page** with one button.
3. **The strongest moment is on screen but not acted on.** When the world changes (another kitchen takes the ham), the agent says "these rules pick" a German ham and does nothing about it.

Spend the 10 hours on making the hero path dramatic and safe, the video and the write-ups. No new surfaces.

## Now → next (ranked; S ≤1 h, M 1–3 h, L >3 h)
| # | Do | Why (judge effect) | Size |
|---|---|---|---|
| 1 | **Make the hero moment act: contention → re-rescue.** When the simulator takes 4 palvikinkku, the agent re-runs the rescue and applies a split: 11 FI palvikinkku plus the rest from the next eligible candidate. A DE ham breaks "meat: Finnish preferred", so it lands in a sign-off group. Any earlier approval on that line voids, with the diff shown. Ops gets a case "Ham: another kitchen took stock". All the pieces exist: `find_substitutes.apply`, groups, `lastVoided`, Ops cases | This is the wow (below): the world changes, the agent repairs and still asks. It scores Robustness 15 + Controls 20 in one beat | M |
| 2 | **Fence the open menu.** The resolver must refuse category mismatches: protein↔protein, no meat in a vegetarian dish, no sausage for a spice. Below a match score → "unresolved, shown". Until then, the menu path stays off the stage and out of the video, and the `/request` example buttons don't lead there | A judge typing a dinner is likely at the peer-review table; one sausage-in-dessert kills "solves the user's need" (20) | S–M |
| 3 | **First screen tells the story before the click.** Show the event card with the two real outages (ham `462490`, lanttulaatikko `462482`) and the mandate quote *before* planning, or auto-plan on the first visit. Planning takes ~8 s, so run it in the background with a "planning…" skeleton | Peer review is 2 min at a table; the empty page wastes the first 10 s | S |
| 4 | **Video + submission text + sponsor write-ups** (Gemini's four questions; Aiven: Runtime + Postgres + NOTIFY + Valio cache) recorded on prod against CLAIMS "say it" rows only. Tag the commit; no redeploy in the last 30 min | Submission is judged on the demo video first | M (do by 01:00) |
| 5 | **Fix the visible wrong words**: `/request` "Placed by the kitchen agent" before approval; the brief drops "4 lactose-free"; receipt "15 lines supplier confirmed" next to "the supplier is simulated" → "confirmed by the simulated supplier"; chat "Which plan? pl-run-…" → default to the open event, with names not ids; Ops "Product 469995" → names; "Drafted an order with 0 lines" | Each is a 5-second credibility loss on a "trust" product | S each |
| 6 | **Ops first screen**: recalls with "Nothing held" go below held lines, grey not red. Keep held/sign-off cases on top with consequence titles (mock #3) | "The other side" beat must read in 5 s | S |
| 7 | **Explain the two surprises** a chef judge will ask about: rank order vs scores (0.84 ranked below 0.69) needs a visible "known stock first" band label; cured salmon 20 kg for an 11.5 kg need (+€120) needs "Valio sells 10 kg cases only" on the row | Both look like bugs today | S |
| 8 | **Guarantee change beat**: "30 more guests Saturday" (or 140 → 124 at T−72 h) re-plans the event diff. Today chat answers with a raw plan-id question. Wire the chat intent to the seeded event's covers. If it can't be done safely, drop it | The concept's own anomaly; a second robustness beat | M |
| 9 | `/story` + `/how` static pages (mock #6/#7) | Q&A and pitch only; isolated route | M, only after 1–5 |
| 10 | Rehearse the 3-min script below 3× on prod at 1440 and on a phone. Pre-plan a backup sandbox in a second tab | Demo risk | S |

**Cut tonight:** Kitchen layout A/B churn; forecast/demand tabs; product sheet; gate-path percentages; venue map; any new sponsor. **Sponsor entries:**
- Submit Valio, Gemini and Aiven.
- Submit Context.dev **tech** only if a recall drill visibly holds a line in the visitor's own order with its source. Skip Context.dev **main**: real-timeness is hourly, and every live notice says "Nothing held".
- Mention Exa only if the Why-drawer web evidence (merged in `03d4da7`) is seen on prod. I did not open it.

## Current ← eventual: what the strongest product is
**Eventual product: "the standing order that repairs itself, and an exception desk that asks only before cut-off."** Each role gets one thing:

| Role | Gets |
|---|---|
| Exec chef | The usual week runs in the act tier from the kitchen's own rhythm; only exceptions arrive as decision cards ("2 decisions before Tue 15:00") |
| Purchaser | One receipt per delivery date, plus a receiving loop (delivery note → short-ship → claim + rescue) |
| Approver | A seal: exact terms, why, consequence of a no |
| Valio ops | A cross-kitchen view of contention, recalls and demand; the gateway that admits third-party agents with grants and spend caps |

| Piece today | Verdict | Why |
|---|---|---|
| One gate (`applyOps`), terms-hash approvals, idempotent commit, cumulative caps | **Foundation** | The product *is* this; every future door (EDI, Choco-like apps, voice) passes through it |
| Mandate as data (caps, never-delegate, origin require/prefer, weights) | **Foundation** | Becomes versioned policy per site and per chain (GROWTH Mandate/Grant) |
| FulfilmentView + D10 vocabulary (confirmed / awaiting / known / unknown) | **Foundation** | The honest-supply language Valio can't get from a chatbot; carries straight into receiving and forecast |
| MCP/REST door with scoped judge keys, per-visitor sandbox | **Foundation** | Becomes Valio's agent gateway; the sandbox becomes tenancy (BuyerAccount/KitchenSite) |
| Valio cache-through with lookup economy, ports + fixtures | **Foundation** | Matches Valio's "query only when needed" rule; production-shaped |
| Op log with provenance, Ops cases per cause | **Foundation** | Audit, recall impact and demand analytics all read this log |
| Rescue ranking (supply tier first, Gemini fit as a caution) | Foundation, but **fit is cosmetic today** | Fit scores don't drive order; keep them as a reason, not a claim |
| Seeded single event + scripted planner special cases | **Detour** | Hard-codes k-hotel and the buffet; the eventual input is the kitchen's rhythm and its menus |
| Three orchestrators (`/request` run, `runGoal`, `kitchen/live`) | **Detour** | One task/turn identity should own all doors (ROUND8 #1) |
| `/request` as a separate product with its own stepper | Detour, keep as Valio's required-flow proof | It becomes the "New request" composer feeding a task |
| LLM menu → ingredient resolve without category guards | **Detour as built** | Needs typed ingredient classes and the alias table, or it will keep mapping vanilla to sausage |
| Review mechanism behind `REVIEW=1`, roadmap tooling | Detour for the product | Fine as engineering hygiene; never on stage |

## Idea table
| Idea | Value | Feasibility | Call |
|---|---|---|---|
| Contention → agent re-rescues, approval voids, Ops case | Very high | M (pieces exist) | **tonight** |
| Guarantee change 140 → 170/124 re-plans the diff | High | M | **tonight** if #1 is done by ~01:00, else pitch only |
| Approval seal: edit lights the field, hash breaks, diff shown | High | S–M (`lastVoided`, "Audit detail" exist) | **tonight** (visual only) |
| Recall impact on the visitor's own order (labelled drill, source link) | High | M | tonight only if the drill already reaches visitor sandboxes; else **pitch, labelled next** |
| Usual order / rhythm as the act-tier baseline ("normal week €3,120, 46 lines" already shown) | Very high | L (needs history) | **pitch only, labelled next**; it is the obvious production step |
| Standing orders (Valio's *tilauspohjat* read as the agent baseline) | High | M | pitch only, labelled next |
| Forecast "will stock hold?" per SKU across kitchens | High (Valio) | L | pitch only, labelled next |
| Demand at Valio scale (2,400 kitchens) | Medium | synthetic only | pitch only, one slide labelled synthetic |
| Photo of a delivery note → short-ship → claim (*reklamaatio*) + rescue | High (closes the loop) | M–L (Gemini vision) | **pitch only, labelled next** |
| Mandate from the chef's words (Gemini drafts, chef signs the diff) | High | M; `set_mandate` is off | pitch only, labelled next |
| Third-party agent registry: per-agent grants, spend, reputation for Valio | High (Valio) | M | pitch only, labelled next (judge key is the seed) |
| Chain central purchasing policy over many sites | High (buyer) | L | pitch only |
| Waste line "vs your usual +15%" | Medium | S, but an estimate | drop tonight (claim risk); pitch with the Luke numbers |
| Voice (Gemini Live) ordering | Medium wow | risky | **drop** |
| Price-first vs carbon-first flip | Low (salmon/trout share 4.9) | – | **drop** carbon flip; keep Finnish-required flip |
| 500-kitchen swarm, venue "estimate any kitchen" map | Low for judging | M–L | **drop** |
| Finnish UI | Medium | M | drop (chat already takes FI) |

## The wow moment
**"The world changed under an approved plan, and the agent fixed it without overstepping."** Live steps:
1. Approve the ham.
2. Tick "another kitchen takes 4 palvikinkku".
3. The ham row turns "short".
4. The agent splits 11 FI + rest DE, and the DE part goes to sign-off because the mandate says Finnish meat is preferred.
5. The old approval visibly voids with the diff.
6. Ops lights the same case.

It shows autonomy, controls, exception handling and auditability in about 20 seconds. **Today it is half on the path:** the shortage and "these rules pick" show, but nothing is applied (see #1). The fallback wow is already real: "Send the same order again" → "Same key, same receipt. No second order", followed by the judge's own agent getting 403 on approve.

## 3-minute demo script (real on prod today, except where marked)
| Time | Beat | Action / words |
|---|---|---|
| 0:00–0:15 | Opener | "140 guests Saturday. Valio's own data says the ham and the swede casserole are out. What may an agent promise this kitchen, and what must it refuse?" (Plan already pressed in a pre-warmed tab; it takes ~8 s) |
| 0:15–0:45 | It thinks like a chef | Header "2 decisions before Tue 8 Dec, 15:00". Ham row: 135 g × 140 ÷ 0.70 = 27 kg → HK Palvikinkku, known stock. Lanttulaatikko "make it in house, 5 of 5 ingredients known". Rosolli: "supplier states no quantity, so it is not cover" |
| 0:45–1:05 | It refuses | Click "Finnish required": the German ham drops out with its reason. "Same shortage, your rules." Back to default |
| 1:05–1:35 | Trust you can test | "New product" group → Confirm exact terms. Allergen group → **hold to sign off** ("the kitchen never delegates an allergen change"). Place order: 18 lines, €933.92. Press "Send the same order again" → "Same key, same receipt". Reload → receipt still there |
| 1:35–1:55 | World changes (**after #1 lands; otherwise skip**) | Fresh tab, plan, simulator tick → ham short → agent re-rescues, DE part to sign-off |
| 1:55–2:25 | The other side: any agent | `/agents` → key → Claude Code with the MCP: "order 1,000 L lactose-free milk by Monday for the hotel". It gets a held plan ("over your €800 line limit"). Ask it to approve → refused (approve isn't even in its tool list). The approval link opens in the Kitchen. (Backup: `/request` milk, same flow, with live Valio lookup in 178 ms) |
| 2:25–2:45 | Valio's view | `/ops`: held for a person, sign-off requested by the approver, committed €933.92, every op in the timeline with actor |
| 2:45–3:00 | Close | "Valio publishes the door; kitchens keep their rules. Next: the usual week runs on its own, the delivery note closes the loop. A 4-week hotel shadow pilot is the next step: targets, not results." |

## PITCH claims
**Strongest (seen on prod in this pass):**
- approval bound to exact terms, with grouped decisions;
- allergen change can't be delegated (hold to sign off);
- no double orders (resend → same receipt; survives reload; race smoke);
- outside agents can't approve (MCP list, chat "approve it for me" refused);
- unknown supply is never cover;
- live Valio lookup only for shortlisted ids (`/request` trace: Valio cached + live, 178 ms);
- per-visitor sandboxes.

**Risky:**
- **Open menus → plan**: it runs end to end now ("Planned: 21 needs, 17 lines"), but the products are wrong. Don't claim until #2.
- **Gemini "recipe fit"**: ranks visibly don't follow scores (supply tier first). Say "Gemini flags fit as a caution; rules decide".
- **"Supplier confirmed"** on a simulated supplier: always say "simulated".
- **Context.dev "live recall"**: every live notice says "Nothing held"; it's a drill only.
- **Exa**: unverified on prod.
- **"Unlimited" milk stock**: it's an assumption label.
- **A.I.mo comparison**: say the date it was asked.
- **Any number on waste or time saved**: estimate only.
- **Carbon trade-offs**: drop.
