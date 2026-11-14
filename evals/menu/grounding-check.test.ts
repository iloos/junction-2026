// Self-tests of the grounded-menu checks. `node --test evals/menu/grounding-check.test.ts` (evals:self).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkGrounding, type MenuGrounding, type MenuShape } from './grounding-check.ts';

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
const good: MenuGrounding = {
	dishes: {
		d1: {
			status: 'sourced',
			recipes: [
				{ title: 'Graavilohi', url: 'https://www.mtk.fi/resepti/graavilohi', host: 'mtk.fi' }
			],
			ingredients: { i1: 'sourced', i2: 'unsourced' },
			missing: ['tilli', 'sokeri']
		},
		d2: { status: 'none', reason: 'no recipe found for luumukiisseli' }
	}
};
const failed = (rs: ReturnType<typeof checkGrounding>) =>
	rs.filter((r) => !r.pass).map((r) => r.key.split('.').slice(1).join('.'));

test('a sourced dish with cited recipes and every ingredient classified passes; "none" needs a reason', () => {
	assert.deepEqual(failed(checkGrounding('m', menu, good, { before: 'abc', after: 'abc' })), []);
});

test('a dish without grounding, an unclassified ingredient or an invented id fails', () => {
	const g = structuredClone(good);
	delete g.dishes.d2;
	(g.dishes.d1 as { ingredients: Record<string, string> }).ingredients = {
		i1: 'sourced',
		i9: 'sourced'
	};
	assert.deepEqual(failed(checkGrounding('m', menu, g)), ['d1.classified', 'd2.present']);
});

test('a recipe whose host is not its url, or no recipe at all, is not a citation', () => {
	const g = structuredClone(good);
	(g.dishes.d1 as { recipes: unknown[] }).recipes = [
		{ title: 'x', url: 'https://example.com/a', host: 'mtk.fi' }
	];
	assert.deepEqual(failed(checkGrounding('m', menu, g)), ['d1.cited']);
	(g.dishes.d1 as { recipes: unknown[] }).recipes = [];
	assert.deepEqual(failed(checkGrounding('m', menu, g)), ['d1.cited']);
});

test('grounding for a dish the menu lacks, an empty reason, or a changed menu fails', () => {
	const g = structuredClone(good);
	g.dishes.d7 = { status: 'none', reason: 'x' };
	(g.dishes.d2 as { reason: string }).reason = ' ';
	assert.deepEqual(failed(checkGrounding('m', menu, g, { before: 'a', after: 'b' })), [
		'd2.reason',
		'noExtraDishes',
		'menuUnchanged'
	]);
});
