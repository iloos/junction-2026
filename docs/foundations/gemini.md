# Gemini: Decisions API, fast structured output, Live

_Foundation note, Sat 14 Nov. Sources: the `gemini-api-dev` / `gemini-live-api-dev` skills plus the hosted docs (decisions-api, gemini-decision-1, pricing, rate-limits, structured-output, live-api/tools), fetched 14 Nov. Live check: 7 calls, Sat 14 Nov ~00:25 EET, from a laptop in Espoo. Spike: `scratch/spikes/gemini/` (`spike*.mjs`, `results.json`)._

## 1. Models and what each one is for
| Job | Model | Call | Measured |
|---|---|---|---|
| **(a) Calibrated decisions** (yes/no, choice, rubric score) | `gemini-decision-1` ("Jev" at the kickoff) | `ai.decisions.create` / `POST /v1beta/decisions`, needs **`v1beta`** | 3 questions: **365 ms**. 15 questions: **454 ms**. **120 questions (40 candidates × 3): 561 ms**, 9.8k input tokens, 0 output tokens |
| **(b) Fast structured text** (explanations, extraction) | `gemini-3.5-flash-lite` (thinking `minimal`) | `ai.interactions.create` + `response_format` JSON schema | **1.4 s**, 138 in / 63 out tokens, valid JSON |
| (b') Harder reasoning, same API | `gemini-4-hydrogen` (thinking `low`) | same | **8.6 s** (570 thought tokens). Default thinking is `high`; `minimal` is rejected (400) |
| (c) Voice | `gemini-3.8-live` (voice agent, async tools) or `gemini-3.5-transcribe-live` (STT, `smart` mode) | WebSocket `ai.live.connect`, browser auth via ephemeral token (`ai.authTokens.create`) | not tested |

`gemini-4-carbon` and `-argon` are frontier models we don't need. `gemini-2.x` models are deprecated, so never use them.

**Decision call shape.** One shared `input` (text, JSON as a string, image, PDF or audio) and up to **1,000 questions** in a map, all within a 262k-token context. Each question is `noul` (P(yes) between 0.01 and 0.99), `choice` (2–255 options, probabilities sum to 1) or `score` (2–255 ordered levels, recommended 2–10; returns the expected level index). Every answer carries `confidence`. Questions run in parallel and can't see each other, so latency barely changes with the number of questions. The model never sees question keys, so write the whole question in `instructions`. Real answer from our spike:
```json
"c1_culinary": {"type":"score","score":3.39,"confidence":0.50,
  "probabilities":{"0":0.001,"1":0.011,"2":0.086,"3":0.399,"4":0.504},"legend":{"0":"Unusable…","4":"Near drop-in replacement"}}
"tier": {"type":"choice","choice":"act","confidence":0.87,"probabilities":{"act":0.87,"propose":0.10,"signoff":0.02}}
"c4_violates": {"type":"noul","noul":0.99,"confidence":0.99}   // shrimp vs "no shellfish": caught
```

## 2. Our three uses (request → response)
**Rank substitutes.** **Code** computes the numeric part from catalogue data: price, carbon and reliability, normalised and weighted by the kitchen's sliders. The docs agree: "compare numbers in code, then pass the result or a named bucket". **Gemini** judges what code can't, in **one call per out-of-stock line**, with 3 questions per candidate:
- `{id}_culinary`: score 0–4, "can it replace X in this dish?"
- `{id}_violates`: noul against the hard constraints (allergens, "no shellfish")
- `{id}_fi`: noul for Finnish origin, used when the origin field is messy

Input: `{kitchen.priorities, hard_constraints, order_line{dish, missing_product, qty}, candidates[{id, name, price_vs_original:"-8%", carbon_vs_original:"-20%", origin, reliability}]}`. Rank = `wNumeric·numeric + wFit·culinary/4`, with any candidate dropped where `P(violates) > 0.2` or `culinary < 1.5`. Spike result for salmon out on a hotel menu, with culinary fit / mandate fit, both out of 4: Finnish trout 3.39 / 3.79, Icelandic char 3.05 / 1.39 (low reliability), Finnish zander 2.54 / 2.07, frozen Chilean salmon 2.40 / 0.92 (carbon +60%), and shrimp 0.17, vetoed by the constraint check (P 0.99). That is the order a chef would pick. For the "why?", hand the numbers and the probabilities to Flash-Lite with a schema `{headline, reasons[], trade_off}`. Spike output: _"Switch to Finnish rainbow trout for lower carbon and local origin."_ Or skip the LLM and fill a template.

**Act / propose / sign-off.** Hard limits stay **in code** (spend over the mandate limit, a novel supplier, a broken priority → `signoff`, always). Gemini only decides the grey zone, with a `choice` `{act, propose, signoff}` plus a `noul` "should a human be asked?" over `{mandate, change, event}`. Measured: a trout swap of €340 under a €400 limit gave `act` 0.87 and `needs_human` 0.04. Policy: act only if `choice=act` **and** `confidence ≥ θ_kitchen`, otherwise drop one tier.

**Classify anomalies.** Use one **`noul` per type** (`demand_spike`, `stockout`, `equipment`, `recall`, `delivery`, `pack_size`), not a `choice`. In the spike, "+80 covers and the salmon is out" split 0.54 stockout / 0.43 demand_spike, because both were true. Decision input can be a **photo or a voice note** directly (e.g. "is a fridge broken?", "is this a delivery note?").

## 3. SDK
- **`@google/genai@3.3.0`** (npm, published 12 Nov). It covers `decisions` (≥ 3.2), `interactions`, `live` and `authTokens`. Construct it as `new GoogleGenAI({ apiKey, apiVersion: "v1beta" })`; the default is `v1`, and decisions are `v1beta` only. Server-side only, in `src/lib/server/`.
- **`@ai-sdk/google@4.0.120`** + `ai@7` cover it too: `experimental_decide({ model: google.decisionModel('gemini-decision-1'), state, questions })`. It's experimental and renames things: `noul` becomes `boolean`/`probability`, and confidence moves to `providerMetadata`. **Use `@google/genai` directly** for the Gemini adapters. That gives one first-party SDK for decisions, interactions and live, the native shapes, and a cleaner "how we integrated Gemini" story.
- **Env gotcha:** our `.env` names the key `GEMINI_STUDIO_API_KEY`, but the SDK reads `GEMINI_API_KEY`/`GOOGLE_API_KEY` by default. Pass `apiKey` explicitly, or rename it in `.env.example`.

## 4. Limits, cost, failure modes
- **Price:** decisions cost **$0.10 per 1M input tokens**, and nothing on the free tier. A 120-question call is about **$0.001**, so 1,000 order lines cost about $1. Flash-Lite is $0.30 in / $2.50 out; Hydrogen $1.50 / $7.50. Neither matters at our volume.
- **Rate limits (decision-1):** Free tier 200 RPM / **50k TPM** / 10k RPD; Tier 1 1,500 RPM / 1M TPM. On the free tier, only **about five 120-question calls per minute** fit. **Check the tier of our key in AI Studio** (open question). The swarm must not use the real Decisions API for 500 kitchens unless we are on Tier 1 or above.
- **Missing features:** decisions have no Batch API and no context caching. Shared input is billed again on every request, so batch the questions, not the requests.
- **Failure modes:**
  - **400 `safety`** blocks the input. A product description can trigger it, so treat that as "unknown" and fall back.
  - **400 limit/key validation:** question keys must match `[A-Za-z0-9_-]{1,64}`.
  - **429 `RESOURCE_EXHAUSTED`.**
  - **Probabilities are clamped** to 0.01–0.99.
  - **A `choice` always sums to 1, even when nothing fits.** Add `other` and a scope `noul`. Option keys are sorted alphabetically, so don't name one `none_of_the_above`.
  - **The model reads untrusted input:** text can argue for its own label (prompt injection via product descriptions). Keep code limits in front of it.
  - **Hydrogen with default `high` thinking** burns `max_output_tokens` on thoughts. We got `status:"incomplete"` and empty output at 400 tokens. Always set `thinking_level` and leave headroom.
  - **Interactions are stored by default.** Pass `store:false`.
- **Fixture fallback (DecidePort / LlmPort):**
  1. **`replay`:** answers recorded from real calls, keyed by `hash(model, input, questions)`. Lanes and the demo replay them, so we get real numbers offline.
  2. **`rules`:** deterministic heuristics with the same output shape. Keyword allergen match, a lookup table from category to culinary fit, numeric limits for the tier, and `confidence: 0.5`. Every result carries `source: 'gemini' | 'replay' | 'rules'`, and the UI shows it.
  3. The live adapter wraps calls with a 2 s timeout, one retry on 429, then drops to `rules`. The trace logs model, input tokens, latency, question count and source.

## 5. Voice: is it a 2-hour add-on?
**A full Live voice agent is not a 2-hour job.** It needs a PCM16 16 kHz AudioWorklet, a WebSocket, an ephemeral-token endpoint, `NON_BLOCKING` tool calls mapped onto our ops, echo in a loud venue, and ~10-min connection resets. Budget half a day and accept real demo risk. **The cheap version, about 1 h**, is a hold-to-talk button: MediaRecorder sends webm to the server, Flash-Lite turns the audio into the same structured `Request` the text box produces, and Decisions classifies the anomaly from the same audio. That's one extra input to the flow we already have. A middle option, about 2 h, is `gemini-3.5-transcribe-live` in `smart` mode, which resolves self-corrections, with live captions. Do it only after the thin slice ships.

## 6. How this wins the Gemini prize
The brief asks for more than "adding an LLM". Our story: **Gemini Decision is the trust layer of an autonomous buyer.**
- **Problem:** Valio asks, "When does your agent know it's safe to order on its own?"
- **Integration:** every order line and substitute passes through calibrated questions. That's dozens of judgements per anomaly in one ~0.5 s call, versus N generative calls and parsing.
- **Innovation:** calibrated probabilities become **policy**. The kitchen's "how much may the agent do alone" slider *is* the confidence threshold θ. We tune θ on our ~20 labelled eval scenarios, show a small calibration plot, and display P and confidence next to every line ("act 0.87"). Decision questions run straight on a fridge photo or a voice note, so it's multimodal with no extraction step.
- **Why Gemini:** zero output tokens, calibrated numbers you can branch on, and up to 1,000 questions per pass. No other provider in our stack offers that. Flash-Lite writes the human "why".
- **Evidence:** the write-up shows a real trace (questions in, probabilities out, latency) next to the UI.

## Decisions for ARCHITECTURE
- **DecidePort** in `core/` with our own types (`yesno|choice|score`, answers with `p/choice/score + probabilities + confidence`, `usage`, `latencyMs`, `source`). Adapters: `gemini` (`@google/genai@3.3.0`, `v1beta`), `replay`, `rules`. LlmPort stays separate for generated text and structured output.
- **Numbers in code, judgement in Gemini.** Substitute rank = code-weighted numeric score × Decision culinary fit, gated by Decision constraint checks. One decision call per anomaly line, batching all candidates × questions.
- **The tier is code-first.** Hard limits always force `signoff`. Gemini decides the grey zone, and the acting threshold comes from the kitchen mandate (`autonomy → θ`). It is recorded on the op with P, confidence and source.
- **Anomalies are multi-label `noul`s**, not one `choice`.
- **Default models:** `gemini-decision-1` (decisions), `gemini-3.5-flash-lite` with `thinking_level:"minimal"` (explanations, extraction), `gemini-4-hydrogen` with `"low"` only where reasoning is needed. Always set `max_output_tokens` with thinking headroom and `store:false`.
- **The swarm uses `replay`/`rules`**, or Gemma, for decisions. The real Decisions API runs for the demo kitchen and sampled lines only, until we confirm the key's tier.

## Open questions
1. What tier is our key (free 50k TPM vs Tier 1 1M TPM)? Check the AI Studio rate-limit page; this sets how much of the swarm can be real.
2. How do we enter the Gemini prize: a tag in the submission or a separate form? Ask at the DeepMind booth. Also ask whether they want Decisions shown specifically.
3. "Jev": the kickoff and a `typesafe-ai` skill on this machine also use the name. Is TypeSafe a separate wrapper? We call Google's endpoint directly, which counts unambiguously as Gemini API use.
4. Photo anomalies (a fridge, a delivery note): Decisions on the image, or Nemotron? Proposal: Decisions classifies, Nemotron extracts text. This needs a line in models.md.
5. Does Decision-1 handle Finnish product names and Finnish input well? Not tested; run a 10-case check during the eval set.
