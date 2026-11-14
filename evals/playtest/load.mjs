#!/usr/bin/env node
/**
 * Room-mode load (D24): N fresh visitors plan the seeded event at the same moment, as a room full of judges would.
 * Each visitor is its own cookie jar (its own sandbox); it opens the Kitchen, then posts the scenario `start`. Reports
 * per visitor the status, the time to a planned snapshot, and any cooldown (429 PROVIDER_UNAVAILABLE + retryInMs).
 *   node evals/playtest/load.mjs                         # local preview on 5190 (start it with DATABASE_URL= blank)
 *   KITCHEN_URL=https://app.mandate.kitchen LOAD_N=10 node evals/playtest/load.mjs   # a deploy, off-peak only
 * Writes scratch/playtest/load-<UTC>-<host>.json.
 */
import { request } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.KITCHEN_URL ?? 'http://localhost:5190';
const N = Number(process.env.LOAD_N ?? 10);
const ROOM = process.env.LOAD_ROOM; // e.g. ws-judges: every visitor joins the shared room instead of its own sandbox

async function visitor(i) {
	const ctx = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { origin: BASE } });
	const t0 = Date.now();
	const out = { i, open: 0, start: 0, ms: 0, planned: false, retryInMs: null, error: null };
	try {
		const open = await ctx.get(ROOM ? `/?ws=${ROOM}` : '/');
		out.open = open.status();
		const res = await ctx.post('/kitchen-api/scenario', {
			data: { action: 'start' },
			timeout: 180_000
		});
		out.start = res.status();
		const body = await res.json().catch(() => ({}));
		if (res.status() === 429) out.retryInMs = body?.error?.detail?.retryInMs ?? null;
		else if (!res.ok()) out.error = String(body?.error?.message ?? '').slice(0, 200);
		out.planned = Boolean(body?.plan?.lines?.length ?? body?.plan?.id);
	} catch (e) {
		out.error = String(e?.message ?? e).slice(0, 200);
	}
	out.ms = Date.now() - t0;
	await ctx.dispose();
	return out;
}

const t0 = Date.now();
const results = await Promise.all(Array.from({ length: N }, (_, i) => visitor(i)));
const ms = results.map((r) => r.ms).sort((a, b) => a - b);
const summary = {
	base: BASE,
	room: ROOM ?? null,
	n: N,
	wallMs: Date.now() - t0,
	planned: results.filter((r) => r.planned).length,
	cooldown429: results.filter((r) => r.start === 429).length,
	otherErrors: results.filter((r) => r.start !== 429 && !r.planned).length,
	p50Ms: ms[Math.floor(ms.length / 2)],
	maxMs: ms.at(-1),
	maxRetryInMs: Math.max(0, ...results.map((r) => r.retryInMs ?? 0)),
	at: new Date().toISOString()
};
mkdirSync(join('scratch', 'playtest'), { recursive: true });
const file = join(
	'scratch',
	'playtest',
	`load-${summary.at.slice(0, 19).replace(/[-:]/g, '')}-${new URL(BASE).host.replace(/[:.]/g, '_')}.json`
);
writeFileSync(file, JSON.stringify({ summary, results }, null, '\t'));
console.log(JSON.stringify(summary, null, 2));
console.log(
	results
		.map(
			(r) =>
				`#${r.i} ${r.start} ${r.ms} ms${r.retryInMs ? ` retry ${r.retryInMs}` : ''}${r.error ? ` ${r.error}` : ''}`
		)
		.join('\n')
);
console.log(file);
