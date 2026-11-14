import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import type { FixtureSnapshot } from '../../lib/kitchen/fixture-server';

/** Run against an already-started local server with DATABASE_URL= and LLM_PROVIDER=fixture. */
const BASE = process.env.KITCHEN_URL ?? 'http://localhost:4173';
const cards = (page: Page) => page.locator('button[data-need-id]');
const ingredient = (page: Page, id: string) =>
	page.locator(`button[data-need-id=${JSON.stringify(id)}]`);
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Ingredient inspector' });

async function scenario(context: BrowserContext, action: string, value?: string) {
	const response = await context.request.post(`${BASE}/kitchen-api/scenario`, {
		headers: { origin: BASE },
		data: { action, ...(value ? { value } : {}) }
	});
	expect(response.ok(), `${action}: ${await response.text()}`).toBe(true);
	return response.json();
}

async function seedPlan(context: BrowserContext, kitchen = 'k-hotel'): Promise<FixtureSnapshot> {
	// Establish this context's signed visitor and kitchen-session cookies before the first command.
	const initial = await context.request.get(`${BASE}/kitchen-api/snapshot`);
	expect(initial.ok()).toBe(true);
	await scenario(context, 'join', kitchen);
	const progress = (await scenario(context, 'plan')) as { planned: boolean; lines: number };
	expect(progress.planned).toBe(true);
	expect(progress.lines).toBeGreaterThan(0);
	const snapshot = (await scenario(context, 'rescue')) as FixtureSnapshot;
	expect(snapshot.plan.id).toBeTruthy();
	expect(snapshot.plan.kitchenId).toBe(kitchen);
	return snapshot;
}

async function lastSequence(context: BrowserContext) {
	let after = 0;
	for (let i = 0; i < 100; i++) {
		const response = await context.request.get(`${BASE}/api/events?mode=poll&after=${after}`);
		expect(response.ok()).toBe(true);
		const body = (await response.json()) as { events: unknown[]; last: number };
		expect(Array.isArray(body.events)).toBe(true);
		expect(Number.isFinite(body.last)).toBe(true);
		if (body.last === after) return after;
		after = body.last;
	}
	throw new Error('The fixture event cursor did not settle.');
}

async function openPlan(page: Page, snapshot: FixtureSnapshot) {
	await page.goto(`${BASE}/canvas?plan=${encodeURIComponent(snapshot.plan.id)}`);
	await expect(page.getByRole('heading', { name: 'Basket canvas', exact: true })).toBeVisible();
	await expect(cards(page)).toHaveCount(snapshot.plan.needs.length);
	await expect(page.getByRole('link', { name: 'Review and order in Kitchen' })).toHaveAttribute(
		'href',
		`/?plan=${encodeURIComponent(snapshot.plan.id)}#approval`
	);
}

async function expectNoPageOverflow(page: Page) {
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
		.toBeLessThanOrEqual(1);
	const bounds = await inspector(page).boundingBox();
	expect(bounds).not.toBeNull();
	expect(bounds!.x).toBeGreaterThanOrEqual(0);
	expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
}

async function capture(page: Page, name: string) {
	await mkdir(resolve('scratch'), { recursive: true });
	await page.screenshot({ path: resolve('scratch', name), fullPage: true });
}

