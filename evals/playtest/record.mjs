#!/usr/bin/env node
/**
 * Video takes for the ≤2:00 video (S7's docs/pitch/shots.json), one command:
 *   KITCHEN_URL=https://app.mandate.kitchen DECK=../pitch/docs/pitch/deck.html node evals/playtest/record.mjs
 *   ONLY=A,B,deck  TAKES=2 (default)
 * Every clip is a fresh browser profile at 1920×1080 with a visible cursor dot, clicks preceded by a smooth cursor
 * move, typing at human speed, ~1 s pauses and slow scrolling. Output: scratch/video/<run>/<shot>-<take>[-ops].webm,
 * stills in scratch/video/<run>/stills/ and scratch/video/stills/ (latest), and notes.json with the real labels and
 * counts each shot saw (S7 checks them against the script). .mp4 copies are made when ffmpeg is on PATH.
 */
import { chromium } from '@playwright/test';
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const BASE = process.env.KITCHEN_URL ?? 'https://app.mandate.kitchen';
const DECK = resolve(process.env.DECK ?? '../pitch/docs/pitch/deck.html');
const ONLY = (process.env.ONLY ?? 'deck,A,B').split(',');
const TAKES = Number(process.env.TAKES ?? 2);
const W = 1920;
const H = 1080;
const run = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '');
const out = join('scratch', 'video', run);
const stillsDir = join(out, 'stills');
mkdirSync(stillsDir, { recursive: true });
mkdirSync(join('scratch', 'video', 'stills'), { recursive: true });
const notes = { base: BASE, run, shots: {} };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const CURSOR = () => {
	const add = () => {
		if (document.getElementById('__cursor')) return;
		const d = document.createElement('div');
		d.id = '__cursor';
		d.style.cssText =
			'position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(255,80,40,.35);border:2px solid rgba(255,80,40,.9);z-index:2147483647;pointer-events:none;transition:transform .12s;';
		document.documentElement.appendChild(d);
		addEventListener(
			'mousemove',
			(e) => (d.style.left = e.clientX + 'px') && (d.style.top = e.clientY + 'px'),
			true
		);
		addEventListener('mousedown', () => (d.style.transform = 'scale(.7)'), true);
		addEventListener('mouseup', () => (d.style.transform = ''), true);
	};
	if (document.readyState === 'loading') addEventListener('DOMContentLoaded', add);
	else add();
};

const browser = await chromium.launch();
let pos = { x: W / 2, y: H / 2 };

async function clip() {
	const ctx = await browser.newContext({
		viewport: { width: W, height: H },
		recordVideo: { dir: out, size: { width: W, height: H } },
		deviceScaleFactor: 1
	});
	await ctx.addInitScript(CURSOR);
	return ctx;
}
async function save(ctx, page, name) {
	const v = page.video();
	await ctx.close();
	if (!v) return;
	const tmp = await v.path();
	const dst = join(out, `${name}.webm`);
	renameSync(tmp, dst);
	log('saved', dst);
}
const pause = (p, ms = 1000) => p.waitForTimeout(ms);
async function moveTo(p, loc) {
	await loc.scrollIntoViewIfNeeded().catch(() => {});
	const b = await loc.boundingBox();
	if (!b) return;
	const to = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
	await p.mouse.move(pos.x, pos.y);
	await p.mouse.move(to.x, to.y, { steps: 25 });
	pos = to;
	await pause(p, 350);
}
async function click(p, loc) {
	await loc.waitFor({ state: 'visible', timeout: 60_000 });
	await moveTo(p, loc);
	await loc.click();
	await pause(p, 900);
}
async function type(p, loc, text) {
	await click(p, loc);
	await loc.pressSequentially(text, { delay: 55 });
	await pause(p, 600);
}
async function slowScroll(p, dy, steps = 30) {
	for (let i = 0; i < steps; i++) {
		await p.mouse.wheel(0, dy / steps);
		await p.waitForTimeout(40);
	}
	await pause(p, 700);
}
async function still(p, name) {
	const f = join(stillsDir, `${name}.png`);
	await p.screenshot({ path: f });
	copyFileSync(f, join('scratch', 'video', 'stills', `${name}.png`));
}
const working = (p) =>
	p
		.getByText(/^Working\b.*…$/)
		.first()
		.waitFor({ state: 'detached', timeout: 180_000 })
		.catch(() => {});

async function sampleHotel(p) {
	await p.goto(`${BASE}/`);
	const pk = p.getByTestId('establishment-picker');
	await pk.or(p.locator('main h1')).first().waitFor({ timeout: 60_000 });
	if (await pk.isVisible().catch(() => false)) {
		await pause(p, 1500);
		await click(p, pk.locator('[data-kitchen-id="k-hotel"]'));
		await pk.waitFor({ state: 'hidden', timeout: 60_000 });
	}
	await p.waitForLoadState('networkidle').catch(() => {});
	await pause(p, 1200);
}

