# Stack

Chosen for: least overhead, fast iteration, impressive UI at scale, and one deployable service. Versions checked 13 Nov 2026.

| Layer | Pick | Why / note |
|---|---|---|
| Framework | **SvelteKit 2.70** + Svelte 5.57 (runes) + Vite 8, scaffolded with `sv@0.17.1` | `+server.ts` API routes keep the LLM proxy and keys in the same app. Kit 2 is what coding agents know best (D0). |
| Adapter | **`@sveltejs/adapter-node@^5`** (5.5.8; v6 needs Kit 3) + two-stage Dockerfile (D3) | One container on Aiven Runtime, fallback a Verda VM. Not Vercel. TypeScript is pinned ^6 (Kit 2 peers). |
| Styling | Tailwind 4.3 (`@tailwindcss/vite`) | No config file needed; tokens as CSS vars in `app.css`. |
| Components | **bits-ui 2.21** (headless) | Low overhead. Pull in **shadcn-svelte** only for the boring parts (dialog, command palette, sheet, tabs, sonner). |
| Icons / toasts / util | `@lucide/svelte`, `svelte-sonner`, `runed`, `mode-watcher` | |
| 2D viz | **d3 7.9** for the maths (scales, force, hierarchy, zoom), Svelte renders the SVG | Canvas for >5k marks. `layerchart` 2.x if we want ready Svelte charts. ECharts 6 for dense time series (pass ids, never objects). |
| 3D hero (optional) | `3d-force-graph` 1.80 (fastest, WebGL, 50k+ nodes) or **Threlte 8** (`@threlte/core` + `three` 0.187) | Only behind a 1-hour spike Fri night with 50k dummy nodes. Keep only if it shows something 2D can't. |
| Graph (2D) | `@xyflow/svelte` 1.7 (node editors), `sigma` 4 + `graphology` (big graphs), `@cosmos.gl/graph` 3.6 (GPU, 1M points) | |
| Large lists | `@tanstack/svelte-virtual` 3.13 | |
| In-browser data engine | **duckdb-wasm** (+ Mosaic for linked views, or Perspective for pivot grids) | Millions of rows client-side, with no DB server. The agent writes SQL as a tool. See [BUILDING-BLOCKS.md](BUILDING-BLOCKS.md). |
| Chat UI | **Svelte AI Elements** (shadcn-svelte port) on `@ai-sdk/svelte` | Message, tool-call and reasoning components. Note: it targets `ai` v6 / `@ai-sdk/svelte` 4; either pin those or adapt the components to v7 (spike for 20 min, then pick). |
| Validation | **zod 4.6** | One `schemas.ts`; validate on storage read and on every LLM structured output. |
| Persistence | **Postgres** via Drizzle 0.45 + `postgres` 4.1 (Aiven Hobbyist, PG 18, pgvector); **PGlite 0.5** (+ `@electric-sql/pglite-pgvector`) as the fixture, booted from a snapshot; `localStorage` only for UI prefs (D3) | Op log table with `seq` cursor; NOTIFY → SSE for live views. See [foundations/data.md](foundations/data.md). |
| LLM | Vercel `ai` 7 + `@ai-sdk/openai-compatible` (Gemma on Featherless, Nemotron on Verda/NVIDIA Build when keyed); **`@google/genai` 3.3** for the Gemini Decisions API (`gemini-decision-1`, v1beta) and flash-lite structured output | Behind `LlmPort` / `DecidePort` (D5). Send images as bytes, not URLs. See [foundations/gemini.md](foundations/gemini.md), [foundations/models.md](foundations/models.md). |
| Search / data | Valio mock API (cache-through + our simulator), Context.dev (`context.dev` SDK), Exa (`exa-js`), OpenStreetMap venues, Finnish open data (holidays, FMI, Linked Events, Jamix menus) | Behind `CatalogPort` / `WebPort`, each with a fixture. See [foundations/valio-data.md](foundations/valio-data.md), [research/horeca-profiles.md](research/horeca-profiles.md). |
| Heavy compute | **Modal** (Python, `jobs/modal/`, uv project) | Catalogue normalisation/enrichment fan-out, Lab episodes, swarm, Sandboxes; results come back through our API. See [foundations/modal.md](foundations/modal.md). |
| MCP | **`@modelcontextprotocol/server` / `client` 2.4** (v2; not the v1 `sdk` package), `createMcpHandler` in a stateless `+server.ts`; MCP Apps `ext-apps` 2.0.4 for the approval card (stretch); `zod-openapi` 6 for `/openapi.json` | One tool registry → MCP + REST + OpenAPI; scoped bearer keys (judges get a key in the URL path). See [foundations/mcp.md](foundations/mcp.md). |
| Tests | vitest (core only), Playwright 1.64 (one smoke e2e + perf/heap check) | Tests are offline: fixture LLM. |
| Package manager | pnpm | |

