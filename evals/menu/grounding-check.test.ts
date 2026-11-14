// Self-tests of the grounded-menu checks. `node --test evals/menu/grounding-check.test.ts` (evals:self).
/* eslint-disable @typescript-eslint/no-explicit-any -- the self-tests mutate states loosely */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkGrounding, type GroundingState, type MenuShape } from './grounding-check.ts';

const menu: MenuShape = {
	dishes: [
		{
			id: 'd1',
			name: 'Graavilohi',
			ingredients: [
				{ id: 'i1', label: 'lohifilee' },
				{ id: 'i2', label: 'merisuola' }
			]
		},
		{ id: 'd2', name: 'Luumukiisseli', ingredients: [{ id: 'i3', label: 'luumu' }] }
	]
};
const mtk = { url: 'https://www.mtk.fi/resepti/graavilohi', title: 'Graavilohi', host: 'mtk.fi' };
const good: Record<string, GroundingState> = {
	Graavilohi: {
		dishName: 'Graavilohi',
		state: 'done',
		source: 'replay',
		matchedSources: [{ ...mtk, shared: 1, of: 2 }],
		compared: [mtk],
		modelOnly: ['merisuola'],
		sourceOnly: ['tilli', 'sokeri'],
		note: 'Matches 1 sourced recipe(s) (mtk.fi).'
	},
	Luumukiisseli: {
		dishName: 'Luumukiisseli',
		state: 'done',
		source: 'replay',
		matchedSources: [],
		compared: [],
		modelOnly: [],
		sourceOnly: [],
		note: 'No recorded recipe for this dish in fixture mode.'
	}
};
const failed = (rs: ReturnType<typeof checkGrounding>) =>
	rs.filter((r) => !r.pass).map((r) => r.key.split('.').slice(1).join('.'));
const edit = (f: (g: Record<string, any>) => void) => {
	const g = structuredClone(good) as Record<string, any>;
	f(g);
	return g as Record<string, GroundingState>;
};

test('a matched dish and an honest "no recipe" dish pass', () => {
	assert.deepEqual(failed(checkGrounding('m', menu, good, { before: 'a', after: 'a' })), []);
});

test('a missing, pending or failed dish fails', () => {
	const g = edit((g) => {
		delete g.Luumukiisseli;
		g.Graavilohi = { dishName: 'Graavilohi', state: 'failed', error: 'timeout' };
	});
	assert.deepEqual(failed(checkGrounding('m', menu, g)), ['d1.done', 'd2.done']);
});

test("a recipe whose host isn't its url's, or a match that shares under half, fails", () => {
	const g = edit((g) => {
		g.Graavilohi.compared = [{ ...mtk, host: 'example.com' }];
		g.Graavilohi.matchedSources = [{ ...mtk, shared: 0, of: 2 }];
	});
	assert.deepEqual(failed(checkGrounding('m', menu, g)), ['d1.cited', 'd1.matched']);
});

test('a match that was never compared, or a miscounted "of", fails', () => {
	const g = edit((g) => {
		g.Graavilohi.matchedSources = [
			{ url: 'https://other.fi/x', title: 'x', host: 'other.fi', shared: 2, of: 2 },
			{ ...mtk, shared: 2, of: 3 }
		];
	});
	assert.deepEqual(failed(checkGrounding('m', menu, g)), ['d1.matched']);
});

test('modelOnly naming a foreign ingredient, grounding for an unknown dish, or a changed menu fails', () => {
	const g = edit((g) => {
		g.Graavilohi.modelOnly = ['sianliha'];
		g.Joulukinkku = { ...g.Luumukiisseli, dishName: 'Joulukinkku' };
	});
	assert.deepEqual(failed(checkGrounding('m', menu, g, { before: 'a', after: 'b' })), [
		'd1.modelOnly',
		'noExtraDishes',
		'menuUnchanged'
	]);
});
