import { expect, test, type BrowserContext } from '@playwright/test';

/**
 * Prod incident guard: an open kitchen page must not write. After the demo is started, leaving `/` open for
 * 60 s appends no ops to the visitor's own event stream. The stream is read as the visitor (the browser context's
 * signed cookie), and every read must succeed with a finite cursor, so a refused read can never compare equal.
 */
const BASE = process.env.KITCHEN_URL ?? 'http://localhost:4173';

/** The visitor's workspace, from the signed visitor cookie (`ws-j-<id>.<signature>`). */
async function workspace(ctx: BrowserContext): Promise<string> {
	const c = (await ctx.cookies()).find((x) => x.name === 'mandate_visitor');
	expect(c, 'the visitor cookie is set').toBeTruthy();
	return c!.value.split('.')[0];
}

/** The workspace's last op sequence, read page by page as the visitor. */
async function lastSeq(ctx: BrowserContext, ws: string): Promise<number> {
	let after = 0;
	for (let page = 0; page < 1000; page++) {
		const r = await ctx.request.get(`${BASE}/api/events?ws=${ws}&mode=poll&after=${after}`);
		expect(r.status(), `events read for ${ws}`).toBe(200);
		const body = (await r.json()) as { events: unknown; last: unknown };
		expect(Array.isArray(body.events), 'events is a list').toBe(true);
		expect(Number.isFinite(body.last), `last is a number: ${String(body.last)}`).toBe(true);
		if (body.last === after) return after;
		after = body.last as number;
	}
	throw new Error('the event stream never settled');
}

test('an open kitchen page appends no ops for 60 s', async ({ page, context }) => {
	test.setTimeout(150_000);
	await page.goto(`${BASE}/`);
	const start = page.getByRole('button', { name: 'Plan the event', exact: true });
	await page.locator('#task-h').or(start).first().waitFor({ timeout: 30_000 });
	if (await start.isVisible()) await start.click();
	await page.locator('#task-h').waitFor({ timeout: 60_000 });
	await page.waitForLoadState('networkidle');
	const ws = await workspace(context);

	const before = await lastSeq(context, ws);
	expect(before, 'planning wrote ops').toBeGreaterThan(0);
	await page.waitForTimeout(60_000);
	expect(await lastSeq(context, ws)).toBe(before);
});
