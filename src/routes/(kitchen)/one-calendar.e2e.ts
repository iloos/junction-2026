import { expect, test } from '@playwright/test';

/**
 * One calendar per screen (prod bug, 15 Nov): on the Basket, picking a day with nothing planned showed the Basket's
 * own day picker and a second one inside "Nothing planned", and the mandate twice. The empty day reuses the Basket's
 * picker; the mandate is said once, in the header.
 */
const BASE = process.env.KITCHEN_URL ?? 'http://localhost:4173';

for (const [w, h] of [
	[1440, 900],
	[390, 844]
] as const) {
	test(`an empty day in the Basket shows one calendar and the mandate once at ${w}px`, async ({
		page
	}) => {
		test.setTimeout(180_000);
		await page.setViewportSize({ width: w, height: h });
		await page.goto(`${BASE}/`);
		const picker = page.getByRole('heading', { name: 'Who are you cooking for?' });
		const start = page.getByRole('button', { name: 'Plan the event', exact: true });
		await picker.or(start).first().waitFor({ timeout: 60_000 });
		if (await picker.isVisible())
			await page
				.getByRole('button', { name: /Hotel Rautatientori/ })
				.first()
				.click();
		await start.click();
		const views = page.getByRole('navigation', { name: 'Kitchen view' });
		await views.waitFor({ timeout: 120_000 });
		await views.getByRole('button', { name: 'Basket', exact: true }).click();

		const grids = page.locator('[data-grid]');
		await expect(grids).toHaveCount(1, { timeout: 30_000 });
		// Wed 16 Dec: a delivery day with nothing planned in the seeded hotel.
		await grids.first().locator('[data-date="2026-12-16"]').click();
		await expect(page.getByRole('heading', { name: /Nothing planned for/ })).toBeVisible();

		await expect(grids).toHaveCount(1);
		await expect(page.getByText(/Order alone up to €800 a line/)).toHaveCount(1);
		await page.screenshot({ path: `test-results/one-calendar-${w}.png`, fullPage: true });
	});
}
