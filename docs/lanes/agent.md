# Lane: agent

**Branch:** `lane/agent` · **Worktree:** `../junc26-lanes/agent` · **Dev port:** 5174

## Goal
The tool registry served as MCP + REST + OpenAPI with scoped keys; the routine agent plans the Christmas event in ≤8 traced steps; Gemini decisions with replay and rules fallbacks.

## What is where
- `src/lib/server/auth`: bearer key (header, or `/mcp/k/<key>`) → `CallContext`. Actor is never read from the body.
- `src/lib/server/tools`: `serveTool` (the one gate: input zod, scope, handler, output zod, HTTP mapping), `handlers.ts` (real core-db handlers on PGlite, stub fallback per unfinished tool and for `stub-*` ids), `mcp.ts`, `openapi.ts`.
- Routes: `POST /api/tools/[name]`, `GET /api/openapi.json`, `/mcp`, `/mcp/k/[key]`.
- `src/lib/server/adapters/decide`: `gemini-decision-1` → `replay.json` → rules. `adapters/llm`: Gemini Flash-Lite, Featherless Gemma (OpenAI-compatible), fixture. Both emit `trace` callbacks; `traceEvent()` turns them into `ServerEvent`s.
- `src/lib/server/agent`: `runRoutineAgent({goal, env, onEvent})` as `kitchen_agent`. Fixture mode plays a deterministic script; otherwise the LLM planner picks each tool call.

## Env names (values only in .env)
| Name | Use |
|---|---|
| `MANDATE_KEY_CHEF`, `MANDATE_KEY_KITCHEN_AGENT`, `MANDATE_KEY_EXTERNAL_AGENT`, `MANDATE_KEY_APPROVER` | one key per actor, ≥16 chars |
| `MCP_KEYS` | extra keys `label:actor:key,…` (e.g. one external_agent key per judge) |
| `MANDATE_WORKSPACE`, `MANDATE_RUN` | default `ws-demo`, `run-1` |
| `MANDATE_FIXTURE_KEYS=1` | enable the public `fx-chef`, `fx-kitchen-agent`, `fx-external-agent`, `fx-approver` keys outside dev (never on a public deploy) |
| `GEMINI_STUDIO_API_KEY` (or `GEMINI_API_KEY`) | Decisions + Flash-Lite |
| `FEATHERLESS_API_KEY`, `FEATHERLESS_MODEL` | Gemma via Featherless (default `google/gemma-4-E4B-it`) |
| `LLM_PROVIDER` | `fixture` (default, no network) \| `gemini` \| `featherless` |

## Try it
```sh
curl -s -X POST localhost:5174/mcp -H 'authorization: Bearer fx-external-agent' \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -H 'mcp-protocol-version: 2025-06-18' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
curl -s -X POST localhost:5174/api/tools/quote -H 'authorization: Bearer fx-external-agent' \
  -H 'content-type: application/json' -d '{"productIds":["464201","479999"]}'
```

## Needs
See the Report.

## Report
- Sat 01:40 · done: auth, serveTool, REST, OpenAPI, MCP, decide/llm adapters, agent loop · stubbed: plan_event, edit_line, find_substitutes, explain_line, set_mandate (until core-db slices land) · ready to merge: yes
