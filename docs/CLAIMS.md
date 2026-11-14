# CLAIMS

_The claim ledger for the video and the stage. Every sentence in [PITCH.md](PITCH.md) that asserts behaviour has a row here: the evidence, where it was **observed** (a test or eval green on main, or a run on the deployed app), and a verdict. Owner: Track F (session 91). Rewritten when main or prod changes; the PITCH table points here._

**Verdicts:** **say it** (observed on main and on prod) · **say it, tests** (green on main; prod not observed for this claim) · **narrow it** (true only with the stated limit) · **not yet** (don't say it).
**Last pass:** Sat 14 Nov, main `6f0ca7a`; prod runs main `ab3a557` (Aiven commit_sha, confirmed by 9c), `pnpm gate` green (check, lint, eval self-tests, build, unit ×~420, eval, eval:agent). Prod = https://widely-many-scorpion.eur-1.aiven.app; `/healthz` ok, db ok, TLS verified. `/healthz` does not report the deployed commit, so a prod row says what was observed there and when, not which sha.

## Provable now (PITCH table)
| Claim | Evidence | Observed | Verdict |
|---|---|---|---|
| Approval is bound to the exact terms | `server/store/gate.test.ts`, `view.test.ts`; eval s4 (price change → `TERMS_CHANGED`) | main | say it, tests |
| A hard limit no approval can pass | `server/store/ceiling.test.ts` (split lines included) | main | say it, tests |
| No double orders | evals s1, s5; `pg-race.test.ts` (`pnpm test:pg`); `scripts/smoke-race.mjs` on prod | **prod, this pass:** same key ×4 → one receipt; three keys → one receipt, two refused `STALE_VERSION` | say it |
| Never auto-orders over its caps, even split | eval s5 (`CAP_EXCEEDED.weekly`) | main | say it, tests |
| Below a lot step is unorderable | eval s3 | main | say it, tests |
| Unknown supply never counts as cover; known stock ranks first | `core/rank/rank.ts`, `server/store/pool.test.ts`, `core/mandate/fulfilment.test.ts`; eval surfaces (FulfilmentView = Kitchen dish status) | main | say it, tests. Ops still counts coverage from line states (F12-ops, 9c): don't point at Ops numbers for this until that lands |
| Each committed line names what allowed it | `server/store/authority.test.ts` | main | say it, tests |
| Edits after a rescue re-plan; any edit voids the approval | `server/store/rescue.test.ts`, `core/state.test.ts`; eval r6-5 (`lastVoided` shows what changed) | main | say it, tests |
| Physical amounts, not pack counts | `server/store/direct.test.ts`; eval r5-f10; fidelity `butter-grams-weekday` | main | say it, tests |
| The same words give the same basket through `/request`, the agent and REST | `evals/fidelity` (5 cases × 3 entries), `evals/paraphrase` (EN/FI, 3 order intents) | main, with known gaps | **narrow it**: say "for the cases we test, in English and Finnish". Open: the agent picks an undeliverable product for "4 kg butter tomorrow" (A3-agent-cutoff, E); a mid-sentence "lactose free" is dropped by the rules parser (P1, B); "vispikermaa" is unknown (P2, B) |
| Outside agents get the same tools over MCP and REST and can never approve | `SCOPES_BY_ACTOR`; `agent/adversarial.test.ts`; eval s5 | **prod, this pass:** a judge key minted in its own sandbox reads `get_context` (200); `approve` and `set_mandate` → 403 `FORBIDDEN` (needs scope approve / mandate:write); no key → 401 | say it |
| Every visitor gets their own sandbox; a judge key works only there | `server/demo/{visitor,judge-key,sandbox}.test.ts`; `routes/ops/visitor-gate.e2e.ts` | **prod `ab3a557`, this pass:** the visitor gate passed against prod (see the journey below) | say it |
| Gemini Decisions scores recipe fit, with replay and rules fallbacks | `server/adapters/decide`; `DECIDE_LIVE=1 pnpm test:live` | live call not re-run this pass | narrow it: "ranks with Gemini Decisions and falls back to rules"; no "recipe-aware" (no labelled fit set has run) |
| Valio's milk example runs on `/request`, keeping "lactose-free" | `server/request/fixes.test.ts`, `request.test.ts`; fidelity `lactose-free-milk-2l` | main; prod `/request` 200 | say it, tests. Phrase it as typed ("lactose-free milk"); see P1 for other word orders |

## Deployed journey: two browsers + an outside agent (prod `ab3a557`)
Recorded Sat 14 Nov against https://widely-many-scorpion.eur-1.aiven.app. Trace, screenshots and the MCP log are in `scratch/claims/` (gitignored; the lead copies what the video needs).
- **Two browsers, REST agent, stranger, forged cookies:** `GATE_URL=<prod> npx playwright test -c scripts/deploy/pw-gate.config.ts --trace on` passed (1/1, 23 s). A plans the buffet, and A's Ops shows its own sandbox (`ws-j-…`): 14 held, 3 can't be ordered, quoted €933.92. B is in a different `ws-j-…` with an empty queue. B can't read A's stream (403), approve A (403) or reset A. An outside agent on A's judge key orders into A's sandbox and current run, can't approve (403), and a tampered key gets 401. A stranger opening A's deep link lands in their own sandbox and can't approve. Forged visitor/room cookies select nothing of A's. Each reset changes only its own sandbox.
- **MCP:** a fresh visitor's judge key on `/mcp/k/<key>`: `initialize` 200; `tools/list` gives 13 tools, **without `approve` or `set_mandate`**; `get_context` shows `external_agent`, scopes read/plan/order, its own workspace; `place_order` (30 ST `464201`, k-hotel, Fri 11 Dec) gives a **held** plan in that sandbox; `approve` → "Tool approve not found".
- Not covered by this run: a commit by the outside agent within the mandate, and a stale commit refused over MCP (tests only).

## Moved since PITCH was written (lead: update "Not yet claimable")
| Was "not yet" | Now | Evidence | Verdict |
|---|---|---|---|
| Cut-off enforced at commit (F9) | merged (A3) | `server/store/cutoff.test.ts`; eval r5-f9 (Terminal refused, Stock commits) | say it, tests (prod after the next deploy) |
| Before → after diff of a voided approval | served (`get_plan.lastVoided`) | eval r6-5 | say it, tests; on screen only if the Kitchen shows it at the video pass |
| Decide per reason group | merged | `server/store/groups.test.ts` (a grant never covers a line it did not list) | say it, tests |
| Agent door page `/agents` | on main and on prod | prod `/agents` 200; judge key minted (above) | say it |
| Review mechanism | on main, **off** (`REVIEW=1`) | `server/review/` | not yet: say nothing about review improving answers until the on/off arms run (`eval:live`, F) |

## Still not yet
Open menus to a plan (A4) · "ordered the buffet" (the agent plans and holds) · Exa in a judge-facing view · Context.dev "a real recall hit our orders" or "within minutes" · a stale external commit refused on prod over MCP (tests only) · simulator events in the kitchen's own workspace · data residency (never, D5) · chat (Ring 2: evals scaffolded, `evals/chat`, entry not built).

## Demo beats (to observe on prod before the video)
Each beat is said only after it is seen on the deployed app, with a screenshot in `scratch/claims/` and the time noted here.
| Beat | What must be on screen | Observed |
|---|---|---|
| The problem | ham `462490` and lanttulaatikko `462482` out; "Valio challenge mock: fetched/cached T" label | not yet |
| Thinks like a chef | g/guest edit → packs with unit bases; coverage ruler per dish | not yet |
| It refuses | a rejected candidate with its reason; Terminal labelled unknown stock | not yet |
| It's honest | ham → `476768` known-stock candidate; lanttulaatikko made in house; shortfall shown | not yet |
| Trust you can test | approve → commit → retry → one receipt; an edit voids the approval | race smoke on prod (above); the UI path not yet |
| The other side | the same held lines in Ops, in the visitor's own workspace | prod `ab3a557`: A's Ops in its own sandbox (`scratch/claims/gate-a-planned.png`) |
| Labels | scenario, local simulated commitment, simulated overlays, team estimate, assumption (the last two were missing at the last review) | not yet |

## Wording traps
- Never "confirmed" for anything without a receipt; Terminal lines are "ordered, awaiting supplier" (D10).
- "Ops shows why" is fine; "Ops shows the same coverage" waits for F12-ops.
- "In English and Finnish" only with "the cases we test"; the agent path still has the gaps above.
