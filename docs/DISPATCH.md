# DISPATCH

_Live tracks and seams. The lead rewrites this at each checkpoint. Ring 3 plan and reasons: [handoff/ring3/SYNTHESIS.md](handoff/ring3/SYNTHESIS.md). Rings 1–2: [archive/DISPATCH-ring1-2.md](archive/DISPATCH-ring1-2.md)._

## How a track works
One session or lead agent per track, in its own worktree and branch, editing only its owned paths. It runs `pnpm gate` (dev servers with `DATABASE_URL=` blank), sends the lead a SHA, and the lead merges to `main`, gates, pushes and asks 9c to deploy. Bugs before features; every UI change is seen at 1440 and 390 px.

## Ring 3: land the hero path, make it act, tell the truth (until the Sun 06:00 freeze)
| Track | Owner | Now, in order |
|---|---|---|
| Core | 8d | rebase `lane/a-atp` (ATP, Valio traces, `nextActionFor`, served basis) · core `change_date` + approved-held → commit · **the wow**: contention → re-rescue → split → sign-off → voided diff |
| Kitchen UI | 1f | the dock pill off the action buttons · in-place approval link + open-tasks switcher · first screen before the click · Wave 1 #1 dish sentence, #7 counts, #8 consequence titles, #2 chat turn · render the wow |
| Ops + deploy | 9c | `onCurrentRun` refresh (M2) · Wave 1 #3 cases, #5 Engine room, #4 case story · Ops order and names · deploys with `SMOKE_UI=1`, rollback via branch `rollback` |
| Agent + chat | lead agent E | server-owned idempotency keys · understanding guard · one claim checker · task-id helper · chat on scoped handlers · `/api/agent/run` in scope · chat answers from ledger counts, no raw ids · CHAT-add-item, CHAT-two-items · switch to core `nextActionFor` |
| Request + menu | lead agent B | resolver category guards (fish ≠ poultry, no meat in vegetarian, spices) · menu progress · `/request` polish |
| Sponsors | lead agent D | Gemini text calls through `external/` with trace + cap · `propose_menu` traced |
| Evals, claims | 91 | PITCH/CLAIMS truth pass · README tour checked on prod · prod re-test per deploy · gate without `data/valio/` |
| Design | design session | judge README draft · Wave 1 acceptance criteria · Wave 2 mocks (memory, forecast) |
| Lead | lead | merges, gate, `withCallScope` at every door, dead stub code out, submission texts, ARCHITECTURE and CLAUDE.md refresh, five-second rule as a hard rule, archive stale docs |

## Seams (one owner each)
- **Contracts** (`src/lib/core/contracts`): lead; contract edits come as their own commit and are approved before merge.
- **Call scope** (`src/lib/server/scope.ts`, `tools/handlers.ts`): lead. Every door enters `withCallScope` or `serveTool`.
- **Next action**: core `nextActionFor` (8d) is the one rule; the agent, ledger, MCP meta and Kitchen read it.
- **Words**: [concept/VOCABULARY.md](concept/VOCABULARY.md) (D10); "supplier confirmed" only with a receipt.
- **Models**: per job in `adapters/llm/router.ts` (D12).

## Order of landing
1. Seams and guarantees (B1), deployed and re-tested on prod.
2. Hero path dramatic and safe (B2): the wow, the first screen, Wave 1.
3. Truth, docs, submission (B3), in parallel from now.
4. Wave 2 only after 1–2 are deployed and checked.
5. Last stretch before 06:00: fixes, video, rehearsal; tag; no redeploy in the last 30 minutes.

## Held
SetMandate op (after the hackathon; don't claim mandate history) · Kitchen layout restructure (B's deltas only) · new dependencies · forecast/demand tabs and the product sheet until Wave 2.
