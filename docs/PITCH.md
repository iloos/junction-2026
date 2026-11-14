# PITCH

_Working doc, not final copy. Lead-owned until a pitch owner exists. Claims only what is wired on `main` (CLAUDE.md rule 8); anything unverified sits under "Not yet claimable" until a test, eval or observed deployed run backs it. Words on screen and in speech follow [concept/VOCABULARY.md](concept/VOCABULARY.md) (D10): **supplier confirmed** (receipt-backed only), **ordered, awaiting supplier** (committed, Terminal), **planned**, **known-stock candidate** (Valio states a quantity; not reserved)._

## One-breath opener
"140 guests on Saturday. The ham and the swede casserole are out. What can an agent actually promise this kitchen, and what must it refuse?"

## Table demo (2:00)
| Time | Beat | What they see | Label on screen | Status |
|---|---|---|---|---|
| 0–15 | The problem | Christmas buffet for 140 (`event-xmas-140`); whole ham `462490` and lanttulaatikko `462482` out in Valio's own data | Valio mock data (fetched/cached); booking and the December clock are the scenario | [x] live kitchen |
| 15–40 | It thinks like a chef | Edit grams per guest; demand → packs with unit bases and a coverage ruler per dish | Recipes and stock-on-hand are team estimates | [x] live kitchen (C1) |
| 40–70 | It refuses | Candidates ranked known stock first; a rejected candidate with its reason; Terminal items labelled unknown stock, never counted as cover | Real data + our rules | [x] in code and tests; see it deployed before saying it |
| 70–95 | It's honest | Ham → HK Palvikinkku `476768` (known-stock candidate); lanttulaatikko and joulutorttu made in house from known-stock ingredients; any shortfall shown | Hand-checked rescue in the seed | [x] tests; prod check open |
| 95–115 | Trust you can test | Approve exact terms → commit → deliberate retry → one receipt; an edit after approval voids it | Local simulated commitment | [x] |
| 115–120 | The other side | The same held lines in Operations, in the visitor's own workspace | | [x] |

Valio's own example ("1,000 L lactose-free milk by Monday") runs as its own route, `/request` (their required flow: request → lookup → order → approval), not inside this story.

**Bold beat ("Same shortage. Your rules."):** the judge flips price-first to Finnish-required or changes a cap; eligible terms, rejections and residuals update; if nothing qualifies, it says so. [~] rehearse on the deployed app first.

## Stage pitch (3:00)
0–20 the problem · 20–105 the Christmas journey · 105–135 an outside agent on the judge's own key plans in the judge's sandbox and cannot approve · 135–160 Operations shows why kitchens are held · 160–180 the 4-week hotel pilot (targets, not results) and close.

## Labels (always visible)
"Valio challenge mock: fetched T / cached T" · booking, stock-on-hand, recipes and the December clock = **scenario** · order = **local simulated commitment** · salmon contention and shifted cut-offs = **simulated** overlays · the "normal week" a plan is diffed against is a **team estimate** · Valio's huge "unlimited" stock figure is an **assumption**. Check each label is on screen before the video (the normal-week and assumption labels were missing at the last review). Salmon and trout share carbon 4.9: don't promise a carbon flip there. No product images.

## Provable now (claim → evidence on main)
| Claim we say out loud | Backed by |
|---|---|
| An enforceable mandate: approval is bound to the exact terms | `server/store/gate.test.ts`; eval s4 (price change voids the approval, commit → `TERMS_CHANGED`); `view.test.ts` (missing price never passes) |
| A hard limit no approval can pass | `server/store/ceiling.test.ts` (forbidden outright, split lines included) |
| No double orders | eval s1 (retry → the same receipt), s5 (`DUPLICATE` on a reused key with another payload); Postgres race `pg-race.test.ts` via `pnpm test:pg` (opt-in, on Aiven) and `scripts/smoke-race.mjs` after each deploy |
| Never auto-orders over its caps, even split | eval s5 (`CAP_EXCEEDED.weekly` on a split second order) |
| Below a lot step is unorderable | eval s3 |
| Unknown supply never counts as cover, and known stock ranks first (D8) | `core/rank/rank.ts`; `server/store/pool.test.ts` (lanttulaatikko made in house, Terminal `462157` ranked below); `FulfilmentView` partition (`core/mandate/fulfilment.test.ts`) |
| Each committed line names what allowed it: the mandate or a specific approval | `server/store/authority.test.ts` |
| Edit after a rescue resizes the substitute and re-plans; any edit voids the approval | `server/store/rescue.test.ts` (resize, replace, commit only the new product); `core/state.test.ts` (approval invalidated on edit) |
| Physical amounts, not pack counts: 10 L of milk is sized in litres | `server/store/direct.test.ts`; `fixtures/views/milk-direct.json` |
| The same words give the same basket through `/request`, the agent and REST | `evals/fidelity/cases.json` (`pnpm eval`) |
| Outside agents get the same tools over MCP and REST and can never approve | `SCOPES_BY_ACTOR` (`core/contracts/tools.ts`); `agent/adversarial.test.ts` (`pnpm eval:agent`); eval s5 `tools.externalAgentMustNotHave` |
| Every visitor gets their own sandbox; a judge key works only there | `server/demo/{visitor,judge-key,sandbox}.test.ts`; two-browser gate `src/routes/ops/visitor-gate.e2e.ts` (production build) |
| Gemini Decisions scores recipe fit in ranking, with replay and rules fallbacks | `server/adapters/decide`; `DECIDE_LIVE=1 pnpm test:live` (one live call) |
| Valio's milk example runs on `/request`, keeping "lactose-free" | `server/request/fixes.test.ts`, `request.test.ts`; seen deployed with the Gemini parser |

