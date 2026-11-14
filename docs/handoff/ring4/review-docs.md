# Ring 4 review: docs and claims coherence

_Read-only review, Sat 14 Nov late, main at `6af9c1b`. Read: CLAUDE.md, STATUS, DISPATCH, DECISIONS, PITCH, CLAIMS, BUGS, SUBMISSION, handoff/README-draft, concept/{ARCHITECTURE,PRIVACY,SCORECARD,VOCABULARY}, foundations/{models,valio-data,deploy}, the Valio brief with mentor answers, and site/public (landing, /story, /how, /proof, cases.json). Spot-checked against code with grep. No prod calls were made, so every "prod" statement below comes from the docs._

## Verdict
The trust core is described consistently everywhere, and the site's /proof and /how pages are the most accurate documents in the repo. Three things are out of step:
- **SUBMISSION §4 "Honest limits" and the README draft were written before Valio's answers and the A4/cut-off fixes.** They under-claim things CLAIMS marks "say it", and they still call ≥999999 "an assumption".
- **The ≥999999 = unknown change (81c3fb7) flipped routine dairy from "within the mandate" to "held, one tap".** `cases.json` and the PITCH Q&A still describe the milk as ordered without asking.
- **CLAIMS' last full pass ran on `70c30e2`/`7f1db5a`, before** D13 (dock approve), chat events, grounded menus, the contention split to Vataja, `read_image` and the calendar feed. None of these has a CLAIMS row, so none of them can be said yet.

Fix the texts, re-record `cases.json` after the last deploy, and run one CLAIMS pass on the freeze build.

## Contradictions, over-claims and under-claims
| # | Where | Says | Truth (CLAIMS / code) | Kind |
|---|---|---|---|---|
| 1 | site `cases.json` "lactose-free" (recorded at `e9ec36c`, before `81c3fb7`) | "Inside the mandate, so it can be ordered without asking", €15.60 | `validate.ts:110`: availability unknown → `UNKNOWN_REQUIRED`, tier `propose`. `464201` is ≥999999, so it is now held for one tap. /how says the same thing | **over** |
| 2 | `cases.json` "one-receipt" | commit ×4 on the /request milk | The milk now needs an approval before the commit, so the recorder flow may break. Re-record | stale |
| 3 | `cases.json` "agent-cannot-approve" | "its key gets 15 tools" | The registry has 18 (`read_image` added); an external key sees 16 | stale |
| 4 | CLAIMS MCP row; BUGS minor | "13 tools… registry 17, judges should see 15"; "/agents says 13, there are 14" | 18 registered, 16 for an outside agent. `/agents` counts dynamically | stale |
| 5 | SUBMISSION §4, README-draft table | ≥999999 "treated as an assumption" / "(an assumption)" | D6 amendment: Valio confirmed it means **unknown**. PITCH labels already say so | contradiction |
| 6 | SUBMISSION §4 | "neither entry yet tells which cut-off passed or offers the next day" | CLAIMS "say it": seen on prod `/request` ("earliest delivery is Wed 9 Dec"). Also on /proof | **under** |
| 7 | SUBMISSION §4 | open menus: "turning one into an order is not claimed: ingredient matching can pick the wrong product" | CLAIMS "say it" on /request (menu → plan); BUGS #11 fixed on `7f1db5a` | under |
| 8 | SUBMISSION §4 | "same words" gaps: rules parser drops "lactose free"; undeliverable next-day pick | CLAIMS: every paraphrase expectFail retired. Keep only "for the cases we test" | stale |
| 9 | SUBMISSION Gemini | Flash-Lite "for planning the in-app agent's tool calls" | Prod runs the scripted planner (`agent/index.ts:173`; STATUS trap; PRIVACY). The LLM planner is opt-in | **over** |
| 10 | SUBMISSION Exa "ENTER?" | "CLAIMS still lists Exa… not yet observed on prod" | CLAIMS: Why-drawer Exa evidence is "say it" (prod `70c30e2`) | stale |
| 11 | SUBMISSION Exa bullet 2 | make in house from a web recipe, held for sign-off | Code exists (`web/grounding.ts`, `lookup.ts`) but there is no CLAIMS row and it hasn't been observed | unbacked |
| 12 | PITCH "Not yet claimable" | "New events from chat"; "trout→pork (BUGS #11)" | e1229f3: chat runs its own event flow (brief chips → `propose_menu` → menu card → `plan_event`); #11 fixed on prod `7f1db5a` | under / stale |
| 13 | PITCH Q&A "Doesn't the agent ask too much?" | usual products go through within the mandate | Unknown-supply products (most dairy, butter, creams: `trial-harness.ts:27`) are now held for one tap. Narrow it: "known-stock routine lines" | **over** |
| 14 | site /how approval section | "A person approves, on the Kitchen screen… the chat… links to the approval in Kitchen" | D13 / 9fc27b8: the chef also approves from the dock card (same terms, hold-to-confirm). Still no agent approval | stale |
| 15 | README-draft tour 1 | "the packs and the coverage per dish update" | CLAIMS: the per-dish coverage ruler is being removed; don't script it | stale |
| 16 | README-draft; STATUS | "~420 unit tests" | 669 `it/test` cases in 142 `*.test.ts`; /story says "600+" | stale |
| 17 | README-draft tour 3 | "Edit a line after approving… voided, with what changed shown" | CLAIMS: the UI void hasn't been observed on prod (tests only) | say only after seen |
| 18 | CLAIMS Labels row | prod still shows "unlimited · Stock" until 8d's fix | The fix is merged (`81c3fb7`); re-observe on the freeze build | stale |
| 19 | PITCH "Parked by D7… photo input, Nemotron" vs code | parked | `read_image` (Verda Nemotron) is wired and **listed on MCP for judges**, but the endpoint 404s (models.md §1). A judge's call fails | risk |
| 20 | No CLAIMS row | the hero wow: contention → split → Vataja held as a new product → sign-off; D13 dock approve; calendar feed; grounded-menu check | `store/contention.test.ts:100`; 9fc27b8; ca5f451/d55da2d; d734c6a | under (unclaimable until a row exists) |
| 21 | CLAIMS header | "Prod = widely-many-scorpion…aiven.app" | Primary is https://app.mandate.kitchen; aiven.app is the fallback | stale |

