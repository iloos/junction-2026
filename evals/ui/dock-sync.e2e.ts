import { expect, test, type Page } from '@playwright/test';

/**
 * The Kitchen page and the agent dock read one event stream, so what the chef does in one shows in the other
 * without a chat turn: approving on the page puts a plain line and the way on into the dock; approving in the dock
 * (D13, another tab) takes the decision off the page and What changed says it was done in the dock.
 * Runs in `pnpm gate --full`, or KITCHEN_URL=<url> npx playwright test -c evals/ui/pw-prod.config.ts dock-sync
 */
const BASE = process.env.KITCHEN_URL ?? 'http://localhost:4173';

async function openDock(page: Page) {
	const dock = page.locator('aside[aria-label="Agent chat"]');
	await expect(async () => {
		await page.getByRole('button', { name: 'Ask the agent' }).click();
		await expect(dock).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 30_000 });
	return dock;
}

async function planBuffet(page: Page) {
	await page.goto(`${BASE}/`);
	const start = page.getByRole('button', { name: 'Plan the event' });
	await page.locator('#task-h').or(start).first().waitFor({ timeout: 60_000 });
	if (await start.isVisible()) await start.click();
	await expect(page.locator('#task-h')).toContainText('Christmas', { timeout: 120_000 });
}

test('approving on the page shows in the dock, with the way on', async ({ page }) => {
	test.setTimeout(180_000);
	await planBuffet(page);
	const dock = await openDock(page);
	await dock.locator('textarea').fill('What still needs my decision?');
	await dock.locator('textarea').press('Enter');
	// With the plan on the page, the rail shows its decisions once, above the chat; the chat points to them.
	await dock.getByText(/decisions? waits? above/).first().waitFor();
	await expect(dock.getByRole('region', { name: /Decide/ }).or(dock.locator('#approval'))).toBeVisible();
	await dock.getByRole('button', { name: 'Close chat' }).click();

	// Approve the first (non sign-off) decision on the page.
	const panel = page.locator('#approval').first();
	await panel
		.getByRole('button', { name: /^Review \d+ lines?/ })
		.first()
		.click();
	await panel.getByRole('button', { name: 'Confirm exact terms' }).click();

	await openDock(page);
	await expect(dock.getByRole('status').filter({ hasText: /You approved \d+ lines?/ })).toBeVisible(
		{
			timeout: 20_000
		}
	);
	// The way on: the page's own Order (same plan on screen) or Continue (anywhere else).
	await expect(
		dock
			.getByRole('link', { name: /Order it on the page/ })
			.or(dock.getByRole('button', { name: /continue/i }))
	).toBeVisible();
});

test('approving in the dock takes the decision off the page and says where', async ({
	browser
}) => {
	test.setTimeout(180_000);
	const ctx = await browser.newContext();
	const request = await ctx.newPage();
	// The dock on /request (no Kitchen page there) drafts a plan that needs a decision.
	await request.goto(`${BASE}/request`);
	const dock = await openDock(request);
	await dock.getByRole('button', { name: 'New task' }).click();
	await dock.locator('textarea').fill('4 kg lactose-free butter for Thursday');
	await dock.locator('textarea').press('Enter');
	const here = dock.getByLabel('Decide here');
	await here.waitFor({ timeout: 60_000 });
	const url = await here
		.getByRole('link', { name: /Open this plan in the Kitchen/ })
		.getAttribute('href');

	// The same plan open on the Kitchen page in another tab of the same browser.
	const kitchen = await ctx.newPage();
	await kitchen.goto(`${BASE}${url}`);
	const card = kitchen.locator('#approval article[aria-label^="Decision:"]');
	await expect(card.first()).toBeVisible({ timeout: 60_000 });

	await here
		.getByRole('button', { name: /^Review \d+ lines?/ })
		.first()
		.click();
	await here.getByRole('button', { name: 'Confirm exact terms' }).click();
	await here
		.getByRole('button', { name: /^Order the approved lines/ })
		.waitFor({ timeout: 30_000 });

	await expect(card).toHaveCount(0, { timeout: 20_000 });
	await here.getByRole('button', { name: /^Order the approved lines/ }).click();
	await expect(kitchen.getByText(/by you in the agent dock/i)).toBeVisible({ timeout: 20_000 });
	await ctx.close();
});
