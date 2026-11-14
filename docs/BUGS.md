# BUGS

_Bug bash of prod, Sat 14 Nov, build `825874d` (`/healthz` commit). Owner: Track F (session 91). This file only finds and ranks; fixes happen in the owning lanes. Four journeys (Kitchen, Request, Agents/MCP/chat, Ops), at widths 1440 and 390, in fresh browsers, with a second browser for isolation. Shots are in `junc26-lanes/f-evals/scratch/bugbash/shots/` (gitignored; scripts and logs are beside them)._

**Severity:**
- **blocker:** breaks a judge journey, or shows wrong or unsafe information.
- **ugly:** a judge notices and it looks bad.
- **minor:** anything smaller.

**Verified** means 91 re-checked it from the screenshot, the code or a second run. Every other row was reported by a walker and is plausible. Prod at `825874d` doesn't include `lane/b2-request`. Request rows marked **B-pending** should be re-tested after B's merge and deploy.

## Top 10
| # | Sev | Defect | Repro | Shot | Owner | Verified |
|---|---|---|---|---|---|---|
| 1 | blocker | **An agent's plan can't be approved anywhere.** The approval link opens the Kitchen screen, which shows only the seeded buffet, so a plan from MCP or chat never appears. Approve → continue → commit → receipt can't finish from either door. | MCP `place_order` (30 ST `464201`, k-hotel, 11 Dec), or chat "Order 60 kg butter for Friday" → open `approvalUrl` `/?kitchen=k-hotel&plan=…&v=1` → only "Plan the event", no Approve. Ops "Confirm, edit or swap" → `/`, same result. `KitchenScreen.svelte` `honourDeepLink` reads `plan` but only acts on `need`. | `agents-approval-link-1440.png` | Kitchen UI (1f), approval links (E) | yes |
| 2 | blocker | **/request's clock is a day ahead, so "tomorrow" silently becomes Wed 9 Dec** and turns into an approvable order. No passed cut-off is mentioned. | "4 kg lactose-free butter tomorrow" (also the FI phrasing) → header "Sim clock Tue 8 Dec" against Mon 7 Dec 21:40 everywhere else; "Deliver by Wed 9 Dec from 'tomorrow'"; €26.48 "Needs your approval". | `request-j2-en-1440.png`, `request-j2-fi-1440.png` | request (B); clock source (see the B clock fix) | yes |
| 3 | blocker | **The event menu journey stops at "Brief complete. Menu proposal: next."** There's no menu, no review and no plan. | "Christmas dinner for 50 on 20 December, 4 lactose-free and 2 vegetarians" → answer Plated / 4 courses / €25 → dead end. "5-star 5-course dinner for 50" ends the same way. | `request-j3x-s4-1440.png`, `request-j3s-end-390.png` | request/menu (B): B-pending | |
| 4 | ~~blocker~~ **not a bug** | ~~A stale Kitchen tab commits the new run's plan~~. Re-run by 91 with request bodies logged: the stale tab sends the old plan's id and is refused (`403 FORBIDDEN "that plan is not this session's kitchen plan"`). The walker's 200 came from a different tab. What remains is the raw error text (see Ugly: stale tab) | one browser: K1 plan → Ops reset → K2 plan → K1 Place order → 403 | `verify-stale-k1-1440.png` | — | re-run: false positive |
| 5 | blocker | **The order summary undercounts and doesn't add up.** It says "Ordered · 7 approved lines" when 18 were ordered, and "These lines €532.31 / Within your mandate €0.00 / Order total €933.92". Only the first approval group is shown. | Kitchen: approve both groups → Place order | `kitchen-05-ordered-1440.png`, `kitchen-09-receipt-390.png` | Kitchen UI (1f) | yes |
| 6 | blocker | **Reloading after an order loses the receipt.** The headline flips from "Ordered… Editing is locked" to "No decisions · Nothing needs you", and the receipt id, "Send the same order again" and "What happened" are gone. | Kitchen: order → reload | `kitchen-05-reload-1440.png` | Kitchen UI hydration (1f) | yes |
| 7 | ugly | Ham rescue bases disagree on screen: need 27 kg, 13 ST ≈ 19.5 kg, "27 kg planned", while the Why drawer sizes from 18.9 kg. The 27 kg is raw on the bone and the pack is cooked, so this is **not a stock overclaim** (lead/8d). 8d is adding a served basis so the row, the drawer and the receipt read one basis | Kitchen: plan → ham rescue → Why | `kitchen-07-why-1440.png`, `kitchen-10-ham2-390.png` | core (8d) served basis | reclassified |
| 8 | blocker | **A new request typed while a question is pending is swallowed as the answer.** | chat @390: "I need lactose-free butter for tomorrow" → "4 kg" → "Order 60 kg butter for Friday": "Friday" is taken as the date, the 60 kg is dropped, and a €26.48 draft is shown. | `agents-chat-m-big-390-390.png` | agent/chat (E) | yes |
| 9 | blocker | **The rice formula is wrong and the milk input shows 0.** "100 g × 140 = 1.7 kg" (that's 14 kg, and the real basis is about 12 g/guest); pressing + gives "105 g × 140 = 1.8 kg". Milk is a disabled "0" against a 10.5 l need. | Kitchen: plan → Riisipuuro rows | `kitchen-02-planned-1440.png` | Kitchen UI / core (1f) | yes |
| 10 | ugly | **Ops and Kitchen disagree.** Kitchen shows "3 can't be ordered, 2 decisions, 4 lines orderable now". Ops shows "can't be ordered 0" and "held 14", and its Timeline says "17 held" and "sign off 14", while the queue says 7. | Kitchen plan → /ops | `ops-j1-ops-1440.png`, `ops-j1-kitchen-planned-1440.png` | Ops (9c; F12-ops) | |

## More blockers
| Sev | Defect | Repro | Shot | Owner |
|---|---|---|---|---|
| blocker | "Your earlier approval no longer applies" when nothing was approved. The diff lists unchanged lines as "added" (they only moved into an "Over order cap" group), and the banner stays after a no-op edit | Kitchen: plan → set ham 200 g (or tick Simulator) without approving | `kitchen-03-ham200-1440.png` | Kitchen UI (1f) |
| blocker | Ham shortfall blamed on another kitchen: at 200 g/guest the rescue resizes to 19 ST (≈ 28.5 kg for a 40 kg need), and the banner says "stock was taken by another kitchen" / "(simulated contention)" although the Simulator was never touched. The real cause is 19 needed against 15 in stock. The line is held with the shortfall stated, so it isn't ordered against stock | fresh browser, Kitchen: plan → Joulukinkku 135 → 200 g (1000 g → 94 ST) | `kitchen-03-ham200-1440.png` (verified) | core (8d) |
| blocker | Chat: a second task shows the previous task's card, and the ledger contradicts itself ("62 kg needed… 2 decision(s)… 1 held line"); the Finnish turn gets an English reply | chat after the 60 kg task: "tilaa 2 kg laktoositonta voita perjantaiksi" | `agents-chat-fi-1440-1440.png` | agent/chat (E) |
| blocker | Chat: leaving and coming back shows the task id with an empty conversation; approval links open in the same tab despite the ↗ | chat → "Open the approval in Kitchen" → back | `agents-chat-reload-1440-1440.png` | agent/chat (E) |
| blocker | /request: a passed cut-off is a dead end ("Unorderable · cut-off passed", €0.00), with no next open date offered | "4 kg lactose-free butter for Tuesday 8 December" | `request-j2-explicit-1440.png` | request (B): B-pending |
| blocker | /request: the built-in example "2 cases of butter tomorrow" lists 4 priced options as orderable; picking one gives "cut-off passed", €0.00 | example button → pick the first case | `request-j4-cases-picked-390.png` | request (B): B-pending |
| blocker | /request event brief drops the lactose-free count ("lactose-free, vegetarian:2"; the 4 is lost) | event text above | `request-j3x-s0-1440.png` | request parser (B) |

## Ugly
| Defect | Repro / shot | Owner |
|---|---|---|
| A stale Kitchen tab after a reset keeps the old plan; actions fail with raw red "start the demo first" or "FORBIDDEN: that approval is not for this session's plan", and nothing says the sandbox was reset elsewhere | `ops-j3-reset1-stale-kitchen-1440.png`, `ops-j3d-k1-stale-hold-1440.png` | Kitchen UI (1f) |
| /request: "Placed by the kitchen agent for …" on every order card, including pending, denied and unorderable ones (claims an order before approval) | `request-j2-en-1440.png` (verified) | request (B) |
| /request event date contradicts the brief: "Deliver by Tue 8 Dec (no day given)" after answering Sat 12 Dec; "2026-12-20 is a Sunday" next to "the day before" | `request-j3s-end-390.png` | request (B) |
| Search ranks substrings first: "voi" → savoy cabbage, "butter" → butternut squash; `nextAction` suggests quoting them | MCP `search_products` | search/tools |
| Chat asks the date again after "ok" and offers "Tomorrow 12-08", the date it just ruled out; old date buttons stay live; US-style "12-09" | `agents-chat-clar3-1440-1440.png` | agent/chat (E) |
| Chat "Decide before Tue 8 Dec, 21:40" on a Friday order | `agents-chat-fi-1440-1440.png` (verified) | core/chat |
| Chat "approve it for me" reprints the held card, with no "I can't approve; a chef must" | same shot (verified) | agent/chat (E) |
| `/agents` "Your agent's changes" shows raw op names; a refused commit is listed as `CommitOrder` | `/agents` after MCP calls | /agents page |
| Ops: the chat's 60 kg butter row is "Product 463798" (no name) with an "Unknown quantity" chip for a 15 KI line | `agents-ops-chef-1440.png` | Ops (9c) |
| Ops: at 1440 the queue's "Next step" column runs under the side panel | `ops-j1-ops-1440.png` | Ops UI (9c) |
| Ops: three recalls that need nothing ("Nothing held") are red rows at the top of "To act on"; due "in 17 h" next to age "24 d"; they push held lines below the fold, worst at 390 | `ops-m-queue-a-390.png` | Ops UI (9c) |
| Ops: Agent traces is empty right after the kitchen agent planned ("No agent has run since this page opened") | `ops-j1-traces-1440.png` | Ops (9c) |
| Ops Timeline clipped at 390 (only v1–v2); at 1440 it uses ~40% of its card; recall triangles not in the legend | `ops-m-timeline-a-390.png` | Ops UI (9c) |
| Kitchen: Gemini fit shown as "fit 2.194225815422525/4" (main has a52d377; not deployed) | Kitchen rescue candidates | deploy |
| Kitchen: candidate ranks don't follow their scores; every candidate shows "rel 1.00 · 10.1 kg CO₂e/kg" (looks like placeholder data) | Kitchen ham candidates | Kitchen UI / D |
| Kitchen: at 390 the "By when" labels overlap the Now line and bars; no "Now" label | `kitchen-10-chart-390.png` | Kitchen UI (1f) |
| Kitchen Why drawer leaks internals (`fixtures/seeds/…json`, raw ISO time, Nov cut-offs against the Dec scenario; steps start at 4) | Kitchen Why | Kitchen UI (1f) |
| Kitchen: Graavilohi needs 11.5 kg, orders 20 kg (+8.47 kg, €282) within mandate: lot rounding a judge will ask about | Kitchen | core (lot rounding) |
| /request at 390: "Place it anyway (it will be refused…)" spills out of its button | `request-j5-huge-390.png` | request UI (B) |
| /request status copy contradicts itself ("Approval · needs you" next to "Nothing to approve"; amber after a grant; "Not on the tender list" vs "Over the limits you set") | `request-j2-explicit-1440.png`, `request-j1-b-1440.png` | request UI (B) |
| /request: nonsense input becomes a product ("How much purple elephant sings quietly?") | `out-j5-nonsense-1440.txt` | request (B) |
| /request: the System toggle changes nothing visible; "Demo data" says "No prices on screen yet" with prices shown | `request-j4-system-1440.png` | request UI (B) |
| /request jargon: "1,000 ST (= 100 KI)", parser notes, "butter: product 463798", "€1250" vs "€1,250" | request runs | request UI (B) |

## Minor
`approvalUrl` relative (an outside agent can't hand a working link) · MCP errors carry no guidance (`commit_order` FORBIDDEN has no `approvalUrl`/`nextAction`; cut-off-passed `place_order` doesn't offer 9 Dec) · `get_context` cut-off 15:00 vs quotes 17:00 · chat/`/agents` copy ("0 needs not fully covered of 1", "1 decision(s)", full ids) · every MCP line held (`external_agent_needs_approval`), even €46.80 of milk, while `/agents` says the mandate's allowance is ordered (product decision) · `/agents` says 13 tools, there are 14 (`get_outcome`) · Kitchen grams input clamps silently (0 → 1, 5000 → 1000) · "Approval valid until Tue 8 Dec 21:40", after the cut-off · switching kitchen keeps the buffet headline · phone Kitchen is ~7,800 px tall · /request loses the run on reload · "Hold to approve" quick tap gives no hint · the kitchen select clips "Espoo Central Kitchen (fictiona" · Ops reset within ~20 s → small orange "try again in 9 s" · another visitor's link silently shows your own sandbox (safe) · the Shared room offers "Start this sandbox over" · Ops header shows `ws-j-… · run-…`; the Timeline shows `web:contextdev`, `agent:plan_event`, "Drafted an order with 0 lines", wall-clock times beside scenario times.

## Not reproduced
- Stage presenter reset → Kitchen → back: Stage is view-only without a chef/approver key, which the walkers don't have. The same error text comes from `applyOps` (`core/state.ts`) when an op's run id differs from the stored run. Re-test with the presenter key after 9c's fix deploys.

## Found and fixed
| Defect | Cause | Fix |
|---|---|---|
| Stage on prod: "FORBIDDEN … another workspace or run" after reset → Kitchen → back (the user's screenshot) | Lane dev servers ran with the prod `DATABASE_URL` from the worktree `.env`; a local dev in `ws-demo` wrote into prod's stage | 9c: g5 run-authority re-read and a dev guard; dev servers now run with `DATABASE_URL=` blank |

## Worked well
- Kitchen:
  - The buffet journey works end to end.
  - Decisions are made one reason at a time, with hold-to-sign for the allergen change.
  - Double commit or resend gives the same receipt.
  - An edit voids the approval and shows "2 → 3 ST".
  - Terminal lines are worded honestly.
  - Every step is under 5 s.
- /request: the milk example works end to end at both widths. The receipt is labelled "local simulated commitment", and a prompt injection was refused.
- MCP answers in 80–300 ms, and never exposes `approve` or `set_mandate`.
- Chat turns are under 1 s, and it names the passed cut-off and offers 9 Dec.
- Isolation: two browsers stayed isolated, and B's reset never touched A.
- The Ops deep link opens the exact need, and a Kitchen commit shows up live in Ops.
- No console errors or HTTP 5xx on any journey.
