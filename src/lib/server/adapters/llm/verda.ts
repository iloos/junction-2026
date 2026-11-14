/**
 * NVIDIA Nemotron 3.5 Super VL on a Verda serverless container, behind the Llm port: an OpenAI-compatible chat
 * completion with the pictures as `image_url` data URLs. Thinking is off for reading (`chat_template_kwargs`), so the
 * whole `max_tokens` budget goes to the answer; any `reasoning_content` is ignored. A 429 becomes `RateLimited` with
 * its Retry-After, so the shared breaker cools the endpoint down. The key stays server-side (VERDA_INFERENCE_KEY).
 */
import type { Llm } from '$lib/core/ports';
import { RateLimited } from '../../external/call';

export const VERDA_VISION_BASE = 'https://containers.datacrunch.io/nemotron-3-5-super-vl-b300/v1';
export const VERDA_VISION_MODEL = 'nemotron-3.5-super-vl';
const TIMEOUT_MS = 60_000;

export class VerdaError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(`verda ${status}: ${message.slice(0, 200)}`);
	}
}

export function verdaLlm(o: {
	apiKey: string;
	baseURL?: string;
	model?: string;
	fetch?: typeof fetch;
}): Llm {
	const model = o.model ?? VERDA_VISION_MODEL;
	const doFetch = o.fetch ?? fetch;
	return {
		async generate(req) {
			const t0 = performance.now();
			const content = [
				{ type: 'text', text: req.prompt },
				...(req.images ?? []).map((i) => ({
					type: 'image_url',
					image_url: { url: `data:${i.mimeType};base64,${i.base64}` }
				}))
			];
			const res = await doFetch(`${o.baseURL ?? VERDA_VISION_BASE}/chat/completions`, {
				method: 'POST',
				headers: { authorization: `Bearer ${o.apiKey}`, 'content-type': 'application/json' },
				body: JSON.stringify({
					model,
					max_tokens: req.maxTokens,
					temperature: 0.2,
					chat_template_kwargs: { enable_thinking: false },
					...(req.json ? { response_format: { type: 'json_object' } } : {}),
					messages: [
						...(req.system ? [{ role: 'system', content: req.system }] : []),
						{ role: 'user', content }
					]
				}),
				signal: req.signal
					? AbortSignal.any([req.signal, AbortSignal.timeout(TIMEOUT_MS)])
					: AbortSignal.timeout(TIMEOUT_MS)
			});
			if (res.status === 429) {
				const s = Number(res.headers.get('retry-after'));
				throw new RateLimited(Number.isFinite(s) && s > 0 ? Math.ceil(s) : 30, 'verda 429');
			}
			const body = (await res.json().catch(() => null)) as {
				choices?: { message?: { content?: string } }[];
				usage?: { prompt_tokens?: number; completion_tokens?: number };
				model?: string;
				error?: unknown;
				msg?: string;
			} | null;
			if (!res.ok)
				throw new VerdaError(res.status, String(body?.msg ?? JSON.stringify(body?.error ?? '')));
			return {
				text: body?.choices?.[0]?.message?.content ?? '',
				model: body?.model ?? model,
				tokens: { in: body?.usage?.prompt_tokens ?? 0, out: body?.usage?.completion_tokens ?? 0 },
				latencyMs: Math.round(performance.now() - t0)
			};
		}
	};
}
