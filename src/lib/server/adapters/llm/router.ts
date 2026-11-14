import type { Llm } from '$lib/core/ports';
import type { Env } from '$lib/server/auth';
import { createLlm, GEMINI_LLM_MODEL, geminiKey, geminiLlm } from './index';
import { noTrace, type Trace } from './trace';

/**
 * One routing table for every model job: which provider and model a job uses and its token ceiling. Every
 * call made through `llm.for(job)` carries `job` on its trace, so the trace drawer and the cost view can group
 * by job. `LLM_PROVIDER=fixture` (the dev and test default) keeps every job on the fixture: the table picks
 * among configured providers, it never turns spending on.
 */
export const LLM_JOBS = [
	'agent.plan',
	'agent.review_rewrite',
	'request.parse',
	'menu.propose',
	'explain',
	'chat.understand'
] as const;
export type LlmJob = (typeof LLM_JOBS)[number];

export interface LlmRoute {
	/** `env` = whatever LLM_PROVIDER says; a named provider is used only when its key is set. */
	provider: 'env' | 'gemini' | 'featherless';
	/** Model id for the provider (Gemini only; Featherless reads FEATHERLESS_MODEL). */
	model?: string;
	/** Ceiling for this job, under the adapter's global ceiling. */
	maxTokens: number;
}

export const LLM_ROUTES: Record<LlmJob, LlmRoute> = {
	'agent.plan': { provider: 'env', model: GEMINI_LLM_MODEL, maxTokens: 600 },
	'agent.review_rewrite': { provider: 'env', model: GEMINI_LLM_MODEL, maxTokens: 200 },
	'request.parse': { provider: 'env', model: GEMINI_LLM_MODEL, maxTokens: 600 },
	'menu.propose': { provider: 'env', model: GEMINI_LLM_MODEL, maxTokens: 1500 },
	explain: { provider: 'env', model: GEMINI_LLM_MODEL, maxTokens: 400 },
	'chat.understand': { provider: 'env', model: GEMINI_LLM_MODEL, maxTokens: 400 }
};

export interface LlmRouter {
	for(job: LlmJob): Llm;
}

export function createLlmRouter(
	env: Env,
	trace: Trace = noTrace,
	routes: Record<LlmJob, LlmRoute> = LLM_ROUTES
): LlmRouter {
	const fixture = (env.LLM_PROVIDER ?? 'fixture') === 'fixture';
	const cache = new Map<LlmJob, Llm>();
	return {
		for(job) {
			const hit = cache.get(job);
			if (hit) return hit;
			const route = routes[job];
			const provider = fixture
				? 'fixture'
				: route.provider === 'env'
					? env.LLM_PROVIDER
					: route.provider;
			const jobTrace: Trace = (step, data) => trace(step, { ...data, job });
			const gk = geminiKey(env);
			const base =
				provider === 'gemini' && gk
					? geminiLlm(gk, jobTrace, route.model ?? GEMINI_LLM_MODEL)
					: createLlm({ ...env, LLM_PROVIDER: provider }, jobTrace);
			const llm: Llm = {
				generate: (req) =>
					base.generate({ ...req, maxTokens: Math.min(req.maxTokens, route.maxTokens) })
			};
			cache.set(job, llm);
			return llm;
		}
	};
}
