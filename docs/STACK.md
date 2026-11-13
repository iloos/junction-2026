# Stack

Chosen for: least overhead, fast iteration, impressive UI at scale, and one deployable service. Versions checked 13 Nov 2026.

| Layer | Pick | Why / note |
|---|---|---|
| Framework | **SvelteKit 3** (as `sv` 1.3 scaffolds it) + Svelte 5.57 (runes) + Vite 8 | `+server.ts` API routes keep the LLM proxy and keys in the same app. Kit 3 is new: look up surprises via context7. Fallback to Kit 2.70 per D0. |
| Adapter | **`adapter-vercel`** (D0d); fallback `adapter-node` on Fly | Deploy the empty scaffold at 19:30. |
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
| Persistence | `localStorage` for prefs; **Dexie 4.4 (IndexedDB)** for datasets | localStorage caps at ~5 MB, which "lots of data points" will hit. Same storage port either way. |
| LLM | Vercel `ai` 7 + `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/openai-compatible` 3.0 (Featherless, Verda) | Behind `LlmPort` (D0e). Routing table in [event/SPONSORS.md](event/SPONSORS.md). Raw SDK inside an adapter if `ai` gets in the way. |
| Search / data | Exa (`exa-js` 2.28), context.dev, Cala | Adapters behind `SearchPort` / `DataPort`, each with a fixture. |
| Heavy compute | **Modal** (Python) | Only for something the browser/Node can't do (batch embeddings, GPU, scraping fan-out). Expose one HTTPS endpoint (`@modal.fastapi_endpoint`); the app calls it through a port. |
| MCP | `@modelcontextprotocol/sdk` + **MCP Apps** (`@modelcontextprotocol/ext-apps` 2.0, stable spec; renders in Claude, ChatGPT, VS Code, Goose) | Expose our ops as an MCP server (`/mcp` route), and return our Svelte view as an MCP App so it renders *inside Claude*. ext-apps 2.x needs `@modelcontextprotocol/*@^2` peers: check versions at install. There's a Svelte example in the repo (`examples/basic-server-svelte`). |
| Tests | vitest (core only), Playwright 1.64 (one smoke e2e + perf/heap check) | Tests are offline: fixture LLM. |
| Package manager | pnpm | |

## Folder shape (single app, no monorepo)

```
src/
  lib/
    core/        pure TS: model, ops (applyOps), transforms, generators. No Svelte/DOM/SDK.
    ports/       interfaces: LlmPort, StoragePort, SearchPort, DataPort (+ fakes/fixtures)
    server/      real adapters that need secrets: anthropic.ts, gemini.ts, exa.ts, cala.ts, modal.ts
    adapters/    client-side adapters: localStorage, dexie
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

## Scaffold recipe (run at/after Fri 19:30, not before)

```powershell
# in the repo root (it already has docs/ and CLAUDE.md, so scaffold into a temp dir, then move the files up)
pnpm dlx sv@1.3 create scratch/app --template minimal --types ts   # add-ons: tailwindcss, prettier, eslint, vitest, playwright
# move scratch/app/* (incl. dotfiles) to the repo root, merge .gitignore, delete scratch/app
pnpm add -D @sveltejs/adapter-vercel          # swap it into svelte.config.js (D0d)
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
