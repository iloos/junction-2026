import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The claims journeys: every demo beat and every "say it" row in docs/CLAIMS.md that needs a prod observation, run
 * on the deployed app in fresh visitor sandboxes. Each beat saves timestamped page text and a screenshot under
 * JOURNEY_OUT (default scratch/claims/<commit>/) and soft-asserts the property its CLAIMS row states, so one red beat
 * never hides the others' evidence. Opt-in and prod-only (JOURNEYS=1 KITCHEN_URL=<url>): it calls Gemini, Valio and
 * Exa and trips an outside agent's quote limit, so the post-deploy smoke (all of evals/ui) skips it.
 *   JOURNEYS=1 KITCHEN_URL=https://app.mandate.kitchen npx playwright test -c evals/ui/pw-prod.config.ts journeys
 */
const BASE = process.env.KITCHEN_URL ?? '';
const ON = process.env.JOURNEYS === '1' && Boolean(BASE);
let OUT = process.env.JOURNEY_OUT ?? '';

test.skip(!ON, 'claims journeys: JOURNEYS=1 and KITCHEN_URL');

/** The deployed commit and what main holds now: a claims pass cites code at the deployed commit, so they must match. */
let pin: { deployed: string; sourceMain: string | null } = { deployed: '', sourceMain: null };

test.beforeAll(async ({ request }) => {
	const h = (await (await request.get(`${BASE}/healthz`)).json()) as { commit: string };
	OUT ||= join('scratch', 'claims', h.commit.slice(0, 7));
	mkdirSync(OUT, { recursive: true });
	let sourceMain: string | null;
	try {
		sourceMain = execSync('git rev-parse main', { encoding: 'utf-8' }).trim();
	} catch {
		sourceMain = null;
	}
	pin = { deployed: h.commit, sourceMain };
	writeFileSync(join(OUT, 'healthz.json'), JSON.stringify({ ...h, pin }, null, '\t'));
});

test('the evidence is pinned: the deployed commit is the source on main', () => {
	expect(pin.sourceMain, 'main resolves').toBeTruthy();
	expect(
		pin.deployed,
		`deployed ${pin.deployed.slice(0, 7)} vs main ${pin.sourceMain?.slice(0, 7)}`
	).toBe(pin.sourceMain);
});

async function record(page: Page, name: string, extra = '') {
	await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
	const text = await page.locator('body').innerText();
	writeFileSync(
		join(OUT, `${name}.txt`),
		`${new Date().toISOString()} ${page.url()}\n${extra}${extra ? '\n' : ''}${text}`
	);
	return text;
}
const note = (name: string, body: unknown) =>
	writeFileSync(join(OUT, `${name}.json`), JSON.stringify(body, null, '\t'));

async function planBuffet(page: Page) {
	await page.goto(`${BASE}/`);
	const start = page.getByRole('button', { name: 'Plan the event' });
	await page.locator('#task-h, #event-h').or(start).first().waitFor({ timeout: 60_000 });
	if (await start.isVisible()) await start.click();
	await page.getByText('What happened').first().waitFor({ timeout: 90_000 });
	await page.waitForLoadState('networkidle');
}

async function approveAll(page: Page) {
	for (let round = 0; round < 6; round++) {
		const review = page.getByRole('button', { name: /^Review \d+ lines?/ }).first();
		const confirm = page.getByRole('button', { name: /Confirm exact terms/ }).first();
		const hold = page.getByRole('button', { name: /Hold to sign off \d+ lines?/ }).first();
		if (await review.isVisible().catch(() => false)) {
			await review.click();
			await confirm.click();
		} else if (await hold.isVisible().catch(() => false)) {
			const b = (await hold.boundingBox())!;
			await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
			await page.mouse.down();
			await page.waitForTimeout(4000);
			await page.mouse.up();
		} else break;
		await page.waitForLoadState('networkidle');
		await page.waitForTimeout(1000);
	}
}

