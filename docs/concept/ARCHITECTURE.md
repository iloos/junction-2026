# ARCHITECTURE

_Written after CONCEPT.md, before fan-out. The contracts named here get committed to `main` by the lead before any lane starts._

## Shape
```
browser: routes → state (*.svelte.ts) → viz / agent UI
                    ↓ applyOps
                  core (pure TS: types, ops, transforms)
                    ↓ ports
adapters: storage (Dexie/localStorage) · llm (anthropic/google/featherless/verda/fixture) · data (sponsor APIs/fixture)
server:  /api/agent (tool loop, streams events) · /api/<x> · /mcp (stretch)
```

## Data model (core/types.ts)
Entities, ids, relations. **Closed** sets of kinds. Each field exists because something reads it.

## Ops (core/ops.ts)
`applyOps(state, ops) → state`. The list of op kinds, and who emits each one (UI, agent tool, import).

## Ports (ports/*.ts)
| Port | Methods | Real adapter | Fixture |
|---|---|---|---|

## Agent
- Tools (name → op(s) it proposes / data it reads):
- Model routing (per job), step cap, deadline, fallback:
- Event stream: `step | text | tool | ops | done | error`

## API routes
| Route | In | Out | Lane |
|---|---|---|---|

## Performance budget
Demo N = … · stress 10N = … · first paint < 1.5s · interaction < 100ms at N · heap < … at 10N.

## Lanes
| Lane | Goal | Owned paths | Depends on (fixtures) | Port |
|---|---|---|---|---|
| data | | | | 5171 |
| agent | | | | 5172 |
| viz | | | | 5173 |
| shell | | | | 5174 |
