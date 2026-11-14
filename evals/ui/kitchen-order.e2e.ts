import { expect, test } from '@playwright/test';
import { approveAll, BASE, planBuffet, enterKitchen } from './flow';

/**
 * Regression checks from the prod bug bash (docs/BUGS.md #1, #5, #6, #9), on the Kitchen screen as a judge uses it.
 * Properties, not today's numbers: the order summary counts what was approved and its parts add up to the total; a
 * reload keeps the receipt; every "g × guests = kg" formula is arithmetic; an agent's approval link lands on something
 * a human can approve. Runs in `pnpm gate --full` (production build on PGlite, throwaway JUDGE_KEY_SECRET) or against
 * a deployed app with KITCHEN_URL=<url>.
 */

const euros = (s: string) => Number(s.replace(/[€\s,]/g, ''));

/**
 * Known open defects by BUGS.md id, as `expectFail` in the evals: a listed check that fails is annotated, not red; a
 * listed check that passes is red ("looks fixed: delete it here"), so the list never hides a fix. Empty = all enforced.
 */
const KNOWN = new Set<string>([]);

const seen = new Map<string, { pass: boolean; detail: string }[]>();
function check(id: string, pass: boolean, detail: string) {
	seen.set(id, [...(seen.get(id) ?? []), { pass, detail }]);
}
/** After each test: an unlisted id must pass every check; a KNOWN id must still fail at least one. */
test.afterEach(() => {
	for (const [id, rs] of seen) {
		const failed = rs.filter((r) => !r.pass);
		if (KNOWN.has(id)) {
			for (const r of failed)
				test.info().annotations.push({ type: 'expected-fail', description: `${id}: ${r.detail}` });
			expect(failed.length, `${id} looks fixed: delete it from KNOWN`).toBeGreaterThan(0);
		} else
			expect(
				failed.map((r) => r.detail),
				id
			).toEqual([]);
	}
	seen.clear();
});

