import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { OpEnvelope } from '$lib/core/contracts';
import { orderStages } from '$lib/core/services/stages';
import { gapSentence, gapsOf, orderRow, planTitle } from './orders';

const ops = readFileSync('src/lib/core/services/fixtures/ordered-ops.ndjson', 'utf8')
	.trim()
	.split(/\r?\n/)
	.map((l) => JSON.parse(l) as OpEnvelope);
const id = (ops[0].op as { plan: { id: string } }).plan.id;

describe('an ordered plan as an Orders row', () => {
	const row = orderRow(orderStages(id, ops)!, []);

	it('reads as the kitchen confirmed it, with who signed what and who placed it', () => {
		expect(row.title).toMatch(/^3 cases /);
		expect(row.origin).toBe('outside_agent');
		expect(row.status).toBe('1 line ordered');
		expect(row.done).toBe(true);
		const [o] = row.ordered;
		expect(o.lines).toEqual([
			expect.objectContaining({
				qty: '3 cases',
				status: 'confirmed',
				allowedBy: 'signed by the chef'
			})
		]);
		expect(o.trail).toEqual([
			'Asked by an outside agent.',
			'Ordered as asked, with no changes.',
			'The chef signed 1 line on the terms of plan version 1.',
			'Placed by the chef at plan version 1.'
		]);
	});

	it('keeps ids and terms out of the sentences', () => {
		const text = JSON.stringify({
			...row,
			planId: '',
			approval: null,
			names: {},
			ordered: row.ordered.map((o) => ({ ...o, orderId: '', terms: '' })),
			signed: row.signed.map((a) => ({ ...a, terms: '' }))
		});
		expect(text).not.toMatch(/ws-j-|run-|pl-run|ap-pl|or-[0-9a-f]{6}/);
	});
});

describe('the door an op came through', () => {
	it('names Kitchen tabs and the agent dock, not their tab ids', async () => {
		const { viaLabel } = await import('./labels');
		expect(viaLabel('kitchen#t-3f9a')).toBe('Kitchen page');
		expect(viaLabel('dock#t-3f9a')).toBe('Agent dock');
		expect(viaLabel('mcp:approve')).toBe('MCP');
		expect(viaLabel('rest')).toBe('API');
		expect(viaLabel('kitchen')).toBe('Kitchen');
	});
});

describe('needs nothing can be bought for', () => {
	const need = (id: string, label: string, dishId: string, unresolved?: string) => ({
		id,
		label,
		unresolved,
		source: { proposalId: 'p', revision: 0, dishId, ingredientId: id },
		dish: { gServed: 1, defaultGServed: 1, guests: 120, yield: 1, formula: '' }
	});
	const plan = {
		needs: [
			need('n1', 'Butter', 'd1'),
			need('n2', 'Saffron', 'd1', 'no product'),
			need('n3', 'Rye bread', 'd2')
		],
		lines: [{ needId: 'n1', qty: { value: 2, unit: 'KI' } }]
	} as unknown as Parameters<typeof gapsOf>[0];

	it('lists unresolved needs and needs no line serves', () => {
		expect(gapsOf(plan)).toEqual(['Saffron', 'Rye bread']);
		expect(gapSentence(gapsOf(plan), 3)).toBe(
			'1 of 3 needs covered; 2 had no product: Saffron, Rye bread.'
		);
	});

	it('titles a menu by its dishes, not its ingredients', () => {
		const s = {
			asked: { needs: plan.needs.map((n) => ({ needId: n.id, label: n.label })), lines: [] },
			plan
		} as unknown as Parameters<typeof planTitle>[0];
		expect(planTitle(s)).toBe('2 dishes for 120 guests · 3 ingredients');
	});
});
