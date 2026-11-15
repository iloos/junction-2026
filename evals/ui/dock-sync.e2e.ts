import { expect, test, type Page } from '@playwright/test';
import { approveFirstOnPage, decisionCards, enterKitchen, approveInDock, DOCK_ORDER } from './flow';

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
	await enterKitchen(page, '/');
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
	// With the plan on the page, the chat answers about its decisions; they are decided on the page (one "Decide").
	await dock
		.getByText(/decisions?/)
		.last()
		.waitFor();
	await expect(page.getByRole('region', { name: 'Decide', exact: true })).toHaveCount(1);
	await dock.getByRole('button', { name: 'Close chat' }).click();

	// Approve the first (non sign-off) decision on the page.
	await approveFirstOnPage(page);

	await openDock(page);
	await expect(
		dock.getByRole('status').filter({ hasText: /You (approved|decided) \d+ lines?/ })
	).toBeVisible({
		timeout: 20_000
	});
	// The way on: the page's own Order (same plan on screen) or Continue (anywhere else).
	await expect(
		dock
			.getByRole('link', { name: /Order it on the page/ })
			.or(dock.getByRole('button', { name: /continue|^Order \d+ lines? now/i }))
			.first()
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
	const card = decisionCards(kitchen);
	await expect(card.first()).toBeVisible({ timeout: 60_000 });

	await approveInDock(here);
	await here.getByRole('button', { name: DOCK_ORDER }).waitFor({ timeout: 30_000 });

	await expect(card).toHaveCount(0, { timeout: 20_000 });
	await here.getByRole('button', { name: DOCK_ORDER }).click();
	await expect(kitchen.getByText(/by you in the agent dock/i)).toBeVisible({ timeout: 20_000 });
	await ctx.close();
});

test('two Kitchen tabs: a change in one shows in the other, named as another tab', async ({
	browser
}) => {
	test.setTimeout(240_000);
	const ctx = await browser.newContext();
	const a = await ctx.newPage();
	await planBuffet(a);
	const b = await ctx.newPage();
	await enterKitchen(b, '/');
	await expect(b.locator('#task-h')).toContainText('Christmas', { timeout: 120_000 });
	await b.waitForTimeout(1500); // b's stream is open

	// Tab A changes the salmon's grams; tab B re-reads and says the change came from another tab.
	await a.getByRole('button', { name: /^Show details: Graavilohi/ }).click();
	await a.getByRole('button', { name: 'More Graavilohi' }).last().click();
	await expect(b.getByText(/by you in another tab/i).first()).toBeVisible({ timeout: 20_000 });
	await ctx.close();
});

test('a reset in another tab brings this tab back to the start, without a reload', async ({
	browser
}) => {
	test.setTimeout(240_000);
	const ctx = await browser.newContext();
	const a = await ctx.newPage();
	await planBuffet(a);
	const b = await ctx.newPage();
	await enterKitchen(b, '/');
	await expect(b.locator('#task-h')).toContainText('Christmas', { timeout: 120_000 });
	await b.waitForTimeout(1500);

	// Start over in tab B (the sandbox menu); tab A follows the new run on its own.
	await b.getByRole('button', { name: /^Sandbox/ }).click();
	await b.getByRole('button', { name: /Reset demo|Start over/ }).click();
	await expect(a.getByRole('button', { name: 'Plan the event' })).toBeVisible({ timeout: 30_000 });
	await ctx.close();
});

test('in a shared room the stream follows that room, not the own sandbox', async ({ browser }) => {
	// D24: a visitor joins the room as their own store (no seeded event there). Tab A orders through the dock; tab B,
	// the same browser on the same room, must show that order live, without a reload.
	test.setTimeout(240_000);
	const ctx = await browser.newContext();
	const a = await ctx.newPage();
	await enterKitchen(a, '/?ws=ws-judges');
	const b = await ctx.newPage();
	await enterKitchen(b, '/?ws=ws-judges');
	await b.waitForTimeout(1500);
	expect(
		await b.getByText(/lactose-free milk|laktoositon/i).count(),
		'tab B starts without the order'
	).toBe(0);

	const dock = a.locator('aside[aria-label="Agent chat"]');
	await expect(async () => {
		await a.getByRole('button', { name: 'Ask the agent' }).click();
		await expect(dock).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 30_000 });
	await dock.locator('textarea').fill('10 l lactose-free milk for Friday');
	await dock.locator('textarea').press('Enter');
	await a
		.getByText(/^Working\b.*…$/)
		.first()
		.waitFor({ state: 'detached', timeout: 120_000 })
		.catch(() => undefined);
	const said = (await dock.innerText()).slice(-600);
	const live = await b
		.getByText(/lactose-free milk|laktoositon/i)
		.first()
		.waitFor({ timeout: 60_000 })
		.then(() => true)
		.catch(() => false);
	// When the live update fails, a reload tells a stream fault (shows after reload) from a Kitchen that never shows
	// the dock's plan at all (D23).
	let afterReload: boolean | null = null;
	if (!live) {
		await b.reload();
		afterReload = await b
			.getByText(/lactose-free milk|laktoositon/i)
			.first()
			.waitFor({ timeout: 20_000 })
			.then(() => true)
			.catch(() => false);
	}
	expect(
		live,
		`tab B never showed tab A's order live (after a reload: ${afterReload}); tab A's dock ended: ${said}`
	).toBe(true);
	await ctx.close();
});
