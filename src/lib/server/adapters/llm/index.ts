import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { GoogleGenAI } from '@google/genai';
import { generateText } from 'ai';
import type { Llm } from '$lib/core/ports';
import type { Env } from '$lib/server/auth';
import { logTrace, noTrace, type Trace } from './trace';

type Req = Parameters<Llm['generate']>[0];
type Res = Awaited<ReturnType<Llm['generate']>>;

export const GEMINI_LLM_MODEL = 'gemini-3.5-flash-lite';
export const FEATHERLESS_MODEL = 'google/gemma-4-E4B-it';
/** Hard ceiling on any single call, whatever the caller asks for (CLAUDE.md rule 6). */
const MAX_TOKENS_CEILING = 4000;

export const geminiKey = (env: Env) => env.GEMINI_STUDIO_API_KEY || env.GEMINI_API_KEY;

function traced(source: string, model: string, trace: Trace, fn: (r: Req) => Promise<Res>): Llm {
	return {
		async generate(req) {
			const maxTokens = Math.min(Math.max(1, req.maxTokens), MAX_TOKENS_CEILING);
			const t0 = performance.now();
			try {
				const res = await fn({ ...req, maxTokens });
				const data = {
					source,
					model: res.model,
					tokensIn: res.tokens.in,
					tokensOut: res.tokens.out,
					latencyMs: res.latencyMs,
					maxTokens
				};
				trace('text', data);
				logTrace(data);
				return res;
			} catch (e) {
				const data = {
					source,
					model,
					latencyMs: Math.round(performance.now() - t0),
					error: String((e as Error)?.message ?? e).slice(0, 200)
				};
				trace('error', data);
				logTrace(data);
				throw e;
			}
		}
	};
}

/** Gemini Flash-Lite via the Interactions API, thinking minimal, not stored. */
export function geminiLlm(apiKey: string, trace: Trace = noTrace, model = GEMINI_LLM_MODEL): Llm {
	const ai = new GoogleGenAI({ apiKey, apiVersion: 'v1beta' });
	return traced('gemini', model, trace, async (req) => {
		const t0 = performance.now();
		const r = await ai.interactions.create({
			model,
			input: req.prompt,
			system_instruction: req.system,
			// The Interactions API takes JSON mode as a text response_format (a bare response_mime_type is a 400).
			...(req.json ? { response_format: { type: 'text', mime_type: 'application/json' } } : {}),
			generation_config: { max_output_tokens: req.maxTokens, thinking_level: 'minimal' },
			store: false
		} as Parameters<typeof ai.interactions.create>[0]);
		const out = r as { output_text?: string; usage?: Record<string, number>; model?: string };
		return {
			text: out.output_text ?? '',
			model: out.model ?? model,
			tokens: { in: out.usage?.total_input_tokens ?? 0, out: out.usage?.total_output_tokens ?? 0 },
			latencyMs: Math.round(performance.now() - t0)
		};
	});
}

const withTimeout = (signal?: AbortSignal) =>
	signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000);

/** Any OpenAI-compatible endpoint (Featherless Gemma by default) through the AI SDK. */
export function openAiCompatibleLlm(
	o: { name: string; baseURL: string; apiKey: string; model: string },
	trace: Trace = noTrace
): Llm {
	const provider = createOpenAICompatible({
		name: o.name,
		baseURL: o.baseURL,
		apiKey: o.apiKey,
		includeUsage: true,
		supportsStructuredOutputs: true
	});
	return traced(o.name, o.model, trace, async (req) => {
		const t0 = performance.now();
		const r = await generateText({
			model: provider(o.model),
			system: req.system,
			prompt: req.prompt,
			maxOutputTokens: req.maxTokens,
			maxRetries: 1,
			abortSignal: AbortSignal.timeout(30_000)
		});
		return {
			text: r.text,
			model: o.model,
			tokens: { in: r.usage.inputTokens ?? 0, out: r.usage.outputTokens ?? 0 },
			latencyMs: Math.round(performance.now() - t0)
		};
	});
}

/** No network: echoes a labelled placeholder so callers can tell it from model output. */
export function fixtureLlm(trace: Trace = noTrace): Llm {
	return traced('fixture', 'fixture', trace, async (req) => ({
		text: req.json ? '{}' : `[fixture] ${req.prompt.slice(0, 120)}`,
		model: 'fixture',
		tokens: { in: 0, out: 0 },
		latencyMs: 0
	}));
}

/** `LLM_PROVIDER`: fixture (default) | gemini | featherless. A missing key falls back to fixture. */
export function createLlm(env: Env, trace: Trace = noTrace): Llm {
	const p = env.LLM_PROVIDER ?? 'fixture';
	const gk = geminiKey(env);
	if (p === 'gemini' && gk) return geminiLlm(gk, trace);
	if (p === 'featherless' && env.FEATHERLESS_API_KEY)
		return openAiCompatibleLlm(
			{
				name: 'featherless',
				baseURL: 'https://api.featherless.ai/v1',
				apiKey: env.FEATHERLESS_API_KEY,
				model: env.FEATHERLESS_MODEL || FEATHERLESS_MODEL
			},
			trace
		);
	if (p !== 'fixture') console.warn(`[llm] LLM_PROVIDER=${p} has no usable key; using fixture`);
	return fixtureLlm(trace);
}
