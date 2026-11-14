# Models: Nemotron 3.5 Super VL, Gemma, one LLM port

_Foundation note, Sat 14 Nov. Sources: Verda docs (inference models, rate limits, CLI object storage), the HF model card for `nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-BF16`, the public NVIDIA Build `/v1/models` list, the Featherless `/v1/models` list, and the installed `ai@7.0.172` / `@ai-sdk/openai-compatible@3.0.92` types. Live check on Sat 14 Nov: ~45 calls. Spike and raw results: `scratch/spikes/models/` (`results.md`, `sdk-check.mjs`)._

## 1. Nemotron 3.5 Super VL
**Wired, not yet measured (Sat 14 Nov, 15:00).** `read_image` (tool, read scope) and the router job `image.read` call NVIDIA Nemotron 3.5 Super VL on a Verda serverless container: `https://containers.datacrunch.io/nemotron-3-5-super-vl-b300/v1`, model `nemotron-3.5-super-vl`, key `VERDA_INFERENCE_KEY`, OpenAI-style `image_url` data URL, `max_tokens` 1500, thinking off (`chat_template_kwargs.enable_thinking: false`; `reasoning_content` ignored), temperature 0.2, JSON schema in the system prompt (`server/images/read.ts`, `adapters/llm/verda.ts`). Every call is one ExternalCallTrace (api `verda`), behind a breaker, honouring 429 Retry-After, with daily caps per visitor workspace and per instance (`VISION_CAP_PER_WORKSPACE` 30, `VISION_CAP_GLOBAL` 500, Postgres `web_spend`). The picture is never stored.

**Measurement: blocked.** At 14:45–15:00 every path on that base (`/v1/chat/completions`, `/v1/models`, `/health`) answered **404 `no such container deployment or batch job: nemotron-3-5-super-vl-b300`**: the container is not deployed under that name. The harness is ready: `IMAGE_LIVE=1 node --env-file=.env node_modules/vitest/vitest.mjs run --project server src/lib/server/images/live.test.ts` reads the three samples in `fixtures/images/` (typed prep list, delivery note with a short-delivered line, product label; fictional, rendered by `scripts/web/render-image-samples.mjs`) and reports latency, kind and line recall/precision against the hand-written readings in `fixtures/images/readings.json` to `scratch/image-live.json`. Fixture mode answers those three samples from the hand-written readings, labelled `fixture`, and refuses any other picture.

Earlier paths, for reference:

| Path | Base URL · model id | Status |
|---|---|---|
| **Verda (NVIDIA-hosted)** | `https://inference.verda.com/v1` · id unknown | Our `VERDA_INFERENCE_KEY` is valid, but `/v1/models` returns `[]` and 12 likely ids return **404 `model_not_found`**. At the kickoff NVIDIA said: _message the NVIDIA sub-channel on Discord and we'll send you a Verda inference key_. That key, and the id it uses, are separate from ours. **Ask today.** |
| **NVIDIA Build** | `https://integrate.api.nvidia.com/v1` · **`nvidia/nemotron-3.5-super-vl-120b-a12b`** (in the public model list) | No `NVIDIA_API_KEY` in `.env`. Keys are free at build.nvidia.com. The free tier is ~40 RPM per key, so give each teammate their own key and retry with backoff. |
| Featherless | `nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16` | Nemotron **3** Super, text only. It **doesn't meet** the "3.5 Super VL" requirement. Use it only for a text-critic smoke test. |

**Model facts (from the HF card, not yet measured by us):** 120B MoE with 12B active parameters, up to 1M context (hosted deployments may set less). Input is RGB JPEG/PNG; the reference vLLM recipe allows **one image (+1 video) per request**. **There is no native PDF input**: send documents as page images plus any extracted text. Tool calling is supported (vLLM `qwen3_coder` parser); whether the hosted endpoints turn it on is untested. Reasoning is toggled with `chat_template_kwargs: {enable_thinking: true|false}` (plus `medium_effort: true`), and thinking shares the `max_tokens` budget. Recommended sampling is temperature 0.6 / top_p 0.95 for vision and 1.0 / 0.95 for text. Reported OCRBench v2 (en) 68.1, MMLongBench-Doc 62.8. Licence: OpenMDW-1.1. Image format is the OpenAI style: `{type:"image_url", image_url:{url:"data:image/jpeg;base64,…"}}`.

