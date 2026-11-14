import { expect, test } from '@playwright/test';

/**
 * The deployed app talks to its sponsors for real: after one request that quotes a product, `/healthz` reports Valio
 * as configured, answered live or from its cache, breaker not open, and a successful live call within the window;
 * Gemini (the request parser) is configured and neither failing nor tripped. Prod only (KITCHEN_URL): the gate's
 * local build has no keys, so every service is fixture there. `services[]` is per process since start, so the check
 * makes the call it then asserts on.
 */
const BASE = process.env.KITCHEN_URL;
const WINDOW_S = 600;

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

	// One request that parses (Gemini) and quotes (Valio) in this visitor's sandbox.
	await page.goto(`${BASE}/request`);
	await page.locator('#req').fill('10 l lactose-free milk for Friday');
	await page.getByRole('button', { name: /Find and price/ }).click();
	await page
		.getByText(/1 quote for|nothing quoted/)
		.first()
		.waitFor({ timeout: 60_000 });

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
