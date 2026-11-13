# Stack

Chosen for: least overhead, fast iteration, impressive UI at scale, and one deployable service. Versions checked 13 Nov 2026.

| Layer | Pick | Why / note |
|---|---|---|
| Framework | **SvelteKit 2.70** + Svelte 5.57 (runes) + Vite 8 | Kit gives us `+server.ts` API routes, so the LLM proxy and keys live in the same app. Kit 3.x shipped 1 Oct 2026: too new to trust overnight. Pin `@sveltejs/kit@^2.70`. |
| Adapter | `adapter-node` (Fly/Render/Hostinger VPS) or `adapter-vercel` | Decide in hour 2. Deploy before anything gets deep. |
| Styling | Tailwind 4.3 (`@tailwindcss/vite`) | No config file needed; tokens as CSS vars in `app.css`. |
| Components | **bits-ui 2.21** (headless) | Low overhead. Pull in **shadcn-svelte** only for the boring parts (dialog, command palette, sheet, tabs, sonner). |
| Icons / toasts / util | `@lucide/svelte`, `svelte-sonner`, `runed`, `mode-watcher` | |
| 2D viz | **d3 7.9** for the maths (scales, force, hierarchy, zoom), Svelte renders the SVG | Canvas for >5k marks. `layerchart` 2.x if we want ready Svelte charts. ECharts 6 for dense time series (pass ids, never objects). |
| 3D hero (optional) | `3d-force-graph` 1.80 (fastest, WebGL, 50k+ nodes) or **Threlte 8** (`@threlte/core` + `three` 0.187) | Only behind a 1-hour spike Fri night with 50k dummy nodes. Keep only if it shows something 2D can't. |
| Graph (2D) | `@xyflow/svelte` 1.7 (node editors), `sigma` 4 + `graphology` (big graphs), `@cosmograph/cosmos` (GPU, 1M points) | |
| Large lists | `@tanstack/svelte-virtual` 3.13 | |
| In-browser data engine | **duckdb-wasm** (+ Mosaic for linked views, or Perspective for pivot grids) | Millions of rows client-side, with no DB server. The agent writes SQL as a tool. See [BUILDING-BLOCKS.md](BUILDING-BLOCKS.md). |
| Chat UI | **Svelte AI Elements** (shadcn-svelte port) on `@ai-sdk/svelte` | Message, tool-call and reasoning components for free |
| Validation | **zod 4.6** | One `schemas.ts`; validate on storage read and on every LLM structured output. |
| Persistence | `localStorage` for prefs; **Dexie 4.4 (IndexedDB)** for datasets | localStorage caps at ~5 MB, which "lots of data points" will hit. Same storage port either way. |
| LLM | Vercel `ai` 7 + `@ai-sdk/anthropic` / `@ai-sdk/google`, or the raw SDKs (`@anthropic-ai/sdk`, `@google/genai` 3.3) | Behind `LlmPort`. `ai` gives streaming + tool loops + `@ai-sdk/svelte` `Chat` for free; raw SDK if we need fine control. Default model `claude-sonnet-5-5`; `claude-opus-5-5` for hard reasoning; Gemini if DeepMind's challenge wants it. |
| Search / data | Exa (`exa-js` 2.28), context.dev, Cala | Adapters behind `SearchPort` / `DataPort`, each with a fixture. |
| Heavy compute | **Modal** (Python) | Only for something the browser/Node can't do (batch embeddings, GPU, scraping fan-out). Expose one HTTPS endpoint (`@modal.fastapi_endpoint`); the app calls it through a port. |
| MCP | `@modelcontextprotocol/sdk` 1.32 | "Integrated into the ecosystem": expose our core ops as an MCP server (`/mcp` route) so Claude/ChatGPT can drive the app. Cheap and wins "no way, that too?". |
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

## Patterns (from our past repos, re-derived at the event, not copied)
- **Agent loop:** server route runs the tool loop; client reads an NDJSON stream with `getReader()`; tools return *proposed ops* + a short summary; UI shows a review card / animates the change. Effort "gears" (quick/think) instead of a router.
- **Hedged LLM call:** if no first token in N seconds, fire a backup to the fallback model; turn deadline; fixture fallback for the demo.
- **Tracing:** a no-op-safe `trace()`/`span()` wrapper; a dev "trace" drawer in the UI is itself a wow moment ("see what the agent did").
- **Data at scale:** `$state.raw` + reassignment (logsight2: load 15s→7.7s, heap 1.8→0.74 GB); ids into charts + `Map` lookup; lazy indexes; yield between chunks; measure heap in Playwright.
- **Hide, don't disable:** a control that does nothing in this view does not exist.

## Scaffold recipe (run at/after Fri 19:30, not before)

```powershell
pnpm dlx sv create app --template minimal --types ts   # choose: tailwind, prettier, eslint, vitest, playwright
# then move/flatten into repo root, or keep /app
pnpm add -D @sveltejs/kit@^2.70 @sveltejs/adapter-node
pnpm add bits-ui @lucide/svelte svelte-sonner runed mode-watcher zod dexie d3 @tanstack/svelte-virtual
pnpm add -D @types/d3
pnpm add ai @ai-sdk/anthropic @ai-sdk/google @ai-sdk/svelte     # or the raw SDKs
pnpm dlx shadcn-svelte@latest init                              # optional
# optional 3D spike
pnpm add three 3d-force-graph   # or @threlte/core @threlte/extras three
# Modal (only if needed)
uv venv && uv pip install modal && modal setup
```

First commit after scaffold: `.env.example`, ports with fixture adapters, `/api/agent` streaming a fixture, one route rendering generated data. Deploy it. Then branch out.
