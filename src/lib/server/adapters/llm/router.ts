import type { Llm } from '$lib/core/ports';
import type { Env } from '$lib/server/auth';
import { createLlm, GEMINI_LLM_MODEL, geminiKey, geminiLlm, type ThinkingLevel } from './index';
import { capFromEnv, scopedCap } from '../../external/ledger';
import { createExternalCall } from '../../external/call';
import { currentScope } from '../../external/scope';
import { logTrace, noTrace, type Trace } from './trace';
import { verdaLlm, VERDA_VISION_MODEL } from './verda';

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
	'request.parse.escalate',
	'menu.propose',
	'explain',
	'chat.understand',
	'chat.agent',
	'establishment.match',
	'image.read'
] as const;
export type LlmJob = (typeof LLM_JOBS)[number];

export interface LlmRoute {
	/** `env` = whatever LLM_PROVIDER says; a named provider is used only when its key is set. */
	provider: 'env' | 'gemini' | 'featherless' | 'verda';
	/** Model id for the provider (Gemini only; Featherless reads FEATHERLESS_MODEL). */
	model?: string;
	/** Ceiling for this job, under the adapter's global ceiling; includes thinking tokens. */
	maxTokens: number;
	/** Gemini thinking level; always set, since the model default (high) spends the budget on thoughts. */
	thinking?: ThinkingLevel;
}

/**
 * Measured per job on real inputs (docs/research/gemini-models.md): Flash-Lite at minimal thinking matched
 * gemini-3.8-flash (low) and gemini-4-hydrogen (low) on parse, plan and explain at a third of the latency, so the
 * interactive jobs stay on it. The menu proposal is the one job where Flash-Lite missed (8/10 vs 10/10 on the golden
 * briefs), so it takes gemini-3.8-flash at low thinking with headroom for thoughts. 3.8-flash rejects `minimal`.
 */
export const LLM_ROUTES: Record<LlmJob, LlmRoute> = {
	'agent.plan': { provider: 'env', model: GEMINI_LLM_MODEL, thinking: 'minimal', maxTokens: 600 },
	'agent.review_rewrite': {
		provider: 'env',
		model: GEMINI_LLM_MODEL,
		thinking: 'minimal',
		maxTokens: 200
	},
	'request.parse': {
		provider: 'env',
		model: GEMINI_LLM_MODEL,
		thinking: 'minimal',
		maxTokens: 600
	},
	// The parse's second pass when the first reading is unsure (D12 cascade, docs/foundations/models.md).
	'request.parse.escalate': {
		provider: 'env',
		model: 'gemini-3.8-flash',
		thinking: 'low',
		maxTokens: 800
	},
	'menu.propose': { provider: 'env', model: 'gemini-3.8-flash', thinking: 'low', maxTokens: 4000 },
	explain: { provider: 'env', model: GEMINI_LLM_MODEL, thinking: 'minimal', maxTokens: 400 },
	'chat.understand': {
		provider: 'env',
		model: GEMINI_LLM_MODEL,
		thinking: 'minimal',
		maxTokens: 400
	},
	// The chat as an agent (CHAT_HARNESS=llm): one step of its tool loop, a tool call or the typed reply.
	'chat.agent': {
		provider: 'env',
		model: GEMINI_LLM_MODEL,
		thinking: 'minimal',
		maxTokens: 1200
	},
	// Mapping a chef's description to the nearest seeded kitchen (D15): one short JSON answer.
	'establishment.match': {
		provider: 'env',
		model: GEMINI_LLM_MODEL,
		thinking: 'minimal',
		maxTokens: 300
	},
	// Pictures: NVIDIA Nemotron 3.5 Super VL on Verda, thinking off (adapters/llm/verda.ts).
	'image.read': { provider: 'verda', model: VERDA_VISION_MODEL, maxTokens: 1500 }
};

export interface LlmRouter {
	for(job: LlmJob): Llm;
}

/**
 * Daily model calls (all text jobs together) per visitor workspace and per instance (UTC day). Over a cap the call is
 * refused with a rate-limit error before anything is sent; every caller already falls back on a failed call (parse to
 * the rules, the planner to its stop).
 */
