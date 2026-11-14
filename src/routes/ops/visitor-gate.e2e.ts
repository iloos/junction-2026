import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * Visitor isolation gate (D9): browser A, browser B, an outside agent holding A's judge key, and a fresh
 * browser opening A's deep link. Each visitor works in its own sandbox; no cookie, query, key or link reaches
 * another's. Needs a production build (dev opens everything) with JUDGE_KEY_SECRET set:
 *   GATE_URL=http://localhost:4177 npx playwright test -c scripts/deploy/pw-gate.config.ts
 */
const BASE = process.env.GATE_URL ?? '';

// Runs only when pointed at a server (GATE_URL); the default e2e preview has no JUDGE_KEY_SECRET.
test.skip(!BASE, 'set GATE_URL to run the visitor isolation gate');

/** Workspace and run the browser's /ops shows (its room line). */
async function room(page: Page, query = ''): Promise<{ ws: string; run: string }> {
	await page.goto(`${BASE}/ops${query}`);
	const text =
		(await page.getByTitle('Workspace and run this screen reads').locator('.mono').textContent()) ??
		'';
	const [ws, run] = text.split('·').map((s) => s.trim());
	return { ws, run };
}

async function planEvent(page: Page) {
	await page.goto(`${BASE}/`);
	const start = page.getByRole('button', { name: 'Plan the event' });
	await page.locator('#event-h').or(start).first().waitFor({ timeout: 60_000 });
	if (await start.isVisible()) await start.click();
	await page.waitForSelector('#event-h', { timeout: 90_000 });
}

/** The visible queue count on /ops ("To act on N"). */
async function queueCount(page: Page): Promise<number> {
	const h = page.getByRole('heading', { name: /To act on/ });
	await h.waitFor({ timeout: 30_000 });
	return Number(((await h.textContent()) ?? '').match(/(\d+)/)?.[1] ?? 0);
}

const poll = (ctx: BrowserContext, ws: string) =>
	ctx.request.get(`${BASE}/api/events?workspace=${ws}&mode=poll`);

