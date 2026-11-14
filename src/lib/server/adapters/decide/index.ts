import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApiError, GoogleGenAI } from '@google/genai';
import { canonicalJson, sha256Hex } from '$lib/core/hash';
import type { Decide, Decision, DecideQuestion as PortQuestion } from '$lib/core/ports';
import type { Env } from '$lib/server/auth';
import { createExternalCall, RateLimited } from '../../external/call';
import {
	capFromEnv,
	createSpendLedger,
	sharedLedger,
	type GuardSource,
	type SpendLedger
} from '../../external/ledger';
import { currentScope } from '../../external/scope';
import { geminiKey } from '../llm';
import { logTrace, noTrace, type Trace } from '../llm/trace';

/**
 * Decide port: Gemini Decisions API (`gemini-decision-1`, v1beta) → recorded replay → rules
 * (docs/foundations/gemini.md §4). With `LLM_PROVIDER=fixture` there is no network: replay, then rules.
 * Every answer says which source produced it, with Gemini's calibrated p / probabilities when live or
 * replayed; the UI shows them. `batch` asks many questions in one call per shared context.
 */
export const DECISION_MODEL = 'gemini-decision-1';
/** Per attempt; a 120-question call measured ~0.6 s. */
const TIMEOUT_MS = 2500;
/** Wait before the one retry after a 429. */
const RETRY_429_MS = 600;

/** One question in a provider-neutral shape; also the replay key material. */
export type DecideQuestion =
	| { kind: 'yesNo'; question: string; context: string }
	| { kind: 'choice'; question: string; options: readonly string[]; context: string }
	| { kind: 'score'; question: string; rubric: string; max: number; context: string };

export interface Recorded {
	value: boolean | string | number;
	confidence: number;
	model: string;
	/** P(yes) for a yes/no question. */
	p?: number;
	/** Probability per option (choice) or per level index (score). */
	probabilities?: Record<string, number>;
}
export type ReplayBook = Record<string, Recorded>;

export async function replayKey(q: DecideQuestion): Promise<string> {
	const { kind, question, context } = q;
	const material =
		q.kind === 'choice'
			? { kind, question, options: q.options, context }
			: q.kind === 'score'
				? { kind, question, rubric: q.rubric, max: q.max, context }
				: { kind, question, context };
	return (await sha256Hex(canonicalJson({ model: DECISION_MODEL, ...material }))).slice(0, 32);
}

/** Score levels: the rubric's lines when it has exactly max+1 of them, else numbered levels. */
export function scoreCriteria(rubric: string, max: number): string[] {
	const lines = rubric
		.split(/\n|;/)
		.map((s) => s.trim())
		.filter(Boolean);
	if (lines.length === max + 1) return lines;
	return Array.from({ length: max + 1 }, (_, i) => `${i} of ${max}: ${rubric}`);
}

