import { describe, expect, it } from 'vitest';
import { contextFor } from '$lib/server/auth';
import { ensureRunLoaded } from '$lib/server/demo/reset';
import { newVisitorWorkspace } from '$lib/server/demo/visitor-id';
import { realHandlers } from '$lib/server/tools/handlers';
import { serveTool } from '$lib/server/tools/serve';
import { kitchenCalendar } from './calendar';

describe('kitchen calendar from a sandbox', () => {
	it("lists the plan's delivery and the kitchen's receiving days; unknown kitchens get nothing", async () => {
		const ws = newVisitorWorkspace();
		await ensureRunLoaded(ws, { start: true });
		const placed = await serveTool(
			'place_order',
			contextFor('kitchen_agent', 'agent', 'test', {}, ws),
			{
				kitchenId: 'k-lounas',
				deliverBy: '2026-12-09',
				idempotencyKey: 'cal-1',
				lines: [{ productId: '460692', qty: 3, unit: 'KI' }]
			},
			await realHandlers()
		);
		expect(placed.ok).toBe(true);
		const ics = (await kitchenCalendar(ws, 'k-lounas'))!;
		const lines = ics.replace(/\r\n /g, '').split('\r\n');
		expect(lines).toContain('DTSTART;VALUE=DATE:20261209');
		expect(lines.some((l) => l.startsWith('SUMMARY:Delivery: '))).toBe(true);
		expect(lines.some((l) => l.startsWith('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;'))).toBe(true);
		// No personal data: no workspace or run ids, no actor names.
		expect(ics).not.toContain(ws);
		expect(await kitchenCalendar(ws, 'k-nope')).toBeNull();
	}, 60_000);
});
