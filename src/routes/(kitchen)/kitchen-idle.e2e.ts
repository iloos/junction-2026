import { expect, test } from '@playwright/test';

/**
 * Prod incident guard: an open kitchen page must not write. After the demo is started, leaving `/` open for
 * 60 s appends no ops to the workspace's event stream.
 */
const BASE = process.env.KITCHEN_URL ?? 'http://localhost:4173';

async function lastSeq(request: import('@playwright/test').APIRequestContext, ws: string) {
	let after = 0;
	for (;;) {
		const r = await request.get(`${BASE}/api/events?ws=${ws}&mode=poll&after=${after}`);
		const body = (await r.json()) as { events: unknown[]; last: number };
		if (body.last === after) return after;
		after = body.last;
	}
}

test('an open kitchen page appends no ops for 60 s', async ({ page, request }) => {
	test.setTimeout(150_000);
	await page.goto(`${BASE}/`);
	const start = page.getByRole('button', { name: 'Plan the event' });
	await page.locator('#event-h').or(start).first().waitFor({ timeout: 30_000 });
	if (await start.isVisible()) await start.click();
	await page.waitForSelector('#event-h', { timeout: 60_000 });
	const label =
		(await page.getByTitle('Workspace and run this screen reads and writes').textContent()) ?? '';
	const ws = label.split('·')[0].trim() || 'ws-demo';
	await page.waitForLoadState('networkidle');

	const before = await lastSeq(request, ws);
	await page.waitForTimeout(60_000);
	expect(await lastSeq(request, ws)).toBe(before);
});
