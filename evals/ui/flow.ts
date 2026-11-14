import { expect, type Page } from '@playwright/test';

/**
 * Every entry step the UI checks take, in one place (D15 stages the entry flow: establishment picker → chat-first
 * home → the Kitchen as a canvas). A spec calls these and never selects the first screens itself, so a change to the
 * entry flow touches this file only. Selector owners: the picker c3; the Kitchen canvas, Decide and dish details 1f;
 * the chat composer E; the request step cards B (contract in docs/lanes/f-evals.md).
 */
export const BASE = process.env.KITCHEN_URL ?? 'http://localhost:4173';

/**
 * Opens the Kitchen at `path` as the visitor would. A fresh sandbox first shows the establishment picker ("Who are you
 * cooking for?", c3); this picks the hotel there and waits for the Kitchen, so every spec starts from the same canvas.
 * A visitor who already chose (or a build without the picker) goes straight on.
 */
export async function enterKitchen(page: Page, path = '/', kitchenId = 'k-hotel') {
	await page.goto(`${BASE}${path}`);
	const picker = page.getByTestId('establishment-picker');
	const views = page.getByRole('navigation', { name: 'Kitchen view' });
	const canvas = page.locator('#task-h').or(page.getByRole('button', { name: /^Plan the event/ }));
	await picker.or(views).or(canvas).first().waitFor({ timeout: 60_000 });
	if (await picker.isVisible().catch(() => false)) {
		await picker.locator(`[data-kitchen-id="${kitchenId}"]`).click();
		await picker.waitFor({ state: 'hidden', timeout: 60_000 });
		await views.or(canvas).first().waitFor({ timeout: 60_000 });
	}
	await eventView(page);
	await page.waitForLoadState('networkidle').catch(() => undefined);
}

/**
 * The Kitchen opens on the Basket (c3) and doesn't remember the view across a reload; the event canvas these specs
 * check is the second tab, labelled with the remembered plan's title. Opens it when it is there.
 */
export async function eventView(page: Page) {
	const event = page.getByRole('navigation', { name: 'Kitchen view' }).getByRole('button').nth(1);
	if (!(await event.isVisible().catch(() => false))) return;
	if ((await event.getAttribute('aria-pressed')) !== 'true') await event.click();
	await page
		.locator('#task-h')
		.or(page.getByRole('button', { name: /^Plan the event/ }))
		.first()
		.waitFor({ timeout: 60_000 });
}

/** The seeded buffet planned in this visitor's sandbox, on the Kitchen canvas. */
export async function planBuffet(page: Page) {
	await enterKitchen(page);
	const start = page.getByRole('button', { name: 'Plan the event', exact: true });
	await page.locator('#task-h').or(start).first().waitFor({ timeout: 60_000 });
	if (await start.isVisible()) await start.click();
	await expect(page.locator('#task-h')).toContainText('Christmas', { timeout: 120_000 });
	await page.waitForLoadState('networkidle');
}

/** Approves every decision as the chef (Review → Confirm, or a held sign-off); returns the lines signed off. */
export async function approveAll(page: Page): Promise<number> {
	let lines = 0;
	for (let round = 0; round < 6; round++) {
		const review = page.getByRole('button', { name: /^Review \d+ lines?/ }).first();
		const confirm = page.getByRole('button', { name: /Confirm exact terms/ }).first();
		const hold = page.getByRole('button', { name: /Hold to sign off \d+ lines?/ }).first();
		if (await review.isVisible().catch(() => false)) {
			lines += Number(((await review.innerText()).match(/(\d+)/) ?? [])[1] ?? 0);
			await review.click();
			await confirm.click();
		} else if (await hold.isVisible().catch(() => false)) {
			lines += Number(((await hold.innerText()).match(/(\d+) lines?/) ?? [])[1] ?? 0);
			const b = (await hold.boundingBox())!;
			await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
			await page.mouse.down();
			await page.waitForTimeout(4000);
			await page.mouse.up();
		} else break;
		await page.waitForLoadState('networkidle');
		await page.waitForTimeout(1000);
	}
	return lines;
}

/** Opens the first line's Why drawer: the line rows sit inside each dish's details, collapsed by default. */
export async function openWhy(page: Page) {
	const why = page.getByRole('button', { name: 'Why this line' }).first();
	if (!(await why.isVisible().catch(() => false))) {
		const plan = page.getByRole('tab', { name: /^Plan/ }).first();
		if (await plan.isVisible().catch(() => false)) await plan.click();
		await page
			.getByRole('button', { name: /^Show details: / })
			.first()
			.click({ timeout: 30_000 });
	}
	await why.click({ timeout: 30_000 });
}

/** Sends a purchase request in words (today on /request; in D15 stage 2 the home composer) and waits for its answer. */
export async function request(page: Page, text: string, kitchen?: string) {
	await page.goto(`${BASE}/request`);
	if (kitchen) await page.locator('select').first().selectOption({ label: kitchen });
	await page.locator('#req').fill(text);
	await page.getByRole('button', { name: /Find and price/ }).click();
	await page
		.getByText(/Prepared by the kitchen agent|Nothing was ordered|Event brief|nothing quoted/)
		.first()
		.waitFor({ timeout: 60_000 })
		.catch(() => undefined);
	await page.waitForTimeout(1500);
}

/** One chat turn in the open chat (the /agents/chat page or the dock) and its end. */
export async function chat(page: Page, text: string) {
	await page.locator('#chat-text').fill(text);
	await page.getByRole('button', { name: 'Send' }).click();
	await page.waitForTimeout(1500);
	await page
		.getByText(/^Working( · step \d+)?…/)
		.first()
		.waitFor({ state: 'detached', timeout: 180_000 })
		.catch(() => undefined);
	await page.waitForTimeout(1500);
}

/**
 * Wait for the order's receipt and return its id. The Kitchen shows a card labelled "Receipt" that reads "Ordered",
 * with the id in a System-only span (hidden, still in its text); older builds showed "receipt rc-…" as visible text.
 */
export async function receipt(page: Page): Promise<string | null> {
	const card = page.getByLabel('Receipt', { exact: true });
	await card
		.or(page.getByText(/receipt rc-/))
		.first()
		.waitFor({ timeout: 30_000 })
		.catch(() => undefined);
	const text = (await card.count())
		? await card.first().textContent()
		: await page.locator('body').innerText();
	return text?.match(/receipt (rc-[a-z0-9]+)/)?.[1] ?? null;
}