## Folder shape (single app, no monorepo)

```
src/
  lib/
    core/        pure TS: model, ops (applyOps), transforms, generators. No Svelte/DOM/SDK.
    ports/       interfaces: LlmPort, StoragePort, SearchPort, DataPort (+ fakes/fixtures)
    server/      real adapters that need secrets: gemini, models (openai-compatible), valio, contextdev, exa, db (postgres-js), modal
    adapters/    fixture adapters: pglite, valio simulator, decide-replay/rules, llm-fixture
    state/       *.svelte.ts rune classes ($state.raw for datasets)
    agent/       tool registry, turn loop client, NDJSON event stream reader
    viz/         d3 helpers, chart/graph components
    components/  ui (bits-ui/shadcn wrappers)
  routes/
    api/agent/+server.ts   streams NDJSON: {type: step|text|tool|ops|done|error}
    api/data/...           REST-ish resources behind the ports
    mcp/+server.ts         (stretch) MCP endpoint over our ops
fixtures/        recorded LLM/search responses for offline demo
scripts/         gen-data (seeded faker, --n), replay
docs/
```

Dependency direction: `routes → state/agent/viz → ports → core`. `core` imports nothing else. Add `dependency-cruiser` only if drift appears.

## General patterns (re-derive at the event; don't copy)
- **Agent loop:** a server route runs the tool loop and streams events (`step | text | tool | ops | done | error`) as NDJSON or via the `ai` SDK's UI stream. Tools return *proposed ops* plus a short summary, and the UI animates the change. Use user-selectable effort ("quick" / "think") instead of a router.
- **Hedged LLM call:** if no first token arrives within N seconds, fire a backup to the fallback model. Set a turn deadline. The fixture is the last resort.
- **Tracing:** a no-op-safe `trace()` / `span()` wrapper. A dev "trace" drawer in the UI is itself a wow moment ("see what the agent did").
- **Data at scale:** load large arrays into `$state.raw` and reassign them (deep proxies on big arrays cost seconds and gigabytes). Pass ids into charts and resolve them via a `Map`. Build indexes lazily, yield between chunks, and measure the heap in Playwright.
- **Hide, don't disable:** a control that does nothing in this view does not exist.

## Scaffold recipe (done: commit 091725f; adapter-node instead of vercel)

Remaining deps arrive with the contracts commit: zod, drizzle-orm, drizzle-kit, postgres, @electric-sql/pglite (+ pglite-pgvector), @google/genai, ai + @ai-sdk/openai-compatible, @modelcontextprotocol/server + client, zod-openapi, context.dev, exa-js, bits-ui, d3, @lucide/svelte. The historical recipe below is kept for reference only.

```powershell
# in the repo root (it already has docs/ and CLAUDE.md, so scaffold into a temp dir, then move the files up)
pnpm dlx sv@0.17.1 create scratch/app --template minimal --types ts   # 0.17.1 = last sv that scaffolds Kit 2 (1.x scaffolds Kit 3)
#   # add-ons: tailwindcss, prettier, eslint, vitest, playwright
# move scratch/app/* (incl. dotfiles) to the repo root, merge .gitignore, delete scratch/app
pnpm add -D @sveltejs/adapter-vercel@^6      # swap it into svelte.config.js (D0d)
# sanity check: pnpm list @sveltejs/kit  → 2.70.x
pnpm add bits-ui @lucide/svelte svelte-sonner runed mode-watcher zod dexie d3
pnpm add -D @types/d3
pnpm add ai @ai-sdk/svelte @ai-sdk/anthropic @ai-sdk/google @ai-sdk/openai-compatible
pnpm dlx shadcn-svelte@latest init            # optional, for boring components
# then deploy:  pnpm dlx vercel@latest --prod   (link the project, add env vars in the dashboard)
# as the idea needs it:
#   pnpm add @duckdb/duckdb-wasm  |  pnpm add @cosmos.gl/graph  |  pnpm add three 3d-force-graph  |  pnpm add embedding-atlas
#   pnpm add @modelcontextprotocol/sdk @modelcontextprotocol/ext-apps   (check peer versions)
# Modal (only if needed):  uv tool install modal; modal setup
```

First commit after scaffold: `.env.example`, ports with fixture adapters, `/api/agent` streaming a fixture, one route rendering generated data. Deploy it. Then branch out.