async function request(page: Page, text: string, kitchen?: string) {
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

async function chat(page: Page, text: string) {
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

async function judgeKey(page: Page) {
	await page.goto(`${BASE}/?ws=mine`);
	const k = await page.request.get(`${BASE}/api/demo/judge-key`);
	expect(k.status(), 'judge key').toBe(200);
	return { authorization: `Bearer ${((await k.json()) as { key: string }).key}` };
}
const tool = async (
	r: APIRequestContext,
	auth: Record<string, string>,
	name: string,
	data: unknown
) => r.post(`${BASE}/api/tools/${name}`, { headers: auth, data });

test('the problem, the Why drawer and its web evidence', async ({ page }) => {
	test.setTimeout(240_000);
	await planBuffet(page);
	const t = await record(page, 'b1-planned');
	expect.soft(t).toMatch(/462490/);
	expect.soft(t).toMatch(/462482/);
	await page.getByRole('button', { name: 'Why this line' }).first().click();
	await page
		.getByText(/From the web/)
		.first()
		.waitFor({ timeout: 20_000 })
		.catch(() => undefined);
	await page.waitForTimeout(10_000);
	const w = await record(page, 'b2-why');
	expect.soft(w, 'web evidence cites the GTIN').toMatch(/GTIN cited/);
});

test('lines inside the mandate are ordered alone, before any decision', async ({ page }) => {
	test.setTimeout(240_000);
	await planBuffet(page);
	const before = await record(page, 'b3-before');
	const can = page.getByRole('button', { name: /Order the \d+ lines you can now/ }).first();
	const label = (await can.innerText().catch(() => '')).replace(/\s+/g, ' ');
	const n = Number(label.match(/Order the (\d+) lines/)?.[1] ?? 0);
	expect.soft(n, `the button: "${label}"`).toBeGreaterThan(0);
	await can.click();
	await page
		.getByText(/receipt rc-/)
		.first()
		.waitFor({ timeout: 30_000 })
		.catch(() => undefined);
	await page.waitForTimeout(2000);
	const after = await record(page, 'b3-after', `button: ${label}`);
	const snap = (await (await page.request.get(`${BASE}/kitchen-api/snapshot`)).json()) as {
		plan?: { lines: { productId: string; state: string; tier?: string }[] };
	};
	const committed = snap.plan?.lines.filter((l) => l.state === 'committed') ?? [];
	note('b3-committed', committed);
	expect.soft(committed.length, 'committed = the button count').toBe(n);
	expect.soft(after, 'decisions still wait for the chef').toMatch(/decision/i);
	expect.soft(before).toMatch(/can be ordered now/);
});

test('approve, order, one receipt; Ops shows the same case by cause', async ({ page, context }) => {
	test.setTimeout(300_000);
	await planBuffet(page);
	const ops = await context.newPage();
	await ops.goto(`${BASE}/ops`);
	await ops.waitForTimeout(5000);
	await record(ops, 'b4-ops-held');
	await page.bringToFront();
	await approveAll(page);
	await page
		.getByRole('button', { name: /Place order|Order the \d+ lines/ })
		.first()
		.click();
	await page
		.getByText(/receipt rc-/)
		.first()
		.waitFor({ timeout: 30_000 })
		.catch(() => undefined);
	await page.waitForTimeout(2000);
	const t = await record(page, 'b4-ordered');
	expect.soft(t).toMatch(/receipt rc-[a-z0-9]+/);
	await ops.reload();
	await ops.waitForTimeout(5000);
	await record(ops, 'b4-ops-after');
});

test('another kitchen takes the rescue stock: the agent keeps what is left and adds one for sign-off', async ({
	page
}) => {
	test.setTimeout(240_000);
	await planBuffet(page);
	const r = await page.request.post(`${BASE}/kitchen-api/scenario`, {
		data: { action: 'contention', value: true }
	});
	const body = (await r.json()) as Record<string, unknown>;
	note('b5-contention', { status: r.status(), contentionRescue: body.contentionRescue ?? null });
	await page.reload();
	await page.waitForLoadState('networkidle');
	await page.waitForTimeout(3000);
	const t = await record(page, 'b5-contention');
	expect.soft(r.status()).toBe(200);
	expect
		.soft(t, 'the agent says what it kept and what it added')
		.toMatch(/Another kitchen took \d+ × .+ I kept \d+ and added /s); // the added product varies with stock
});

test('/request: lactose-free milk, the passed cut-off, the off day', async ({ page }) => {
	test.setTimeout(240_000);
	await request(page, '10 l lactose-free milk for Friday');
	const milk = await record(page, 'b6-milk');
	expect.soft(milk).toMatch(/laktoositon/);
	// Valio states no quantity (>= 999999 = unknown, Valio 14 Nov): held for one tap, never counted as cover.
	expect.soft(milk).toMatch(/Valio doesn.t state a quantity/);
	await request(page, '4 kg lactose-free butter for tomorrow');
	const late = await record(page, 'b6-late');
	expect.soft(late).toMatch(/cut-off for Tue 8 Dec has passed/);
	expect.soft(late).toMatch(/Wed 9 Dec/);
	await request(page, '10 l milk for Thursday', 'Lounas Ruoholahti (fictional)');
	const off = await record(page, 'b6-offday');
	expect.soft(off).toMatch(/takes deliveries on Mon, Wed, Fri/);
});

test('an event brief becomes a menu checked against cited recipes, then a plan', async ({
	page
}) => {
	test.setTimeout(400_000);
	// The menu's own responses, for the grounding each dish ended with (evidence beside the page text).
	let lastMenu = '';
	page.on('response', async (r) => {
		if (r.url().includes('/request/menu')) lastMenu = (await r.text().catch(() => '')) || lastMenu;
	});
	await request(page, 'Christmas dinner for 50 guests on Saturday 19 December, buffet');
	for (let i = 0; i < 8; i++) {
		if (
			await page
				.locator('[aria-label="Menu proposal"]')
				.first()
				.isVisible()
				.catch(() => false)
		)
			break;
		const q = page.getByTestId('brief-question');
		if (await q.isVisible().catch(() => false)) {
			await q.getByRole('list', { name: 'Answers' }).getByRole('button').first().click();
			await page.waitForTimeout(500);
			const use = q.getByRole('button', { name: /Use th/ });
			if ((await use.isVisible().catch(() => false)) && (await use.isEnabled().catch(() => false)))
				await use.click();
		}
		await page.waitForTimeout(4000);
	}
	await page.locator('[aria-label="Menu proposal"]').first().waitFor({ timeout: 120_000 });
	await page
		.getByText(/Looking for sourced recipes/)
		.first()
		.waitFor({ state: 'detached', timeout: 120_000 })
		.catch(() => undefined);
	const menu = await record(page, 'b7-menu');
	writeFileSync(join(OUT, 'b7-menu-response.json'), lastMenu);
	const grounded = await page.getByTestId('dish-grounding').count();
	expect.soft(grounded, 'every dish shows its recipe check').toBeGreaterThan(0);
	expect.soft(menu).toMatch(/proposed by gemini/i);
	const accept = page.getByRole('button', { name: /Accept this menu/ });
	if (await accept.isEnabled().catch(() => false)) {
		await accept.click();
		await page.getByRole('button', { name: /Plan it/ }).click({ timeout: 30_000 });
		await page
			.getByTestId('menu-planned')
			.waitFor({ timeout: 120_000 })
			.catch(() => undefined);
	}
	const planned = await record(page, 'b7-planned');
	expect.soft(planned).toMatch(/Planned: \d+ needs, \d+ lines/);
});

test('chat: an order held, approval refused, then the chef decides in the dock', async ({
	page
}) => {
	test.setTimeout(400_000);
	await page.goto(`${BASE}/agents/chat`);
	await chat(page, 'need 4kg lactose free butter for wednesday');
	await record(page, 'b8-chat-order');
	await chat(page, 'approve it');
	const refused = await record(page, 'b8-chat-refused');
	expect.soft(refused).toMatch(/can.?t approve|only the chef/i);
	// D13: the chef decides on the dock's own card, off the Kitchen page.
	const review = page.getByRole('button', { name: /^Review \d+ lines?/ }).first();
	const hold = page.getByRole('button', { name: /Hold to sign off \d+ lines?/ }).first();
	if (await review.isVisible().catch(() => false)) {
		await review.click();
		await page
			.getByRole('button', { name: /Confirm exact terms/ })
			.first()
			.click();
	} else if (await hold.isVisible().catch(() => false)) {
		const b = (await hold.boundingBox())!;
		await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
		await page.mouse.down();
		await page.waitForTimeout(4000);
		await page.mouse.up();
	}
	await page.waitForTimeout(2000);
	const cont = page.getByRole('button', { name: /decided: continue|Continue/ }).first();
	if (await cont.isVisible().catch(() => false)) {
		await cont.click();
		await page.waitForTimeout(1500);
		await page
			.getByText(/^Working( · step \d+)?…/)
			.first()
			.waitFor({ state: 'detached', timeout: 180_000 })
			.catch(() => undefined);
	}
	const done = await record(page, 'b8-chat-decided');
	expect.soft(done, 'a receipt after the dock decision').toMatch(/receipt|ordered/i);
});

test('chat: an event brief to a menu, reviewed on /request, then planned', async ({ page }) => {
	test.setTimeout(500_000);
	let streamed = '';
	page.on('response', async (r) => {
		if (r.url().includes('/api/chat/turn')) streamed += (await r.text().catch(() => '')) + '\n';
	});
	await page.goto(`${BASE}/agents/chat`);
	await chat(page, 'Christmas dinner for 50 guests on Saturday 19 December, buffet');
	for (const answer of ['none', 'no budget', 'none', 'none']) {
		if (/"type":"menu"/.test(streamed)) break;
		await chat(page, answer);
	}
	const asked = await record(page, 'b9-chat-event');
	writeFileSync(join(OUT, 'b9-chat-stream.ndjson'), streamed);
	const shown = await page
		.locator('a[href*="/request?menu="]')
		.first()
		.getAttribute('href', { timeout: 2000 })
		.catch(() => null);
	const sent = streamed.match(/"reviewUrl":"([^"]+)"/)?.[1] ?? null;
	expect.soft(sent, 'the turn proposes a menu with a review link').toBeTruthy();
	expect.soft(shown, 'the chat shows the menu card with its review link').toBeTruthy();
	const href = shown ?? sent;
	if (!href) return;
	const review = await page.context().newPage();
	await review.goto(href.startsWith('http') ? href : `${BASE}${href}`);
	await review.locator('[aria-label="Menu proposal"]').first().waitFor({ timeout: 60_000 });
	const accept = review.getByRole('button', { name: /Accept this menu/ });
	if (await accept.isEnabled().catch(() => false)) await accept.click();
	await review.waitForTimeout(2000);
	await record(review, 'b9-review');
	await page.bringToFront();
	await chat(page, 'plan it');
	const planned = await record(page, 'b9-chat-planned', `asked: ${asked.length} chars`);
	expect.soft(planned).toMatch(/plan|needs/i);
});

test('an outside agent: held, refused, logged in Ops, metered, and 16 tools', async ({ page }) => {
	test.setTimeout(240_000);
	const auth = await judgeKey(page);
	const r = page.request;
	const placed = (await (
		await tool(r, auth, 'place_order', {
			kitchenId: 'k-hotel',
			deliverBy: '2026-12-11',
			idempotencyKey: 'journey-outside',
			lines: [{ productId: '464201', qty: 30, unit: 'ST' }]
		})
	).json()) as { plan?: { id: string; state: string } };
	const plan = (await (await tool(r, auth, 'get_plan', { planId: placed.plan?.id })).json()) as {
		approval?: { id: string; planVersion: number; termsHash: string };
	};
	const a = plan.approval;
	const ap = await tool(r, auth, 'approve', {
		approvalId: a?.id,
		planVersion: a?.planVersion,
		termsHash: a?.termsHash,
		decision: 'grant'
	});
	const key = auth.authorization.slice('Bearer '.length);
	const list = (await (
		await r.post(`${BASE}/mcp/k/${key}`, {
			headers: {
				accept: 'application/json, text/event-stream',
				'content-type': 'application/json'
			},
			data: { jsonrpc: '2.0', id: 1, method: 'tools/list' }
		})
	).text()) as string;
	const names = [...list.matchAll(/"name":"([a-z_]+)"/g)].map((m) => m[1]);
	const quotes: number[] = [];
	for (let i = 0; i < 22; i++)
		quotes.push((await tool(r, auth, 'quote', { productIds: ['464201'] })).status());
	note('b10-outside', {
		placed: placed.plan?.state,
		approve: ap.status(),
		tools: names,
		quoteStatuses: quotes
	});
	expect.soft(placed.plan?.state).toBe('held');
	expect.soft(ap.status()).toBe(403);
	expect.soft(names).not.toContain('approve');
	expect.soft(names).not.toContain('set_mandate');
	expect.soft(quotes, 'the per-key quote limit (20 a minute) refuses the 21st').toContain(429);
	await page.goto(`${BASE}/ops`);
	await page.waitForTimeout(5000);
	const ops = await record(page, 'b10-ops');
	expect.soft(ops).toMatch(/tried to approve/);
});

test('the kitchen calendar feed', async ({ page }) => {
	test.setTimeout(180_000);
	await planBuffet(page);
	await page.goto(`${BASE}/?ws=mine`);
	const link = await page.request.get(`${BASE}/api/demo/calendar-link?kitchen=k-hotel`);
	const { url } = (await link.json()) as { url: string };
	const ics = await (await page.request.get(url)).text();
	writeFileSync(join(OUT, 'b11-calendar.ics'), ics);
	expect.soft(link.status()).toBe(200);
	expect.soft(ics).toMatch(/BEGIN:VCALENDAR/);
	expect.soft((ics.match(/BEGIN:VEVENT/g) ?? []).length, 'events in the feed').toBeGreaterThan(0);
	const anon = await page.request.get(url.replace(/token=[^&]+/, 'token=forged'));
	expect.soft(anon.status(), 'a forged token reads nothing').toBeGreaterThanOrEqual(400);
});

test('the agent card and the MCP resources and prompts', async ({ page }) => {
	test.setTimeout(120_000);
	const card = await page.request.get(`${BASE}/.well-known/agent.json`);
	const auth = await judgeKey(page);
	const key = auth.authorization.slice('Bearer '.length);
	const headers = {
		accept: 'application/json, text/event-stream',
		'content-type': 'application/json'
	};
	const rpc = async (id: number, method: string, params: object = {}) =>
		(
			await page.request.post(`${BASE}/mcp/k/${key}`, {
				headers,
				data: { jsonrpc: '2.0', id, method, params }
			})
		).text();
	await rpc(1, 'initialize', {
		protocolVersion: '2025-06-18',
		capabilities: {},
		clientInfo: { name: 'f-evals-journeys', version: '1' }
	});
	const resources = [...(await rpc(2, 'resources/list')).matchAll(/"uri":"([^"]+)"/g)].map(
		(m) => m[1]
	);
	const prompts = await rpc(3, 'prompts/list');
	note('b12-mcp', { card: card.status(), resources, prompts: prompts.slice(0, 2000) });
	expect.soft(card.status(), 'agent card').toBe(200);
	expect.soft(resources).toContain('decisions://open');
	expect
		.soft(
			resources.some((u) => u.startsWith('mandate://')),
			'a mandate resource'
		)
		.toBe(true);
	expect.soft(prompts).toMatch(/plan_event_in_mandate/);
});