## Ranked doc fixes (file → fix)
1. **site/public/cases.json** → re-record on the freeze build (`site/record/record.mjs`). The milk case must show "Needs one tap: Valio doesn't state a quantity", the tool count must be 16 (or 15 if `read_image` is hidden), and the one-receipt case must commit after the tap.
2. **docs/SUBMISSION.md §4** → delete the stale limits (#5–#8). Replace them with: unknown supply is held for one tap (Valio-confirmed); the cut-off is caught and the next day offered; menus plan on /request and in chat (product picks are estimates); "same words" only for the cases we test.
3. **docs/SUBMISSION.md Gemini** → "Flash-Lite parses requests and chat messages and writes explanations; the in-app agent's planner can run on Flash-Lite (opt-in); the deployed agent plans with a deterministic script." Name the chat router job.
4. **docs/SUBMISSION.md Exa/Context.dev** → resolve the two "ENTER?" notes. Exa: the Why drawer is "say it". The recipe-grounding bullet stays only if a CLAIMS row is observed; otherwise cut it.
5. **docs/CLAIMS.md** → one pass on the freeze build. Add rows for the contention split, the dock approve, chat events, the grounded-menu check and the calendar feed. Set MCP to 16 tools. Update the Labels row. Make app.mandate.kitchen the prod URL.
6. **MCP tool list** (lead decision, a code change) → hide `read_image` from outside agents until the Verda endpoint answers, or make sure it refuses with a plain message. Otherwise say nothing about Nemotron anywhere, and add D14 recording that `read_image` is wired but unclaimed (D7 still parks Nemotron).
7. **docs/handoff/README-draft.md** → promote it to the root `README.md` (the root file is still the old "Hackathon repo" stub). Apply #5, #15–#17. Add "Gemini 3.8 Flash proposes menus" to the architecture lines and "the chef can also approve from the chat dock" to the tour.
8. **docs/PITCH.md** → apply #12 and #13. Add the wow beat (ham taken by another kitchen → split → Vataja held → sign-off → void diff) to the demo table as `[ ]`, marked to observe before the video.
9. **site/public/how** → change the approval sentence to "A person approves, in Kitchen or from the chat dock's decision card, bound to the exact terms; no agent, key or model can approve." Add the 3.8 Flash menu job to the LLM port box.
10. **docs/concept/ARCHITECTURE.md** → add `read_image` to the tool table (18) and `image.read` (Verda, not live) to the model table; change "Implements D3–D12" to D13; add the `/api/calendar/[kitchen].ics` and `/kitchen-api/calendar.ics` routes.
11. **CLAUDE.md** → rule 6 "The app uses Gemini only" is stale: name `gemini-3.8-flash` (menus) and Verda Nemotron (`read_image`, wired, not live). Add `/agents`, `/api/chat/*` and `/api/calendar/*` to the routes list.
12. **docs/foundations/deploy.md:123** → "migrations through `0002`" should be `0004`, matching STATUS and ARCHITECTURE.
13. **docs/STATUS.md** → rewrite for Ring 4: the current prod SHA; what landed after `70c30e2` (≥999999, D13, chat events, grounded menus, contention wow, calendar, read_image); "~420" → 669.
14. **docs/concept/SCORECARD.md** → the status column is from `0623b19`: "/agents on a branch", "cut-off at commit open (F9)", "open menus not yet (A4)". Refresh it, or point to this file.

## Scorecard (Valio weights; 1–5, from docs and code, not from prod)
| Criterion (w) | Score | Evidence | Gap |
|---|---|---|---|
| End-to-end demo (30) | 4 | /request milk request → lookup → order → approval; buffet approve → one receipt (`kitchen-order.e2e.ts`, prod); menu → plan on prod | Nothing has been re-observed since `81c3fb7`/D13; the wow is unobserved; the video isn't made yet |
| User need (20) | 3.5 | g/guest → packs with unit bases; lactose-free survives parse and substitutes; cut-off and off-day caught; event brief → menu | Chat and /request give different baskets for the same words (BUGS Ugly); the ham shows 27 kg vs 19.5 kg bases; Graavilohi lot overbuy; weak menu picks |
| Autonomy and controls (20) | 4.5 | Mandate tiers as data; terms-hash approval; per-reason groups; hard limit; per-line authority; op log with actor and door; judge keys never approve | After ≥999999, almost nothing is ordered alone in the demo. Show one known-stock line going through alone, or the autonomy story looks thin |
| Robustness (15) | 4 | Outages, supply-tier ranking, make in house (D8a), lots, cut-off, off-day, contention re-rescue, idempotency race on prod | Partial delivery is simulated only; the recall is a drill; the contention wow isn't on screen yet |
| Openness and path (15) | 4 | MCP + REST + OpenAPI from one registry; labels; PRIVACY; DECISIONS; /proof with test links; a pilot named | The README isn't promoted; the public-repo scrub (history squash in PLAN) isn't done; `read_image` is exposed while dead |
| Rules and bonus | — | Not a chatbot: the Kitchen task page is primary and chat is a dock. "Query APIs only when needed": cache-through for shortlisted products, 15 min TTL (`pg.ts:51`) | Bonus: the ranking already weighs carbon, reliability and organic/Finnish labels (`rank.ts:99`), but SUBMISSION never says so, and the UI shows "rel 1.00 · 10.1 kg CO₂e/kg" on every candidate (BUGS). Add one labelled sentence; fix or hide the placeholder look |

Weighted ≈ 4.0/5. STATUS self-scores 3.4.

## Cut list (archive before the repo goes public)
- **docs/review/** (ROUND7–9, 824 lines): superseded by handoff/ring3 and archive → `docs/archive/review/`.
- **docs/lanes/** (8 briefs, 438 lines): Ring 1–2 lane briefs; the tracks now live in DISPATCH → `docs/archive/lanes/`.
- **docs/handoff/** `review-adversarial-r9.md`, `ui-mockset-to-prod.md`, `memory-and-tenancy.md`, and after the freeze `ring3/` → archive. Keep `README.md` and `ring4/`.
- **docs/PLAN.md** "Now (Sat 14 Nov)": every line is stale (Integration 1–3, the 22:00 video checkpoint). Keep only "Land (Sunday)".
- **docs/foundations/models.md** §2–§5 (Gemma swarm, Verda GPU prices, the Nemotron eval ladder): parked work. Cut to §1 plus one line.
- **docs/concept/SCORECARD.md** parked tech rows (Modal, Verda, Cloudinary, Gemma, AfterQuery): one line, "parked (D7)".
- **docs/roadmap/** is gitignored but holds `__pycache__/`: no repo impact; ignore.
- **Root README.md**: replace it with the README draft (fix 7).
- Before flipping public: `docs/event/challenges/*` now read `[REDACTED]` in the working tree, but PLAN's "squash history" step is still open. Check `git log -p` for the Valio key before publishing.
