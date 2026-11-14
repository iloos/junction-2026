import { expect, test, type Page } from '@playwright/test';
import { BASE, planBuffet } from './flow';

/**
 * One visitor, one scenario clock (docs/BUGS.md #2): in a fresh browser the clock pill on /request, /ops and the
 * Kitchen screen must show the same scenario time (within a few minutes of each other). On prod /request once read a
 * clock anchored at process start, 6 h ahead of the visitor's run and drifting, so "tomorrow" meant another day there.
 * Runs in `pnpm gate --full`, or against prod: KITCHEN_URL=<url> npx playwright test -c evals/ui/pw-prod.config.ts
 */
const MONTHS: Record<string, number> = { Nov: 10, Dec: 11 };
const PILL = /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\d{1,2}) (Nov|Dec),? (\d\d):(\d\d)/;

/** The scenario time a page's clock pill shows, in minutes since an arbitrary epoch, or null when none is shown. */
async function clockOn(
	page: Page,
	path: string
): Promise<{ text: string; minutes: number } | null> {
	await page.goto(`${BASE}${path}`);
	await page.waitForLoadState('networkidle');
	await page.waitForTimeout(1500);
	const m = (await page.locator('body').innerText()).match(PILL);
	if (!m) return null;
	const [, d, mon, hh, mm] = m;
	const minutes = Date.UTC(2026, MONTHS[mon], Number(d), Number(hh), Number(mm)) / 60_000;
	return { text: m[0], minutes };
}

test('every surface shows the visitor run’s scenario clock', async ({ page }) => {
	test.setTimeout(180_000);
	// The Kitchen shows its clock once the event is planned: wait on the plan's own heading (flow.ts), which a
	// reused, already-planned sandbox shows too and no viewport hides.
	await planBuffet(page);

	const seen: Record<string, { text: string; minutes: number } | null> = {
		kitchen: await clockOn(page, '/'),
		request: await clockOn(page, '/request'),
		ops: await clockOn(page, '/ops')
	};
	const shown = Object.entries(seen).filter(
		(e): e is [string, { text: string; minutes: number }] => !!e[1]
	);
	const detail = Object.entries(seen)
		.map(([k, v]) => `${k}: ${v?.text ?? 'no clock'}`)
		.join(' · ');
	expect(shown.length, `clock pills found: ${detail}`).toBeGreaterThanOrEqual(2);
	const spread =
		Math.max(...shown.map(([, v]) => v.minutes)) - Math.min(...shown.map(([, v]) => v.minutes));
	// Pages are read seconds apart while the scenario clock moves in real time: a few minutes of slack.
	expect(spread, `scenario clocks disagree: ${detail}`).toBeLessThanOrEqual(5);
});
