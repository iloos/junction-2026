import { describe, expect, it } from 'vitest';
import { contextFor } from '$lib/server/auth';
import { ensureRunLoaded } from '$lib/server/demo/reset';
import {
	newVisitorWorkspace,
	readCalendar,
	signCalendar,
	signVisitor
} from '$lib/server/demo/visitor-id';
import { realHandlers } from '$lib/server/tools/handlers';
import { serveTool } from '$lib/server/tools/serve';
import { kitchenCalendar, kitchenDays, MAX_DAYS } from './calendar';

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

		// The picker reads the same input: three weeks from the scenario's today, the order's day marked.
		const out = (await kitchenDays(ws, 'k-lounas'))!;
		expect(out.from).toBe('2026-12-07');
		expect(out.days).toHaveLength(21);
		const wed = out.days.find((d) => d.date === '2026-12-09')!;
		expect(wed.marks.some((m) => m.kind === 'delivery')).toBe(true);
		expect(wed.orderBy.map((o) => o.model)).toEqual(['Stock', 'Terminal']);
		expect(out.days.find((d) => d.date === '2026-12-07')?.status).not.toBe('open');
		const capped = (await kitchenDays(ws, 'k-lounas', '2026-12-01', '2027-12-31'))!;
		expect(capped.days).toHaveLength(MAX_DAYS);
		expect(await kitchenDays(ws, 'k-nope')).toBeNull();
	}, 60_000);

	it('a calendar token reads one sandbox, and nothing else stands in for it', () => {
		const env = { JUDGE_KEY_SECRET: 'a-test-secret-of-enough-length' };
		const ws = newVisitorWorkspace();
		const token = signCalendar(ws, env);
		expect(readCalendar(token, env)).toBe(ws);
		expect(readCalendar(token.slice(0, -2) + (token.endsWith('A') ? 'BB' : 'AA'), env)).toBeNull();
		expect(readCalendar(`cal_${newVisitorWorkspace()}.${token.split('.')[1]}`, env)).toBeNull();
		// The visitor cookie is not a calendar token, and a calendar token is not a cookie.
		expect(readCalendar(`cal_${signVisitor(ws, env)}`, env)).toBeNull();
		expect(readCalendar(token, { JUDGE_KEY_SECRET: 'another-secret-of-enough-length' })).toBeNull();
	});
});
