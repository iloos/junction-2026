# Lane: agent-door (proposal, for the lead to assign)

**Branch:** `lane/agent-door` · **Worktree:** `../junc26-lanes/agent-door` · **Dev port:** 517N · **Owner:** unassigned

## Goal (one sentence, user-visible)
An outside agent completes Valio's milk example through MCP with no Mandate UI except one approval link, and a judge can see how to connect on one page.

## Context to read first (≤4 files)
- docs/concept/SURFACES.md §1 (agent door is a main door), §6.1, §6.4
- docs/event/challenges/main/valio-aimo--trusted-trade-agents.md (Openness 15, E2E 30)
- src/lib/core/contracts/tools.ts, src/lib/server/tools/serve.ts, src/lib/server/tools/mcp.ts

## Owned paths (only these may be edited)
- src/routes/agents/** (new page)
- src/routes/approve/[approvalId]/** (new phone page)
- src/lib/server/tools/present.ts (new: tool-result summaries)
- tests for the above

## Contracts used (read-only; fixtures exist)
- Tool outputs and `LineView.nextAction` (core/contracts/plan.ts); approvals bound to version + terms hash.

## Tasks (small; each one ends in a commit)
- [ ] Every tool result over MCP/REST also carries `summary` (consequences first, in words), `state`, `nextAction` and, when held, `approvalUrl`. Add them in one presenter beside `serveTool`; the structured payload is unchanged. Refusals stay structured (`code`, `retryable`, `why`).
- [ ] `/approve/<approvalId>`: phone-first, consequences first (what, why outside the mandate, total, delivery, what stays unsupplied); "Review → Confirm exact terms" and hold; hash and versions collapsed; stale → changed fields highlighted. It reuses the kitchen's approval component, not a second one.
- [ ] `/agents`: MCP URL with copy + QR, tool list from the registry, `/api/openapi.json`, a 6-line sample transcript, the assumptions (simulated commitment, scenario clock), "agents can't approve: this is what the human sees".
- [ ] A scripted MCP client test: search → quote → place_order → `pending` with `approvalUrl` → approve as chef → commit → receipt.

## Acceptance (observable)
- [ ] The milk example through the MCP client ends with a receipt, with the human step only on `/approve/<id>`
- [ ] `/agents` and `/approve/<id>` at 390 px and 1440 px (Playwright screenshots in `scratch/`)
- [ ] `pnpm check`, `pnpm test:unit`, `pnpm eval` pass; works with `LLM_PROVIDER=fixture`

## Out of scope
MCP App rendering inside Claude (D6); new tools; auth changes beyond what approval already needs.

## Needs (requests to the lead; keep working on the fixture meanwhile)
- Which actor may open `/approve/<id>` in the public demo (the presenter gate from 9aa01d4 or the judge sandbox).
