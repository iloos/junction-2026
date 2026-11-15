import { expect, test } from '@playwright/test';
import { enterKitchen, eventView, approveInDock, DOCK_ORDER } from './flow';

/**
 * D13: the chef may approve from the agent dock when the plan is not on the page. The dock's decision card uses the
 * Kitchen's own approve command (exact terms, the chef's session), never a chat turn: while the chef approves, no
 * request goes to /api/chat/turn, and the approve goes to /kitchen-api/tool/approve. Then the dock orders the
 * approved lines through the same commit path. (A chat turn that asks to approve does nothing: src/lib/server/chat
 * turn.test.ts.) Runs in `pnpm gate --full`, or KITCHEN_URL=<url> npx playwright test -c evals/ui/pw-prod.config.ts
 */
const BASE = process.env.KITCHEN_URL ?? 'http://localhost:4173';

test('the chef approves and orders from the dock, never through a chat turn', async ({ page }) => {
	test.setTimeout(120_000);
	const posts: string[] = [];
	page.on('request', (r) => r.method() === 'POST' && posts.push(new URL(r.url()).pathname));
	await page.goto(`${BASE}/request`);
	const dock = page.locator('aside[aria-label="Agent chat"]');
	// Until the page hydrates, the shell's button does nothing: press it until the dock opens.
	await expect(async () => {
		await page.getByRole('button', { name: 'Ask the agent' }).first().click();
		await expect(dock).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 30_000 });
	await dock.getByRole('button', { name: 'New task' }).click();
	await dock.locator('textarea').fill('4 kg lactose-free butter for Thursday');
	await dock.locator('textarea').press('Enter');
	const here = dock.getByLabel('Decide here');
	await here.waitFor({ timeout: 60_000 });

	const before = posts.length;
	await approveInDock(here);
	const order = dock.getByRole('button', { name: DOCK_ORDER }).first();
	await order.waitFor({ timeout: 30_000 });
	const during = posts.slice(before);
	expect(during, 'the approval is the Kitchen command').toContain('/kitchen-api/tool/approve');
	expect(during, 'no chat turn while the chef approves').not.toContain('/api/chat/turn');

	await order.click();
	await expect(dock.getByText(/Ordered\s*·\s*\d+\s+lines?|Ordered: receipt/).first()).toBeVisible({
		timeout: 30_000
	});
	expect(posts.slice(before)).toContain('/kitchen-api/tool/commit_order');
});

test('a dock approval on another plan never switches the plan the Kitchen page shows', async ({
	page
}) => {
	test.setTimeout(180_000);
	await enterKitchen(page, '/');
	const start = page.getByRole('button', { name: 'Plan the event' });
	await page.locator('#task-h').or(start).first().waitFor({ timeout: 60_000 });
	if (await start.isVisible()) await start.click();
	const title = page.locator('#task-h');
	await expect(title).toContainText('Christmas', { timeout: 120_000 });

	const dock = page.locator('aside[aria-label="Agent chat"]');
	await expect(async () => {
		await page.getByRole('button', { name: 'Ask the agent' }).first().click();
		await expect(dock).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 30_000 });
	await dock.getByRole('button', { name: 'New task' }).click();
	await dock.locator('textarea').fill('4 kg lactose-free butter for Thursday');
	await dock.locator('textarea').press('Enter');
	const here = dock.getByLabel('Decide here');
	await here.waitFor({ timeout: 60_000 });
	await approveInDock(here);
	await dock.getByRole('button', { name: DOCK_ORDER }).first().click();
	await expect(dock.getByText(/Ordered\s*·\s*\d+\s+lines?|Ordered: receipt/).first()).toBeVisible({
		timeout: 30_000
	});

	// A reload straight after the dock's order still opens the buffet (the dock never moves the remembered plan);
	// then the page's own next command and a fresh read still act on, and show, the buffet.
	await page.reload();
	await expect(
		// Pre-D30 the second "Kitchen view" tab names the remembered plan; D30 focuses it (#task-h).
		page
			.getByRole('navigation', { name: 'Kitchen view' })
			.getByRole('button')
			.nth(1)
			.or(page.locator('#task-h'))
			.first(),
		'the remembered plan is still the buffet'
	).toContainText('Christmas', { timeout: 60_000 });
	await eventView(page);
	await expect(title).toContainText('Christmas', { timeout: 60_000 });
	if (await dock.isVisible()) await dock.getByRole('button', { name: 'Close chat' }).click();
	await page.getByRole('button', { name: /^Show details: Graavilohi/ }).click();
	await page.getByRole('button', { name: 'More Graavilohi' }).last().click();
	await page.waitForTimeout(3000);
	await expect(title).toContainText('Christmas');
	await page.reload();
	await expect(
		// Pre-D30 the second "Kitchen view" tab names the remembered plan; D30 focuses it (#task-h).
		page
			.getByRole('navigation', { name: 'Kitchen view' })
			.getByRole('button')
			.nth(1)
			.or(page.locator('#task-h'))
			.first(),
		'the remembered plan is still the buffet'
	).toContainText('Christmas', { timeout: 60_000 });
	await eventView(page);
	await expect(title).toContainText('Christmas', { timeout: 60_000 });
});
