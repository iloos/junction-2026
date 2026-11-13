# Sponsor tools: integration cheat-sheet

Verified 13 Nov 2026 unless marked. Rule: use a sponsor only if the use is **visible in the demo** and **load-bearing** (the product is worse without it). A logo on a slide wins nothing. Every sponsor sits behind a port with a fixture.

**Ask for access in Discord on Friday night.** Don't wait for the Saturday workshops.

| Tool | What | Fastest path (verified) | Credits | "Wow" use |
|---|---|---|---|---|
| **Featherless** (tech partner) | Serverless inference over ~22.5k open-weight HF models (live `/v1/models` count) | `@ai-sdk/openai-compatible`: `createOpenAICompatible({ name: 'featherless', baseURL: 'https://api.featherless.ai/v1', apiKey })`. Strong models: `moonshotai/Kimi-K3.1-Pro`, `zai-org/GLM-5.3`, `deepseek-ai/DeepSeek-V4-Pro`, `Qwen/Qwen3.5-397B-A17B`, `MiniMaxAI/MiniMax-M3`. Context 262K on the big classes, 32K on some. | **Developer plan** ($50/mo per-token credits, 100 concurrency) is the one allowed for agents/backends; the $25 Chat plan forbids API backends. Hackathon grant: free compute codes. Ask at the booth. | A **model arena / picker over 22k open models**: same task, three open models side by side, scored live. Community fine-tunes with zero deploy. |
| **Cala** | Entity graph of companies, people, investors and funding rounds, with sources | OpenAPI 3.1 `https://api.cala.ai/openapi.json`; `/v1/knowledge/search`, `/v1/knowledge/query`, `/v1/entities`...; MCP `https://api.cala.ai/mcp/` (trailing slash) with header `X-API-KEY` | "Free account", quota unknown | Walk investor→round→company→founder for non-obvious paths; every claim cited |
| **Verda** | Finnish GPU cloud plus OpenAI-compatible inference | `baseURL: 'https://inference.verda.com/v1'`, Bearer auth. Models: `kimi-k3-1-pro`, `deepseek-4-1-flash-1017`. Kimi reasons at max effort by default: send `reasoning_effort: "low"` or leave `max_tokens` headroom. | Balance ≥ $1, minimum top-up $20; coupon via the platform. Prize: €10k/€2.5k/€2.5k credits. | Long-context "read the whole corpus" pass plus a documented path to scale. Keep a short `docs/VERDA.md` process log (they judge on it). Their CTO is on the grand jury. |
| **Exa** | Neural web search | `exa-js` 2.28 (`exa.search`, `contents: { text: true }`). `findSimilar` still works but is **deprecated**: OK for a demo, don't build on it. Hosted MCP: `https://mcp.exa.ai/mcp` with header `x-api-key`, `?tools=web_search_exa,web_fetch_exa,...` | $10 at sign-up, reset monthly (~2.5k searches) | Semantic discovery ("startups like X"), then verify with Cala / Context.dev |
| **Context.dev** (ex-Brand.dev) | Scrape/crawl to markdown, JSON-schema extraction, brand data (logo, colours, industry), official MCP | REST plus MCP *(unverified details)* | ~500 free credits *(S)* | Real logos and colours make the UI look real instantly; website-diff monitoring that feeds the agent. **Their CTO is on the grand jury.** |
| **Modal** | Serverless Python/GPU | `uv tool install modal` → `modal setup` → `@app.function` / `@modal.fastapi_endpoint` → `modal deploy` | Free tier ~$30/mo; Junction credits TBD | Fan out hundreds of parallel jobs **live on stage**, with progress streamed into our UI |
| **Gemini / DeepMind** | Gemini 3.x; Live API for realtime voice/video | `@ai-sdk/google` or `@google/genai`; key from AI Studio | Free tier | Realtime multimodal (camera or voice) moment |
| **Hostinger** | Hosting / VPS / Horizons | MCP configured locally (needs auth) | ? | Only if they offer a prize for hosting there |
| **MariaDB** | Vector plus system-versioned temporal tables | MariaDB 11.x in Docker | — | "AS OF" time travel, only for their challenge |

## Model routing (one LLM port, D0e)
| Job | Default | Why |
|---|---|---|
| Agent chat plus tool calls | `claude-sonnet-5-5` | Most reliable tool use |
| Bulk extraction / transforms over many items | Featherless (GLM-5.3 / DeepSeek V4) or Verda DeepSeek Flash | Cheap, parallel, a sponsor story |
| Whole-corpus long-context read | Verda `kimi-k3-1-pro` | 1M ctx, Verda prize |
| Realtime voice/vision | Gemini Live | DeepMind |

Featherless tool calling is documented natively only for the Kimi K2 and Qwen3 families. Test K3, GLM and DeepSeek V4 tool calls in a 10-min spike, or use JSON-mode structured output for those.

Workshops: Cala Sat 11:00 · Modal 13:30 · Exa 16:30 · Context.dev 17:30.