**Our uses:**
- **(a) Reader.** A photo of a handwritten prep list, delivery note or spec sheet goes in; the model returns JSON of the form `{lines:[{text, qty, unit, product_guess}], doc_type, confidence}` against a schema. Thinking is off and there is one page per call. A tool `lookup_product(name)` grounds each guess to a catalogue GTIN.
- **(b) Critic.** The order plan as JSON, plus the kitchen mandate and catalogue facts for each line, goes in; the model returns `{issues:[{line_id, kind, evidence, severity}]}`. Thinking is on, with `max_tokens` around 4k. This is the "second model" check that Gemini's ranking passes through.

## 2. Gemma for the 500-kitchen swarm (Featherless)
There are 41 `google/gemma*` ids on Featherless. The Gemma 4 instruct ids are **ungated** and flagged `tool_use`; all have 32k context.
| Model | $/M in · out | Concurrency cost | Measured (SDK: text / image / tools 2-step / JSON object) |
|---|---|---|---|
| **`google/gemma-4-E4B-it`** | 0.10 · 0.20 | 1 | **1.5 / 1.4 / 3.9 / 2.6 s, all OK.** **20 parallel tool calls: 20/20 OK, mean 1.8 s, max 2.1 s** |
| `google/gemma-4-31B-it` | 0.12 · 0.36 | 2 | 5.6 / 2.1 / **45.9** / 1.5 s, all OK (the tool loop was slow) |
| `google/gemma-4-26B-A4B-it` | 0.07 · 0.34 | 2 | **Tool calling broken in 3 of 4 runs.** It leaks `_call:google_search{…}` as text and stops on `length`. Text, image and JSON work. **Don't use it for tools.** |

Gemma 3 ids (`gemma-3-27b-it` and others) are gated and have no `tool_use` flag. A swarm run of 500 kitchens × 8 steps × ~1.5k tokens is about 6M tokens, roughly **$1 on E4B**. Our plan's concurrency cap is unknown (the Developer plan is 100 units). Gemma on a Verda GPU is possible but pointless next to Featherless at these prices; Verda's inference API does not list Gemma.