export const DEFAULT_LLM_LIMITS = { perKey: 200, global: 3000 };
/** Picture readings (image.read) per visitor workspace and per instance (UTC day). */
export const DEFAULT_VISION_LIMITS = { perKey: 30, global: 500 };

/**
 * Every job's calls go through the shared outside-call helper: one ExternalCallTrace each (job, model, tokens,
 * latency) into the caller's trace drawer, a breaker, and the daily caps. The trace goes to `trace` when given, else to
 * the caller's scope (a tool call's workspace). Fixture calls are traced as `fixture` and charge nothing.
 */
export function createLlmRouter(
	env: Env,
	trace?: Trace,
	routes: Record<LlmJob, LlmRoute> = LLM_ROUTES,
	/** Test hook: the provider client for a live route (default: the Gemini or OpenAI-compatible adapter). */
	client?: (route: LlmRoute) => Llm
): LlmRouter {
	const fixture = (env.LLM_PROVIDER ?? 'fixture') === 'fixture';
	const cache = new Map<LlmJob, Llm>();
	const guard = scopedCap({
		name: 'gemini-text',
		limits: {
			perKey: capFromEnv(env.LLM_CAP_PER_WORKSPACE, DEFAULT_LLM_LIMITS.perKey),
			global: capFromEnv(env.LLM_CAP_GLOBAL, DEFAULT_LLM_LIMITS.global)
		}
	});
	const visionGuard = scopedCap({
		name: 'verda-vision',
		limits: {
			perKey: capFromEnv(env.VISION_CAP_PER_WORKSPACE, DEFAULT_VISION_LIMITS.perKey),
			global: capFromEnv(env.VISION_CAP_GLOBAL, DEFAULT_VISION_LIMITS.global)
		}
	});
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
			const jobTrace: Trace = (step, data) =>
				(trace ?? currentScope()?.trace ?? noTrace)(step, { ...data, job });
			const gk = geminiKey(env);
			const live =
				provider === 'gemini' && gk
					? 'gemini'
					: provider === 'featherless'
						? 'featherless'
						: provider === 'verda' && env.VERDA_INFERENCE_KEY
							? 'verda'
							: null;
			const base =
				live && client
					? client(route)
					: live === 'gemini'
						? geminiLlm(gk!, noTrace, route.model ?? GEMINI_LLM_MODEL, route.thinking ?? 'minimal')
						: live === 'verda'
							? verdaLlm({ apiKey: env.VERDA_INFERENCE_KEY!, model: route.model })
							: createLlm({ ...env, LLM_PROVIDER: provider }, noTrace);
			const call = live
				? createExternalCall({
						api: live,
						name: `${live}-${live === 'verda' ? 'vision' : 'text'}`,
						step: 'text',
						cache: false,
						trace: jobTrace,
						guard: live === 'verda' ? visionGuard : guard
					})
				: null;
			const llm: Llm = {
				async generate(req) {
					const r = { ...req, maxTokens: Math.min(req.maxTokens, route.maxTokens) };
					if (!call) {
						const res = await base.generate(r);
						// The ExternalCallTrace shape, with source 'fixture' so nothing reads it as a model answer.
						const data = {
							api: 'other',
							purpose: job,
							cache: 'fixture',
							ok: true,
							latencyMs: res.latencyMs,
							model: res.model,
							workspaceId: currentScope()?.workspaceId,
							maxTokens: r.maxTokens,
							source: 'fixture'
						};
						jobTrace('text', data);
						logTrace(data, 'text');
						return res;
					}
					const out = await call(
						{
							key: job,
							purpose: job,
							detail: { maxTokens: r.maxTokens, thinking: route.thinking }
						},
						async () => {
							const res = await base.generate(r);
							return {
								value: res,
								model: res.model,
								costUnits: res.tokens.in + res.tokens.out,
								detail: { tokensIn: res.tokens.in, tokensOut: res.tokens.out }
							};
						}
					);
					return out.value;
				}
			};
			cache.set(job, llm);
			return llm;
		}
	};
}
