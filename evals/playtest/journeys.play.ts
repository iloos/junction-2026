import { expect, type Page } from '@playwright/test';
import { BASE, journey, isMobile, type Recorder } from './harness';
import { approveAll as approveAllShared, orderNow } from '../ui/flow';

/**
 * The four north-star moments (docs/handoff/ring6/RESTART.md) and the nine Round 12 journeys
 * (docs/review/ROUND12-ADVERSARIAL.md, "Nine-journey matrix"), as a first-time visitor in a fresh sandbox per test.
 * Steps name what the visitor tries; selectors are the visible words, so a step that can't find its words is where a
 * visitor would be stuck too. Judges read the beats; nothing here decides pass or fail.
 */

const SITE = process.env.SITE_URL ?? 'https://mandate.kitchen';

// ---------- shared moves ----------

/**
 * Opens the Kitchen as a first-time visitor. A fresh sandbox shows the establishment picker first: with a recorder, the
 * picker is recorded as its own beat (it is the visitor's first screen), then the hotel is picked.
 */
async function home(page: Page, r?: Recorder) {
	await page.goto(`${BASE}/`);
	await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
	const picker = page.getByTestId('establishment-picker');
	if (await picker.isVisible().catch(() => false)) {
		if (r) await r.beat('picker-first-screen');
		await picker.locator('[data-kitchen-id="k-hotel"]').click();
		await picker.waitFor({ state: 'hidden', timeout: 60_000 });
		await page.waitForLoadState('networkidle').catch(() => {});
	}
}

/** The hotel's seeded event, planned the way a visitor would: pick the kitchen if asked, then plan. */
async function planEvent(page: Page) {
	await home(page);
	const start = page.getByRole('button', { name: /^Plan the event/ });
	await page.locator('#task-h').or(start).first().waitFor({ timeout: 60_000 });
	if (await start.isVisible()) await start.click();
	await expect(page.locator('#task-h')).toContainText(/\w/, { timeout: 120_000 });
	await page.waitForLoadState('networkidle').catch(() => {});
}

async function openDock(page: Page) {
	const dock = page.locator('aside[aria-label="Agent chat"]');
	if (await dock.isVisible().catch(() => false)) return dock;
	await expect(async () => {
		await page
			.getByRole('button', { name: /Ask the agent/ })
			.first()
			.click();
		await expect(dock).toBeVisible({ timeout: 1500 });
	}).toPass({ timeout: 30_000 });
	return dock;
}

/** One dock turn; the reply is the dock text added by the turn. */
async function say(r: Recorder, page: Page, text: string) {
	const dock = await openDock(page);
	const before = await dock.innerText();
	await dock.locator('#chat-text, textarea').first().fill(text);
	await dock.getByRole('button', { name: 'Send' }).click();
	await page.waitForTimeout(1500);
	await page
		.getByText(/^Working\b.*…$/)
		.first()
		.waitFor({ state: 'detached', timeout: 180_000 })
		.catch(() => undefined);
	await page.waitForTimeout(1500);
	const after = await dock.innerText();
	const at = after.lastIndexOf(text);
	const reply = at >= 0 ? after.slice(at + text.length) : after.slice(before.length);
	r.j.chat.push({ said: text, reply: reply.trim().slice(0, 4000) });
}

async function requestPage(page: Page, text: string) {
	await page.goto(`${BASE}/request`);
	const form = page.locator('#req');
	const composer = page.locator('#chat-text');
	await form.or(composer).first().waitFor({ timeout: 30_000 });
	if (!(await form.isVisible().catch(() => false))) {
		// From wave K (D23 UI) /request is the conversation, full width: the same composer as the dock.
		const before = await page
			.locator('main')
			.innerText()
			.catch(() => '');
		await composer.fill(text);
		await page.getByRole('button', { name: 'Send' }).first().click();
		await page.waitForTimeout(1500);
		await page
			.getByText(/^Workingb.*…$/)
			.first()
			.waitFor({ state: 'detached', timeout: 180_000 })
			.catch(() => undefined);
		const after = await page
			.locator('main')
			.innerText()
			.catch(() => '');
		if (after.length <= before.length + text.length)
			throw new Error('the conversation gave no answer');
		await page.waitForTimeout(1500);
		return;
	}
	await form.fill(text);
	await page.getByRole('button', { name: /Find and price/ }).click();
	await page
		.getByText(
			/Prepared by the kitchen agent|Nothing was ordered|Event brief|nothing quoted|Menu|needs you|How much/
		)
		.first()
		.waitFor({ timeout: 90_000 });
	await page.waitForTimeout(1500);
}

async function approveAll(page: Page) {
	const lines = await approveAllShared(page);
	if (!lines)
		throw new Error('no Accept all / Accept these / Review / Hold to sign off control found');
	return lines;
}

async function judgeAuth(page: Page) {
	await page.goto(`${BASE}/?ws=mine`);
	const k = await page.request.get(`${BASE}/api/demo/judge-key`);
	if (k.status() !== 200) throw new Error(`judge key ${k.status()}`);
	const key = ((await k.json()) as { key: string }).key;
	return { key, headers: { authorization: `Bearer ${key}` } };
}

// ---------- the four moments ----------

