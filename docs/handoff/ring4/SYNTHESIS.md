# Ring 4 synthesis: hold the guarantees, close the seams, tell the truth

_Lead, Sat 14 Nov evening. Inputs: [review-code](review-code.md), [review-docs](review-docs.md), lane self-reviews (each brief's "Self-review"), 91's prod re-tests, the user's prod sessions, Valio's mentor answers (DECISIONS D6 amendment). Freeze Sun 06:00; the last stretch is fixes, video and rehearsal._

## Where we stand
- **Guarantees hold and are stronger than at Ring 3:** a run fence under the workspace lock; every `serveTool` call re-reads the current run; per-key limits for outside agents; refusals in the op log; server-owned idempotency keys; one task-id helper and one next-action rule in core; chat in `withCallScope`; D13 (the chef approves in the dock through the Kitchen command; no agent, key or model can approve). The adversarial suite has 2 open cases (D's web durability).
- **Valio's answers changed semantics:** ≥999999 = unknown (milk now needs one tap), lot 0.01 → 1, a 429 pauses 30 s. D8a keeps lanttulaatikko made in house from orderable ingredients. The wow (another kitchen takes the ham) splits to a known-stock Finnish ham, one tap.
- **Product:** the Kitchen in compact rows with one status per dish, What changed, adaptive titles; chat handles events, product and mandate questions, and the continue loop is gone; grounded menus; the calendar feed; the service status; mandate.kitchen with recorded case cards; app.mandate.kitchen as the app.
- **Docs lag the code** in both directions (SUBMISSION over-claims the LLM planner, under-claims menu → plan and the cut-off; the site's milk card predates the ≥999999 change); CLAIMS lacks rows for the newest work.
- **Seams slipped again:** due time computed three ways; op sentences four times (now one in Ops; /agents to follow); product names and money formatted inconsistently; the dock's second store can move the page's plan (M1, the D13 demo path).

## Decisions
- `read_image` is listed to outside agents only when the vision endpoint is live (`VISION_LIVE=1`); the tool stays in the registry.
- Kitchen layout A/B is closed: keep the in-app redesign; carry over at most five details from the mocks.
- Approver notifications are out of scope (the chef orders; sign-off stays a mandate tier). The calendar feed is in.
- valo-basket stays held off main until the user, the lead and Valio agree; real VALO prices in its fixtures become placeholders before the repo goes public.
- The Ops Orders tab (asked → proposed → signed → ordered) is the next Ops surface and doubles as the approval and supplier view.

## Work, by owner (in order)
- **1f:** M1 pin the page's plan; rebase the density pass + adaptive titles + menu card + calendar link; readable names and one money formatter; the substring approve guard.
- **9c:** the Orders tab (core `orderStages` + list + stage diff), then its approval surface, then the supplier view.
- **8d:** basekey + substitute kinds (contract on its branch); one `dueOf` in core.
- **D:** web routes through the gate (M4); the grounding cache keyed per ingredients and traced (M5).
- **da:** /agents passes the no-raw-ids sweep; opSummary as the one source.
- **91:** CLAIMS rows for the newest work on the freeze build; narrow "usual products go through"; one visible "goes through alone" line; the full prod re-test; d0 re-records the site cards after it.
- **d0:** /story polish; re-record cards on the freeze build; Usual order / forecast pages brief once the user picks the history policy.
- **Lead:** merges and gates; the docs truth pass (SUBMISSION, README, ARCHITECTURE, deploy.md, CLAUDE.md rule 6); the comment sweep near the freeze; the history rewrite and the prices placeholder before going public.

## Before the freeze (must)
The race smoke with `SMOKE_KEY` (needs the user); the visitor gate on a production build; the three UI e2es against prod; the video from a recorded run on the freeze build; tag; no redeploy in the last 30 minutes.
