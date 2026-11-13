import { readFileSync, writeFileSync } from 'node:fs';
import { GoogleGenAI } from '@google/genai';
import { canonicalJson, sha256Hex } from '$lib/core/hash';
import type { Decide, Decision } from '$lib/core/ports';
import type { Env } from '$lib/server/auth';
import { geminiKey } from '../llm';
import { logTrace, noTrace, type Trace } from '../llm/trace';

/**
 * Decide port: Gemini Decisions API (`gemini-decision-1`, v1beta) → recorded replay → rules
 * (docs/foundations/gemini.md §4). With `LLM_PROVIDER=fixture` there is no network: replay, then rules.
 * Every answer says which source produced it; the UI shows it.
 */
export const DECISION_MODEL = 'gemini-decision-1';
const TIMEOUT_MS = 2000;

/** One question in a provider-neutral shape; also the replay key material. */
export type DecideQuestion =
	| { kind: 'yesNo'; question: string; context: string }
	| { kind: 'choice'; question: string; options: readonly string[]; context: string }
	| { kind: 'score'; question: string; rubric: string; max: number; context: string };

export interface Recorded {
	value: boolean | string | number;
	confidence: number;
	model: string;
}
export type ReplayBook = Record<string, Recorded>;

export async function replayKey(q: DecideQuestion): Promise<string> {
	return (await sha256Hex(canonicalJson({ model: DECISION_MODEL, ...q }))).slice(0, 32);
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
};

export interface DecideOptions {
	env: Env;
	trace?: Trace;
	/** Replay file: recorded live answers keyed by `replayKey`. */
	replayPath?: string;
	/** Write new live answers back to `replayPath` (dev only: `DECIDE_RECORD=1`). */
	record?: boolean;
	/** Injectable for tests. */
	gemini?: { create: (body: unknown) => Promise<unknown> };
}

export function loadReplay(path?: string): ReplayBook {
	if (!path) return {};
	try {
		return JSON.parse(readFileSync(path, 'utf8')) as ReplayBook;
	} catch {
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

export function createDecide(o: DecideOptions): Decide {
	const trace = o.trace ?? noTrace;
	const book = loadReplay(o.replayPath);
	const client = liveClient(o);

	async function ask(q: DecideQuestion): Promise<Decision<boolean | string | number>> {
		const t0 = performance.now();
		const k = await replayKey(q);
		const done = (
			r: Recorded,
			source: Decision<unknown>['source'],
			extra: Record<string, unknown> = {}
		) => {
			const latencyMs = Math.round(performance.now() - t0);
			const data = {
				source,
				model: r.model,
				kind: q.kind,
				question: q.question.slice(0, 160),
				value: r.value,
				confidence: r.confidence,
				latencyMs,
				...extra
			};
			trace('decision', data);
			logTrace(data);
			return { value: r.value, confidence: r.confidence, source, model: r.model, latencyMs };
		};

		if (client) {
			try {
				const res = (await withTimeout(
					client.create({
						model: DECISION_MODEL,
						input: q.context,
						questions: { q: toGeminiQuestion(q) }
					}),
					TIMEOUT_MS
				)) as { answers?: Record<string, GeminiAnswer>; usage?: { total_input_tokens?: number } };
				const a = res.answers?.q;
				if (a) {
					const value =
						a.type === 'noul'
							? (a.noul ?? 0) >= 0.5
							: a.type === 'choice'
								? (a.choice ?? '')
								: (a.score ?? 0);
					const rec: Recorded = { value, confidence: a.confidence ?? 0, model: DECISION_MODEL };
					if (o.record && o.replayPath) {
						book[k] = rec;
						writeFileSync(o.replayPath, JSON.stringify(book, null, '\t') + '\n');
					}
					return done(rec, 'gemini', {
						tokensIn: res.usage?.total_input_tokens,
						tokensOut: 0,
						p: a.noul
					});
				}
			} catch (e) {
				trace('error', {
					source: 'gemini',
					model: DECISION_MODEL,
					error: String((e as Error)?.message ?? e).slice(0, 200),
					latencyMs: Math.round(performance.now() - t0)
				});
			}
		}
		if (book[k]) return done(book[k], 'replay', { replayKey: k });
		return done(rulesAnswer(q), 'rules');
	}

	return {
		yesNo: async (q) => (await ask({ kind: 'yesNo', ...q })) as Decision<boolean>,
		choice: async <T extends string>(q: {
			question: string;
			options: readonly T[];
			context: string;
		}) => (await ask({ kind: 'choice', ...q })) as Decision<T>,
		score: async (q) => (await ask({ kind: 'score', ...q })) as Decision<number>
	};
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return Promise.race([
		p,
		new Promise<never>((_, rej) => {
			timer = setTimeout(() => rej(new Error(`timeout after ${ms} ms`)), ms);
		})
	]).finally(() => clearTimeout(timer));
}