// ---------- deck ----------
const DECK_SHOTS = [
	['d1-cover', 1, 'Refuse it.', 6],
	['d3-case', 3, 'without the chef?', 14],
	['d4-rules', 4, 'refused, with why', 14],
	['d8-consent', 8, 'Only the chef can say yes.', 14],
	['d9-next', 9, 'The order itself is simulated.', 10],
	['d10-close', 10, 'Your rules decide what.', 6],
	['d5-buffet', 5, 'The chef decides 3 things.', 18],
	['d7-recorded', 7, 'on Valio', 20]
];
if (ONLY.includes('deck')) {
	if (!existsSync(DECK)) log('SKIP deck: no file at', DECK);
	else
		for (const [id, n, text, dur] of DECK_SHOTS) {
			const ctx = await clip(id);
			const p = await ctx.newPage();
			await p.goto(`${pathToFileURL(DECK).href}#s${n}`);
			const seen = await p
				.getByText(text, { exact: false })
				.first()
				.waitFor({ timeout: 15_000 })
				.then(() => true)
				.catch(() => false);
			await p.waitForTimeout(Math.max(3000, dur * 1000 * 1.5));
			notes.shots[id] = { waitFor: text, seen };
			await save(ctx, p, id);
		}
}

// The brief typed in shot A, and the chips answered when the agent asks (day, service style).
const BRIEF =
	process.env.BRIEF ?? 'Lunch for 80 on Friday: salmon soup, a vegetarian main and rye bread';
const CHIP = /^(Fri\b|Friday|Sat\b|Saturday|Buffet$|Lunch$|None$)/;

