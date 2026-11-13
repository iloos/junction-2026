# New and usable: the "novelty" layer

Scanned on 13 Nov 2026. Web coverage in this window is noisy (aggregator blogs contradict each other). [P] = checked against a primary source · [S] = secondary only · [U] = unconfirmed. **Verify anything [S]/[U] in a 10-minute spike before building on it.**

Note: Meta's TRIBE v2 (brain encoding) came out in March 2026, so it no longer reads as new.

## Best fit for our stack (web + data + agents)
| Pick | What | Access | Effort | Wow it enables |
|---|---|---|---|---|
| **MCP Apps** (SEP-1865, `modelcontextprotocol/ext-apps`) [S] | MCP servers return *interactive UI* that renders inside Claude, ChatGPT and VS Code | Open spec + SDK | 3–5h | Our Svelte/d3 views appear live *inside Claude* as tool output. "No way, that too?" with our main stack, and it lands squarely on the agentic-ecosystem theme. |
| **Apple Embedding Atlas** [P, older] | WebGPU scatter of millions of embedded points, with search and clustering | MIT, npm | 2–4h | "Here's every company/claim/meeting as a point; the agent flies you to clusters." An instant data wow. |
| **TripoSplat** (VAST-AI, MIT, SIGGRAPH '26) [P] + **three.js r186 native Gaussian splats** [S] | One photo → 3D splat; three.js renders it | Modal GPU | 4–6h | Photo → walkable 3D in seconds. Our three.js moment, with no 3D modelling skill needed. |
| **Kimi K3.1 Pro on Verda** (1M context) [S/U] | Drop-in OpenAI-compatible LLM | Verda coupon; confirm the endpoint with staff | 1–2h | "It read the entire corpus in one pass." A clean, load-bearing Verda use, judged by their CTO. |
| **Transformers.js 4 (WebGPU)** [S] | Small LLMs and embeddings running in the browser, with tool calling | npm | 2–4h | Works offline and keeps data private. Pairs with duckdb-wasm for a server-less data agent. |
| **Meta Muse Glimmer** (30B, Apache-2.0, Aug 2026) [S] | Open-weight agent model; reads screenshots, charts and documents | Modal GPU / quantized local | 3–5h | A local, private document agent (FinTech/Healthcare privacy story). |
| **Agent payments: x402 / Stripe MPP / AP2** [S] | Agents pay per call | Testnets/sandboxes | 4–6h | Agentic-economy demo: our MCP tool charges another agent per query. |
| **OpenEnv** (Meta/HF RL environment standard) [S] | Package a task as an RL environment | OSS | 3–5h | Speaks directly to the RL-evals juror: "here's how we measure when the agent fails". |

## Big novelty, but further from our stack
| Pick | Note |
|---|---|
| **Gemini Robotics-ER 2** (live preview since Jul) [S] | Real-time pointing and orchestration from video. Hardware track plus the DeepMind juror. |
| **NVIDIA Kimodo v1.2** [P] | Text → full-body motion; pairs with Rokoko mocap data. 6–8h, with retargeting risk. |
| **LeRobot v0.6 Robometer-4B** [P] | Reward model that scores task progress on any video → a d3 eval dashboard. |
| **Meta DAT for Ray-Ban Display** [S] | The Meta glasses challenge; 8–12h of mobile plumbing. |
| **Gemini Omni Flash 1.1** (video generation) [S] | An agent that answers with generated video; ~$0.10/s. |
| **Genie 4** (DeepMind, 27 Oct) [P] | Trusted testers only. Ask at the DeepMind booth Friday night; fall back to the Odyssey-2 Pro API. |
| **Brain2Qwerty v2 / CortexMAE** [S] | Highest novelty, CC BY-NC, 10–15h, replay-only demo. Risky. |

## How to use this
A new model is a multiplier, not the product. Pick at most **one** novelty item, and only if it makes the chosen challenge's core moment better. Spike it in ≤45 min on Friday night; if it isn't working by then, drop it.

Strongest combinations with the idea directions in IDEAS.md:
- **A (Cala graph)** + Embedding Atlas or cosmos.gl + **MCP Apps** (the graph renders inside Claude) + Kimi on Verda for whole-corpus reads.
- **B (Wikipedia through time)** + Embedding Atlas over claims × time + OpenEnv-style "when does the agent get it wrong" evals.
- **D (Trade agents)** + x402/MPP agent payments + an OpenEnv evaluation of agent failure.
