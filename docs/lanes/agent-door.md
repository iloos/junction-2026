# Lane: agent-door

**Branch:** `agent-questions` (after `agent-door-hardening`, merged) · **Worktree:** `../junc26-lanes/agent-door` · **Dev port:** 5191 · **Owner:** lead-approved peer session

## Goal
An outside agent (Claude over MCP) and the in-app dock can both work for a chef inside the mandate: the outside one sees the rules before it acts and is metered; the dock answers what it used to refuse.

## Owned paths (granted by the lead for this lane)
- `src/lib/server/tools/{mcp,mcp-extras,key-limits,serve}.ts`, `src/lib/server/agent/get-context.ts`, `src/lib/server/agent/intents/**`
- `src/lib/server/chat/{question,outside}.ts` + small hooks in `chat/turn.ts`; `sources` on the `done` ChatEvent and its line in `ChatDock.svelte`
- `src/routes/agents/**`, `src/routes/.well-known/agent.json/**`
- Contract edits (`get_context`: `mandate`, `deliveryDays`) in their own commits for the lead.

## Done
- [x] Per-key limits for outside agents (120 calls, 30 writes, 20 quotes a minute; 429 `rate_limit` with Retry-After), off under vitest
- [x] `get_context` carries each kitchen's mandate and delivery days; web tools marked open-world; MCP errors name the next call
- [x] /agents: "Your agent's changes" live (SSE) in plain words; resources, prompts, agent card, `read_image` note when served
- [x] MCP resources `mandate://<kitchen>`, `decisions://open`; prompts: plan in mandate, open before cut-off, order for a receiving day
- [x] `/.well-known/agent.json` (A2A-ish card, documentation only)
- [x] Dock: mandate and product questions (recall, origin, allergens, facts), read-only allowlist, sources listed; fourth chip "Ask about a product"
- [x] Shortage repair: `find_outside` for unresolved needs, labelled "For your information; not orderable here"

## Report: self-review (Ring 4 checkpoint)
1. **Solid:** the gate is untouched in spirit (limits and answers sit in front of `serveTool`; question answers can only call four read tools, tested to never plan/order/commit or save a task); /agents panel and dock answers seen live at 1440 and 390 px.
2. **Fragile:** `readQuestion` is regex: phrasing outside its words falls through to the plan agent as before (safe, but a missed answer); product pick depends on /request's lexicon or a whole-word name match, so a brand-only question ("Oltermanni") may ask "which product?".
3. **Untested live:** `check_recall` and `lookup_facts` answers on prod data (fixture mode had no notices or facts, so the Sources line was not seen with real links); `find_outside` after a real shortage repair (unit-tested with a stub only); the per-key limits on prod (in-process windows: per container, reset on restart).
4. **Known gap:** limits are per process; with more than one container a key gets N× the budget. Fine for one container (D3).
5. **One hour before 06:00:** run a recall question and a shortage repair on prod with `LLM_PROVIDER=gemini` and the live web, screenshot the Sources line; add `read_image` to the agent card notes once it is on main; one e2e that the dock never shows a raw id in an answer.

## Resume
- **Branch:** `agent-questions` · **Head:** see the reply to the lead (gate run on the rebased head) · base `origin/main` ad7675e
- **Next 3:**
  1. Prod walk of the dock questions and an MCP session against the deployed build (resources/prompts visible after `/mcp` reconnect).
  2. Recall/facts answers with real Sources on prod; tune wording if a notice title is long.
  3. Agent benchmark prep (user idea): same questions to plain Claude, Claude + web MCPs, Claude + Mandate MCP; time, review effort, accuracy.