## Not yet claimable
- **Open menus** ("Christmas dinner for 50 on 20 December" → a plan): brief questions are live; the menu proposal is in progress and `plan_event` from a reviewed proposal (A4) is not built.
- **Decide per reason group** (an allergen change never rides with routine lines): typed, on a branch (A2b).
- **Cut-off enforced at commit** (F9) and the **before → after diff** of a voided approval: typed, not served.
- **Agent door page** (`/agents`) and the **review mechanism**: on `lane/e-agent`, not on main.
- **Recipe-aware**: no labelled fit set has run; say "ranks by the kitchen's rules" instead.
- **"Ordered the buffet"**: the default agent goal commits nothing; it plans and holds.
- **Exa**: tools exist (`lookup_facts`, `find_outside`) but no judge-facing UI yet; decide at the Sat 22:00 checkpoint.
- **Context.dev**: not "a real recall hit our orders" (drill only) and not "within minutes" (hourly monitor unless the 10-min cadence is approved).
- **An external agent's stale commit refused on prod over MCP**: covered in tests, not yet observed deployed.
- **Simulator events "labelled simulated"** in the kitchen's own workspace: the synthetic stream runs only in `ws-synth`.
- **Data residency** ("data stays in Finland"): never; D5.
- Parked by D7, never in the pitch: Gemini Live voice, photo input, a 500-kitchen swarm, Nemotron, Modal jobs.

## Framing we can say truthfully (docs/research/agentic-commerce.md)
- "Our mandate is what Google's agent payments protocol (AP2) calls an open mandate; our approval is a closed mandate bound to the exact terms by a hash; the approval surface is not an agent, and every check runs in deterministic code." Don't claim AP2/ACP compliance, payments or signatures.
- Numbers (cite on a slide, docs/research/pitch-numbers-and-viz.md): Finnish food services waste ~61 Mkg of edible food a year (Luke); ~1 plate in 6 on a serving line is never eaten (Luke field study); EU law requires a 30% per-person cut by 2030; public kitchens serve ~380 M meals a year; buyers beat the algorithm only where they know something it doesn't (Kesavan & Kushwaha 2020), so we ask only at the exceptions. No Finnish online-order or fill-rate figures (none found).

## Q&A crib
- **Why won't Valio's own A.I.mo do this?** We asked it Valio's own example (1,000 L lactose-free milk by Monday); it said it can't confirm availability or price and pointed to sales service. That is right for a knowledge assistant. The missing layer is transactional: stock, price and authority. We built that layer and an open gate A.I.mo could sit on; we don't replace A.I.mo or the webshop. (Say the date we asked.)
- **Isn't this Choco's OrderAgent Autopilot?** Choco claims "only genuine exceptions reach a person" as a vendor feature inside its own app. Ours: the exception rule is the customer's own mandate, enforced in an open interface any agent can use, with approval bound to exact terms.
- **What breaks it?** Unknown supply: we hold and say so, and never call it covered.
- **How are substitutes better than "Katso korvaavat"?** Theirs lists similar products with no reason. Ours gives a reason line per candidate and a rule-based rejection (e.g. an allergen difference).
- **Doesn't the agent ask too much?** Usual products go through within the mandate (the standing-order baseline), so only what is new or over a limit is held. Grouping the held lines into one decision per reason is in progress (A2b + C).
- **Images?** None from Valio's data; we show none rather than guess.
- **Valio's words:** order templates (*tilauspohjat*), cart per delivery date, main user (*pääkäyttäjä*), claims (*reklamaatiot*). Our standing order is their template read as the agent's baseline.
- **What did you build vs use? Who pays?** Built: the gate, mandate, ranking, planning, request flow, Ops, MCP/REST. Used: Valio's mock data and API, Gemini, Aiven, Exa, Context.dev. Valio pays; free to kitchens.
