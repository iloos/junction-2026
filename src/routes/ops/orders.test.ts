import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { OpEnvelope } from '$lib/core/contracts';
import { orderStages } from '$lib/core/services/stages';
import { orderRow } from './orders';

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
