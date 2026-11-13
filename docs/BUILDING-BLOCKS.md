# Building blocks: use what exists

Rule check: "All code outside open-source libraries must be written at the event", so OSS libraries and tools are fair game and encouraged. Our value goes in the glue, the insight and the UX. Verified on GitHub on 13 Nov 2026 (stars, last push, license); *(check)* = license shows as "Other" on GitHub.

## Tier 1: likely in the build
| Block | Why | License | Effort |
|---|---|---|---|
| **duckdb-wasm** (duckdb/duckdb-wasm) | SQL over millions of rows *in the browser*. The agent writes SQL, the dashboard renders it. The answer to "robust data, lots of points" without a server DB. | MIT | S–M |
| **Mosaic** (uwdata/mosaic) | Linked, cross-filtered views over DuckDB that scale to millions of points | BSD-3 *(check)* | M |
| **Perspective** (perspective-dev/perspective) | WASM pivot grid and charts for huge or streaming data; a web component, so it drops into Svelte | Apache-2.0 | S |
| **cosmos.gl** (cosmosgl/graph; npm `@cosmos.gl/graph`) | GPU force layout, 100k–1M nodes. The "whoa" graph. | MIT | M |
| **3d-force-graph** (vasturiano) | Easy 3D graph hero view | MIT | S |
| **sigma.js + graphology** | Robust 2D big-graph rendering plus graph algorithms (paths, centrality, communities) | MIT | S–M |
| **Vercel AI SDK + @ai-sdk/svelte** | Streaming, tools, Claude and Gemini providers, a `Chat` class | Apache-2.0 *(check)* | S |
| **Svelte AI Elements** (SikandarJODD/ai-elements) | shadcn-svelte port of AI Elements: message, tool-call, reasoning and prompt-input components. Skips chat-UI work. **Targets `ai` v6**: pin v6 or adapt. | MIT | S–M |
| **shadcn-svelte + bits-ui** | Dashboard and sidebar blocks for layout; skip boilerplate | MIT | S |
| **Svelte Flow** (xyflow) | A visual editor for data-transform pipelines ("mechanisms that transform the data", made visible) | MIT | S–M |
| **LayerChart** | Svelte-native d3 charts | MIT | S |
| **MCP TS SDK + MCP Apps** (`@modelcontextprotocol/ext-apps` 2.0, stable) + Inspector | Expose our app as an MCP server, and render our view *inside Claude/ChatGPT* ("no way, that too?") | MIT *(check)* | S–M |
| **Featherless** (sponsor) via `@ai-sdk/openai-compatible` | ~22.5k open models behind one OpenAI-compatible endpoint: bulk transforms, a model arena | service | S |

## Tier 2: if the idea needs it
| Block | Use when | License |
|---|---|---|
| **google/langextract** | Structured, source-grounded extraction from notes or email with Gemini (a DeepMind tie-in). Python; run on Modal. | Apache-2.0 |
| **graphiti** (getzep) | A temporal knowledge graph (facts changing over time): meetings, email, Wikipedia-through-time | Apache-2.0 |
| **LightRAG** | Quick graph-RAG retrieval if quality matters. Python sidecar. | MIT |
| cognee / mem0 / microsoft graphrag | Probably too heavy for 40h | Apache/MIT |
| **auto-ontology-mcp** (gogoymh) | Typed-record personal KB as MCP; a reference for the "digital context" theme | ? |
| **strands-decider** | Cheap calibrated classifier step (triage) instead of an LLM call | ? |
| **json-render** (vercel-labs) / **A2UI** / **AG-UI** | Generative UI: the agent emits JSON that renders as our components | Apache/MIT |
| **A2A** | Agent-to-agent story for the agentic-economy pitch | Apache-2.0 |
| **mcp-server-motherduck** | Agent SQL over DuckDB via MCP | MIT |
| **LadybugDB** (fork of the archived Kùzu) | An embedded graph DB if we need Cypher | MIT |

Our own default for a knowledge graph in 40h: an LLM extracts typed nodes and edges into JSON (zod schema, **closed** node and edge kinds), stored in IndexedDB, loaded into graphology, rendered with cosmos.gl or sigma. Reach for graphiti or LightRAG only if retrieval quality becomes the bottleneck.

## Datasets
QMSum (meeting transcripts with summaries, MIT) · AMI Meeting Corpus (CC BY 4.0) · MeetingBank (HF) · Enron emails · or LLM-generated synthetic corpora (often the best for a demo: controllable, licence-free, scales to 10×).

## Dev-side (agentic development)
| Tool | Use |
|---|---|
| superpowers (installed) | brainstorm → plan → subagent execution → verification |
| **plannotator** (backnotprop) | Annotate and review agent plans before execution: faster review loops |
| **lot-map** (alexeyw) | Live map of Claude Code tool calls, hooks and subagents. Fun to watch. Also visual inspiration if we build an "agentic ecosystem" view. |
| impeccable (installed, update to 4.9) | Design polish, anti-slop |
| chrome-devtools-mcp / playwright-mcp / **agent-browser** (vercel-labs, token-cheap CLI) | Agent sees and tests the UI |
| context7 (needs auth) | Current docs for Svelte 5, Tailwind 4 and the AI SDK |
| OpenSpec | Skip: superpowers plus docs/PLAN.md is enough; don't run two planning systems |

Avoid: `vercel/ai-chatbot-svelte` (stale since Jun 2025; read it for patterns only), `kuzudb/kuzu` (archived), CopilotKit (React-only).

Inspiration source: André Lindenberg (LinkedIn `alindnbrg`) regularly posts agent-dev repos; worth a scroll before the event.
