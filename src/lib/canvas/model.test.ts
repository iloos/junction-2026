import { describe, expect, it } from 'vitest';
import { Plan, type Line, type Need } from '$lib/core/contracts';
import type { DishView } from '$lib/kitchen/view-model';
import { projectCanvas, type CanvasSnapshot } from './model';

const source = (dishId: string, ingredientId: string, proposalId = 'menu-1') => ({
	proposalId,
	revision: 1,
	dishId,
	ingredientId
});
const need = (id: string, label = id, lineage?: Need['source']): Need => ({
	id,
	label,
	kind: lineage ? 'dish' : 'direct',
	amount: { value: 4, unit: 'kg' },
	...(lineage ? { source: lineage } : {}),
	provenance: { source: 'user' }
});
const line = (id: string, needId?: string, productId = '123456'): Line => ({
	id,
	...(needId ? { needId } : {}),
	productId,
	productName: 'Potatoes',
	qty: { value: 2, unit: 'ST' },
	state: 'eligible',
	tier: 'act',
	reasons: [],
	offer: null,
	lineCents: 350,
	provenance: { source: 'user' }
});
const dish = (needId: string, name: string): DishView => ({
	id: `view-${needId}`,
	needId,
	name,
	nameFi: name,
	gServed: 100,
	gDefault: 100,
	editable: true,
	yield: 0.5,
	need: { value: 2, unit: 'kg' },
	needFormula: 'A display served amount',
	productId: '123456',
	productName: 'Potatoes',
	plannedLineId: `line-${needId}`,
	lineIds: [`line-${needId}`],
	status: 'ok',
	isNew: false,
	eventCents: 999999
});
function snapshot(needs: Need[] = [], lines: Line[] = [], dishes: DishView[] = []): CanvasSnapshot {
	return {
		plan: Plan.parse({
			workspaceId: 'ws-canvas',
			runId: 'run-canvas',
			id: 'plan-canvas',
			kitchenId: 'k-hotel',
			version: 1,
			state: 'quoted',
			deliverBy: '2026-12-10',
			needs,
			lines,
			totalCents: 1377,
			termsHash: null,
			createdBy: { kind: 'chef', id: 'chef' }
		}),
		view: {
			eventId: '',
			title: 'A real plan',
			date: '2026-12-10',
			guests: 40,
			serviceStyle: 'buffet',
			dishes,
			why: {},
			normalWeek: { cents: 0, lines: 0 },
			thisWeek: { cents: 999999, lines: 99 },
			eventKg: 999,
			planReasons: [],
			weekSpentCents: 0,
			counts: { outages: 0, unknown: 0, held: 0, eligible: 0, committed: 0 }
		}
	};
}

