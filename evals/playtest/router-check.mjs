#!/usr/bin/env node
/**
 * The multi-machine router (S4): a browser is pinned to one upstream by the `mk_up` cookie, so the Kitchen's
 * per-process session state (src/lib/server/kitchen/live.ts) stays on one machine.
 *   ROUTER=https://mandate-router.example.workers.dev node evals/playtest/router-check.mjs
 * 1. sticky: N fresh browsers each make a session (plan the seeded event, read it back, approve a decision) and
 *    every response after the first says `x-mandate-upstream: pinned` to the same upstream;
 * 2. forced cross (FLIP=1, only meaningful when the upstreams run the same commit): mk_up is flipped between the
 *    plan and the read; the expected symptoms (plan not found / stale version) show why the pin matters.
 */
import { request } from '@playwright/test';

const ROUTER = process.env.ROUTER ?? 'https://mandate-router.example.workers.dev';
const N = Number(process.env.N ?? 6);
const FLIP = process.env.FLIP === '1';

const info = await (await fetch(`${ROUTER}/__router`)).json().catch(() => null);
console.log('router', JSON.stringify(info));

async function session(i, flip) {
	const ctx = await request.newContext({ baseURL: ROUTER, extraHTTPHeaders: { origin: ROUTER } });
	const seen = [];
	const step = async (name, fn) => {
		const r = await fn();
		seen.push(`${name}:${r.status()}:${r.headers()['x-mandate-upstream'] ?? '-'}`);
		return r;
	};
	try {
		await step('home', () => ctx.get('/'));
		const pin = (await ctx.storageState()).cookies.find((c) => c.name === 'mk_up')?.value ?? null;
		const s = await (
			await step('plan', () =>
				ctx.post('/kitchen-api/scenario', { data: { action: 'start' }, timeout: 120_000 })
			)
		)
			.json()
			.catch(() => ({}));
		const planId = s.plan?.id;
		if (flip && pin !== null) {
			const n = Array.isArray(info?.upstreams) ? info.upstreams.length : 2;
			const other = String((Number(pin) + 1) % n);
			const url = new URL(ROUTER);
			await ctx.addCookies([
				{
					name: 'mk_up',
					value: other,
					domain: url.hostname,
					path: '/',
					secure: true,
					httpOnly: true
				}
			]);
			seen.push(`flipped mk_up ${pin}→${other}`);
		}
		const read = await step('read', () => ctx.get(`/kitchen-api/snapshot?plan=${planId}&peek=1`));
		const snap = await read.json().catch(() => ({}));
		let approve = null;
		if (snap.approval) {
			const a = snap.approval;
			approve = await step('approve', () =>
				ctx.post('/kitchen-api/tool/approve', {
					// what the page was rendered from, as the Kitchen sends it
					headers: {
						'x-kitchen-view': JSON.stringify({
							runId: snap.plan?.runId,
							planId: snap.plan?.id,
							version: snap.plan?.version
						})
					},
					data: {
						approvalId: a.id,
						planVersion: a.planVersion,
						termsHash: a.termsHash,
						decision: 'grant',
						planId
					}
				})
			);
		}
		const ok = read.ok() && (!approve || approve.ok());
		return {
			i,
			pin,
			ok,
			plan: !!planId,
			readStatus: read.status(),
			approveStatus: approve?.status() ?? null,
			seen
		};
	} finally {
		await ctx.dispose();
	}
}

const results = [];
for (let i = 0; i < N; i++) results.push(await session(i, FLIP));
for (const r of results)
	console.log(
		`#${r.i} pin=${r.pin} ok=${r.ok} read=${r.readStatus} approve=${r.approveStatus} · ${r.seen.join(' ')}`
	);
const pins = results.map((r) => r.pin);
console.log(
	`\n${FLIP ? 'FORCED CROSS' : 'STICKY'}: ${results.filter((r) => r.ok).length}/${N} sessions whole; pins seen ${JSON.stringify([...new Set(pins)])}`
);
