import { expect, test } from '@playwright/test';

/**
 * One calendar per screen (prod bug, 15 Nov): picking a day with nothing planned showed two day pickers and the mandate
 * twice. In the day view (D30) the empty day reuses the one calendar; the mandate is said once, in the header.
 */
const BASE = process.env.KITCHEN_URL ?? 'http://localhost:4173';

for (const [w, h] of [
	[1440, 900],
	[390, 844]
] as const) {
	test(`an empty day shows one calendar and the mandate once at ${w}px`, async ({ page }) => {
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
		await page.locator('#task-h').waitFor({ timeout: 120_000 });
		// D30: the day view; another day comes from "Other day…" (its one calendar).
		await page.getByText('Other day…').click();
		const grids = page.locator('[data-grid]');
		await expect(grids).toHaveCount(1, { timeout: 30_000 });
		// Wed 16 Dec: a delivery day with nothing planned in the seeded hotel.
		await grids.first().locator('[data-date="2026-12-16"]').click();
		await expect(
			page.getByRole('heading', { name: /Nothing planned for|usual is ready/ })
		).toBeVisible();

		await expect(grids).toHaveCount(1);
		await expect(page.getByText(/Order alone up to €800 a line/)).toHaveCount(1);
		await page.screenshot({ path: `test-results/one-calendar-${w}.png`, fullPage: true });
	});
}
