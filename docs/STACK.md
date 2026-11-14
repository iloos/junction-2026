# Stack

Chosen for: least overhead, fast iteration, impressive UI at scale, and one deployable service. Installed versions: `package.json`.

| Layer | Pick | Why / note |
|---|---|---|
| Framework | **SvelteKit 2** + Svelte 5 (runes) + Vite 8, TypeScript 6 | `+server.ts` routes keep keys and model calls server-side. Kit 2 is what coding agents know best (D0). |
| Adapter | **`@sveltejs/adapter-node@^5`** (v6 needs Kit 3) + two-stage Dockerfile (D3) | One container on Aiven Runtime, fallback a Verda VM. Not Vercel. See [foundations/deploy.md](foundations/deploy.md). |
| Styling and components | Tailwind 4 (`@tailwindcss/vite`), **bits-ui** (headless), `@lucide/svelte` | Tokens as CSS vars in `app.css`. |
| Viz | **d3** (+ `d3-transition`) for the maths, Svelte renders the SVG | Charts get explicit heights; pass ids, not objects. |
| Validation | **zod 4** | Contracts in `core/contracts/`; validate tool input, storage reads and every model output. |
| Persistence | **Postgres** via Drizzle 0.45 + `postgres` (Aiven, pgvector); **PGlite** (+ pgvector) as the fixture for tests, evals and offline | Op log with a per-workspace `seq`; NOTIFY → SSE. See [foundations/data.md](foundations/data.md). |
| LLM | **`@google/genai`** for Gemini Decisions (`gemini-decision-1`) and Flash-Lite; `ai` + `@ai-sdk/openai-compatible` for Featherless Gemma | Behind the Decide and Llm ports, each with replay/fixture fallbacks. See [foundations/gemini.md](foundations/gemini.md), [foundations/models.md](foundations/models.md). |
| Web data | Exa and Context.dev over plain `fetch` (no SDKs), cached, with spend caps | Behind the Web port with a fixture. See [foundations/web.md](foundations/web.md). |
| Catalogue | Valio mock API (cache-through + our simulator) and the Valio datasets in `data/valio/` (gitignored) | See [foundations/valio-data.md](foundations/valio-data.md). |
| MCP | **`@modelcontextprotocol/server` 2.4** (`createMcpHandler`, stateless) + `zod-openapi` for `/api/openapi.json` | One tool registry → MCP + REST + OpenAPI; scoped bearer keys or a key in the path. See [foundations/mcp.md](foundations/mcp.md). |
| Tests | vitest (server + client projects), Playwright | Offline by default: fixture LLM, PGlite. Opt-in live and Postgres suites (CLAUDE.md Commands). |
| Package manager | pnpm | |

Considered and not installed: shadcn-svelte, duckdb-wasm, three.js/Threlte, Svelte AI Elements, Modal jobs ([archive/prep/foundations/modal.md](archive/prep/foundations/modal.md)). Options and libraries: [BUILDING-BLOCKS.md](BUILDING-BLOCKS.md).

## Folder shape (single app, no monorepo)

```
src/
  lib/
    core/          pure TS: contracts/ (zod types + tool registry), ports.ts, state.ts (applyOps), hash.ts, scenario.ts,
                   demand/ (event and direct needs, rounding, factors), mandate/ (tiers, validation, views, fulfilment),
                   rank/ (supply tier, then weighted score), services/ (one handler per tool)
    server/        everything with secrets or I/O: adapters/ (catalog, decide, llm, simulator), agent/, auth/, bus/,
                   db/, demo/, evals/, kitchen/, menu/, request/, store/, tools/, web/ (map: concept/ARCHITECTURE.md)
    kitchen/       Kitchen screen client: live and fixture backends, view model (*.svelte.ts)
    ui/            shared components (Why drawer, coverage bar, state chips, hold button), request/, viz/
  routes/
    (kitchen)/     / (Kitchen screen), /offline, /kitchen-api/{snapshot,scenario,tool/[name]}
    request/       /request (Valio's request → lookup → order flow)
    ops/           /ops control room
    api/           tools/[name], openapi.json, events (SSE), request, agent/run, web/*, demo/*
    mcp/           /mcp and /mcp/k/[key]
    healthz/
evals/           scenarios/, agent/, fidelity/, retrieval/ + the runner (run.ts, check.ts); see evals/README.md
fixtures/        seeds/ (kitchens, Christmas buffet, calendar factors), views/ (generated read models)
drizzle/         SQL migrations
scripts/         db-migrate, seed-db, merge-gate, test-pg, smoke-race, lane-setup; deploy/, probe/ (Valio), venues/, web/
```

Dependency direction: `routes → lib/server → lib/core`; `lib/kitchen` and `lib/ui` import from `core` (contracts, hash, scenario), never from `lib/server`. `core` imports nothing else (lint-enforced).

## General patterns (re-derive at the event; don't copy)
- **Agent loop:** a server route runs the tool loop and streams events (`step | text | tool | ops | done | error`) as NDJSON or via the `ai` SDK's UI stream. Tools return *proposed ops* plus a short summary, and the UI animates the change. Use user-selectable effort ("quick" / "think") instead of a router.
- **Hedged LLM call:** if no first token arrives within N seconds, fire a backup to the fallback model. Set a turn deadline. The fixture is the last resort.
- **Tracing:** a no-op-safe `trace()` / `span()` wrapper. A dev "trace" drawer in the UI is itself a wow moment ("see what the agent did").
- **Data at scale:** load large arrays into `$state.raw` and reassign them (deep proxies on big arrays cost seconds and gigabytes). Pass ids into charts and resolve them via a `Map`. Build indexes lazily, yield between chunks, and measure the heap in Playwright.
- **Hide, don't disable:** a control that does nothing in this view does not exist.