## 3. Verda beyond inference (read-only checks)
- **Account:** the balance is **€200** with no instances. Inference models must be **enabled per project in the Console** before they answer: Kimi and DeepSeek currently return 403 `subscription_required`. Enabling one is a lead action (it can spend).
- **Inference rate limits:** RPM and TPM are set per model and tier. `input + max_tokens` is reserved against TPM, so keep `max_tokens` tight. A 429 carries `Retry-After`; read the `x-ratelimit-*` headers.
- **GPU instances** (per hour): L40S €2.00, A100 80G €2.37, H100 €5.19, H200 €6.64, B200 €9.41. Batch embedding of 17.5k products doesn't need a GPU: Modal plus a hosted embed model is enough. Use a GPU only if we self-host Nemotron, which we shouldn't.
- **Serverless containers** (`verda container`, autoscaling HTTPS) and **CPU VMs** are the deploy fallback (D3).
- **Object storage** (S3, beta): `https://objects.fin-03.verda.storage`, region `us-east-1`. `VERDA_OBJ_*` keys exist but are **untested** (no boto3 or aws-cli; the CLI isn't configured). Possible use: uploaded kitchen photos and eval artefacts, kept in the EU.
- **Prize write-up:** keep `docs/VERDA.md` as a dated process log covering service, why it was chosen, what ran, numbers, and the path to scale (EU data residency, renewable power). Publish a summary page and **post the link in Verda's Discord channel**, and also mention Verda in the Junction submission. The criteria are ambition, fit, working prototype and path to scale, 25 each.

## 4. One LLM port over all of them
One adapter covers everything: `createOpenAICompatible({ name, baseURL, apiKey, includeUsage: true, supportsStructuredOutputs: true })`. **Verified on Featherless** for text, **base64 image**, a multi-step tool loop (`tool()` + `stopWhen: isStepCount(n)`), and `Output.object` with zod. Notes:
- **Images:** use a `{type:'file', mediaType:'image/jpeg', data:{type:'data', data: bytes}}` part. In v7 the `image` part is deprecated and only warns. **Always send bytes, never remote URLs**: a Wikimedia URL hung for 37 s and then returned 400 on Featherless.
- **Vendor body fields go through `providerOptions[name]`**, which the adapter spreads into the request body. Example: `providerOptions: { nvidia: { chat_template_kwargs: { enable_thinking: false } } }`. Use `reasoningEffort` for Verda's Kimi and `transformRequestBody` for anything else. **No provider needs a raw `fetch`.**
- **Usage:** Featherless also returns `usage.cost` in USD, which the trace drawer can show.
- **Still untested:** Verda and NVIDIA Build through the SDK (no Nemotron key yet). Rerun `node sdk-check.mjs nvidia nvidia/nemotron-3.5-super-vl-120b-a12b` once a key arrives.

## 5. Nemotron eval for the write-up ("how we improved its outputs")
**Set of 16 cases, all made by us:**
- 6 phone photos of handwritten prep lists (messy, Finnish/English mix, crossed-out lines).
- 4 delivery notes (printed, with a short-delivered line).
- 2 spec sheets as page images.
- 4 order plans with planted errors: pack size ×10, an allergen against the mandate, a missed cut-off, and a duplicate line.

Gold JSON for each case lives in `evals/nemotron/`.

**Metrics:**
- **Reader:** line-level F1, where a line matches when product and qty are right within ±5%. Also GTIN grounding accuracy.
- **Critic:** planted-error recall and false flags per plan.
- **For both:** p50 latency and JSON validity rate.

**Ladder to report:**
1. v0: plain prompt.
2. v1: JSON schema plus 2 few-shot examples, thinking off.
3. v2: the `lookup_product` tool grounds names to the catalogue.
4. v3 (critic only): thinking on, plus a re-ask when JSON is invalid.

The write-up gets a table of one row per version, which also serves as the "Quality of AI Output" evidence. Run it on fixtures in CI after a single recorded live pass.

## Decisions for ARCHITECTURE
1. **`LlmPort.generate({ role, messages, tools?, schema?, maxTokens })`** routes by role. `reader` and `critic` go to Nemotron (Verda first, then NVIDIA Build, then fixture). `swarm` goes to `gemma-4-E4B-it` on Featherless, then fixture. `agent` and `decide` go to Gemini or Claude per gemini.md. Every adapter is `createOpenAICompatible`.
2. **Images enter the port as bytes.** The server downscales to ≤1600 px JPEG. A PDF becomes one page image per call (pdf.js server-side), with page results merged in core.
3. **A per-provider semaphore plus 429 retry** that honours `Retry-After`. Every call sets `maxOutputTokens`, and the trace logs model, tokens, cost and latency.
4. **Never use `gemma-4-26B-A4B-it` for tools.** Use `gemma-4-31B-it` as the "smart kitchen" tier if the swarm needs one.
5. **Thinking is off for reading and on for the critic**, set through `providerOptions`.

## Open questions
- **The Verda Nemotron key and model id from NVIDIA's Discord: ask now (lead).** Also get an NVIDIA Build key for each teammate as a fallback.
- Does the hosted Nemotron allow more than one image per request, and are tools turned on?
- What is our Featherless plan's concurrency cap? Measure 100 parallel calls before the swarm demo.
- Should we enable a Verda model (Kimi or DeepSeek) at all? It's only worth it if Verda inference does visible work beyond Nemotron.
- Do we test the Verda S3 keys? Install `boto3` in the spike folder only if photo storage is in scope.
