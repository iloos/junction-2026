#!/usr/bin/env node
/**
 * Capacity ramp (lead, Sun 02:40): idle open tabs (each holds the live event stream, as a Kitchen tab does) at
 * TABS steps, then concurrent fresh planners (scenario `start`, the seeded event: rules only, no model call) at
 * PLANNERS steps, while /healthz is timed. Own sandboxes only (no room writes).
 *   KITCHEN_URL=https://app.mandate.kitchen node evals/playtest/ramp.mjs
 *   TABS=50,100,200 PLANNERS=10,25,50 (defaults)
 * Writes scratch/playtest/ramp-<UTC>.json and prints one line per step.
 */
import { request } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.KITCHEN_URL ?? 'http://localhost:5190';
const TABS = (process.env.TABS ?? '50,100,200').split(',').map(Number);
const PLANNERS = (process.env.PLANNERS ?? '10,25,50').split(',').map(Number);
const pct = (xs, p) => {
	const s = [...xs].sort((a, b) => a - b);
	return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : null;
};

async function health() {
	const t = Date.now();
	try {
		const r = await fetch(`${BASE}/healthz`, { signal: AbortSignal.timeout(20_000) });
		const j = await r.json();
		return {
			status: r.status,
			ms: Date.now() - t,
			db: j.latencyMs,
			mem: j.memory ?? j.mem ?? null
		};
	} catch (e) {
		return { status: 0, ms: Date.now() - t, error: String(e).slice(0, 80) };
	}
}

/** One idle tab: a visitor cookie, then the event stream held open until `stop`. */
async function tab(stop) {
	const ctx = await request.newContext({ baseURL: BASE });
	await ctx.get('/');
	const cookie = (await ctx.storageState()).cookies.map((c) => `${c.name}=${c.value}`).join('; ');
	await ctx.dispose();
	const ac = new AbortController();
	stop.push(() => ac.abort());
	const t = Date.now();
	try {
		const r = await fetch(`${BASE}/api/events`, {
			headers: { cookie, accept: 'text/event-stream' },
			signal: ac.signal
		});
		const reader = r.body?.getReader();
		const first = reader
			? await Promise.race([
					reader.read(),
					new Promise((res) => setTimeout(() => res(null), 15_000))
				])
			: null;
		const out = { status: r.status, firstByteMs: first ? Date.now() - t : null };
		// keep reading so the stream stays open, until aborted
		(async () => {
			try {
				while (reader && !(await reader.read()).done);
			} catch {
				/* aborted */
			}
		})();
		return out;
	} catch (e) {
		return { status: 0, error: String(e).slice(0, 80) };
	}
}

async function planner() {
	const ctx = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { origin: BASE } });
	const t = Date.now();
	try {
		await ctx.get('/');
		const r = await ctx.post('/kitchen-api/scenario', {
			data: { action: 'start' },
			timeout: 300_000
		});
		return { status: r.status(), ms: Date.now() - t };
	} catch (e) {
		return { status: 0, ms: Date.now() - t, error: String(e).slice(0, 80) };
	} finally {
		await ctx.dispose();
	}
}

const report = {
	base: BASE,
	at: new Date().toISOString(),
	baseline: await health(),
	tabs: [],
	planners: []
};
console.log('baseline healthz', JSON.stringify(report.baseline));
const stop = [];
let open = 0;
for (const n of TABS) {
	const add = n - open;
	const res = [];
	for (let i = 0; i < add; i += 25)
		res.push(
			...(await Promise.all(Array.from({ length: Math.min(25, add - i) }, () => tab(stop))))
		);
	open = n;
	const h = [await health(), await health(), await health()];
	const ok = res.filter((r) => r.status === 200).length;
	const step = {
		tabs: n,
		newOk: ok,
		newFailed: res.length - ok,
		firstByteP50: pct(
			res.map((r) => r.firstByteMs ?? 99999),
			50
		),
		healthMs: h.map((x) => x.ms),
		healthStatus: h.map((x) => x.status),
		mem: h[2].mem
	};
	report.tabs.push(step);
	console.log('tabs', JSON.stringify(step));
}
for (const n of PLANNERS) {
	const hp = health();
	const t = Date.now();
	const res = await Promise.all(Array.from({ length: n }, () => planner()));
	const h = await hp;
	const ms = res.filter((r) => r.status === 200).map((r) => r.ms);
	const step = {
		planners: n,
		withOpenTabs: open,
		ok: ms.length,
		s429: res.filter((r) => r.status === 429).length,
		s5xx: res.filter((r) => r.status >= 500).length,
		failed: res.filter((r) => r.status === 0).length,
		p50: pct(ms, 50),
		p95: pct(ms, 95),
		max: Math.max(0, ...ms),
		wallMs: Date.now() - t,
		healthMsDuring: h.ms
	};
	report.planners.push(step);
	console.log('planners', JSON.stringify(step));
}
for (const s of stop) s();
report.after = await health();
console.log('after healthz', JSON.stringify(report.after));
mkdirSync(join('scratch', 'playtest'), { recursive: true });
const file = join(
	'scratch',
	'playtest',
	`ramp-${report.at.slice(0, 19).replace(/[-:]/g, '')}.json`
);
writeFileSync(file, JSON.stringify(report, null, '\t'));
console.log(file);
process.exit(0);
