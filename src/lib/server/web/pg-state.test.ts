import { describe, expect, it } from 'vitest';
import { createFixtureDb } from '../db/pglite';
import type { AnyDb } from '../store/drizzle-store';
import { createExternalCall, resetExternalCache } from '../external/call';
import { resetBreakers } from '../external/breaker';
import { LimitError, setSharedLedger } from '../external/ledger';
import { withExternalScope } from '../external/scope';
import { createDecide } from '../adapters/decide';
import { createPgWebState } from './pg-state';
import { attachStateSink, hydrateSlot, stateWrites } from './persist';
import { createFindings } from './findings';
import { createWorkQueue } from './queue';

/** Web state in Postgres (migration 0004) on PGlite: the same SQL Aiven runs. */
async function state(clock?: () => Date) {
	const { db } = await createFixtureDb();
	return createPgWebState(db as unknown as AnyDb, clock);
}

describe('web state in Postgres', { timeout: 30_000 }, () => {
	it('spend caps are shared counters: per key and global, per UTC day, nothing charged past a cap', async () => {
		let now = new Date('2026-11-14T23:00:00Z');
		const s = await state(() => now);
		const a = s.guard('chef:a', { perKey: 2, global: 3 });
		await a.charge('exa');
		await a.charge('exa');
		await expect(a.charge('exa')).rejects.toMatchObject({ reason: 'cap-key', retryAfterS: 3600 });
		await s.guard('chef:b', { perKey: 2, global: 3 }).charge('exa');
		await expect(s.guard('chef:c', { perKey: 2, global: 3 }).charge('exa')).rejects.toBeInstanceOf(
			LimitError
		);
		// A refused key charge rolled back its global bump.
		expect(await s.usage()).toEqual([
			{ api: 'exa', key: '*', n: 3 },
			{ api: 'exa', key: 'chef:a', n: 2 },
			{ api: 'exa', key: 'chef:b', n: 1 }
		]);
		now = new Date('2026-11-15T00:00:01Z');
		await a.charge('exa');
	});

	it('the response cache survives the process: a second instance answers from Postgres', async () => {
		const s = await state();
		resetBreakers();
		let sent = 0;
		const call = createExternalCall({ api: 'exa', name: 'exa-pg', store: s.cache });
		const req = { key: 'q1', purpose: 'facts', maxAgeMs: 60_000 };
		await call(req, async () => ({ value: { n: ++sent }, costUnits: 2 }));
		resetExternalCache(); // a new process: memory is empty
		const r = await call(req, async () => ({ value: { n: ++sent } }));
		expect(r).toMatchObject({ value: { n: 1 }, cache: 'cache' });
		expect(sent).toBe(1);
	});

	it('findings and the queue write through and hydrate into a fresh process', async () => {
		const s = await state();
		attachStateSink(s);
		try {
			const f = createFindings();
			f.put({
				id: 'recall:x',
				kind: 'recall',
				at: '2026-11-14T10:00:00Z',
				title: 'X',
				sources: [],
				data: {}
			});
			const q = createWorkQueue();
			q.add({ kind: 'notice', url: 'https://ruokavirasto.fi/a' });
			await stateWrites();
			expect((await s.load('__webFindings')).map((d) => d.id)).toContain('recall:x');
			q.done('notice:https://ruokavirasto.fi/a');
			await stateWrites();
			expect(await s.load('__webQueue')).toEqual([]);
			// A fresh process: hydrate the slot from the table.
			const fresh = new Map<string, Record<string, unknown>>();
			hydrateSlot('__webFindings', fresh, await s.load('__webFindings'), (d) => String(d.id));
			expect(fresh.has('recall:x')).toBe(true);
		} finally {
			attachStateSink(null);
		}
	});

	it('two instances claiming the queue never get the same item (FOR UPDATE SKIP LOCKED)', async () => {
		const s = await state();
		for (const id of ['a', 'b', 'c'])
			await s.upsert('__webQueue', `notice:${id}`, {
				id: `notice:${id}`,
				kind: 'notice',
				at: `2026-11-14T10:00:0${id.charCodeAt(0) - 97}Z`,
				attempts: 0
			});
		const [one, two] = await Promise.all([s.claimQueue('i1', 2), s.claimQueue('i2', 2)]);
		expect(new Set([...one, ...two]).size).toBe(one.length + two.length);
		expect(one.length + two.length).toBe(3);
		await s.releaseQueue('i1');
		expect((await s.claimQueue('i3', 5)).length).toBe(one.length);
	});

	it('Gemini Decide calls are capped per visitor workspace in web_spend once Postgres is attached', async () => {
		const s = await state();
		resetBreakers();
		setSharedLedger(s);
		try {
			const d = createDecide({
				env: { LLM_PROVIDER: 'gemini', DECIDE_CAP_PER_WORKSPACE: '1' },
				gemini: {
					create: async () => ({ answers: { q0: { type: 'noul', noul: 0.2, confidence: 0.8 } } })
				}
			});
			await withExternalScope({ workspaceId: 'ws-j-pg' }, async () => {
				expect((await d.yesNo({ question: 'pg a?', context: 'c' })).source).toBe('gemini');
				expect((await d.yesNo({ question: 'pg b?', context: 'c' })).source).toBe('rules');
			});
			expect(await s.usage()).toEqual([
				{ api: 'gemini-decide', key: '*', n: 1 },
				{ api: 'gemini-decide', key: 'ws-j-pg', n: 1 }
			]);
		} finally {
			setSharedLedger(null);
		}
	});
});
