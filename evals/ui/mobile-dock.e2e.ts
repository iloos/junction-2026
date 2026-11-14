import { expect, test } from '@playwright/test';
import { planBuffet } from './flow';

/**
 * R11-14 (docs/review/ROUND11-ADVERSARIAL.md): on a phone, the agent dock's decisions must not push its message box
 * off the screen. With the buffet planned and the dock open at 390 × 844, the composer sits inside the viewport and a
 * normal click reaches it. Open under 1f until fixed: Playwright's `test.fail` keeps it green while the defect stands
 * and turns it red once the composer is reachable (then delete the line).
 */
const OPEN_R11_14 = true;

test.use({ viewport: { width: 390, height: 844 } });

test('R11-14 the dock composer stays on screen on a phone with decisions open', async ({
	page
}) => {
	test.fail(
		OPEN_R11_14,
		'R11-14 [open · 1f]: the decision region pushes the composer below the viewport'
	);
	test.setTimeout(180_000);
	await planBuffet(page);
	const dock = page.locator('aside[aria-label="Agent chat"]');
	await expect(async () => {
		await page.getByRole('button', { name: 'Ask the agent' }).click();
		await expect(dock).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 30_000 });
	const composer = dock.locator('textarea').first();
	await composer.waitFor({ state: 'attached', timeout: 30_000 });
	const box = await composer.boundingBox();
	expect(box, 'the composer has a box').toBeTruthy();
	expect(box!.y + box!.height, `composer bottom at ${box!.y + box!.height} px`).toBeLessThanOrEqual(
		844
	);
	await composer.click({ timeout: 5_000 });
	await expect(composer).toBeFocused();
});
