import { expect, type Page } from '@playwright/test';
import { BASE, journey, isMobile, type Recorder } from './harness';

/**
 * The four north-star moments (docs/handoff/ring6/RESTART.md) and the nine Round 12 journeys
 * (docs/review/ROUND12-ADVERSARIAL.md, "Nine-journey matrix"), as a first-time visitor in a fresh sandbox per test.
 * Steps name what the visitor tries; selectors are the visible words, so a step that can't find its words is where a
 * visitor would be stuck too. Judges read the beats; nothing here decides pass or fail.
 */

const SITE = process.env.SITE_URL ?? 'https://mandate.kitchen';

// ---------- shared moves ----------

async function home(page: Page) {
	await page.goto(`${BASE}/`);
	await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
}

/** The hotel's seeded event, planned the way a visitor would: pick the kitchen if asked, then plan. */
async function planEvent(page: Page) {
	const picker = page.getByRole('region', { name: /Who are you cooking for/i });
	if (await picker.isVisible().catch(() => false)) {
		const hotel = picker.getByRole('button', { name: /hotel/i }).first();
		await hotel.click();
		await page.waitForLoadState('networkidle').catch(() => {});
	}
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
		.getByText(/^Working( · step \d+)?…/)
		.first()
		.waitFor({ state: 'detached', timeout: 180_000 })
		.catch(() => undefined);
	await page.waitForTimeout(1500);
	const after = await dock.innerText();
	const reply = after.startsWith(before) ? after.slice(before.length) : after;
	r.j.chat.push({ said: text, reply: reply.trim().slice(0, 4000) });
}

async function requestPage(page: Page, text: string) {
	await page.goto(`${BASE}/request`);
	await page.locator('#req').fill(text);
	await page.getByRole('button', { name: /Find and price/ }).click();
	await page
		.getByText(/Prepared by the kitchen agent|Nothing was ordered|Event brief|nothing quoted|Menu/)
		.first()
		.waitFor({ timeout: 90_000 });
	await page.waitForTimeout(1500);
}

async function approveAll(page: Page) {
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
		await page.waitForLoadState('networkidle').catch(() => {});
		await page.waitForTimeout(1000);
	}
	if (!lines) throw new Error('no Review / Hold to sign off control found');
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
	await r.step('first look at the home', () => home(page));
	if (!(await r.step('plan the hotel event', () => planEvent(page)))) return;
	await r.step('a shortage hits (scenario shortage, else contention)', async () => {
		let res = await page.request.post(`${BASE}/kitchen-api/scenario`, {
			data: { action: 'shortage' }
		});
		r.note('shortageAction', res.status());
		if (!res.ok()) {
			res = await page.request.post(`${BASE}/kitchen-api/scenario`, {
				data: { action: 'contention', value: true }
			});
			r.note('contentionAction', res.status());
		}
		if (!res.ok()) throw new Error(`scenario ${res.status()} ${(await res.text()).slice(0, 200)}`);
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

journey('m2', 'Words become a costed plan, step by step', async (r, page) => {
	await r.step('home', () => home(page));
	await r.step('ask the agent for the dinner', () =>
		say(r, page, 'a no-meat dinner for 120 with a peach dessert')
	);
	await r.step('plan it', () => say(r, page, 'plan it'));
	await r.step('the same words on /request', () =>
		requestPage(page, 'a no-meat dinner for 120 with a peach dessert')
	);
});

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
					lines: [{ productId: '464201', qty: 60, unit: 'ST' }]
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
	for (const tab of ['Demand', 'Orders', 'Forecast', 'Flow']) {
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
	await r.step('first look (5-second test: read the fold)', () => home(page));
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

type SnapLine = { productId: string; qty?: number; unit?: string; state: string };
async function basket(page: Page) {
	const snap = (await (await page.request.get(`${BASE}/kitchen-api/snapshot`)).json()) as {
		plan?: { id?: string; lines?: SnapLine[] };
	};
	return {
		plan: snap.plan?.id ?? null,
		lines: (snap.plan?.lines ?? [])
			.filter((l) => !['rejected', 'superseded'].includes(l.state))
			.map((l) => `${l.productId} × ${l.qty ?? '?'} ${l.unit ?? ''}`.trim())
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
			await r.step('/request: the same ask (fresh visitor)', () => requestPage(p2, SAME_ASK), {
				beat: false
			});
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
			await ops.waitForTimeout(3000);
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
							await approveAll(p).catch(() => 0);
						},
						{ beat: false }
					);
					await p.screenshot({ path: `${r.dir}/store-${i + 1}-ordered.png`, fullPage: true });
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
	},
	420_000
);
