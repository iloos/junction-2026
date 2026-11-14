/**
 * Record and replay at the Llm port, so a model-driven trial runs offline in the gate exactly as it ran live. Keyed by
 * a hash of the request (system, prompt, maxTokens, json) with run-specific ids and timestamps normalised, so the same
 * chef message against the same state finds its recording on another run. Live: calls `inner` and, with `record`,
 * writes the answer to `path`. Offline (no `inner`): a hit replays; a miss throws, never falls back silently, because
 * a fallback would test the rules instead of the model.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Llm } from '$lib/core/ports';

type Req = Parameters<Llm['generate']>[0];
interface Recorded {
	text: string;
	model: string;
	tokens: { in: number; out: number };
}

export class ReplayMiss extends Error {
	constructor(public key: string) {
		super(
			`no recorded model answer for ${key.slice(0, 12)}; re-record with CHAT_LIVE=1 CHAT_RECORD=1 pnpm eval:live`
		);
	}
}

/** Request text with run-specific values replaced, so recordings survive new ids and clocks. */
export function normalise(s: string): string {
	return s
		.replace(/\b(pl-run|run|task|ap|rc|ws-j|rq|or)-[a-z0-9-]{6,}/gi, '$1-*')
		.replace(/\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:\d\d)?/g, '<time>')
		.replace(/\b\d{13}\b/g, '<ms>');
}

export function replayKey(req: Req): string {
	const material = JSON.stringify({
		s: normalise(req.system ?? ''),
		p: normalise(req.prompt),
		m: req.maxTokens,
		j: req.json ?? false
	});
	return createHash('sha256').update(material).digest('hex');
}

export function replayLlm(o: { path: string; inner?: Llm; record?: boolean }): Llm & {
	hits: number;
	misses: number;
} {
	return replayBook(o.path).wrap(o.inner, o.record);
}

/**
 * One recording file shared by several models (the chat's understand, explain and plan jobs): every wrapper reads and
 * writes the same book, so one job's recording never overwrites another's.
 */
export function replayBook(path: string) {
	const book: Record<string, Recorded> = existsSync(path)
		? JSON.parse(readFileSync(path, 'utf-8'))
		: {};
	return { wrap: (inner?: Llm, record?: boolean) => wrapBook(book, path, inner, record) };
}

function wrapBook(
	book: Record<string, Recorded>,
	path: string,
	inner?: Llm,
	record?: boolean
): Llm & { hits: number; misses: number } {
	const o = { path, inner, record };
	const self = {
		hits: 0,
		misses: 0,
		async generate(req: Req) {
			const key = replayKey(req);
			const hit = book[key];
			if (hit && !(o.inner && o.record)) {
				self.hits++;
				return { ...hit, latencyMs: 0 };
			}
			self.misses++;
			if (!o.inner) throw new ReplayMiss(key);
			const r = await o.inner.generate(req);
			if (o.record) {
				book[key] = { text: r.text, model: r.model, tokens: r.tokens };
				writeFileSync(o.path, JSON.stringify(book, null, 1) + '\n');
			}
			return r;
		}
	};
	return self;
}