journey('m1', 'A shortage hits and every kitchen re-plans', async (r, page) => {
	await r.step('first look at the home', () => home(page, r));
	if (!(await r.step('plan the hotel event', () => planEvent(page)))) return;
	await r.step('a shortage hits (scenario shortage, else contention)', async () => {
		let res = await page.request.post(`${BASE}/kitchen-api/scenario`, {
			data: { action: 'shortage', value: {} }
		});
		r.note('shortageAction', res.status());
		if (!res.ok()) {
			res = await page.request.post(`${BASE}/kitchen-api/scenario`, {
				data: { action: 'contention', value: true }
			});
			r.note('contentionAction', res.status());
		}
		if (!res.ok()) throw new Error(`scenario ${res.status()} ${(await res.text()).slice(0, 200)}`);
		const body = (await res.json().catch(() => ({}))) as { shortage?: unknown };
		if (body.shortage) r.note('shortage', body.shortage);
		await page.waitForTimeout(4000);
	});
	await r.step('the kitchen shows what changed', async () => {
		await page.reload();
		await page.waitForLoadState('networkidle').catch(() => {});
		await page
			.getByText(/re-?plan|swap|short|taken|held|another kitchen/i)
			.first()
			.waitFor({
				timeout: 20_000
			});
	});
	await r.step('Ops shows the cascade', async () => {
		await page.goto(`${BASE}/ops`);
		await page.waitForTimeout(5000);
	});
});

type HeroLine = {
	id: string;
	productId?: string;
	productName?: string;
	state: string;
	reasons?: string[];
	lineCents?: number;
	offer?: { price?: { unitCents?: number } };
};
const HERO = 'a no-meat dinner for 120 with a peach dessert';
/** The answer a visitor taps for each brief question the dock asks: the later day, a buffet. Recorded in the notes. */
const ANSWER = /^(Sat\b|Saturday|Buffet$)/;

/**
 * The hero journey (SESSIONS "The hero journey", user 23:40), refereed: words → menu → "plan it" → every ingredient a
 * real product with a price or an honest label → every held line in exactly one decision → approve in the dock →
 * ordered with a receipt → the order on Ops. Each acceptance clause is its own step, so RUN.md names the first broken
 * clause. Runs after every deploy.
 */
