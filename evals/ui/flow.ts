import { expect, type Locator, type Page } from '@playwright/test';

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
	// A store or kitchen with no plan yet opens on its own home (an h1 such as "Your kitchen is set up…").
	const home = page.locator('main h1');
	await picker.or(views).or(canvas).or(home).first().waitFor({ timeout: 60_000 });
	if (await picker.isVisible().catch(() => false)) {
		const sample = picker.locator(`[data-kitchen-id="${kitchenId}"]`);
		if (await sample.count()) await sample.click();
		else {
			// The shared room (D24) offers no sample kitchens: a visitor joins as their own store.
			await picker
				.getByLabel(/Store name|Kitchen name/)
				.fill(`Playtest Room ${Date.now().toString(36)}`);
			await picker.getByRole('button', { name: /Start my (store|kitchen)/ }).click();
		}
		await picker.waitFor({ state: 'hidden', timeout: 60_000 });
		await views
			.or(canvas)
			.or(page.getByRole('button', { name: /Ask the agent/ }))
			.first()
			.waitFor({ timeout: 60_000 });
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

/**
 * Approves every decision as the chef; returns the lines signed off. D29 (S2): the plan's sticky bar "Accept all N"
 * and the table's group headers "Accept these N"; before D29: Review → Confirm exact terms, or a held sign-off.
 * Both shapes are handled so the checks hold across the change.
 */
export async function approveAll(page: Page): Promise<number> {
	let lines = 0;
	const confirm = page.getByRole('button', { name: /Confirm exact terms/ }).first();
	const confirmIfAsked = async () => {
		if (await confirm.isVisible({ timeout: 1500 }).catch(() => false)) await confirm.click();
	};
	for (let round = 0; round < 6; round++) {
		const all = page.getByRole('button', { name: /^Accept all \d+/ }).first();
		const group = page.getByRole('button', { name: /^Accept these \d+/ }).first();
		const review = page.getByRole('button', { name: /^Review \d+ lines?/ }).first();
		const hold = page.getByRole('button', { name: /Hold to sign off \d+ lines?/ }).first();
		const signOff = page.getByRole('button', { name: /^Review and sign off \d+ lines?/ }).first();
		const usable = async (l: typeof all) =>
			(await l.isVisible().catch(() => false)) && (await l.isEnabled().catch(() => false));
		if (await usable(all)) {
			lines += Number(((await all.innerText()).match(/Accept all (\d+)/) ?? [])[1] ?? 0);
			await all.click();
			await confirmIfAsked();
		} else if (await usable(group)) {
			lines += Number(((await group.innerText()).match(/Accept these (\d+)/) ?? [])[1] ?? 0);
			await group.click();
			await confirmIfAsked();
		} else if (await usable(signOff)) {
			// S2, Sun 05:00: one group action opens a dialog whose "Confirm exact terms" signs the group off.
			lines += Number(((await signOff.innerText()).match(/sign off (\d+)/) ?? [])[1] ?? 0);
			await signOff.click();
			await page
				.getByRole('dialog')
				.getByRole('button', { name: /Confirm exact terms/ })
				.click({ timeout: 10_000 });
		} else if (await review.isVisible().catch(() => false)) {
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

/**
 * Orders what the plan allows now and waits for "Ordered · N lines". D29: the sticky bar's "Order K lines now";
 * before: "Order N lines now" in the header, "Order the N lines you can now", or "Place order: N lines". Never the
 * phone's "Order" zone tab (a bare "Order").
 */
export async function orderNow(page: Page) {
	await page
		.getByRole('button', { name: /^(Order \d+ lines? now|Order the|Place order)/ })
		.first()
		.click({ timeout: 30_000 });
	await page
		.getByText(/Ordered\s*·\s*\d+\s+lines?|Ordered: receipt|^Ordered \d+$/)
		.first()
		.waitFor({ state: 'attached', timeout: 60_000 }); // on a phone it can sit in an unselected zone tab
}

/**
 * Approves the decisions shown in the dock's "Decide here": S2's line rows with "Accept all N · €X" (one tap, no
 * confirmation), or the older card's Review N lines → Confirm exact terms.
 */
export async function approveInDock(here: Locator) {
	const all = here.getByRole('button', { name: /^Accept all \d+/ }).first();
	if (await all.isVisible({ timeout: 5_000 }).catch(() => false)) return all.click();
	await here
		.getByRole('button', { name: /^Review \d+ lines?/ })
		.first()
		.click();
	await here.getByRole('button', { name: 'Confirm exact terms' }).click();
}

/** The dock's order button after approving: "Order the approved lines", or "Order N lines now". */
export const DOCK_ORDER = /^Order (the approved lines|what may be ordered now|\d+ lines?)/;

/** The page's decisions: D29's decision-group headers, or the pre-D29 cards in the #approval panel. */
export function decisionCards(page: Page) {
	return page
		.getByTestId('decision-group')
		.or(page.locator('#approval article[aria-label^="Decision:"]'));
}

/** Approves the first non-sign-off decision on the page: "Accept these N" (D29) or Review → Confirm exact terms. */
export async function approveFirstOnPage(page: Page) {
	const accept = page.getByRole('button', { name: /^Accept these \d+/ }).first();
	if (await accept.isVisible().catch(() => false)) return accept.click();
	const panel = page.locator('#approval').first();
	await panel
		.getByRole('button', { name: /^Review \d+ lines?/ })
		.first()
		.click();
	await panel.getByRole('button', { name: 'Confirm exact terms' }).click();
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
	// /request is either the step page (#req + "Find and price") or, from wave K (D23 UI), the full-width conversation.
	const form = page.locator('#req');
	const composer = page.locator('#chat-text');
	await form.or(composer).first().waitFor({ timeout: 30_000 });
	if (await form.isVisible().catch(() => false)) {
		await form.fill(text);
		await page.getByRole('button', { name: /Find and price/ }).click();
		await page
			.getByText(/Prepared by the kitchen agent|Nothing was ordered|Event brief|nothing quoted/)
			.first()
			.waitFor({ timeout: 60_000 })
			.catch(() => undefined);
	} else {
		await composer.fill(text);
		await page.getByRole('button', { name: 'Send' }).first().click();
		await page.waitForTimeout(1500);
		await page
			.getByText(/^Working\b.*…$/)
			.first()
			.waitFor({ state: 'detached', timeout: 180_000 })
			.catch(() => undefined);
	}
	await page.waitForTimeout(1500);
}

/** One chat turn in the open chat (the /agents/chat page or the dock) and its end. */
export async function chat(page: Page, text: string) {
	await page.locator('#chat-text').fill(text);
	await page.getByRole('button', { name: 'Send' }).click();
	await page.waitForTimeout(1500);
	await page
		.getByText(/^Working\b.*…$/)
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