test.describe('basket canvas, real fixture APIs', () => {
	test.setTimeout(150_000);
	const runtimeErrors = new WeakMap<Page, string[]>();
	test.beforeEach(({ page }) => {
		const errors: string[] = [];
		runtimeErrors.set(page, errors);
		page.on('pageerror', (error) => errors.push(error.message));
	});
	test.afterEach(({ page }) => {
		expect(runtimeErrors.get(page), 'uncaught browser errors').toEqual([]);
	});

	test('opening an empty canvas is read-only, including its initial stream refresh', async ({
		page,
		context
	}) => {
		const initial = await context.request.get(`${BASE}/kitchen-api/snapshot`);
		expect(initial.ok()).toBe(true);
		expect(await initial.json()).toMatchObject({ started: false });
		const before = await lastSequence(context);
		const writes: string[] = [];
		page.on('request', (request) => {
			if (request.method() !== 'GET' && request.method() !== 'HEAD')
				writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
		});

		await page.goto(`${BASE}/canvas`);
		await expect(page.getByRole('heading', { name: 'Open a plan to explore it' })).toBeVisible({
			timeout: 45_000
		});
		await expect(page.getByRole('link', { name: 'Open Kitchen', exact: true })).toBeVisible();
		await expect(cards(page)).toHaveCount(0);
		// Cover the 400 ms stream-open resync and the first one-second clock tick.
		await page.waitForTimeout(1_500);
		expect(await lastSequence(context), 'viewing must not append domain operations').toBe(before);
		expect(writes, 'viewing must not send planning or editing commands').toEqual([]);
		const after = await context.request.get(`${BASE}/kitchen-api/snapshot`);
		expect(after.ok()).toBe(true);
		expect(await after.json()).toMatchObject({ started: false });
	});

	test('a missing plan cannot expose a different basket and recovers to the visitor plan', async ({
		page,
		context
	}) => {
		const snapshot = await seedPlan(context);
		await openPlan(page, snapshot);
		await page.goto(`${BASE}/canvas?plan=pl-missing-canvas-test`);
		await expect(page.getByRole('heading', { name: 'This plan is not available' })).toBeVisible();
		await expect(cards(page)).toHaveCount(0);
		await expect(page.getByRole('combobox', { name: 'Product diet claims' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Apply agent recommendation' })).toHaveCount(0);
		await expect(page.getByRole('textbox', { name: /grams per guest/ })).toHaveCount(0);
		await page.getByRole('link', { name: 'Open my basket', exact: true }).click();
		await expect(cards(page)).toHaveCount(snapshot.plan.needs.length);
		await expect(page.getByRole('link', { name: 'Review and order in Kitchen' })).toHaveAttribute(
			'href',
			`/?plan=${encodeURIComponent(snapshot.plan.id)}#approval`
		);
	});

	test('product and diet filters keep ingredient selection and recover from no matches', async ({
		page,
		context
	}) => {
		await page.setViewportSize({ width: 1440, height: 1000 });
		const snapshot = await seedPlan(context);
		await openPlan(page, snapshot);
		const carrot = snapshot.view.dishes.find((dish) => dish.id === 'porkkanalaatikko')!;
		const pastry = snapshot.view.dishes.find((dish) => dish.id === 'joulutorttu')!;
		expect(carrot).toBeTruthy();
		expect(pastry).toBeTruthy();
		const carrotNeed = snapshot.plan.needs.find((need) => need.id === carrot.needId)!;
		const pastryNeed = snapshot.plan.needs.find((need) => need.id === pastry.needId)!;
		const carrotLine = snapshot.plan.lines.find(
			(line) =>
				line.needId === carrot.needId &&
				line.qty.value > 0 &&
				line.state !== 'unorderable' &&
				line.state !== 'rejected' &&
				!line.reasons.includes('superseded')
		)!;
		expect(carrotLine, 'the seed has a current carrot-casserole purchase').toBeTruthy();
		const product = snapshot.shortNames?.[carrotLine.productId] ?? carrotLine.productName!;
		expect(product).toBeTruthy();
		// The seed has an explicit gluten-free claim for carrot casserole; pastry contains wheat.
		expect(snapshot.diet?.[carrotLine.productId]?.freeFrom).toContain('GLUTEN');
		await ingredient(page, pastry.needId).click();
		await expect(
			inspector(page).getByRole('heading', { name: pastryNeed.label, exact: true })
		).toBeVisible();

		await page.getByRole('searchbox', { name: 'Find an ingredient or product' }).fill(product);
		await expect(ingredient(page, carrot.needId)).toBeVisible();
		await expect(cards(page)).toHaveCount(1);
		await expect(
			inspector(page).getByText('Selected ingredient is outside the current filters.')
		).toBeVisible();
		await ingredient(page, carrot.needId).click();
		await expect(
			inspector(page).getByRole('heading', { name: carrotNeed.label, exact: true })
		).toBeVisible();
		await expect(inspector(page)).toContainText(product);

		await page.getByRole('searchbox', { name: 'Find an ingredient or product' }).fill('');
		await page.getByRole('combobox', { name: 'Product diet claims' }).selectOption('G');
		await expect(ingredient(page, carrot.needId)).toBeVisible();
		await expect(ingredient(page, pastry.needId)).toHaveCount(0);
		await expect(ingredient(page, carrot.needId)).toHaveAttribute('aria-pressed', 'true');
		await page
			.getByRole('searchbox', { name: 'Find an ingredient or product' })
			.fill('no-such-ingredient-canvas');
		await expect(page.getByRole('heading', { name: 'No ingredients match' })).toBeVisible();
		await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
		await expect(cards(page)).toHaveCount(snapshot.plan.needs.length);
		await expect(page.getByRole('combobox', { name: 'Product diet claims' })).toHaveValue('all');
		await expect(ingredient(page, carrot.needId)).toHaveAttribute('aria-pressed', 'true');
		await page.getByRole('button', { name: 'Compact', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Compact', exact: true })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		await expectNoPageOverflow(page);
	});

	test('another tab edits the selected need while the canvas keeps its exact plan and focus', async ({
		page,
		context
	}) => {
		await page.setViewportSize({ width: 1440, height: 1000 });
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		const snapshot = await seedPlan(context);
		await scenario(context, 'join', 'k-lounas');
		await scenario(context, 'plan');
		const secondary = await context.request.get(`${BASE}/kitchen-api/snapshot`);
		expect(secondary.ok()).toBe(true);
		const different = (await secondary.json()) as FixtureSnapshot;
		expect(different.plan.kitchenId).toBe('k-lounas');
		expect(different.plan.id).not.toBe(snapshot.plan.id);
		let canvasReads = 0;
		page.on('response', (response) => {
			if (new URL(response.url()).pathname === '/kitchen-api/snapshot' && response.ok())
				canvasReads++;
		});
		await openPlan(page, snapshot);
		// Let the initial read and stream-open resync settle before the other tab changes session focus.
		await expect.poll(() => canvasReads).toBeGreaterThanOrEqual(2);
		const dish = snapshot.view.dishes.find(
			(item) => item.id === 'porkkanalaatikko' && item.editable
		)!;
		expect(dish).toBeTruthy();
		const need = snapshot.plan.needs.find((item) => item.id === dish.needId)!;
		await ingredient(page, need.id).click();
		const grams = inspector(page).getByRole('textbox', {
			name: `${need.label}, grams per guest`,
			exact: true
		});
		await expect(grams).toHaveValue(String(dish.gServed));
		const originalUrl = page.url();

		const other = await context.newPage();
		try {
			await other.goto(`${BASE}/healthz`);
			// This changes the browser session's remembered kitchen/plan, but not this canvas's ?plan=.
			const focused = (await scenario(context, 'join', 'k-lounas')) as FixtureSnapshot;
			expect(focused.plan.id).toBe(different.plan.id);
			const remembered = await other.request.get(`${BASE}/kitchen-api/snapshot`);
			expect(remembered.ok()).toBe(true);
			expect((await remembered.json()).plan.id).toBe(different.plan.id);
			const changedGrams = dish.gServed + 5;
			const response = await other.request.post(`${BASE}/kitchen-api/tool/edit_line`, {
				headers: {
					origin: BASE,
					'x-kitchen-tab': 'canvasedit',
					'x-kitchen-view': JSON.stringify({
						runId: snapshot.clock.runId,
						planId: snapshot.plan.id,
						version: snapshot.plan.version
					})
				},
				data: {
					planId: snapshot.plan.id,
					version: snapshot.plan.version,
					needId: need.id,
					patch: { gramsPerGuest: changedGrams }
				}
			});
			expect(response.ok(), await response.text()).toBe(true);
			const changed = (await response.json()) as { plan: FixtureSnapshot['plan'] };
			expect(changed.plan.id).toBe(snapshot.plan.id);
			expect(changed.plan.version).toBeGreaterThan(snapshot.plan.version);

			// No reload or snapshot API from the test: only the page's real event subscription can refresh this input.
			await expect(grams).toHaveValue(String(changedGrams), { timeout: 30_000 });
			await expect(page.getByRole('status')).toContainText(
				'Basket updated from the agent or another screen.'
			);
			await expect(ingredient(page, need.id)).toHaveAttribute('aria-pressed', 'true');
			await expect(
				inspector(page).getByRole('heading', { name: need.label, exact: true })
			).toBeVisible();
			await expect(page.getByRole('link', { name: 'Review and order in Kitchen' })).toHaveAttribute(
				'href',
				`/?plan=${encodeURIComponent(snapshot.plan.id)}#approval`
			);
			expect(page.url()).toBe(originalUrl);
			await expect(cards(page)).toHaveCount(snapshot.plan.needs.length);
			await expectNoPageOverflow(page);
			await expect(grams).toBeEnabled();
			expect(errors).toEqual([]);
			await capture(page, 'canvas-desktop.png');
		} finally {
			await other.close();
		}
	});

	test('inspector quantity edits use the scoped tool and replacement questions remain unsent drafts', async ({
		page,
		context
	}) => {
		await page.setViewportSize({ width: 1440, height: 1000 });
		const snapshot = await seedPlan(context);
		await openPlan(page, snapshot);
		const carrot = snapshot.view.dishes.find((item) => item.id === 'porkkanalaatikko')!;
		const carrotNeed = snapshot.plan.needs.find((item) => item.id === carrot.needId)!;
		await ingredient(page, carrot.needId).click();
		const grams = inspector(page).getByRole('textbox', {
			name: `${carrotNeed.label}, grams per guest`,
			exact: true
		});
		const toolAnswer = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === '/kitchen-api/tool/edit_line' &&
				response.request().method() === 'POST'
		);
		await grams.fill(String(carrot.gServed + 5));
		await grams.press('Tab');
		const response = await toolAnswer;
		expect(response.ok(), await response.text()).toBe(true);
		expect(response.request().postDataJSON()).toMatchObject({
			planId: snapshot.plan.id,
			version: snapshot.plan.version,
			needId: carrotNeed.id,
			patch: { gramsPerGuest: carrot.gServed + 5 }
		});
		await expect(grams).toHaveValue(String(carrot.gServed + 5));
		const refreshed = await context.request.get(
			`${BASE}/kitchen-api/snapshot?plan=${encodeURIComponent(snapshot.plan.id)}&peek=1`
		);
		expect(refreshed.ok()).toBe(true);
		const after = (await refreshed.json()) as FixtureSnapshot;
		expect(after.plan.id).toBe(snapshot.plan.id);
		expect(after.plan.version).toBeGreaterThan(snapshot.plan.version);
		expect(after.view.dishes.find((item) => item.id === carrot.id)?.gServed).toBe(
			carrot.gServed + 5
		);
		expect(
			after.plan.needs.find((item) => item.id === carrotNeed.id)?.amount.value
		).toBeGreaterThan(carrotNeed.amount.value);

		const unsent: string[] = [];
		page.on('request', (request) => {
			const path = new URL(request.url()).pathname;
			if (
				request.method() === 'POST' &&
				(path === '/api/chat/turn' || path === '/kitchen-api/tool/find_substitutes')
			)
				unsent.push(path);
		});
		const dish = after.view.dishes.find((item) => item.id === 'joulukinkku')!;
		expect(dish.rescue).toBeTruthy();
		const need = after.plan.needs.find((item) => item.id === dish.needId)!;
		await ingredient(page, need.id).click();
		await inspector(page)
			.getByRole('button', { name: /Ask agent to replace/ })
			.click();
		const dock = page.getByRole('complementary', { name: 'Agent chat' });
		await expect(dock).toBeVisible();
		const draft = dock.getByRole('textbox', { name: 'Message the agent' });
		await expect(draft).toHaveValue(/replace|replacement/i);
		expect(await draft.inputValue()).toContain(need.label);
		await expect(dock.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
		expect(unsent, 'a replacement draft must not call a tool or send itself').toEqual([]);
		await dock.getByRole('button', { name: 'Close chat', exact: true }).click();
		await inspector(page)
			.getByRole('button', { name: 'Ask about this ingredient', exact: true })
			.click();
		await expect(dock).toBeVisible();
		await expect(draft).toHaveValue(
			`For ${need.label} in this plan, explain the current purchases and compare suitable alternatives.`
		);
		await expect(dock.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
		expect(unsent, 'opening a question draft must not send it').toEqual([]);
	});

	test('applying a replacement updates purchases and repeating it preserves exact approval terms', async ({
		page,
		context
	}) => {
		await page.setViewportSize({ width: 1440, height: 1000 });
		const initial = await context.request.get(`${BASE}/kitchen-api/snapshot`);
		expect(initial.ok()).toBe(true);
		await scenario(context, 'join', 'k-hotel');
		await scenario(context, 'plan');
		const unrescued = await context.request.get(`${BASE}/kitchen-api/snapshot`);
		expect(unrescued.ok()).toBe(true);
		const before = (await unrescued.json()) as FixtureSnapshot;
		const dish = before.view.dishes.find((item) => item.id === 'joulukinkku')!;
		const need = before.plan.needs.find((item) => item.id === dish.needId)!;
		expect(
			before.plan.lines.filter((line) => line.needId === need.id && line.substituteFor)
		).toHaveLength(0);
		await openPlan(page, before);
		await ingredient(page, need.id).click();
		const apply = inspector(page).getByRole('button', {
			name: 'Apply agent recommendation',
			exact: true
		});
		const applyResponse = () =>
			page.waitForResponse(
				(response) =>
					new URL(response.url()).pathname === '/kitchen-api/tool/find_substitutes' &&
					response.request().method() === 'POST'
			);
		const firstAnswer = applyResponse();
		await apply.click();
		const first = await firstAnswer;
		expect(first.ok(), await first.text()).toBe(true);
		const applied = (await first.json()) as { applied: boolean; plan: FixtureSnapshot['plan'] };
		expect(applied.applied).toBe(true);
		expect(applied.plan.id).toBe(before.plan.id);
		expect(applied.plan.version).toBeGreaterThan(before.plan.version);
		expect(
			applied.plan.lines.some(
				(line) => line.needId === need.id && line.substituteFor && line.qty.value > 0
			)
		).toBe(true);
		await expect(
			page.getByText('Recommendation applied. Review the updated purchases and any decisions.', {
				exact: true
			})
		).toBeVisible();
		await expect(
			inspector(page).getByRole('region', { name: 'Ingredient decisions' })
		).toBeVisible();
		await expect(ingredient(page, need.id)).toHaveAttribute('aria-pressed', 'true');
		await expect(apply).toBeEnabled();

		const currentResponse = await context.request.get(
			`${BASE}/kitchen-api/snapshot?plan=${encodeURIComponent(before.plan.id)}&peek=1`
		);
		expect(currentResponse.ok()).toBe(true);
		const current = (await currentResponse.json()) as FixtureSnapshot;
		expect(current.approval?.state).toBe('pending');
		const repeatedAnswer = applyResponse();
		await apply.click();
		const repeated = await repeatedAnswer;
		expect(repeated.ok(), await repeated.text()).toBe(true);
		const unchanged = (await repeated.json()) as {
			applied: boolean;
			plan: FixtureSnapshot['plan'];
		};
		expect(unchanged.applied).toBe(false);
		expect(unchanged.plan.version).toBe(current.plan.version);
		await expect(
			page.getByText('The basket already uses this recommendation. No changes were made.', {
				exact: true
			})
		).toBeVisible();
		await expect(apply).toBeEnabled();
		const repeatedSnapshot = await context.request.get(
			`${BASE}/kitchen-api/snapshot?plan=${encodeURIComponent(before.plan.id)}&peek=1`
		);
		expect(repeatedSnapshot.ok()).toBe(true);
		const stable = (await repeatedSnapshot.json()) as FixtureSnapshot;
		expect(stable.plan.version).toBe(current.plan.version);
		expect(stable.plan.termsHash).toBe(current.plan.termsHash);
		expect(stable.approval).toEqual(current.approval);

		const decision = inspector(page).getByRole('region', { name: 'Ingredient decisions' });
		await decision
			.getByRole('button', { name: /^Review \d+ lines?/ })
			.first()
			.click();
		const approvalAnswer = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === '/kitchen-api/tool/approve' &&
				response.request().method() === 'POST'
		);
		await decision.getByRole('button', { name: 'Confirm exact terms', exact: true }).click();
		const approval = await approvalAnswer;
		expect(approval.ok(), await approval.text()).toBe(true);
		expect(approval.request().postDataJSON()).toMatchObject({
			planVersion: stable.plan.version,
			termsHash: stable.plan.termsHash,
			decision: 'grant'
		});
		expect(await approval.json()).toMatchObject({ state: 'granted' });
		const approved = await context.request.get(
			`${BASE}/kitchen-api/snapshot?plan=${encodeURIComponent(before.plan.id)}&peek=1`
		);
		expect(approved.ok()).toBe(true);
		expect(
			((await approved.json()) as FixtureSnapshot).orders,
			'approval alone must not order'
		).toEqual([]);
	});

	test('390px outline keeps the selected inspector reachable without page overflow', async ({
		page,
		context
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		const snapshot = await seedPlan(context);
		await openPlan(page, snapshot);
		await capture(page, 'canvas-mobile-board.png');
		const need = snapshot.plan.needs.find((item) => item.id === 'need:porkkanalaatikko')!;
		expect(need).toBeTruthy();
		await ingredient(page, need.id).click();
		await expect(ingredient(page, need.id)).toHaveAttribute('aria-pressed', 'true');
		await expect(
			inspector(page).getByRole('heading', { name: need.label, exact: true })
		).toBeInViewport();
		await expect(
			inspector(page).getByRole('heading', { name: need.label, exact: true })
		).toBeFocused();
		await expect(
			inspector(page).getByRole('button', { name: 'Ask about this ingredient' })
		).toBeVisible();
		await expectNoPageOverflow(page);
		await inspector(page).getByRole('button', { name: 'Close ingredient', exact: true }).click();
		await expect(inspector(page)).toBeHidden();
		await expect(ingredient(page, need.id)).toBeFocused();
		await expect(page.getByRole('button', { name: 'Ingredients', exact: true })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		await expect(
			page.getByRole('button', { name: 'Selected ingredient', exact: true })
		).toBeDisabled();
		await ingredient(page, need.id).click();
		await expect(
			inspector(page).getByRole('heading', { name: need.label, exact: true })
		).toBeInViewport();
		await expect(
			inspector(page).getByRole('textbox', { name: `${need.label}, grams per guest`, exact: true })
		).toBeEnabled();
		await page.evaluate(() => window.scrollTo(0, 0));
		expect(errors).toEqual([]);
		await capture(page, 'canvas-mobile.png');
	});

	test('a lost replacement response refreshes the saved change without retrying or ordering', async ({
		page,
		context
	}) => {
		await page.setViewportSize({ width: 1440, height: 1000 });
		const initial = await context.request.get(`${BASE}/kitchen-api/snapshot`);
		expect(initial.ok()).toBe(true);
		await scenario(context, 'join', 'k-hotel');
		await scenario(context, 'plan');
		const unrescued = await context.request.get(`${BASE}/kitchen-api/snapshot`);
		expect(unrescued.ok()).toBe(true);
		const before = (await unrescued.json()) as FixtureSnapshot;
		const dish = before.view.dishes.find((item) => item.id === 'joulukinkku')!;
		const need = before.plan.needs.find((item) => item.id === dish.needId)!;
		expect(before.plan.lines.some((line) => line.needId === need.id && line.substituteFor)).toBe(
			false
		);
		await openPlan(page, before);
		await ingredient(page, need.id).click();

		const serverAnswers: { status: number; applied: boolean; plan: FixtureSnapshot['plan'] }[] = [];
		const unintended: string[] = [];
		page.on('request', (request) => {
			const path = new URL(request.url()).pathname;
			if (request.method() === 'POST' && /\/kitchen-api\/tool\/(approve|commit_order)$/.test(path))
				unintended.push(path);
		});
		await page.route('**/kitchen-api/tool/find_substitutes', async (route) => {
			if (route.request().method() !== 'POST') return route.continue();
			// The real server applies the tool; only its response to the browser is lost.
			const response = await route.fetch();
			const body = (await response.json()) as { applied: boolean; plan: FixtureSnapshot['plan'] };
			serverAnswers.push({ status: response.status(), ...body });
			await route.abort('failed');
		});
		const apply = inspector(page).getByRole('button', {
			name: 'Apply agent recommendation',
			exact: true
		});
		await apply.click();
		const alert = page.getByRole('alert');
		await expect(alert).toContainText(
			'The replacement response could not be confirmed. Review the refreshed basket before retrying.'
		);
		await expect(alert).not.toContainText(/nothing changed|unchanged|no changes were made/i);
		await expect(ingredient(page, need.id)).toContainText('Replacement planned');
		await expect(inspector(page)).toContainText('replaces');
		await expect(ingredient(page, need.id)).toHaveAttribute('aria-pressed', 'true');
		await expect(apply).toBeEnabled();
		expect(serverAnswers).toHaveLength(1);
		expect(serverAnswers[0].status).toBe(200);
		expect(serverAnswers[0].applied).toBe(true);
		expect(serverAnswers[0].plan.version).toBeGreaterThan(before.plan.version);

		// Give the event-stream refresh and a clock tick a chance to reveal an unwanted automatic retry.
		await page.waitForTimeout(1_000);
		expect(
			serverAnswers,
			'a lost response must not automatically repeat the mutation'
		).toHaveLength(1);
		expect(unintended, 'an uncertain recommendation must not approve or order').toEqual([]);
		const refreshed = await context.request.get(
			`${BASE}/kitchen-api/snapshot?plan=${encodeURIComponent(before.plan.id)}&peek=1`
		);
		expect(refreshed.ok()).toBe(true);
		const saved = (await refreshed.json()) as FixtureSnapshot;
		expect(saved.plan.id).toBe(before.plan.id);
		expect(saved.plan.version).toBe(serverAnswers[0].plan.version);
		expect(
			saved.plan.lines.some(
				(line) => line.needId === need.id && line.substituteFor && line.qty.value > 0
			)
		).toBe(true);
		expect(saved.approval?.state).toBe('pending');
		expect(saved.orders).toEqual([]);
		await page.evaluate(() => window.scrollTo(0, 0));
		await expect(alert).toContainText(
			'The replacement response could not be confirmed. Review the refreshed basket before retrying.'
		);
		await expect(apply).toBeEnabled();
		await capture(page, 'canvas-response-lost.png');
	});

	for (const width of [1440, 390]) {
		test(`product photos keep truthful fixed slots and read-only inspection at ${width}px`, async ({
			page,
			context
		}) => {
			await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
			const snapshot = await seedPlan(context);
			const sequence = await lastSequence(context);
			const svg = (label: string, color: string) =>
				`data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" fill="#fff"/><rect x="22" y="10" width="52" height="76" rx="4" fill="${color}"/><rect x="27" y="36" width="42" height="28" fill="#fff"/><text x="48" y="54" text-anchor="middle" font-family="sans-serif" font-size="11">${label}</text></svg>`)}`;
			const exactUrl = svg('EXACT', '#0c7772');
			const approximateUrl = svg('SIMILAR', '#9c6c28');
			const brokenUrl = `${BASE}/canvas-broken-photo.svg`;
			const fixtures: Record<string, { imageUrl: string; match: string } | null> = {
				'461210': { imageUrl: exactUrl, match: 'gtin' },
				'476768': { imageUrl: approximateUrl, match: 'category' },
				'463876': null,
				'463804': { imageUrl: brokenUrl, match: 'gtin' }
			};
			for (const id of Object.keys(fixtures))
				expect(snapshot.plan.lines.some((line) => line.productId === id)).toBe(true);
			const batches: string[][] = [];
			let brokenRequests = 0;
			let release = () => {};
			const ready = new Promise<void>((resolveReady) => (release = resolveReady));
			await page.route('**/canvas-broken-photo.svg', async (route) => {
				brokenRequests++;
				await route.abort('failed');
			});
			await page.route('**/kitchen-api/thumbs?*', async (route) => {
				const ids = new URL(route.request().url()).searchParams.get('ids')!.split(',');
				batches.push(ids);
				await ready;
				await route.fulfill({
					json: Object.fromEntries(ids.map((id) => [id, fixtures[id] ?? null]))
				});
			});
			const writes: string[] = [];
			page.on('request', (request) => {
				if (request.method() === 'POST') writes.push(new URL(request.url()).pathname);
			});
			const photo = (scope: Page | Locator, id: string) =>
				scope.locator(`[data-photo-product=${JSON.stringify(id)}]`).first();
			try {
				await openPlan(page, snapshot);
				const board = page.getByRole('region', { name: 'Recipe and ingredient canvas' });
				const initialSlots = new Map<string, { width: number; height: number }>();
				for (const id of Object.keys(fixtures)) {
					const slot = photo(board, id);
					await expect(slot).toHaveAttribute('data-photo-state', 'loading');
					const box = await slot.boundingBox();
					expect(box).not.toBeNull();
					expect(Math.round(box!.width)).toBe(64);
					expect(Math.round(box!.height)).toBe(64);
					initialSlots.set(id, { width: box!.width, height: box!.height });
				}
				release();
				for (const [id, state] of [
					['461210', 'ready'],
					['476768', 'ready'],
					['463876', 'missing'],
					['463804', 'unavailable']
				]) {
					const slot = photo(board, id);
					await slot.scrollIntoViewIfNeeded();
					await expect(slot).toHaveAttribute('data-photo-state', state);
					const box = await slot.boundingBox();
					expect(box!.width).toBeCloseTo(initialSlots.get(id)!.width, 1);
					expect(box!.height).toBeCloseTo(initialSlots.get(id)!.height, 1);
				}
				const exact = photo(board, '461210');
				await expect(exact).toHaveAttribute('data-photo-match', 'gtin');
				await expect(exact).toHaveAccessibleName(/Exact product photo/i);
				await expect(exact.locator('img')).toHaveAttribute('src', exactUrl);
				await expect
					.poll(() =>
						exact.locator('img').evaluate((image) => (image as HTMLImageElement).naturalWidth)
					)
					.toBeGreaterThan(0);
				await expect(exact).not.toContainText(/pack may differ/i);
				const approximate = photo(board, '476768');
				await expect(approximate).toHaveAttribute('data-photo-match', 'category');
				await expect(approximate).toHaveAccessibleName(/Pack may differ/i);
				await expect(approximate.locator('img')).toHaveAttribute('src', approximateUrl);
				await expect(photo(board, '463876')).toHaveAccessibleName(/No photo/i);
				await expect(photo(board, '463876').locator('img')).toBeHidden();
				await expect(photo(board, '463804')).toHaveAccessibleName(/Photo unavailable/i);
				await expect(photo(board, '463804').locator('img')).toBeHidden();
				expect(brokenRequests).toBeGreaterThan(0);
				const requested = batches.flat();
				expect(requested).toEqual(expect.arrayContaining(Object.keys(fixtures)));
				expect(new Set(requested).size, 'a product is read once per page').toBe(requested.length);
				expect(
					batches.some((ids) => ids.length > 1),
					'nearby photos share a batch'
				).toBe(true);

				const selected = await board
					.locator('button[data-need-id][aria-pressed="true"]')
					.getAttribute('data-need-id');
				expect(selected).toBeTruthy();
				const productRow = board.locator('[data-canvas-product="461210"]').first();
				const productButton = productRow.getByRole('button').first();
				expect(
					await productButton.evaluate(
						(button) => button.parentElement?.closest('button') === null
					),
					'the product trigger is outside the ingredient selection button'
				).toBe(true);
				const productRead = page.waitForResponse(
					(response) => new URL(response.url()).pathname === '/kitchen-api/product/461210'
				);
				await productButton.click();
				expect((await productRead).ok()).toBe(true);
				await expect(page.getByText('Pack', { exact: true })).toBeVisible();
				await expect(ingredient(page, selected!)).toHaveAttribute('aria-pressed', 'true');
				await page.keyboard.press('Escape');
				await expect(page.getByText('Pack', { exact: true })).toBeHidden();
				await page.evaluate(() => window.scrollTo(0, 0));
				const boardArea = page.locator('.board-area');
				if (width === 390) {
					const flow = await boardArea.evaluate((element) => ({
						viewport: window.innerHeight,
						height: element.clientHeight,
						content: element.scrollHeight
					}));
					expect(
						flow.height,
						'the phone board uses the document rather than a short pane'
					).toBeGreaterThan(flow.viewport);
					expect(flow.content - flow.height).toBeLessThanOrEqual(1);
					await capture(page, 'canvas-photos-mobile-board.png');
				}

				const ham = snapshot.plan.needs.find((need) => need.id === 'need:joulukinkku')!;
				await ingredient(page, ham.id).click();
				const inspectionPhoto = photo(inspector(page), '476768');
				await inspectionPhoto.scrollIntoViewIfNeeded();
				await expect(inspectionPhoto).toHaveAttribute('data-photo-state', 'ready');
				await expect(inspectionPhoto).toHaveAccessibleName(/Pack may differ/i);
				const inspectionBox = await inspectionPhoto.boundingBox();
				expect(Math.round(inspectionBox!.width)).toBe(96);
				expect(Math.round(inspectionBox!.height)).toBe(96);
				const paneGeometry = () =>
					page.locator('.workbench').evaluate((element) => {
						const left = element.querySelector<HTMLElement>('.board-area')!;
						const right = element.querySelector<HTMLElement>('.inspector')!;
						const measure = (pane: HTMLElement) => ({
							height: pane.getBoundingClientRect().height,
							client: pane.clientHeight,
							content: pane.scrollHeight,
							scroll: pane.scrollTop
						});
						const bounds = element.getBoundingClientRect();
						return {
							viewport: window.innerHeight,
							pageScroll: window.scrollY,
							workbench: { top: bounds.top, bottom: bounds.bottom, height: bounds.height },
							left: measure(left),
							right: measure(right)
						};
					});
				await page.evaluate(() => window.scrollTo(0, 0));
				const panesBefore = await paneGeometry();
				if (width === 1440) {
					expect(
						Math.abs(panesBefore.left.height - panesBefore.right.height),
						'desktop panes have equal visible heights'
					).toBeLessThanOrEqual(1);
					expect(panesBefore.workbench.top).toBeGreaterThanOrEqual(0);
					expect(
						panesBefore.workbench.bottom,
						'the workbench stays inside the viewport'
					).toBeLessThanOrEqual(panesBefore.viewport + 1);
					expect(panesBefore.left.content).toBeGreaterThan(panesBefore.left.client);
					expect(panesBefore.right.content).toBeGreaterThan(panesBefore.right.client);
					const inner = await board.evaluate((element) => ({
						height: element.clientHeight,
						content: element.scrollHeight
					}));
					expect(
						inner.content - inner.height,
						'the board itself does not create a second nested scroll area'
					).toBeLessThanOrEqual(1);
				} else {
					expect(
						panesBefore.right.height,
						'phone inspection grows to fit its content'
					).toBeGreaterThan(panesBefore.viewport);
					expect(panesBefore.right.content - panesBefore.right.client).toBeLessThanOrEqual(1);
					expect(panesBefore.right.scroll).toBe(0);
				}
				const alternatives = inspector(page).getByRole('region', {
					name: 'Ingredient alternatives'
				});
				const candidatePhoto = photo(alternatives, '476768');
				await candidatePhoto.scrollIntoViewIfNeeded();
				await expect(candidatePhoto).toHaveAttribute('data-photo-state', 'ready');
				await expect(candidatePhoto).toHaveAccessibleName(/Pack may differ/i);
				const candidateBox = await candidatePhoto.boundingBox();
				expect(Math.round(candidateBox!.width)).toBe(48);
				expect(Math.round(candidateBox!.height)).toBe(48);
				await expect(
					alternatives.getByText('Pack may differ', { exact: true }).first()
				).toBeVisible();
				const approval = inspector(page)
					.getByRole('region', { name: 'Ingredient decisions' })
					.getByRole('button', { name: /^Review \d+ lines?/ })
					.first();
				await approval.scrollIntoViewIfNeeded();
				await expect(approval).toBeInViewport();
				const panesAfter = await paneGeometry();
				expect(panesAfter.workbench.height).toBeCloseTo(panesBefore.workbench.height, 1);
				expect(panesAfter.right.height).toBeCloseTo(panesBefore.right.height, 1);
				if (width === 1440) {
					expect(panesAfter.right.scroll, 'the inspector scrolls to its decisions').toBeGreaterThan(
						panesBefore.right.scroll
					);
					expect(
						panesAfter.left.scroll,
						'inspector navigation leaves the board in place'
					).toBeCloseTo(panesBefore.left.scroll, 1);
					expect(panesAfter.pageScroll).toBeCloseTo(panesBefore.pageScroll, 1);
					await capture(page, 'canvas-photos-desktop-inspector-end.png');
				} else {
					expect(panesAfter.right.scroll).toBe(0);
					expect(panesAfter.pageScroll, 'phone inspection scrolls the document').toBeGreaterThan(
						panesBefore.pageScroll
					);
				}
				await expectNoPageOverflow(page);
				const afterResponse = await context.request.get(
					`${BASE}/kitchen-api/snapshot?plan=${encodeURIComponent(snapshot.plan.id)}&peek=1`
				);
				expect(afterResponse.ok()).toBe(true);
				const after = (await afterResponse.json()) as FixtureSnapshot;
				expect(after.plan.id).toBe(snapshot.plan.id);
				expect(after.plan.version).toBe(snapshot.plan.version);
				expect(after.plan.termsHash).toBe(snapshot.plan.termsHash);
				expect(after.approval).toEqual(snapshot.approval);
				expect(after.orders).toEqual(snapshot.orders);
				expect(
					await lastSequence(context),
					'photos and product inspection append no purchasing operations'
				).toBe(sequence);
				expect(writes).toEqual([]);
				if (width === 1440) {
					await inspector(page).hover();
					await page.mouse.wheel(0, -10_000);
					await expect.poll(() => inspector(page).evaluate((element) => element.scrollTop)).toBe(0);
				}
				await page.evaluate(() => window.scrollTo(0, 0));
				await capture(
					page,
					width === 390 ? 'canvas-photos-mobile.png' : 'canvas-photos-desktop.png'
				);
			} finally {
				release();
			}
		});
	}
});
