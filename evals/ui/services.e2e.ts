import { expect, test } from '@playwright/test';

/**
 * The deployed app talks to its sponsors for real, in three separate claims (R11-13):
 * - this journey's own calls answered live: the request it sends is parsed by a named Gemini model with token counts,
 *   and the product it quotes comes back with `valio_live` provenance (per-call evidence, not process health);
 * - configuration: Valio and Gemini keys are set and their breakers closed;
 * - recent process health: `/healthz` saw a successful live Valio call within the window (process-wide, so another
 *   visitor's call can satisfy it: it is never the journey's evidence).
 * When the traces table lands (O), the first claim reads the job, workspace/run and source from it instead.
 * Prod only (KITCHEN_URL): the gate's local build has no keys.
 */
const BASE = process.env.KITCHEN_URL;
const WINDOW_S = 60;

interface Svc {
	service: 'valio' | 'gemini' | 'exa' | 'contextdev';
	configured: boolean;
	mode: string;
	breaker: 'closed' | 'open' | 'half-open' | null;
	last: { at: string; source: string; ok: boolean; latencyMs: number; error?: string } | null;
	lastLive: { at: string; ok: boolean; ageS: number } | null;
	recent: Record<string, number>;
}

test('Valio and Gemini answer live on the deployed app', async ({ page, request }) => {
	test.skip(!BASE, 'prod only: set KITCHEN_URL');
	test.setTimeout(120_000);
	const before = (await (await request.get(`${BASE}/healthz`)).json()) as { services?: Svc[] };
	test.skip(!before.services, '/healthz has no services[] on this deploy');

	// Gemini: one request parse in this visitor's sandbox, read from the request's own streamed result.
	let streamed = '';
	page.on('response', async (r) => {
		if (r.url().includes('/request/run')) streamed += (await r.text().catch(() => '')) + '\n';
	});
	await page.goto(`${BASE}/request`);
	// A sentence no one has sent before, so no parse cache can answer it: only a live model call shows tokens.
	const litres = 11 + Math.floor(Math.random() * 80);
	await page.locator('#req').fill(`${litres} l lactose-free milk for Friday`);
	await page.getByRole('button', { name: /Find and price/ }).click();
	await page
		.getByText(/1 quote for|nothing quoted/)
		.first()
		.waitFor({ timeout: 60_000 });
	// This request was read by a live Gemini call: its own result names the model, the latency and the tokens.
	await page.waitForTimeout(500);
	const step = streamed
		.split('\n')
		.filter((l) => l.includes('"step":"request"') && l.includes('"parser"'))
		.map((l) => {
			try {
				return JSON.parse(l) as {
					data?: {
						parser?: {
							kind?: string;
							model?: string;
							latencyMs?: number;
							tokens?: { in?: number };
						};
					};
				};
			} catch {
				return {};
			}
		})
		.at(-1);
	const parser = step?.data?.parser;
	expect(parser?.kind, `parser: ${JSON.stringify(parser)}`).toBe('gemini');
	expect(parser?.model, 'a named model').toMatch(/^gemini-/);
	expect(parser?.tokens?.in ?? 0, 'tokens spent on this request').toBeGreaterThan(0);
	// Valio: quote a random catalogue product nobody quoted lately (stored availability older than 15 min is fetched
	// live), through this visitor's judge key on REST.
	const k = await page.request.get(`${BASE}/api/demo/judge-key`);
	test.skip(k.status() !== 200, `judge keys off here (${k.status()})`);
	const auth = { authorization: `Bearer ${((await k.json()) as { key: string }).key}` };
	const words = ['juusto', 'kastike', 'mehu', 'leipä', 'keitto', 'pakaste', 'mauste', 'jogurtti'];
	const query = words[Math.floor(Math.random() * words.length)];
	const found = (await (
		await request.post(`${BASE}/api/tools/search_products`, {
			headers: auth,
			data: { query, limit: 50 }
		})
	).json()) as {
		products?: { productId: string }[];
		value?: { products?: { productId: string }[] };
	};
	const ids = (found.products ?? found.value?.products ?? []).map((p) => p.productId);
	expect(ids.length, `search "${query}" found products`).toBeGreaterThan(0);
	const pick = ids[Math.floor(Math.random() * ids.length)];
	const quoted = await request.post(`${BASE}/api/tools/quote`, {
		headers: auth,
		data: { productIds: [pick], deliverBy: '2026-12-11' }
	});
	expect(quoted.status(), `quote ${pick}`).toBe(200);
	// This quote came from Valio now, not a cache or a fixture.
	const offer = (
		(await quoted.json()) as { offers?: { price?: { provenance?: { source?: string } } }[] }
	).offers?.[0];
	expect(offer?.price?.provenance?.source, `quote ${pick} provenance`).toBe('valio_live');

	const h = (await (await request.get(`${BASE}/healthz`)).json()) as {
		commit: string;
		services: Svc[];
	};
	const by = (s: Svc['service']) => h.services.find((x) => x.service === s);
	const valio = by('valio');
	const gemini = by('gemini');
	const say = (s?: Svc) => JSON.stringify(s);
	expect(valio?.configured, `valio configured on ${h.commit}: ${say(valio)}`).toBe(true);
	expect(['live', 'cache'], `valio mode: ${say(valio)}`).toContain(valio?.mode);
	expect(valio?.breaker, `valio breaker: ${say(valio)}`).not.toBe('open');
	expect(valio?.lastLive?.ok, `valio last live call ok: ${say(valio)}`).toBe(true);
	expect(valio!.lastLive!.ageS, `valio last live call age: ${say(valio)}`).toBeLessThan(WINDOW_S);
	expect(gemini?.configured, `gemini configured: ${say(gemini)}`).toBe(true);
	expect(['failing', 'breaker_open'], `gemini mode: ${say(gemini)}`).not.toContain(gemini?.mode);
	console.log(
		`services on ${h.commit.slice(0, 7)}: ${h.services.map((s) => `${s.service}=${s.mode}${s.lastLive ? ` (live ${s.lastLive.ageS}s ago)` : ''}`).join(', ')}`
	);
});