test('the order summary counts what was approved, adds up, and survives a reload', async ({
	page
}) => {
	test.setTimeout(240_000);
	await planBuffet(page);

	// #9: every plain "g × guests = kg" formula on screen is arithmetic (yield forms with ÷ are left out).
	const body = await page.locator('body').innerText();
	const wrong = [...body.matchAll(/(\d+(?:\.\d+)?) g × (\d+) = (\d+(?:\.\d+)?) kg/g)].filter(
		([, g, n, kg]) => Math.abs((Number(g) * Number(n)) / 1000 - Number(kg)) > 0.051
	);
	check('BUG-9', wrong.length === 0, `formulas that are not g × guests: ${wrong.map((m) => m[0])}`);

	const approved = await approveAll(page);
	expect(approved, 'lines signed off').toBeGreaterThan(0);
	// What may be ordered now, from the server's plan (button labels can be read twice while a group re-renders).
	const before = (await (await page.request.get(`${BASE}/kitchen-api/snapshot`)).json()) as {
		plan?: { lines: { state: string; view?: { committable?: boolean } }[] };
	};
	const committable = before.plan?.lines.filter((l) => l.view?.committable === true).length;
	await page
		.getByRole('button', { name: /Place order/ })
		.first()
		.click();
	// The order summary's own sentence, not the first "receipt" anywhere (the activity log shows it earlier).
	await page
		.getByText(/Ordered\s*·\s*\d+\s+lines?/)
		.first()
		.waitFor({ timeout: 30_000 })
		.catch(() => undefined);
	// The receipt id is System-layer detail; the receipt card itself is what the chef sees.
	await page.getByLabel('Receipt', { exact: true }).first().waitFor({ timeout: 30_000 });
	const panel = await page.locator('body').innerText();

	// #5: the order summary counts what was ordered, from the receipt, and the money rows add up to the total.
	const said = panel.match(/Ordered\s*·\s*(\d+)\s+lines/)?.[1];
	const confirmed = Number(panel.match(/(\d+)\s+lines? supplier confirmed/)?.[1] ?? 0);
	const awaiting = Number(panel.match(/(\d+)\s+awaiting the supplier/)?.[1] ?? 0);
	check(
		'BUG-5',
		said !== undefined && Number(said) === confirmed + awaiting,
		`"Ordered · ${said} lines" vs receipt ${confirmed} confirmed + ${awaiting} awaiting`
	);
	check(
		'BUG-5',
		committable !== undefined && Number(said) === committable,
		`"Ordered · ${said} lines" vs ${committable} committable lines before Place order (${approved} signed off per the buttons)`
	);
	// The screen's count against the server's plan: every committed line, no more, no fewer.
	const snap = (await (await page.request.get(`${BASE}/kitchen-api/snapshot`)).json()) as {
		plan?: { lines: { state: string }[] };
	};
	const committed = snap.plan?.lines.filter((l) => l.state === 'committed').length;
	check(
		'BUG-5',
		committed !== undefined && Number(said) === committed,
		`"Ordered · ${said} lines" vs ${committed} committed lines in the server's plan`
	);
	const money = await page
		.locator('dl[aria-label^="Where the plan"]')
		.innerText()
		.catch(() => '');
	const rows = [...money.matchAll(/^(.+?)\s+(€[\d,.]+)$/gm)].map(
		(m) => [m[1].trim(), euros(m[2])] as const
	);
	const total = rows.find(([l]) => /^Plan total/.test(l))?.[1];
	const parts = rows.filter(([l]) => !/^Plan total/.test(l)).reduce((a, [, v]) => a + v, 0);
	check(
		'BUG-5',
		total !== undefined && Math.abs(parts - total) < 0.01,
		`money rows ${parts.toFixed(2)} vs plan total ${total}`
	);
	// The receipt id lives in the System layer (in the DOM, not on screen): read it from there.
	const receiptOf = async () =>
		(await page.getByLabel('Receipt', { exact: true }).first().textContent())?.match(
			/receipt (rc-[a-z0-9]+)/
		)?.[1];
	const receipt = await receiptOf();
	expect(receipt).toBeTruthy();

	// #6: a reload still shows the order and its receipt.
	await page.reload();
	await page.waitForLoadState('networkidle');
	await page.waitForTimeout(1500);
	const after = await page.locator('body').innerText();
	const kept = (await receiptOf().catch(() => undefined)) === receipt;
	check(
		'BUG-6',
		kept && !/No decisions\s+Nothing needs you/.test(after),
		`after reload: receipt ${kept ? 'shown' : 'gone'}, headline ${/No decisions/.test(after) ? '"No decisions"' : 'ordered'}`
	);
});

test("an agent's approval link opens a plan the chef can approve", async ({ page, request }) => {
	test.setTimeout(120_000);
	// The visitor's own sandbox and its judge key, as /agents hands them out.
	await enterKitchen(page, '/?ws=mine');
	const k = await page.request.get(`${BASE}/api/demo/judge-key`);
	test.skip(k.status() !== 200, `judge keys off here (${k.status()})`);
	const { key } = (await k.json()) as { key: string };
	const placed = await request.post(`${BASE}/api/tools/place_order`, {
		headers: { authorization: `Bearer ${key}` },
		data: {
			kitchenId: 'k-hotel',
			deliverBy: '2026-12-11',
			idempotencyKey: 'ui-approval-link',
			lines: [{ productId: '464201', qty: 30, unit: 'ST' }]
		}
	});
	expect(placed.status()).toBe(200);
	const out = (await placed.json()) as {
		approvalId?: string | null;
		meta?: { approvalUrl?: string };
		approvalUrl?: string;
	};
	const url = out.meta?.approvalUrl ?? out.approvalUrl;
	expect(out.approvalId, 'the agent order waits for a human').toBeTruthy();
	expect(url, 'approvalUrl').toBeTruthy();

	// #1: the link lands on the agent's plan with a way to approve it, not on the seeded buffet's start screen.
	await page.goto(url!.startsWith('http') ? url! : `${BASE}${url}`);
	await page.waitForLoadState('networkidle');
	await page.waitForTimeout(2000);
	const approve = page
		.getByRole('button', { name: /Hold to sign off|Confirm exact terms|Review \d+ lines?|Approve/ })
		.first();
	const shown = await approve
		.waitFor({ timeout: 30_000 })
		.then(() => true)
		.catch(() => false);
	check('BUG-1', shown, shown ? 'approve control shown' : `no approve control at ${url}`);
});