journey(
	'm2',
	'HERO: words become a costed plan, approved in the dock, ordered, on Ops',
	async (r, page) => {
		let planId: string | null = null;
		let lines: HeroLine[] = [];
		// The dock names its plan in the chat events (a decision's planId), not always as a link: collect them.
		const seen: string[] = [];
		page.on('response', async (res) => {
			if (!/\/api\/chat\//.test(res.url())) return;
			const t = await res.text().catch(() => '');
			for (const m of t.matchAll(/"planId":"(pl-[^"]+)"/g))
				if (!seen.includes(m[1])) seen.push(m[1]);
		});
		await r.step('home', () => home(page));
		await r.step('ask the agent for the dinner', () => say(r, page, HERO));
		await r.step('answer what it asks, then "plan it"', async () => {
			const dock = await openDock(page);
			let asked = 0;
			for (let i = 0; i < 4; i++) {
				const chip = dock.getByRole('button', { name: ANSWER }).last();
				// Answered chips stay on screen, disabled: only an open question has an enabled one.
				if (
					!(await chip.isVisible().catch(() => false)) ||
					!(await chip.isEnabled().catch(() => false))
				)
					break;
				r.note(`answered${++asked}`, await chip.innerText());
				await chip.click({ timeout: 5_000 });
				await page.waitForTimeout(1500);
				await page
					.getByText(/^Working\b.*…$/)
					.first()
					.waitFor({ state: 'detached', timeout: 180_000 })
					.catch(() => undefined);
			}
			await say(r, page, 'plan it');
			// The first "plan it" can return the menu card to review ("Review it, then say plan it"); the second plans it.
			for (let i = 0; i < 2; i++) {
				if (await dock.locator('a[href*="plan="]').count()) break;
				if (
					!(await dock
						.getByText(/say "plan it"|Review the menu/)
						.last()
						.isVisible()
						.catch(() => false))
				)
					break;
				r.note(`menuReviewed${i + 1}`, true);
				await say(r, page, 'plan it');
			}
		});
		await r.step('a plan exists (named by the dock)', async () => {
			const dock = await openDock(page);
			await dock
				.getByText(/decisions? (for a chef|wait)|nothing ordered|Ordered/)
				.first()
				.waitFor({ timeout: 120_000 });
			const href = await dock
				.locator('a[href*="plan="]')
				.last()
				.getAttribute('href', { timeout: 2_000 })
				.catch(() => null);
			planId = seen.at(-1) ?? (href ? new URL(href, BASE).searchParams.get('plan') : null);
			r.note('planIdsSeen', seen);
			if (!planId) throw new Error('no plan named after "plan it"');
			const snap = (await (
				await page.request.get(`${BASE}/kitchen-api/snapshot?plan=${planId}&peek=1`)
			).json()) as { plan?: { lines?: HeroLine[]; totalCents?: number } };
			lines = snap.plan?.lines ?? [];
			r.note('plan', {
				planId,
				totalCents: snap.plan?.totalCents,
				lines: lines.map((l) => ({
					product: l.productName,
					state: l.state,
					reasons: l.reasons,
					unitCents: l.offer?.price?.unitCents ?? null
				}))
			});
			if (!lines.length) throw new Error('the plan has no lines');
		});
		if (!planId) return;
		await r.step(
			'every ingredient: a real product with a price, or an honest label',
			async () => {
				const bad = lines.filter(
					(l) =>
						!['rejected', 'superseded'].includes(l.state) &&
						!(l.productId && (l.offer?.price?.unitCents ?? 0) > 0) &&
						!(l.reasons ?? []).length
				);
				if (bad.length)
					throw new Error(
						`${bad.length} lines with neither a price nor a reason: ${bad.map((l) => l.id.split('-need:')[1] ?? l.id).join(', ')}`
					);
			},
			{ beat: false }
		);
		await r.step('every held line sits in exactly one decision (Kitchen)', async () => {
			await page.goto(`${BASE}/?plan=${planId}`);
			await page.waitForLoadState('networkidle').catch(() => {});
			const held = lines.filter((l) => l.state === 'held').length;
			let inDecisions = 0;
			for (const b of await page
				.getByRole('button', { name: /^(Review|Hold to sign off) \d+ lines?/ })
				.all())
				if (await b.isVisible().catch(() => false))
					inDecisions += Number(((await b.innerText()).match(/(\d+) lines?/) ?? [])[1] ?? 0);
			r.note('decisionCover', { held, inDecisions });
			if (held !== inDecisions)
				throw new Error(`${held} held lines, ${inDecisions} lines across the decisions`);
		});
		await r.step('approve (dock, or the page when the dock defers to it)', async () => {
			const dock = await openDock(page);
			// The dock's decisions sit under "Decide", one Review button each; on the plan's own Kitchen page the dock
			// says "decisions wait above" and the page holds them. Either is the chef's act (D13); note which.
			const inDock = dock.getByRole('button', { name: /^Review\b|Hold to sign off/ }).first();
			await inDock.waitFor({ timeout: 10_000 }).catch(() => undefined);
			if (!(await inDock.isVisible().catch(() => false))) {
				// The dock's "Decide · N decisions before …" bar may be a collapsed toggle: open it as a visitor would.
				const show = dock.getByRole('button', { name: /^Show\b/ }).first();
				const bar = dock.getByText(/^Decide\b/).first();
				const toggle = (await show.isVisible().catch(() => false)) ? show : bar;
				if (await toggle.isVisible().catch(() => false)) {
					await toggle.click({ timeout: 5_000 }).catch(() => undefined);
					r.note('openedDecideBar', true);
					await inDock.waitFor({ timeout: 5_000 }).catch(() => undefined);
				}
			}
			const viaDock = await inDock.isVisible().catch(() => false);
			// S2 508db7d: beside the open dock the page keeps "Accept all N · €X" for the plan's decisions.
			const acceptAll = page.getByRole('button', { name: /^Accept all/ }).first();
			if (!viaDock && (await acceptAll.isVisible().catch(() => false))) {
				r.note('approvedOn', 'page: Accept all, dock open');
				await acceptAll.click();
				await page.waitForTimeout(2000);
				r.note('approvedDecisions', 'all');
				return;
			}
			if (!viaDock) {
				// Hero finding when this fires: the dock is open on the plan, says the decisions "wait above", and neither
				// the dock nor the page offers a Review. Close the dock (the page's Decide rail returns) to go on.
				r.note('noApproveWithDockOpen', true);
				await dock
					.getByRole('button', { name: /Close chat|Minimi[sz]e|Hide/i })
					.first()
					.click({ timeout: 5_000 })
					.catch(() => page.keyboard.press('Escape'));
				await page.waitForTimeout(1000);
			}
			r.note('approvedOn', viaDock ? 'dock' : 'page');
			const here = viaDock ? dock : page.locator('body');
			await here
				.getByRole('button', { name: /^Review\b|Hold to sign off/ })
				.first()
				.waitFor({ timeout: 30_000 });
			let approved = 0;
			for (let i = 0; i < 6; i++) {
				const review = here.getByRole('button', { name: /^Review\b/ }).first();
				const hold = here.getByRole('button', { name: /Hold to sign off/ }).first();
				if (await review.isVisible().catch(() => false)) {
					await review.click();
					await here
						.getByRole('button', { name: /Confirm exact terms/ })
						.first()
						.click();
					approved++;
				} else if (await hold.isVisible().catch(() => false)) {
					const b = (await hold.boundingBox())!;
					await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
					await page.mouse.down();
					await page.waitForTimeout(4000);
					await page.mouse.up();
					approved++;
				} else break;
				await page.waitForTimeout(1500);
			}
			r.note('approvedDecisions', approved);
			if (!approved) throw new Error('no decision approved in the dock');
		});
		await r.step('ordered, with a receipt', async () => {
			const dock = await openDock(page);
			const inDock = dock.getByRole('button', { name: /^Order/ }).first();
			const order = (await inDock.isVisible().catch(() => false))
				? inDock
				: page
						.getByRole('button', { name: /^(Order \d+ lines? now|Order the|Place order)/ })
						.first();
			await order.click({ timeout: 30_000 });
			await page
				.getByText(/Ordered\s*·\s*\d+\s+lines?/)
				.first()
				.waitFor({ state: 'attached', timeout: 60_000 }); // on a phone it can sit in an unselected zone tab
			const t = await page.locator('body').innerText();
			const rc = t.match(/rc-[a-z0-9]+/);
			if (rc) r.j.receipts.push(rc[0]);
		});
		await r.step('the order shows on Ops', async () => {
			await page.goto(`${BASE}/ops`);
			await page.waitForTimeout(4000);
			const orders = page
				.getByRole('tab', { name: /Orders/ })
				.or(page.getByRole('link', { name: /^Orders/ }));
			if (
				await orders
					.first()
					.isVisible()
					.catch(() => false)
			)
				await orders.first().click();
			await page.waitForTimeout(2500);
			const text = await page.locator('body').innerText();
			const named = lines
				.filter((l) => l.state !== 'unorderable' && l.productName)
				.some((l) => text.includes(l.productName!.slice(0, 20)));
			r.note('opsNamesAProduct', named);
			if (!named) throw new Error("Ops names none of the plan's products");
		});
		await r.step('the same words on /request', () => requestPage(page, HERO));
	},
	420_000
);

journey('m3', 'An outside agent overreaches and is stopped', async (r, page) => {
	let auth: Awaited<ReturnType<typeof judgeAuth>> | undefined;
	await r.step('the agent page a judge opens', async () => {
		await page.goto(`${BASE}/agents`);
		await page.waitForLoadState('networkidle').catch(() => {});
	});
	if (
		!(await r.step('get a judge key', async () => void (auth = await judgeAuth(page)), {
			beat: false
		}))
	)
		return;
	const a = auth!;
	let planId: string | undefined;
	await r.step(
		'the outside agent orders past the mandate',
		async () => {
			const res = await page.request.post(`${BASE}/api/tools/place_order`, {
				headers: a.headers,
				data: {
					kitchenId: 'k-hotel',
					deliverBy: '2026-12-11',
					idempotencyKey: `playtest-${Date.now()}`,
					lines: [{ productId: '464201', qty: 600, unit: 'ST' }] // ≈ €936: over the €800 line cap
				}
			});
			const body = (await res.json()) as { plan?: { id: string; state: string }; meta?: unknown };
			planId = body.plan?.id;
			r.note('placeOrder', { status: res.status(), state: body.plan?.state, meta: body.meta });
		},
		{ beat: false }
	);
	await r.step(
		'the outside agent tries to approve its own order',
		async () => {
			const plan = (await (
				await page.request.post(`${BASE}/api/tools/get_plan`, {
					headers: a.headers,
					data: { planId }
				})
			).json()) as { approval?: { id: string; planVersion: number; termsHash: string } };
			const ap = plan.approval;
			const res = await page.request.post(`${BASE}/api/tools/approve`, {
				headers: a.headers,
				data: {
					approvalId: ap?.id,
					planVersion: ap?.planVersion,
					termsHash: ap?.termsHash,
					decision: 'grant'
				}
			});
			r.note('approve', { status: res.status(), body: (await res.text()).slice(0, 600) });
		},
		{ beat: false }
	);
	await r.step(
		'the tools an outside agent is offered',
		async () => {
			const list = await (
				await page.request.post(`${BASE}/mcp/k/${a.key}`, {
					headers: {
						accept: 'application/json, text/event-stream',
						'content-type': 'application/json'
					},
					data: { jsonrpc: '2.0', id: 1, method: 'tools/list' }
				})
			).text();
			r.note(
				'tools',
				[...list.matchAll(/"name":"([a-z_]+)"/g)].map((m) => m[1])
			);
		},
		{ beat: false }
	);
	await r.step('the chef sees the held order on the kitchen', async () => {
		await page.goto(`${BASE}/?ws=mine`);
		await page.waitForLoadState('networkidle').catch(() => {});
	});
	await r.step('Ops shows the refusal', async () => {
		await page.goto(`${BASE}/ops`);
		await page.waitForTimeout(5000);
	});
});

journey('m4', "Valio's view: demand, forecast, short stock", async (r, page) => {
	await r.step('Ops opens', async () => {
		await page.goto(`${BASE}/ops`);
		await page.waitForTimeout(4000);
	});
	for (const tab of ['Room', 'Demand', 'Orders', 'Forecast', 'Flow']) {
		const t = page
			.getByRole('tab', { name: new RegExp(tab, 'i') })
			.or(page.getByRole('link', { name: new RegExp(`^${tab}`, 'i') }));
		if (
			await t
				.first()
				.isVisible()
				.catch(() => false)
		)
			await r.step(`Ops ${tab}`, async () => {
				await t.first().click();
				await page.waitForTimeout(2500);
			});
		else
			r.j.steps.push({
				step: `Ops ${tab}`,
				ok: false,
				ms: 0,
				error: 'no tab or link with that name'
			});
	}
});

// ---------- the nine Round 12 journeys ----------

journey('j1', 'Kitchen as basket: pick, plan, approve, order, reload', async (r, page) => {
	await r.step('first look (5-second test: read the fold)', () => home(page, r));
	if (!(await r.step('plan the event', () => planEvent(page)))) return;
	await r.step('approve the decisions', async () =>
		r.note('approvedLines', await approveAll(page))
	);
	await r.step('order', async () => {
		const order = page.getByRole('button', { name: /^Order/ }).first();
		if (await order.isVisible().catch(() => false)) await order.click();
		await page
			.getByLabel('Receipt', { exact: true })
			.or(page.getByText(/receipt|Ordered/i))
			.first()
			.waitFor({
				timeout: 30_000
			});
		const t = await page.locator('body').innerText();
		const rc = t.match(/rc-[a-z0-9]+/);
		if (rc) r.j.receipts.push(rc[0]);
	});
	await r.step('reload keeps the order', async () => {
		await page.reload();
		await page.waitForLoadState('networkidle').catch(() => {});
	});
});

journey('j2', 'Request in words: shares, units, brands', async (r, page) => {
	for (const ask of [
		'hi i want 500 pizzas no meat 50%',
		'300 burgers, a third vegan',
		'2 buckets of cream',
		'250 ml cream',
		'Arla milk 20 l'
	])
		await r.step(`/request: ${ask}`, () => requestPage(page, ask));
});

journey('j3', 'Chat: vague turns, an order, the dock approval', async (r, page) => {
	await r.step('home', () => home(page));
	for (const t of ['what', '50 eggs for friday', 'ok', 'approve it'])
		await r.step(`say "${t}"`, () => say(r, page, t));
});

journey('j4', 'Diet and hard requirements', async (r, page) => {
	for (const ask of ['10 l vegan milk', 'gluten-free soy sauce 2 l', 'lactose-free cream 5 l'])
		await r.step(`/request: ${ask}`, () => requestPage(page, ask));
	await r.step('the dock: half the 80 lunches gluten-free', () =>
		say(r, page, 'half the 80 lunches gluten-free')
	);
});

journey('j5', 'Usual order and history', async (r, page) => {
	await r.step('home', () => home(page));
	await r.step('find the usual order', async () => {
		if (
			await page
				.getByText(/usual (Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w* order|usual is ready|^Usual order$/i)
				.first()
				.isVisible()
				.catch(() => false)
		)
			return;
		await page
			.getByRole('link', { name: /usual/i })
			.or(page.getByRole('button', { name: /usual/i }))
			.or(page.getByRole('tab', { name: /usual/i }))
			.first()
			.click({ timeout: 10_000 });
		await page.waitForTimeout(2000);
	});
});

journey('j6', 'Product card from a result', async (r, page) => {
	await r.step('/request: Valio milk 10 l', () => requestPage(page, 'Valio milk 10 l'));
	await r.step('open the product', async () => {
		await page
			.locator('[data-product-id], button:has-text("Valio")')
			.first()
			.click({ timeout: 10_000 });
		await page.waitForTimeout(2000);
	});
});

journey('j7', 'Operations after an order', async (r, page) => {
	if (!(await r.step('plan the event', async () => (await home(page), await planEvent(page)))))
		return;
	await r.step('approve', async () => void (await approveAll(page)));
	await r.step('Ops reflects it', async () => {
		await page.goto(`${BASE}/ops`);
		await page.waitForTimeout(5000);
	});
	await r.step('open a trace', async () => {
		await page
			.getByRole('button', { name: /trace|why|details/i })
			.first()
			.click({ timeout: 10_000 });
		await page.waitForTimeout(2000);
	});
});

journey('j8', 'Outside agent: pairing and the agent page', async (r, page) => {
	await r.step('/agents', async () => {
		await page.goto(`${BASE}/agents`);
		await page.waitForLoadState('networkidle').catch(() => {});
	});
	await r.step('/agents/chat', async () => {
		await page.goto(`${BASE}/agents/chat`);
		await page.waitForLoadState('networkidle').catch(() => {});
	});
});

journey('j9', 'Public site: landing, how, proof, story', async (r, page) => {
	for (const p of ['/', '/how/', '/proof/', '/story/'])
		await r.step(`site ${p}`, async () => {
			const res = await page.goto(`${SITE}${p}`);
			if (!res || res.status() >= 400) throw new Error(`HTTP ${res?.status()}`);
			await page.waitForLoadState('networkidle').catch(() => {});
		});
	if (!isMobile(page))
		await r.step('follow the first CTA into the app', async () => {
			await page.goto(SITE);
			await page
				.getByRole('link', { name: /try|open|app|start/i })
				.first()
				.click({ timeout: 10_000 });
			await page.waitForLoadState('networkidle').catch(() => {});
		});
});

// ---------- D23 / D24 (lead, 14 Nov 23:00) ----------

type SnapLine = { productId: string; qty?: { value: number; unit: string }; state: string };
/** The plan a door just made: the last plan link on its page (dock card or /request result), else the session's plan. */
async function basket(page: Page) {
	const href = await page
		.locator('a[href*="plan="]')
		.last()
		.getAttribute('href', { timeout: 5_000 })
		.catch(() => null);
	const planId = href ? new URL(href, BASE).searchParams.get('plan') : null;
	const url = planId
		? `${BASE}/kitchen-api/snapshot?plan=${encodeURIComponent(planId)}&peek=1`
		: `${BASE}/kitchen-api/snapshot`;
	const snap = (await (await page.request.get(url)).json()) as {
		plan?: { id?: string; lines?: SnapLine[] };
	};
	return {
		plan: snap.plan?.id ?? null,
		lines: (snap.plan?.lines ?? [])
			.filter((l) => !['rejected', 'superseded'].includes(l.state))
			.map((l) => `${l.productId} × ${l.qty?.value ?? '?'} ${l.qty?.unit ?? ''}`.trim())
			.sort()
	};
}

const SAME_ASK = '20 l lactose-free milk and 5 kg butter for friday';

journey(
	'd23',
	'One ask, two doors: the dock and /request end in the same basket',
	async (r, page) => {
		await r.step('dock: the ask', async () => (await home(page), await say(r, page, SAME_ASK)));
		await r.step('dock: the basket on the Kitchen', async () => {
			r.note('dockBasket', await basket(page));
			await home(page);
		});
		const other = await page.context().browser()!.newContext({ viewport: page.viewportSize()! });
		const p2 = await other.newPage();
		try {
			await r.step(
				'/request: the same ask (fresh visitor)',
				async () => {
					await home(p2);
					await requestPage(p2, SAME_ASK);
					await p2.screenshot({ path: `${r.dir}/request-door-result.png`, fullPage: true });
				},
				{ beat: false }
			);
			await r.step('/request: the basket on the Kitchen', async () => {
				r.note('requestBasket', await basket(p2));
				await home(p2);
				await p2.screenshot({ path: `${r.dir}/request-door-kitchen.png`, fullPage: true });
			});
			await r.step(
				'both doors give the same basket (D23 reopen test)',
				async () => {
					const a = JSON.stringify((r.j.notes.dockBasket as { lines: string[] }).lines);
					const b = JSON.stringify((r.j.notes.requestBasket as { lines: string[] }).lines);
					if (a !== b) throw new Error(`dock ${a} vs /request ${b}`);
					if (a === '[]') throw new Error('both baskets empty');
				},
				{ beat: false }
			);
		} finally {
			await other.close();
		}
	}
);

/** D24: three visitors join the shared room as three stores, each orders, Ops shows all three. Writes to ws-judges. */
journey(
	'r1',
	'Room: three stores order, Ops shows them live',
	async (r, page) => {
		const browser = page.context().browser()!;
		const ops = page;
		await r.step('Ops on the big screen joins the room', async () => {
			await ops.goto(`${BASE}/ops?ws=ws-judges`);
			const room = ops.getByRole('tab', { name: /^Room/ });
			if (await room.isVisible().catch(() => false)) await room.click();
			// Orders already there when the page loads don't light up for the first 3 s (S4 50ad21f).
			await ops.waitForTimeout(4000);
		});
		const stores = ['Playtest Bistro', 'Playtest Canteen', 'Playtest Hotel'];
		const ctxs = await Promise.all(
			stores.map(() => browser.newContext({ viewport: page.viewportSize()! }))
		);
		try {
			await Promise.all(
				stores.map(async (name, i) => {
					const p = await ctxs[i].newPage();
					// Only a visitor that became its own store orders: never write into the room's seeded kitchens.
					const joined = await r.step(
						`${name}: joins the room as its own store`,
						async () => {
							await p.goto(`${BASE}/?ws=ws-judges`);
							await p.waitForLoadState('networkidle').catch(() => {});
							const field = p.getByLabel(/store name|kitchen name|your name|name/i).first();
							if (!(await field.isVisible().catch(() => false)))
								throw new Error('no store-name field on joining the room (D24 store creation)');
							await field.fill(name);
							await p
								.getByRole('button', { name: /join|start|create|continue/i })
								.first()
								.click();
							await p.waitForLoadState('networkidle').catch(() => {});
						},
						{ beat: false }
					);
					await p.screenshot({ path: `${r.dir}/store-${i + 1}-joined.png`, fullPage: true });
					if (!joined) return;
					await r.step(
						`${name}: orders`,
						async () => {
							await say(r, p, '10 l milk for friday, order it');
							// Approve on the page (the dock closed so the Decide rail shows), then order.
							const close = p.getByRole('button', { name: 'Close chat' });
							if (await close.isVisible().catch(() => false)) await close.click();
							await approveAll(p).catch(() => 0);
							await p.waitForTimeout(1500);
							await orderNow(p);
						},
						{ beat: false }
					);
					await p.screenshot({ path: `${r.dir}/store-${i + 1}-ordered.png`, fullPage: true });
					// The big screen within a second of this store's order: a "First order" badge and the room line.
					await ops.waitForTimeout(800);
					await ops.screenshot({ path: `${r.dir}/ops-after-store-${i + 1}.png` });
				})
			);
		} finally {
			await Promise.all(ctxs.map((c) => c.close()));
		}
		await r.step('Ops shows all three stores', async () => {
			await ops.waitForTimeout(3000);
			const text = await ops.locator('body').innerText();
			const seen = stores.filter((s) => text.includes(s));
			r.note('opsSeesStores', seen);
			if (seen.length < 3) throw new Error(`Ops names ${seen.length}/3 stores: ${seen.join(', ')}`);
		});
		await r.step('Ops lit up a first order', async () => {
			const lit = await ops
				.getByText(/First order|placed its first order/)
				.first()
				.isVisible()
				.catch(() => false);
			r.note('firstOrderLightUp', lit);
			if (!lit)
				throw new Error(
					'no "First order" badge or room line on Ops (it fades after 8 s; see ops-after-store-*.png)'
				);
		});
		await r.step('the room QR full screen shows the public link', async () => {
			await ops
				.getByRole('button', { name: /Show the code full screen/ })
				.click({ timeout: 10_000 });
			await ops.waitForTimeout(1000);
			const text = await ops.locator('body').innerText();
			r.note('qrLink', /app\.mandate\.kitchen\/\?ws=ws-judges/.test(text));
			if (!/app\.mandate\.kitchen\/\?ws=ws-judges/.test(text))
				throw new Error('the full-screen code does not show app.mandate.kitchen/?ws=ws-judges');
			await ops.keyboard.press('Escape');
		});
	},
	420_000
);

// ---------- D26: a visitor's workspace persists (S1 create_kitchen e2842bd/ff8c1a0) ----------

journey(
	'p1',
	'Your own kitchen persists: new tab, start over, a paired phone, your agent key',
	async (r, page) => {
		const origin = { origin: BASE };
		const name = `Playtest Persist ${Date.now().toString(36)}`;
		let kitchenId = '';
		let planId = '';
		const has = async (p: Page, what: string) =>
			(await p.locator('body').innerText()).includes(what);

		await r.step('first look', () => home(page, r));
		if (
			!(await r.step(
				'create my kitchen',
				async () => {
					const res = await page.request.post(`${BASE}/kitchen-api/kitchen`, {
						headers: origin,
						data: { name, city: 'Espoo', description: 'a small bistro, lunch for 40' }
					});
					const body = (await res.json().catch(() => ({}))) as { kitchen?: { kitchenId: string } };
					r.note('create', { status: res.status(), body });
					if (!body.kitchen?.kitchenId) throw new Error(`create_kitchen ${res.status()}`);
					kitchenId = body.kitchen.kitchenId;
					const j = await page.request.post(`${BASE}/kitchen-api/scenario`, {
						headers: origin,
						data: { action: 'join', value: kitchenId }
					});
					if (!j.ok()) throw new Error(`join ${j.status()}`);
				},
				{ beat: false }
			))
		)
			return;
		await r.step('a first basket in my kitchen', async () => {
			// The Kitchen screen never sends place_order: the visitor's own agent key does (the agent door).
			const k = await page.request.get(`${BASE}/api/demo/judge-key`);
			const key = ((await k.json().catch(() => ({}))) as { key?: string }).key;
			if (!key) throw new Error(`judge key ${k.status()}`);
			const res = await page.request.post(`${BASE}/api/tools/place_order`, {
				headers: { authorization: `Bearer ${key}` },
				data: {
					kitchenId,
					deliverBy: '2026-12-11',
					idempotencyKey: `persist-${kitchenId}`,
					lines: [{ productId: '464201', qty: 10, unit: 'ST' }]
				}
			});
			const body = (await res.json().catch(() => ({}))) as { plan?: { id: string } };
			r.note('placeOrder', {
				status: res.status(),
				plan: body.plan?.id,
				error: res.ok() ? undefined : (await res.text()).slice(0, 300)
			});
			if (!body.plan?.id) throw new Error(`place_order ${res.status()}`);
			planId = body.plan.id;
			await page.goto(`${BASE}/?plan=${planId}`);
			await page.waitForLoadState('networkidle').catch(() => {});
		});
		const state = await page.context().storageState();
		const browser = page.context().browser()!;

		const again = await browser.newContext({ storageState: state, viewport: page.viewportSize()! });
		try {
			const p = await again.newPage();
			await r.step(
				'the same browser later (new tab, same cookie): kitchen and basket still there',
				async () => {
					await p.goto(`${BASE}/`);
					await p.waitForLoadState('networkidle').catch(() => {});
					await p.screenshot({ path: `${r.dir}/later-tab.png`, fullPage: true });
					const snap = await p.request.get(`${BASE}/kitchen-api/snapshot?plan=${planId}&peek=1`);
					if (!snap.ok()) throw new Error(`basket gone: snapshot ${snap.status()}`);
					if (!(await has(p, name))) throw new Error('kitchen not named on the Kitchen page');
				},
				{ beat: false }
			);
			await r.step(
				'start over, then my kitchen is still mine',
				async () => {
					const reset = await p.request.post(`${BASE}/kitchen-api/scenario`, {
						headers: origin,
						data: { action: 'reset' }
					});
					r.note('reset', reset.status());
					const j = await p.request.post(`${BASE}/kitchen-api/scenario`, {
						headers: origin,
						data: { action: 'join', value: kitchenId }
					});
					r.note('joinAfterReset', j.status());
					if (!j.ok()) throw new Error(`join after reset ${j.status()}`);
					await p.goto(`${BASE}/`);
					await p.screenshot({ path: `${r.dir}/after-reset.png`, fullPage: true });
					if (!(await has(p, name))) throw new Error('kitchen not named after start over');
				},
				{ beat: false }
			);
		} finally {
			await again.close();
		}

		await r.step(
			'pair a phone: it sees my kitchen',
			async () => {
				const res = await page.request.post(`${BASE}/pair/new`, { headers: origin });
				const body = (await res.json().catch(() => ({}))) as { link?: string };
				r.note('pair', { status: res.status() });
				if (!body.link) throw new Error(`pair ${res.status()}`);
				const phone = await browser.newContext({
					viewport: { width: 390, height: 844 },
					isMobile: true,
					hasTouch: true
				});
				try {
					const ph = await phone.newPage();
					await ph.goto(body.link.replace(/^https?:\/\/[^/]+/, BASE));
					await ph.waitForLoadState('networkidle').catch(() => {});
					await ph.goto(`${BASE}/`);
					await ph.waitForLoadState('networkidle').catch(() => {});
					await ph.screenshot({ path: `${r.dir}/phone.png`, fullPage: true });
					if (!(await has(ph, name))) throw new Error('the paired phone does not show my kitchen');
				} finally {
					await phone.close();
				}
			},
			{ beat: false }
		);

		await r.step(
			'my agent key: get_context lists my kitchen',
			async () => {
				const k = await page.request.get(`${BASE}/api/demo/judge-key`);
				const key = ((await k.json().catch(() => ({}))) as { key?: string }).key;
				if (!key) throw new Error(`judge key ${k.status()}`);
				const ctx = await page.request.post(`${BASE}/api/tools/get_context`, {
					headers: { authorization: `Bearer ${key}` },
					data: {}
				});
				const text = await ctx.text();
				r.note('getContextHasKitchen', text.includes(kitchenId));
				if (!text.includes(kitchenId)) throw new Error('get_context does not list my kitchen');
			},
			{ beat: false }
		);
	},
	300_000
);

// ---------- F1 (docs/review/INDEPENDENT-REPO-2026-11-14.md §1): the model must not rewrite the ask ----------

journey('f1', 'The dock keeps the ask: "4 kg lactose-free butter tomorrow"', async (r, page) => {
	const ASK = '4 kg lactose-free butter tomorrow';
	await r.step('home', () => home(page));
	await r.step('ask in the dock', async () => {
		await say(r, page, ASK);
		// Tomorrow's cut-off may have passed: the dock asks for a day. Take the earliest it offers, as a visitor would.
		const dock = await openDock(page);
		const day = dock.getByRole('button', { name: /^(Mon|Tue|Wed|Thu|Fri|Sat) \d+ \w+$/ }).first();
		if ((await day.isVisible().catch(() => false)) && (await day.isEnabled().catch(() => false))) {
			r.note('answeredDay', await day.innerText());
			await day.click({ timeout: 5_000 });
			await page.waitForTimeout(1500);
			await page
				.getByText(/^Working\b.*…$/)
				.first()
				.waitFor({ state: 'detached', timeout: 180_000 })
				.catch(() => undefined);
			await page.waitForTimeout(1500);
			r.j.chat.push({
				said: `(tapped ${r.j.notes.answeredDay})`,
				reply: (await dock.innerText()).slice(-3000)
			});
		}
	});
	await r.step(
		'the reply keeps 4 kg and lactose-free',
		async () => {
			const reply = r.j.chat.map((c) => c.reply).join(' ');
			if (/\b40\s*kg\b/i.test(reply)) throw new Error('the reply says 40 kg');
			if (!/lactose|laktoosi/i.test(reply)) throw new Error('the reply drops lactose-free');
		},
		{ beat: false }
	);
	await r.step(
		'the plan buys about 4 kg of lactose-free butter',
		async () => {
			const dock = await openDock(page);
			const href = await dock
				.locator('a[href*="plan="]')
				.last()
				.getAttribute('href', { timeout: 30_000 });
			const planId = href ? new URL(href, BASE).searchParams.get('plan') : null;
			if (!planId) throw new Error('no plan link: the ask did not reach a plan');
			const snap = (await (
				await page.request.get(`${BASE}/kitchen-api/snapshot?plan=${planId}&peek=1`)
			).json()) as {
				plan?: {
					lines?: { productName?: string; qty?: { value: number; unit: string }; state: string }[];
				};
			};
			const lines = (snap.plan?.lines ?? []).filter(
				(l) => !['rejected', 'superseded'].includes(l.state)
			);
			r.note(
				'lines',
				lines.map((l) => `${l.productName} × ${l.qty?.value} ${l.qty?.unit} (${l.state})`)
			);
			const butter = lines.filter((l) => /voi|butter/i.test(l.productName ?? ''));
			if (!butter.length) throw new Error('no butter line');
			const notLf = butter.filter((l) => !/laktoositon|lactose/i.test(l.productName ?? ''));
			if (notLf.length)
				throw new Error(`not lactose-free: ${notLf.map((l) => l.productName).join(', ')}`);
			const kg = butter.find((l) => l.qty?.unit === 'KG')?.qty?.value;
			if (kg !== undefined && kg > 8) throw new Error(`${kg} kg planned for a 4 kg ask`);
		},
		{ beat: false }
	);
});
