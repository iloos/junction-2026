import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDbPorts } from '../store/db-ports';
import { createFindings } from './findings';
import { createFixtureFactSearch } from './fixture';
import {
	groundDish,
	groundingFor,
	needsGrounding,
	resetGrounding,
	RETRY_AFTER_MS,
	startGrounding
} from './grounding';
import type { FactSearch } from './exa';

/** The recorded Exa answer for "joulutorttu" (fixture replay): one cited recipe with six ingredients. */
const tart = {
	name: 'joulutorttu',
	ingredients: [
		{ label: 'lehtitaikinalevyt' },
		{ label: 'kananmuna' },
		{ label: 'kuohukerma' },
		{ label: 'kaviaari' }
	]
};

beforeEach(() => resetGrounding());

describe('grounded menu (recorded answers, no network)', { timeout: 30_000 }, () => {
	it('matches the model dish to a cited recipe and names what each side has alone', async () => {
		const env = await createDbPorts({ runId: 'run-ground' });
		const g = await groundDish(tart, {
			exa: createFixtureFactSearch(),
			catalog: env.ports.catalog,
			findings: createFindings(undefined, true)
		});
		expect(g.source).toBe('replay');
		expect(g.compared.length).toBeGreaterThan(0);
		expect(g.matchedSources[0]).toMatchObject({ shared: 3, of: 4 });
		expect(g.matchedSources[0].url).toMatch(/^https:\/\//);
		expect(g.modelOnly).toEqual(['kaviaari']);
		expect(g.sourceOnly.some((s) => /vaniljasokeri|marmeladi/.test(s))).toBe(true);
		expect(g.note).toMatch(/Matches 1 sourced recipe/);
	});

	it('a dish with no recorded recipe says so and claims nothing', async () => {
		const env = await createDbPorts({ runId: 'run-ground-2' });
		const g = await groundDish(
			{ name: 'Wagyu tartar', ingredients: [{ label: 'naudanliha' }] },
			{
				exa: createFixtureFactSearch(),
				catalog: env.ports.catalog,
				findings: createFindings(undefined, true)
			}
		);
		expect(g).toMatchObject({ matchedSources: [], modelOnly: [], sourceOnly: [] });
		expect(g.note).toMatch(/No recorded recipe/);
	});

	it('runs in the background: pending first, then done, once per dish name', async () => {
		const env = await createDbPorts({ runId: 'run-ground-3' });
		const deps = {
			exa: createFixtureFactSearch(),
			catalog: env.ports.catalog,
			findings: createFindings(undefined, true)
		};
		const p = startGrounding([tart], deps);
		expect(groundingFor([tart]).joulutorttu?.state).toBe('pending');
		await p;
		expect(groundingFor([tart]).joulutorttu?.state).toBe('done');
		await startGrounding([tart], deps); // already known: no second lookup
		expect(groundingFor([{ name: 'Unknown dish', ingredients: [{ label: 'x' }] }])).toEqual({});
		// Same name, other ingredients (another visitor's proposal): not the same verdict.
		expect(
			groundingFor([{ name: 'joulutorttu', ingredients: [{ label: 'lehtitaikinalevyt' }] }])
		).toEqual({});
	});
});

describe('a failed or empty grounding is retried', { timeout: 30_000 }, () => {
	afterEach(() => vi.useRealTimers());
	it('stands for five minutes, then the next start asks again', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-14T10:00:00Z'));
		const env = await createDbPorts({ runId: 'run-ground-4' });
		const fixture = createFixtureFactSearch();
		let fail = true;
		const exa: FactSearch = {
			...fixture,
			async structured(q) {
				if (fail) throw new Error('exa 503');
				return fixture.structured(q);
			}
		};
		const deps = { exa, catalog: env.ports.catalog, findings: createFindings(undefined, true) };
		await startGrounding([tart], deps);
		expect(groundingFor([tart]).joulutorttu?.state).toBe('failed');
		fail = false;
		expect(needsGrounding([tart])).toBe(false);
		await startGrounding([tart], deps); // within the retry: no new lookup
		expect(groundingFor([tart]).joulutorttu?.state).toBe('failed');
		vi.setSystemTime(Date.now() + RETRY_AFTER_MS + 1000);
		expect(needsGrounding([tart])).toBe(true);
		await startGrounding([tart], deps);
		expect(groundingFor([tart]).joulutorttu?.state).toBe('done');
		expect(needsGrounding([tart])).toBe(false);
	});
});