// ---------- A: words → menu → plan → Accept all → Ordered → Ops ----------
for (let t = 1; ONLY.includes('A') && t <= TAKES; t++) {
	const id = `A-words-live-${t}`;
	const n = { steps: [] };
	notes.shots[id] = n;
	const ctx = await clip(id);
	const ops = await ctx.newPage();
	const p = await ctx.newPage();
	try {
		await sampleHotel(p);
		await ops.goto(`${BASE}/ops`);
		await p.bringToFront();
		await pause(p, 800);
		const dock = p.locator('aside[aria-label="Agent chat"]');
		if (!(await dock.isVisible().catch(() => false)))
			await click(p, p.getByRole('button', { name: /Ask the agent|^Agent$/ }).first());
		await dock.waitFor({ timeout: 30_000 });
		const box = dock.locator('textarea').first();
		await type(p, box, BRIEF);
		await box.press('Enter');
		await working(p);
		for (let i = 0; i < 4; i++) {
			const chip = dock.getByRole('button', { name: CHIP }).last();
			if (
				!(await chip.isVisible().catch(() => false)) ||
				!(await chip.isEnabled().catch(() => false))
			)
				break;
			n.steps.push(`answered ${await chip.innerText()}`);
			await click(p, chip);
			await working(p);
		}
		for (let i = 0; i < 2; i++) {
			await type(p, box, 'plan it');
			await box.press('Enter');
			await working(p);
			await pause(p, 1500);
			if (i === 0) await still(p, `A1-menu-card-t${t}`);
			if (
				await p
					.getByRole('button', { name: /^Accept all \d+/ })
					.first()
					.isVisible()
					.catch(() => false)
			)
				break;
		}
		const all = p
			.getByRole('button', { name: /^Accept all \d+/ })
			.filter({ visible: true })
			.first();
		await all.waitFor({ timeout: 120_000 });
		n.acceptAll = (await all.innerText()).replace(/\s+/g, ' ');
		await still(p, `A2-plan-with-reasons-t${t}`);
		const reason = p
			.getByText(/new product|not bought before|doesn't confirm|requirement/i)
			.filter({ visible: true })
			.first();
		if (await reason.isVisible().catch(() => false)) {
			await moveTo(p, reason);
			await pause(p, 2000);
		}
		await moveTo(p, all);
		await still(p, `A3-accept-all-t${t}`);
		await click(p, all);
		const confirm = p.getByRole('dialog').getByRole('button', { name: /Confirm exact terms/ });
		if (await confirm.isVisible({ timeout: 1500 }).catch(() => false)) await click(p, confirm);
		const order = p
			.getByRole('button', { name: /^(Order \d+ lines? now|Order the|Place order)/ })
			.filter({ visible: true })
			.first();
		await order.waitFor({ timeout: 30_000 });
		n.order = (await order.innerText()).replace(/\s+/g, ' ');
		await click(p, order);
		await p
			.getByText(/Ordered\s*·\s*\d+\s+lines?|Ordered: receipt/)
			.or(p.getByRole('button', { name: /^Ordered \d+/ }))
			.first()
			.waitFor({ state: 'attached', timeout: 60_000 });
		await pause(p, 1500);
		n.ordered = (
			(await p
				.getByText(/Ordered\s*·\s*\d+\s+lines?|Ordered: receipt/)
				.or(p.getByRole('button', { name: /^Ordered \d+/ }))
				.first()
				.innerText()
				.catch(() => '')) || ''
		).replace(/\s+/g, ' ');
		await still(p, `A4-ordered-receipt-t${t}`);
		await ops.bringToFront();
		await ops.reload();
		const orders = ops.getByRole('tab', { name: /^Orders/ });
		await orders.waitFor({ timeout: 30_000 }).catch(() => {});
		await pause(ops, 1200);
		if (await orders.isVisible().catch(() => false)) {
			await ops.mouse.move(pos.x, pos.y);
			await click(ops, orders);
		}
		await pause(ops, 2500);
		await still(ops, `A5-ops-order-t${t}`);
		await slowScroll(ops, 400);
		n.ok = true;
	} catch (e) {
		n.ok = false;
		n.error = String(e?.message ?? e).split('\n')[0];
		log('A failed:', n.error);
		await p.screenshot({ path: join(out, `${id}-FAILED.png`) }).catch(() => {});
	}
	const v1 = p.video();
	const v2 = ops.video();
	await ctx.close();
	if (v1) renameSync(await v1.path(), join(out, `${id}.webm`));
	if (v2) renameSync(await v2.path(), join(out, `${id}-ops.webm`));
	log(id, n.ok ? 'ok' : 'FAILED', JSON.stringify(n));
}

// ---------- B: the buffet planned live, its three outcomes in view ----------
for (let t = 1; ONLY.includes('B') && t <= TAKES; t++) {
	const id = `B-buffet-live-${t}`;
	const n = {};
	notes.shots[id] = n;
	const ctx = await clip(id);
	const p = await ctx.newPage();
	try {
		await sampleHotel(p);
		const start = p.getByRole('button', { name: /^Plan the event/ }).first();
		await click(p, start);
		await p.locator('#task-h').waitFor({ timeout: 120_000 });
		await p.waitForLoadState('networkidle').catch(() => {});
		await pause(p, 2000);
		const snap = await (await p.request.get(`${BASE}/kitchen-api/snapshot`)).json();
		const by = {};
		for (const l of snap.plan?.lines ?? []) by[l.state] = (by[l.state] ?? 0) + 1;
		n.counts = by;
		n.lines = snap.plan?.lines?.length;
		n.totalEur = ((snap.plan?.totalCents ?? 0) / 100).toFixed(2);
		n.groups = await p.getByTestId('decision-group').count();
		n.bar = (
			(await p
				.getByTestId('action-bar')
				.innerText()
				.catch(() => '')) || ''
		).replace(/\s+/g, ' ');
		await still(p, `B0-buffet-top-t${t}`);
		for (const [label, loc] of [
			[
				'ready',
				p
					.getByRole('button', { name: /^Order \d+ lines? now/ })
					.filter({ visible: true })
					.first()
			],
			['decision', p.getByTestId('decision-group').first()],
			[
				'refused',
				p
					.getByText(/Not covered|can't be ordered|not orderable/i)
					.filter({ visible: true })
					.first()
			]
		]) {
			if (!(await loc.isVisible().catch(() => false))) {
				n[`missing_${label}`] = true;
				continue;
			}
			await loc.scrollIntoViewIfNeeded().catch(() => {});
			await moveTo(p, loc);
			await pause(p, 2000);
		}
		await p.evaluate(() => scrollTo({ top: 0, behavior: 'smooth' }));
		await pause(p, 1500);
		await still(p, `B1-three-outcomes-t${t}`);
		n.ok = true;
	} catch (e) {
		n.ok = false;
		n.error = String(e?.message ?? e).split('\n')[0];
		log('B failed:', n.error);
	}
	await save(ctx, p, id);
	log(id, n.ok ? 'ok' : 'FAILED', JSON.stringify(n));
}

await browser.close();
writeFileSync(join(out, 'notes.json'), JSON.stringify(notes, null, '\t'));
try {
	execSync('ffmpeg -version', { stdio: 'ignore' });
	for (const f of Object.keys(notes.shots))
		for (const suffix of ['', '-ops']) {
			const src = join(out, `${f}${suffix}.webm`);
			if (existsSync(src))
				execSync(
					`ffmpeg -y -loglevel error -i "${src}" -c:v libx264 -pix_fmt yuv420p "${src.replace(/\.webm$/, '.mp4')}"`
				);
		}
} catch {
	log('no ffmpeg on PATH: .webm only');
}
log('done', out);
