import { describe, expect, it } from 'vitest';
import { contextFor } from '$lib/server/auth';
import { ensureRunLoaded } from '$lib/server/demo/reset';
import { newVisitorWorkspace } from '$lib/server/demo/visitor-id';
import { realHandlers } from './handlers';
import { serveTool } from './serve';

const order = (key: string, extra: Record<string, unknown> = {}) => ({
	kitchenId: 'k-lounas',
	deliverBy: '2026-12-09',
	idempotencyKey: key,
	lines: [{ productId: '460692', qty: 3, unit: 'KI' }],
	...extra
});

describe('a plan records the door it came through', () => {
	it('takes the origin from the server-set call context', async () => {
		const ws = newVisitorWorkspace();
		await ensureRunLoaded(ws, { start: true });
		const ctx = {
			...contextFor('chef', 'kitchen-ui', 'kitchen', {}, ws),
			origin: 'usual' as const
		};
		const r = await serveTool('place_order', ctx, order('o-1'), await realHandlers());
		expect(r.ok).toBe(true);
		expect(r.ok && (r.value as { plan: { origin?: string } }).plan.origin).toBe('usual');
	}, 60_000);

	it('ignores an origin in the tool input: no caller labels its own order', async () => {
		const ws = newVisitorWorkspace();
		await ensureRunLoaded(ws, { start: true });
		const ctx = contextFor('external_agent', 'judge', 'mcp', {}, ws);
		const r = await serveTool(
			'place_order',
			ctx,
			order('o-2', { origin: 'usual' }),
			await realHandlers()
		);
		expect(r.ok).toBe(true);
		expect(r.ok && (r.value as { plan: { origin?: string } }).plan.origin).toBeUndefined();
	}, 60_000);
});