test('two browsers, an outside agent and a stranger with a link stay in their own sandboxes', async ({
	browser
}) => {
	test.setTimeout(300_000);
	const A = await browser.newContext();
	const B = await browser.newContext();
	const a = await A.newPage();
	const b = await B.newPage();

	// 1. A plans the event in its kitchen; Ops in A's browser opens A's sandbox and shows A's held lines.
	await planEvent(a);
	const ra = await room(a);
	expect(ra.ws).toMatch(/^ws-j-[a-z0-9]{24}$/);
	await expect.poll(() => queueCount(a), { timeout: 30_000 }).toBeGreaterThan(0);
	await a.screenshot({ path: 'scratch/gate-a-planned.png' });

	// 2. B is somewhere else and sees nothing of A's.
	const rb = await room(b);
	expect(rb.ws).toMatch(/^ws-j-/);
	expect(rb.ws).not.toBe(ra.ws);
	await expect(b.getByText('No orders in this workspace yet')).toBeVisible({ timeout: 30_000 });

	// 3. B cannot read A: not its stream, not by query on /ops.
	expect((await poll(B, ra.ws)).status()).toBe(403);
	expect((await poll(A, ra.ws)).status()).toBe(200);
	expect((await room(b, `?ws=${ra.ws}`)).ws).toBe(rb.ws);

	// 4. B cannot approve A: the kitchen helper only acts on B's own session plan.
	const approve = await B.request.post(`${BASE}/kitchen-api/tool/approve`, {
		data: { approvalId: `ap-${ra.ws}`, planVersion: 1, termsHash: 'x', decision: 'grant' }
	});
	expect(approve.status()).toBe(403);

	// 5. B's reset changes only B.
	await planEvent(b);
	const bReset = await B.request.post(`${BASE}/api/demo/sandbox/reset`);
	expect(bReset.status()).toBe(200);
	expect((await bReset.json()).workspaceId).toBe(rb.ws);
	expect((await room(a)).run).toBe(ra.run);
	await expect.poll(() => queueCount(a), { timeout: 30_000 }).toBeGreaterThan(0);

	// 6. An outside agent with A's judge key works in A's sandbox, current run, and can't approve.
	const keyRes = await A.request.get(`${BASE}/api/demo/judge-key`);
	expect(keyRes.status()).toBe(200);
	const { key, workspaceId } = (await keyRes.json()) as { key: string; workspaceId: string };
	expect(workspaceId).toBe(ra.ws);
	const agent = await browser.newContext();
	const auth = { authorization: `Bearer ${key}` };
	const placed = await agent.request.post(`${BASE}/api/tools/place_order`, {
		headers: auth,
		data: {
			kitchenId: 'k-lounas',
			deliverBy: '2026-12-09',
			idempotencyKey: 'gate-1',
			lines: [{ productId: '460692', qty: 3, unit: 'KI' }]
		}
	});
	expect(placed.status()).toBe(200);
	const out = (await placed.json()) as {
		plan: { id: string; workspaceId: string; runId: string; version: number; termsHash: string };
		approvalId: string | null;
	};
	expect(out.plan.workspaceId).toBe(ra.ws);
	expect(out.plan.runId).toBe(ra.run);
	if (out.approvalId) {
		const self = await agent.request.post(`${BASE}/api/tools/approve`, {
			headers: auth,
			data: {
				approvalId: out.approvalId,
				planVersion: out.plan.version,
				termsHash: out.plan.termsHash,
				decision: 'grant'
			}
		});
		expect(self.status()).toBe(403);
	}
	// A tampered key is refused outright.
	const tampered = `${key.slice(0, -2)}${key.endsWith('AA') ? 'BB' : 'AA'}`;
	const bad = await agent.request.post(`${BASE}/api/tools/get_plan`, {
		headers: { authorization: `Bearer ${tampered}` },
		data: { planId: out.plan.id }
	});
	expect(bad.status()).toBe(401);
	// The agent's order shows up in A's Ops, not in B's.
	const aEvents = (await (await poll(A, ra.ws)).json()) as {
		events: { envelope?: { planId?: string } }[];
	};
	expect(JSON.stringify(aEvents)).toContain(out.plan.id);
	const bNow = await room(b);
	const bEvents = (await (await poll(B, bNow.ws)).json()) as unknown;
	expect(JSON.stringify(bEvents)).not.toContain(out.plan.id);

	// 7. A stranger opening A's deep link lands in their own sandbox: the link locates, never grants.
	await a.goto(`${BASE}/ops`);
	const link = await a.locator('.queue .next a').first().getAttribute('href');
	expect(link).toContain(`ws=${ra.ws}`);
	const C = await browser.newContext();
	const c = await C.newPage();
	await c.goto(`${BASE}${link}`);
	await c.waitForLoadState('networkidle');
	const rc = await room(c);
	expect(rc.ws).not.toBe(ra.ws);
	const cApprove = await C.request.post(`${BASE}/kitchen-api/tool/approve`, {
		data: { approvalId: out.approvalId ?? 'x', planVersion: 1, termsHash: 'x', decision: 'grant' }
	});
	expect(cApprove.status()).toBe(403);

	// 8. Forged identity: the bare id, an edited signature, or the id in the room cookie select nothing of A's.
	const origin = new URL(BASE);
	for (const [name, value] of [
		['mandate_visitor', ra.ws],
		['mandate_visitor', `${ra.ws}.forged`],
		['mandate_room', ra.ws]
	]) {
		const D = await browser.newContext();
		await D.addCookies([{ name, value, domain: origin.hostname, path: '/' }]);
		const d = await D.newPage();
		expect((await room(d)).ws).not.toBe(ra.ws);
		expect((await poll(D, ra.ws)).status()).toBe(403);
		await D.close();
	}

	// 9. A's own reset changes only A.
	const before = await room(b);
	const aReset = await A.request.post(`${BASE}/api/demo/sandbox/reset`);
	expect(aReset.status()).toBe(200);
	expect((await room(a)).run).not.toBe(ra.run);
	expect(await room(b)).toEqual(before);

	await a.screenshot({ path: 'scratch/gate-a-ops.png' });
	await b.screenshot({ path: 'scratch/gate-b-ops.png' });
	for (const x of [A, B, C, agent]) await x.close();
});
