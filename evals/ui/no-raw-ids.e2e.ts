import { expect, test, type Page } from '@playwright/test';

/**
 * CLAUDE.md rule 12 (five-second UI): no raw ids, op names, reason codes or ISO dates on a judge-facing page outside
 * the System layer (`.sys-only`). Walks every judge door at 1440 and 390 px in a fresh visitor sandbox: the Kitchen
 * (planned, Why open), /request (an order and a menu review), /ops (cases and a case's story), /agents and the agent
 * dock after a turn. Reads only text a person can see (visible elements, not attributes). Runs in `pnpm gate --full`,
 * or against a deployed app: KITCHEN_URL=<url> npx playwright test -c evals/ui/pw-prod.config.ts no-raw-ids
 */
const BASE = process.env.KITCHEN_URL ?? 'http://localhost:4173';

const OPS = [
	'CreatePlan',
	'EditLine',
	'RecordOffer',
	'ProposeSubstitute',
	'RecordApproval',
	'CommitOrder',
	'RecordAnomaly',
	'RecordEnrichment'
];
const RULES: { name: string; re: RegExp }[] = [
	{ name: 'workspace id', re: /\bws-j-[\w-]+/g },
	{ name: 'plan id', re: /\bpl-run-[\w-]+/g },
	{ name: 'run id', re: /\brun-[a-z0-9]{6,}[\w-]*/g },
	{ name: 'op name', re: new RegExp(`\\b(${OPS.join('|')})\\b`, 'g') },
	{ name: 'reason code', re: /\b[a-z]+(?:_[a-z]+)+\b/g },
	{ name: 'ISO date', re: /\b20\d\d-\d\d-\d\d(?:T[\d:.]+Z?)?/g }
];

/** Visible text outside the System layer, one string per text node's nearest element. */
async function visibleText(page: Page): Promise<string[]> {
	return page.evaluate(() => {
		const out: string[] = [];
		const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
		for (let n = walk.nextNode(); n; n = walk.nextNode()) {
			const t = n.textContent?.trim();
			const el = n.parentElement;
			// Code samples (the Agent API page's tool names, its MCP URL) are developer material, read as code.
			if (!t || !el || el.closest('.sys-only, script, style, noscript, code, pre, kbd, samp'))
				continue;
			if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
			out.push(t);
		}
		return out;
	});
}

const hits: string[] = [];
async function sweep(page: Page, where: string) {
	await page.waitForTimeout(800);
	if (process.env.SWEEP_SHOTS)
		await page.screenshot({ path: `${process.env.SWEEP_SHOTS}/${where.replace(/\W+/g, '-')}.png` });
	for (const t of await visibleText(page))
		for (const r of RULES)
			for (const m of t.matchAll(r.re))
				hits.push(`${where} · ${r.name} "${m[0]}" in "${t.slice(0, 90)}"`);
}

async function kitchen(page: Page, w: number) {
	await page.goto(`${BASE}/`);
	const start = page.getByRole('button', { name: /Plan the event/ });
	await start.waitFor({ timeout: 30_000 }).catch(() => undefined);
	await sweep(page, `/ pre-plan ${w}`);
	if (await start.count()) await start.click();
	await page.locator('#dishes-h').waitFor({ state: 'attached', timeout: 120_000 });
	await sweep(page, `/ planned ${w}`);
	if (w < 600) await page.getByRole('tab', { name: /Plan/ }).first().click();
	// A dish row is one line; its lines and their Why open with the row's details.
	await page
		.getByRole('button', { name: /^Show details:/ })
		.first()
		.click();
	await sweep(page, `/ row details ${w}`);
	await page.getByRole('button', { name: 'Why this line' }).first().click();
	await page.getByRole('dialog').waitFor();
	await sweep(page, `/ Why ${w}`);
	await page.keyboard.press('Escape');
}

async function request(page: Page, w: number) {
	await page.goto(`${BASE}/request`);
	await page.waitForLoadState('domcontentloaded');
	const ex = page.getByRole('group', { name: 'Examples' }).getByRole('button').first();
	const examples = page.locator('[aria-label="Examples"] button').first();
	await ((await ex.count()) ? ex : examples).click({ timeout: 30_000 });
	await page.waitForTimeout(6000);
	await sweep(page, `/request order ${w}`);
	const box = page.locator('textarea').first();
	if (await box.count()) {
		await box.fill('Christmas buffet for 40 guests on Saturday, one vegetarian main');
		await box.press('Enter');
		await page.waitForTimeout(8000);
		await sweep(page, `/request brief ${w}`);
		const noBudget = page.getByRole('button', { name: 'No budget' });
		if (await noBudget.count()) {
			await noBudget.click();
			await page.waitForTimeout(20_000);
			await sweep(page, `/request menu review ${w}`);
		}
	}
}

async function ops(page: Page, w: number) {
	await page.goto(`${BASE}/ops`);
	await page.waitForLoadState('domcontentloaded');
	await page.waitForTimeout(3000);
	await sweep(page, `/ops ${w}`);
	// Ops opens on Problems: a problem card shows its story beside it.
	const row = page.locator('.card').first();
	if (await row.count()) {
		await row.click().catch(() => undefined);
		await sweep(page, `/ops story ${w}`);
	}
}

async function agents(page: Page, w: number) {
	await page.goto(`${BASE}/agents`);
	await page.waitForLoadState('domcontentloaded');
	await sweep(page, `/agents ${w}`);
}

async function dock(page: Page, w: number) {
	await page.goto(`${BASE}/`);
	await page.locator('#dishes-h').waitFor({ state: 'attached', timeout: 120_000 });
	await page.getByRole('button', { name: 'Ask the agent' }).click();
	const box = page.locator('aside[aria-label="Agent chat"] textarea');
	await box.fill('4 kg lactose-free butter for Thursday');
	await box.press('Enter');
	await page.waitForTimeout(10_000);
	const fold = page.locator('aside[aria-label="Agent chat"] summary').first();
	if (await fold.count()) await fold.click();
	await sweep(page, `dock ${w}`);
}

for (const w of [1440, 390])
	test(`no raw ids or ISO dates outside the System layer at ${w}px`, async ({ browser }) => {
		test.setTimeout(400_000);
		hits.length = 0;
		const ctx = await browser.newContext({
			viewport: { width: w, height: w > 600 ? 900 : 844 }
		});
		const page = await ctx.newPage();
		await kitchen(page, w);
		await request(page, w);
		await ops(page, w);
		await agents(page, w);
		await dock(page, w);
		await ctx.close();
		expect([...new Set(hits)], 'raw ids, op names, codes or ISO dates on screen').toEqual([]);
	});
