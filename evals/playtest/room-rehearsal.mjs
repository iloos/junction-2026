#!/usr/bin/env node
/**
 * "A stranger scans the QR" rehearsal of the live room demo (D24), on a deploy:
 *   KITCHEN_URL=https://app.mandate.kitchen node evals/playtest/room-rehearsal.mjs
 * Ops (1440) opens the room and its full-screen code; three phone-size strangers open the code's URL, each starts a
 * store of a different kind; two order through the dock, one through /request (the conversation, full width); Ops
 * must name all three and light up a first order; one store then tries the room's hotel and must be refused
 * (room_store). Presenter steps (shortage, reset) need a presenter session on /ops and are left to the presenter.
 * Screenshots and a timing log go to scratch/playtest/room-<UTC>/.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.KITCHEN_URL ?? 'http://localhost:5190';
const at = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '');
const dir = join('scratch', 'playtest', `room-${at}`);
mkdirSync(dir, { recursive: true });
const log = [];
const t0 = Date.now();
const note = (step, ok, detail = '') => {
	const line = {
		s: Math.round((Date.now() - t0) / 100) / 10,
		step,
		ok,
		detail: String(detail).slice(0, 300)
	};
	log.push(line);
	console.log(
		`${String(line.s).padStart(6)} s  ${ok ? 'ok   ' : 'SNAG '} ${step}${detail ? `  · ${line.detail}` : ''}`
	);
};
const timed = async (step, fn) => {
	const t = Date.now();
	try {
		const d = await fn();
		note(step, true, `${Date.now() - t} ms${d ? ` · ${d}` : ''}`);
		return true;
	} catch (e) {
		note(step, false, `${Date.now() - t} ms · ${(e?.message ?? e).split('\n')[0]}`);
		return false;
	}
};
const working = (p) =>
	p
		.getByText(/^Working\b.*…$/)
		.first()
		.waitFor({ state: 'detached', timeout: 180_000 })
		.catch(() => {});

const b = await chromium.launch();
const opsCtx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const ops = await opsCtx.newPage();
let roomUrl = `${BASE}/?ws=ws-judges`;

await timed('Ops opens the room (Room tab)', async () => {
	await ops.goto(`${BASE}/ops?ws=ws-judges`);
	const room = ops.getByRole('tab', { name: /^Room/ });
	await room.waitFor({ timeout: 30_000 });
	await room.click();
	await ops.waitForTimeout(4000); // orders already there don't light up for the first 3 s
});
await timed('the full-screen code shows the public URL', async () => {
	await ops.getByRole('button', { name: /Show the code full screen/ }).click({ timeout: 10_000 });
	await ops.waitForTimeout(800);
	await ops.screenshot({ path: join(dir, '01-ops-qr.png') });
	const m = (await ops.locator('body').innerText()).match(/app\.mandate\.kitchen\/\?ws=ws-judges/);
	if (!m) throw new Error('no app.mandate.kitchen/?ws=ws-judges on the full-screen code');
	if (BASE.includes('app.mandate.kitchen')) roomUrl = `https://${m[0]}`;
	await ops.keyboard.press('Escape');
	return m[0];
});

const stores = [
	{
		name: `Rehearsal Café ${at.slice(-4)}`,
		about: 'a café, 60 coffees and pastries a day',
		via: 'dock'
	},
	{
		name: `Rehearsal Canteen ${at.slice(-4)}`,
		about: 'a staff canteen, 120 lunches a day',
		via: 'dock'
	},
	{ name: `Rehearsal Bistro ${at.slice(-4)}`, about: 'a small bistro, 40 covers', via: 'request' }
];
const phones = [];
for (const [i, s] of stores.entries()) {
	const ctx = await b.newContext({
		viewport: { width: 390, height: 844 },
		isMobile: true,
		hasTouch: true
	});
	const p = await ctx.newPage();
	phones.push(p);
	await timed(`${s.name}: scans the code → the store form`, async () => {
		await p.goto(roomUrl);
		await p
			.getByTestId('establishment-picker')
			.getByLabel(/Store name/)
			.waitFor({ timeout: 30_000 });
	});
	await timed(`${s.name}: starts the store`, async () => {
		const pk = p.getByTestId('establishment-picker');
		await pk.getByLabel(/Store name/).fill(s.name);
		const about = pk.getByLabel(/About it/);
		if (await about.isVisible().catch(() => false)) await about.fill(s.about);
		await pk.getByRole('button', { name: /Start my store/ }).click();
		await pk.waitFor({ state: 'hidden', timeout: 60_000 });
		await p.screenshot({ path: join(dir, `0${i + 2}-store-${i + 1}-home.png`), fullPage: true });
	});
}

for (const [i, s] of stores.entries()) {
	const p = phones[i];
	await timed(`${s.name}: orders 10 l milk (${s.via})`, async () => {
		if (s.via === 'dock') {
			await p.goto(`${roomUrl}&chat=1`);
			const dock = p.locator('aside[aria-label="Agent chat"]');
			await dock.waitFor({ timeout: 30_000 });
			await dock.locator('textarea').fill('10 l milk for friday');
			await dock.locator('textarea').press('Enter');
			await p.waitForTimeout(1500);
			await working(p);
			await dock.locator('textarea').fill('approve all');
			await dock.locator('textarea').press('Enter');
			await p.waitForTimeout(1500);
			await working(p);
			// On a phone the dock covers the page: its "Order it on the page" link is the way on.
			const link = dock.getByRole('link', { name: /Order it on the page/ }).last();
			if (await link.isVisible().catch(() => false)) {
				await link.click();
				await p.waitForLoadState('networkidle').catch(() => {});
			}
			const order = p
				.getByRole('button', { name: /^(Order \d+ lines? now|Order the|Place order)/ })
				.filter({ visible: true })
				.first();
			await order.click({ timeout: 30_000 });
		} else {
			await p.goto(`${BASE}/request?new=1`);
			await p.locator('#chat-text').fill('10 l milk for friday');
			await p.getByRole('button', { name: 'Send' }).first().click();
			await p.waitForTimeout(1500);
			await working(p);
			await p.locator('#chat-text').fill('approve all');
			await p.getByRole('button', { name: 'Send' }).first().click();
			await p.waitForTimeout(1500);
			await working(p);
			// /request is the conversation: the order itself is placed on the Kitchen page.
			const link = p
				.getByRole('link', { name: /Order it on the page|Open this plan in the Kitchen/ })
				.last();
			if (await link.isVisible().catch(() => false)) await link.click();
			await p
				.getByRole('button', { name: /^(Order \d+ lines? now|Order the|Place order)/ })
				.filter({ visible: true })
				.first()
				.click({ timeout: 30_000 });
		}
		await p
			.getByText(/Ordered\s*·\s*\d+\s+lines?/)
			.first()
			.waitFor({ state: 'attached', timeout: 60_000 });
		await p.screenshot({ path: join(dir, `1${i}-store-${i + 1}-ordered.png`), fullPage: true });
	});
	await ops.waitForTimeout(700);
	await ops.screenshot({ path: join(dir, `2${i}-ops-after-store-${i + 1}.png`) });
	const lit = await ops
		.getByText(/First order|placed its first order/)
		.first()
		.isVisible()
		.catch(() => false);
	note(`Ops lights up ${s.name}'s first order`, lit);
}

await timed('Ops names all three stores', async () => {
	await ops.waitForTimeout(2000);
	const text = await ops.locator('body').innerText();
	const seen = stores.filter((s) => text.includes(s.name)).length;
	await ops.screenshot({ path: join(dir, '30-ops-room.png'), fullPage: true });
	if (seen < 3) throw new Error(`${seen}/3 stores named`);
	return `${seen}/3`;
});

await timed(`${stores[0].name}: trying the room's hotel is refused`, async () => {
	// In the room a visitor key is refused by design (409: not a sandbox); a stranger's door to the hotel is the
	// page: switching the Kitchen to it, which the room gate must refuse.
	const p = phones[0];
	const r = await p.request.post(`${BASE}/kitchen-api/scenario`, {
		headers: { origin: BASE },
		data: { action: 'kitchen', value: 'k-hotel' }
	});
	const switched = await r.json().catch(() => ({}));
	const now = switched.kitchenId ?? switched.kitchen?.id ?? null;
	// Either the switch is refused outright (the page stays on the visitor's own store), or the hotel is shown
	// read-only (S1's gate) and planning it is refused. Both keep a stranger off the hotel.
	if (now && now !== 'k-hotel') return `${r.status()}: stays on its own store ${now}`;
	const plan = await p.request.post(`${BASE}/kitchen-api/scenario`, {
		headers: { origin: BASE },
		data: { action: 'start' }
	});
	const body = await plan.text();
	if (plan.ok() || !/not your store|room_store/i.test(body))
		throw new Error(`planning the hotel was allowed: ${plan.status()} ${body.slice(0, 160)}`);
	return `${plan.status()} ${(body.match(/"message":"([^"]+)"/) ?? [])[1] ?? body.slice(0, 120)}`;
});
note(
	'presenter steps (shortage, reset)',
	true,
	'left to the presenter: they need a presenter session on /ops'
);

writeFileSync(join(dir, 'log.json'), JSON.stringify(log, null, '\t'));
console.log(`\n${log.filter((l) => !l.ok).length} snags · ${dir}`);
await b.close();