/** Deterministic answers with the right shape and an honest low confidence. */
export function rulesAnswer(q: DecideQuestion): Recorded {
	const ctx = q.context.toLowerCase();
	if (q.kind === 'yesNo') {
		// The one rule worth having offline: a quoted word in the question ("shellfish") that appears in
		// the context means yes; anything else is no at confidence 0.5.
		const words = (q.question.toLowerCase().match(/"[^"]+"/g) ?? []).map((w) => w.slice(1, -1));
		const hit = words.some((w) => ctx.includes(w));
		return { value: hit, confidence: hit ? 0.7 : 0.5, model: 'rules' };
	}
	if (q.kind === 'choice') {
		const named = q.options.find((o) => ctx.includes(o.toLowerCase()));
		return { value: named ?? q.options[0], confidence: 1 / q.options.length, model: 'rules' };
	}
	return { value: q.max / 2, confidence: 0.5, model: 'rules' };
}

function toGeminiQuestion(q: DecideQuestion) {
	if (q.kind === 'yesNo') return { type: 'noul' as const, instructions: q.question };
	if (q.kind === 'choice')
		return {
			type: 'choice' as const,
			instructions: q.question,
			criteria: Object.fromEntries(q.options.map((o) => [o, o]))
		};
	return {
		type: 'score' as const,
		instructions: q.question,
		criteria: scoreCriteria(q.rubric, q.max)
	};
}

type GeminiAnswer = {
	type: string;
	confidence?: number;
	noul?: number;
	choice?: string;
	score?: number;
	probabilities?: Record<string, number>;
};
type GeminiResponse = {
	answers?: Record<string, GeminiAnswer>;
	usage?: { total_input_tokens?: number };
};

export function fromGemini(a: GeminiAnswer): Recorded {
	const value =
		a.type === 'noul'
			? (a.noul ?? 0) >= 0.5
			: a.type === 'choice'
				? (a.choice ?? '')
				: (a.score ?? 0);
	return {
		value,
		confidence: a.confidence ?? 0,
		model: DECISION_MODEL,
		...(a.type === 'noul' && typeof a.noul === 'number' ? { p: a.noul } : {}),
		...(a.probabilities ? { probabilities: a.probabilities } : {})
	};
}

export interface DecideOptions {
	env: Env;
	/** Where traces go. Default: the caller's scope (`withExternalScope`), else nowhere. */
	trace?: Trace;
	/** Replay file: recorded live answers keyed by `replayKey`. */
	replayPath?: string;
	/** Write new live answers back to `replayPath` (opt-in recording runs only: `DECIDE_RECORD=1`). */
	record?: boolean;
	/** Daily call caps; default: the process-wide ledger with `DECIDE_CAP_PER_WORKSPACE` / `DECIDE_CAP_GLOBAL`. */
	spend?: SpendLedger;
	/** Injectable for tests. */
	gemini?: { create: (body: unknown) => Promise<unknown> };
	/** Injectable for tests (the 429 back-off). */
	sleep?: (ms: number) => Promise<void>;
}

export function loadReplay(path?: string): ReplayBook {
	if (!path) return {};
	try {
		return JSON.parse(readFileSync(path, 'utf8')) as ReplayBook;
	} catch (e) {
		// Without the book, decisions fall back to the rules; say so once instead of failing quietly.
		console.warn(`[decide] replay book not loaded from ${path}: ${(e as Error).message}`);
		return {};
	}
}

function liveClient(o: DecideOptions): DecideOptions['gemini'] | null {
	if (o.env.LLM_PROVIDER === 'fixture') return null;
	if (o.gemini) return o.gemini;
	const key = geminiKey(o.env);
	if (!key) return null;
	const ai = new GoogleGenAI({ apiKey: key, apiVersion: 'v1beta' });
	return { create: (b: unknown) => ai.decisions.create(b as never) };
}

/**
 * Daily Decide calls per visitor workspace and per instance (UTC day). A cap reached never blocks a
 * flow: the answer falls back to replay, then rules, labelled as such.
 */
export const DEFAULT_DECIDE_LIMITS = { perKey: 300, global: 5000 };

const g = globalThis as typeof globalThis & { __decideSpend?: SpendLedger };
function processLedger(env: Env): SpendLedger {
	if (g.__decideSpend) return g.__decideSpend;
	const dir = process.env.VITEST ? undefined : env.WEB_CACHE_DIR || join('scratch', 'web-cache');
	return (g.__decideSpend = createSpendLedger(dir && join(dir, 'decide-spend.json')));
}
export const decideSpend = (env: Env) => processLedger(env).usage();

/** Live answers kept per process before the oldest is dropped. */
const MEMO_MAX = 2000;

const fromPort = (q: PortQuestion): DecideQuestion =>
	q.kind === 'yes_no'
		? { kind: 'yesNo', question: q.question, context: q.context }
		: q.kind === 'choice'
			? { kind: 'choice', question: q.question, options: q.options, context: q.context }
			: { kind: 'score', question: q.question, rubric: q.rubric, max: q.max, context: q.context };

type Source = Decision<unknown>['source'];
type Answer = { rec: Recorded; source: Source; latencyMs: number };

export function createDecide(o: DecideOptions): Decide {
	const book = loadReplay(o.replayPath);
	const client = liveClient(o);
	const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
	// The caps are shared by every instance once the web state is in Postgres (`web_spend`, api 'gemini-decide');
	// before that, and in tests, a per-process file ledger.
	const ledgerFor = async (): Promise<GuardSource> => {
		if (o.spend) return o.spend;
		if (!sharedLedger() && !process.env.VITEST)
			await import('../../web').then((m) => m.webStateReady(process.env)).catch(() => {});
		return sharedLedger() ?? processLedger(o.env);
	};
	const limits = {
		perKey: capFromEnv(o.env.DECIDE_CAP_PER_WORKSPACE, DEFAULT_DECIDE_LIMITS.perKey),
		global: capFromEnv(o.env.DECIDE_CAP_GLOBAL, DEFAULT_DECIDE_LIMITS.global)
	};
	const external = createExternalCall({
		api: 'gemini',
		name: 'gemini-decide',
		step: 'decision',
		cache: false,
		trace: o.trace,
		guard: (scope) => {
			const key = scope?.spendKey ?? scope?.workspaceId ?? null;
			return { charge: async (api) => (await ledgerFor()).guard(key, limits).charge(api) };
		},
		// A 400 (safety block, bad key) is about this input, not an outage.
		isOutage: (e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500)
	});
	const traceOf = () => o.trace ?? currentScope()?.trace ?? noTrace;

	/** One Decisions call for questions sharing a context; null for each question it did not answer. */
	async function live(
		context: string,
		qs: { key: string; q: DecideQuestion }[]
	): Promise<(Answer | null)[]> {
		// Question ids sent to Gemini are positional: caller ids may not match [A-Za-z0-9_-]{1,64}.
		const questions = Object.fromEntries(qs.map((x, i) => [`q${i}`, toGeminiQuestion(x.q)]));
		const body = { model: DECISION_MODEL, input: context, questions };
		const attempt = () => withTimeout(client!.create(body), TIMEOUT_MS) as Promise<GeminiResponse>;
		const r = await external<GeminiResponse>(
			{
				key: qs.map((x) => x.key),
				purpose: `decide.${qs.length > 1 ? 'batch' : qs[0].q.kind}`,
				detail: {
					kind: qs.length > 1 ? 'batch' : qs[0].q.kind,
					questions: qs.length,
					question: qs[0].q.question.slice(0, 160)
				}
			},
			async () => {
				let res: GeminiResponse;
				try {
					res = await attempt();
				} catch (e) {
					if (!(e instanceof ApiError && e.status === 429)) throw e;
					await sleep(RETRY_429_MS);
					try {
						res = await attempt();
					} catch (e2) {
						if (e2 instanceof ApiError && e2.status === 429)
							throw new RateLimited(30, 'gemini 429 RESOURCE_EXHAUSTED');
						throw e2;
					}
				}
				const answers = qs.map((x, i) => {
					const a = res.answers?.[`q${i}`];
					return a ? { id: x.key, ...fromGemini(a) } : null;
				});
				return {
					value: res,
					model: DECISION_MODEL,
					costUnits: res.usage?.total_input_tokens,
					detail: {
						tokensIn: res.usage?.total_input_tokens,
						tokensOut: 0,
						answers: answers.slice(0, 40).map((a, i) =>
							a
								? {
										q: qs[i].q.question.slice(0, 80),
										value: a.value,
										confidence: a.confidence,
										p: a.p,
										probabilities: a.probabilities
									}
								: null
						)
					}
				};
			}
		);
		return qs.map((x, i) => {
			const a = r.value.answers?.[`q${i}`];
			if (!a) return null;
			const rec = fromGemini(a);
			if (o.record && o.replayPath) book[x.key] = rec;
			return { rec, source: 'gemini' as const, latencyMs: r.latencyMs };
		});
	}

	function fallback(key: string, q: DecideQuestion): Answer {
		const t0 = performance.now();
		const replayed = book[key];
		const rec = replayed ?? rulesAnswer(q);
		const source: Source = replayed ? 'replay' : 'rules';
		const latencyMs = Math.round(performance.now() - t0);
		const data = {
			api: 'gemini',
			purpose: `decide.${q.kind}`,
			cache: replayed ? 'replay' : 'fixture',
			ok: true,
			latencyMs,
			model: rec.model,
			workspaceId: currentScope()?.workspaceId,
			source,
			kind: q.kind,
			question: q.question.slice(0, 160),
			value: rec.value,
			confidence: rec.confidence,
			p: rec.p,
			probabilities: rec.probabilities,
			...(replayed ? { replayKey: key } : {})
		};
		traceOf()('decision', data);
		logTrace(data);
		return { rec, source, latencyMs };
	}

	// Live answers per process, keyed like the replay book: the same question (one recipe fit asked by every
	// snapshot) gets the same answer without another call, so rankings don't flicker. Concurrent asks share one
	// call; fallbacks (replay, rules) are not kept, so a later ask retries the live model.
	const memo = new Map<string, Promise<Answer | null>>();
	const remember = (k: string, p: Promise<Answer | null>) => {
		memo.set(k, p);
		p.then(
			(a) => {
				if (!a) memo.delete(k);
				else if (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value!);
			},
			() => memo.delete(k)
		);
	};

	async function askAll(qs: DecideQuestion[]): Promise<Answer[]> {
		const keys = await Promise.all(qs.map(replayKey));
		const pending: (Promise<Answer | null> | null)[] = keys.map((k) => memo.get(k) ?? null);
		if (client) {
			// New questions, grouped by shared context: one call per group.
			const groups = new Map<string, { key: string; q: DecideQuestion; i: number }[]>();
			keys.forEach((key, i) => {
				if (pending[i]) return;
				const dup = keys.indexOf(key);
				if (dup < i) return; // the same question twice in one batch is asked once
				const list = groups.get(qs[i].context) ?? [];
				list.push({ key, q: qs[i], i });
				groups.set(qs[i].context, list);
			});
			for (const [context, list] of groups) {
				const call = live(context, list).catch(() => list.map(() => null));
				list.forEach((x, j) => {
					const p = call.then((as) => as[j]);
					pending[x.i] = p;
					remember(x.key, p);
				});
			}
			keys.forEach((key, i) => (pending[i] ??= memo.get(key) ?? null));
		}
		const answers = await Promise.all(
			pending.map(async (p, i) => (p ? await p : null) ?? fallback(keys[i], qs[i]))
		);
		if (o.record && o.replayPath && client)
			writeFileSync(o.replayPath, JSON.stringify(sortKeys(book), null, '\t') + '\n');
		return answers;
	}

	const toDecision = <T>(a: Answer): Decision<T> => ({
		value: a.rec.value as T,
		confidence: a.rec.confidence,
		...(a.rec.p !== undefined ? { p: a.rec.p } : {}),
		...(a.rec.probabilities ? { probabilities: a.rec.probabilities } : {}),
		source: a.source,
		model: a.rec.model,
		latencyMs: a.latencyMs
	});
	const one = async <T>(q: DecideQuestion) => toDecision<T>((await askAll([q]))[0]);

	return {
		yesNo: (q) => one<boolean>({ kind: 'yesNo', ...q }),
		choice: <T extends string>(q: { question: string; options: readonly T[]; context: string }) =>
			one<T>({ kind: 'choice', ...q }),
		score: (q) => one<number>({ kind: 'score', ...q }),
		async batch(qs) {
			const answers = await askAll(qs.map(fromPort));
			return Object.fromEntries(qs.map((q, i) => [q.id, toDecision(answers[i])]));
		}
	};
}

const sortKeys = (b: ReplayBook): ReplayBook =>
	Object.fromEntries(
		Object.keys(b)
			.sort()
			.map((k) => [k, b[k]])
	);

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return Promise.race([
		p,
		new Promise<never>((_, rej) => {
			timer = setTimeout(() => rej(new Error(`timeout after ${ms} ms`)), ms);
		})
	]).finally(() => clearTimeout(timer));
}
