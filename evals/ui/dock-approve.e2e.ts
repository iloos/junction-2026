import { expect, test } from '@playwright/test';

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
		await page.getByRole('button', { name: 'Ask the agent' }).click();
		await expect(dock).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 30_000 });
	await dock.getByRole('button', { name: 'New task' }).click();
	await dock.locator('textarea').fill('4 kg lactose-free butter for Thursday');
	await dock.locator('textarea').press('Enter');
	const here = dock.getByLabel('Decide here');
	await here.waitFor({ timeout: 60_000 });

	const before = posts.length;
	await here
		.getByRole('button', { name: /^Review \d+ lines?/ })
		.first()
		.click();
	await here.getByRole('button', { name: 'Confirm exact terms' }).click();
	const order = here.getByRole('button', { name: /^Order the approved lines/ });
	await order.waitFor({ timeout: 30_000 });
	const during = posts.slice(before);
	expect(during, 'the approval is the Kitchen command').toContain('/kitchen-api/tool/approve');
	expect(during, 'no chat turn while the chef approves').not.toContain('/api/chat/turn');

	await order.click();
	await expect(here.getByText(/Ordered\s*·\s*\d+\s+lines?/)).toBeVisible({ timeout: 30_000 });
	expect(posts.slice(before)).toContain('/kitchen-api/tool/commit_order');
});
