# Sponsor tools: integration cheat-sheet

Rule: use a sponsor only if the use is **visible in the demo** and **load-bearing** (the product is worse without it). A logo on a slide wins nothing. Every sponsor sits behind a port with a fixture, so a dead API never kills the demo.

| Tool | What it is | Fastest path | Credits | "Wow" use |
|---|---|---|---|---|
| **Cala** | Entity graph of companies, people, investors and funding rounds, with sources. "Knowledge layer for agents." | OpenAPI `https://api.cala.ai/openapi.json`; docs `https://docs.cala.ai/quickstart.md`; MCP `https://api.cala.ai/mcp/` (`X-API-KEY`). Endpoints: Query (typed rows), Search (cited markdown), Search Entities, Lookup, Introspection, Retrieve. | Ask at the Sat 11:00 workshop | Walk investor→round→company→founder to find non-obvious paths (warm intros, hidden clusters); every claim cited |
| **Exa** | Neural web search ("find things like X") | `exa-js`; hosted MCP (works without a key on the free plan); Claude plugin `exa@claude-plugins-official` | $10–20 at sign-up | Semantic discovery ("startups like X"), then verify with Cala or context.dev |
| **Context.dev** (ex-Brand.dev, YC S26) | Scrape/crawl to markdown, JSON-schema extraction, brand data (logo, colours, industry), official MCP | REST plus MCP | ~500 free credits | Live brand cards (real logos and colours make the UI look real instantly); website-diff monitoring that feeds the agent. **Their CTO is on the grand jury.** |
| **Modal** | Serverless Python/GPU | `uv tool install modal` → `modal setup` → `@app.function` / `@modal.fastapi_endpoint` → `modal deploy` | Free tier ~$30/mo; Junction credits TBD | Fan out hundreds of parallel jobs **live on stage** (batch enrich, embed, simulate), with progress streamed into our UI |
| **Verda** | Finnish GPU cloud; OpenAI-compatible inference (Kimi K3.1 Pro, 1M context) | OpenAI SDK with `baseURL` set to Verda (`docs.verda.com/inference/quickstart`); coupon on the platform | €10k credits as 1st prize | A 1M-context "read the whole corpus" pass, plus a documented path to scale. Write a short `docs/VERDA.md` process log (they judge on it). |
| **Gemini / DeepMind** | Gemini 3.x; Live API for realtime voice/video | `@google/genai`; free key from AI Studio | Free tier | Realtime multimodal (camera or voice) agent moment |
| **Hostinger** | Hosting / VPS / Horizons builder | Their MCP is configured locally (needs auth) | ? | A public demo URL. Keynote thesis: "vibe coding solved building; real problems and validation are scarce now." |
| **MariaDB** | Vector plus system-versioned temporal tables | MariaDB 11.x in Docker | — | "AS OF" time travel over knowledge (only if we pick their challenge; it breaks the no-DB default) |

Workshops to attend (one person each, notes into `docs/event/notes-<sponsor>.md`): Cala Sat 11:00, Modal Sat 13:30, Exa Sat 16:30, Context.dev Sat 17:30.