describe('canvas projection from the plan on screen', () => {
	it('groups explicit recipe lineage and keeps repeated products as distinct requirement cards', () => {
		const a = need('need:a', 'Soup · potatoes', source('soup-a', 'potatoes'));
		const b = need('need:b', 'Soup · cream', source('soup-a', 'cream'));
		const c = need('need:c', 'Soup · potatoes', source('soup-b', 'potatoes'));
		const snap = snapshot(
			[a, b, c],
			[line('line-a', a.id), line('line-b', b.id, '234567'), line('line-c', c.id)],
			[dish(a.id, a.label), dish(b.id, b.label), dish(c.id, c.label)]
		);
		const canvas = projectCanvas(snap);
		expect(canvas.groups.map((g) => [g.label, g.items.map((i) => i.needId)])).toEqual([
			['Soup', ['need:a', 'need:b']],
			['Soup', ['need:c']]
		]);
		expect(new Set(canvas.groups.map((g) => g.id)).size).toBe(2);
		expect(canvas.items.map((i) => i.id)).toEqual(['need:a', 'need:b', 'need:c']);
		expect(canvas.items[0].connections.map((c) => c.to)).toEqual(['line-a']);
		expect(canvas.items[2].connections.map((c) => c.to)).toEqual(['line-c']);
		expect(canvas.items[0].dish?.needId).toBe(a.id);
	});

	it('keeps group, item and connection identities through reordering, revisions and product changes', () => {
		const a = need('ingredient-stable', 'Soup · potatoes', source('dish-stable', 'ingredient'));
		const b = need('other', 'Other · milk', source('dish-other', 'milk', 'menu-other'));
		const snap = snapshot([a, b], [line('purchase-a', a.id), line('purchase-b', b.id)]);
		const before = projectCanvas(snap);
		const updated = structuredClone(snap);
		updated.plan.needs.reverse();
		updated.plan.lines.reverse();
		updated.plan.needs.find((n) => n.id === a.id)!.source!.revision = 2;
		updated.plan.lines.find((l) => l.id === 'purchase-a')!.productId = '999999';
		const after = projectCanvas(updated);
		expect(after.groups.map((g) => g.id).sort()).toEqual(before.groups.map((g) => g.id).sort());
		expect(after.items.map((i) => i.id).sort()).toEqual(before.items.map((i) => i.id).sort());
		expect(after.connections.map((c) => c.id).sort()).toEqual(
			before.connections.map((c) => c.id).sort()
		);
	});

	it('uses one Ingredients group for unsourced needs without inferring recipes from labels or view ids', () => {
		const a = need('need:a', 'Soup · carrots');
		const b = need('need:b', 'Cake · cream');
		const canvas = projectCanvas(snapshot([a, b], [], [dish(a.id, a.label), dish(b.id, b.label)]));
		expect(canvas.groups).toHaveLength(1);
		expect(canvas.groups[0]).toMatchObject({ id: 'ingredients', label: 'Ingredients' });
		expect(canvas.groups[0].items.map((i) => i.id)).toEqual([a.id, b.id]);
	});

	it('uses a truthful recipe label when the snapshot cannot name the recipe', () => {
		const a = need('need:a', 'Potatoes', source('raw-dish-id', 'potatoes'));
		const canvas = projectCanvas(snapshot([a]));
		expect(canvas.groups[0].label).toBe('Recipe ingredients');
		expect(canvas.groups[0].label).not.toContain('raw-dish-id');
	});

	it('preserves loose legacy lines without inventing requirements or attaching them by product id', () => {
		const a = need('need:a');
		const canvas = projectCanvas(
			snapshot([a], [line('linked', a.id), line('legacy'), line('dangling', 'missing-need')])
		);
		expect(canvas.items.map((i) => i.id)).toEqual([a.id]);
		expect(canvas.items[0].lines.map((l) => l.id)).toEqual(['linked']);
		expect(canvas.unlinkedLines.map((l) => l.id)).toEqual(['legacy', 'dangling']);
		expect(canvas.groups[0].unlinkedLines).toEqual(canvas.unlinkedLines);
		expect(canvas.lines).toHaveLength(3);
	});

	it('keeps unresolved ingredients and actual demand amounts instead of served view amounts', () => {
		const a = {
			...need('need:a', 'Soup · potatoes', source('soup', 'potatoes')),
			unresolved: 'No matching pack'
		};
		const b = need('need:b', 'Soup · cream', source('soup', 'cream'));
		const canvas = projectCanvas(
			snapshot([a, b], [line('cream', b.id)], [dish(a.id, a.label), dish(b.id, b.label)])
		);
		expect(canvas.items[0]).toMatchObject({
			amount: { value: 4, unit: 'kg' },
			unresolved: 'No matching pack',
			status: 'shortfall',
			lines: [],
			currentLines: []
		});
		expect(canvas.items[0].dish?.need.value).toBe(2);
		expect(canvas.groups[0]).toMatchObject({ status: 'partial', unresolvedCount: 1 });
	});

	it('links replacements only to matching sources of the same need and exposes current purchases once', () => {
		const a = need('need:a');
		const b = need('need:b');
		const original = { ...line('original-a', a.id), state: 'unorderable' as const, lineCents: 900 };
		const replacement = {
			...line('replacement-a', a.id, '234567'),
			substituteFor: '123456',
			lineCents: 777
		};
		const snap = snapshot([a, b], [original, replacement, line('original-b', b.id)]);
		snap.plan.totalCents = 1127;
		const canvas = projectCanvas(snap);
		expect(canvas.items[0].currentLines.map((l) => l.id)).toEqual(['replacement-a']);
		expect(canvas.items[0].lines.map((l) => l.line.lineCents)).toEqual([900, 777]);
		expect(canvas.items[0].connections.filter((c) => c.kind === 'replacement')).toEqual([
			expect.objectContaining({ from: 'original-a', to: 'replacement-a' })
		]);
		expect(canvas.items[1].connections).toHaveLength(1);
		expect(canvas.totalCents).toBe(1127);
		expect(canvas.items[0].status).toBe('rescued');
	});

	it('does not invent a source-line edge when a product reference is ambiguous or absent', () => {
		const a = need('need:a');
		const canvas = projectCanvas(
			snapshot(
				[a],
				[
					line('source-a', a.id),
					line('source-b', a.id),
					{ ...line('swap', a.id, '234567'), substituteFor: '123456' },
					{ ...line('missing-source', a.id, '345678'), substituteFor: '999999' }
				]
			)
		);
		expect(canvas.connections.filter((c) => c.kind === 'replacement')).toEqual([]);
		expect(canvas.items[0].lines.find((l) => l.id === 'swap')?.substituteFor).toBe('123456');
		expect(canvas.connections.filter((c) => c.kind === 'need-line')).toHaveLength(4);
	});

	it('excludes retired and zero-quantity sources while retaining live split original quantities', () => {
		const a = need('need:a');
		const retired = { ...line('retired', a.id), reasons: ['superseded' as const] };
		const zero = { ...line('zero', a.id), qty: { value: 0, unit: 'ST' } };
		const original = line('remaining', a.id);
		const swap = { ...line('swap', a.id, '234567'), substituteFor: '123456' };
		const canvas = projectCanvas(snapshot([a], [retired, zero, original, swap]));
		expect(canvas.items[0].currentLines.map((l) => l.id)).toEqual(['remaining', 'swap']);
		expect(canvas.items[0].lines).toHaveLength(4);
	});

	it('keeps desired requirements separate from actual product diet records, including missing facts', () => {
		const a = {
			...need('need:a'),
			requirements: { freeFrom: ['LACTOSE'], diet: ['vegan' as const] }
		};
		const snap = snapshot([a], [line('purchase', a.id), line('unknown', a.id, '234567')]);
		snap.plan.requirements = { labels: ['EU_ORGANIC_FARMING'] };
		snap.diet = {
			'123456': {
				allergens: { contains: ['AM'], mayContain: [], declared: true },
				freeFrom: [],
				diet: []
			}
		};
		const item = projectCanvas(snap).items[0];
		expect(item.requirements).toEqual({
			freeFrom: ['LACTOSE'],
			diet: ['vegan'],
			labels: ['EU_ORGANIC_FARMING']
		});
		expect(item.lines[0].diet?.allergens.contains).toEqual(['AM']);
		expect(item.lines[0].marks.contains).toEqual(['milk']);
		expect(item.lines[0].marks.codes).not.toContain('VE');
		expect(item.lines[1].diet).toBeUndefined();
		expect(item.lines[1].marks).toMatchObject({ recorded: false, codes: [] });
	});

	it('does not mutate frozen snapshots or retain writable aliases into them', () => {
		const snap = snapshot(
			[need('need:a')],
			[line('purchase', 'need:a')],
			[dish('need:a', 'Potatoes')]
		);
		snap.plan.needs[0].ask = { words: '4 kg potatoes', qty: 4, unit: 'kg' };
		const before = structuredClone(snap);
		const freeze = (value: unknown): void => {
			if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
			Object.freeze(value);
			for (const child of Object.values(value)) freeze(child);
		};
		freeze(snap);
		const canvas = projectCanvas(snap);
		canvas.items[0].amount.value = 99;
		canvas.items[0].ask!.words = 'Changed output';
		canvas.items[0].dish!.name = 'Changed output';
		canvas.lines[0].line.reasons.push('price_missing');
		expect(snap).toEqual(before);
	});

	it('projects an empty plan without synthetic event data and handles ten times the demo size', () => {
		expect(projectCanvas(snapshot())).toMatchObject({
			groups: [],
			items: [],
			lines: [],
			connections: []
		});
		const needs = Array.from({ length: 200 }, (_, i) =>
			need(`need:${i}`, 'An ingredient', source(`dish:${Math.floor(i / 10)}`, `ingredient:${i}`))
		);
		const canvas = projectCanvas(
			snapshot(
				needs,
				needs.map((n, i) => line(`purchase:${i}`, n.id))
			)
		);
		expect(canvas.groups).toHaveLength(20);
		expect(canvas.items).toHaveLength(200);
		expect(new Set(canvas.items.map((i) => i.needId)).size).toBe(200);
		expect(canvas.connections).toHaveLength(200);
	});
});
