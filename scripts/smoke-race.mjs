// Post-deploy concurrency smoke: races commits through the deployed REST API, so it proves the real container on the
// real Postgres, not just the code (pnpm test:pg proves the code against DATABASE_URL).
//   SMOKE_KEY=<kitchen_agent key> node scripts/smoke-race.mjs https://<app>   (default http://localhost:5173, key fx-kitchen-agent)
// The deploy smoke (scripts/deploy/smoke.sh) runs this when SMOKE_KEY is set, after resetting ws-smoke: the key is an
// MCP_KEYS entry `smoke:kitchen_agent:<key>:ws-smoke`, never the stage run. Each run places two small in-mandate orders
// (2 × SMOKE_PRODUCT, default 475214: a k-hotel usual product with a known stock, so the act tier commits without a
// human; a product whose stock Valio leaves unknown, such as 464201 milk, is held for one tap and can't race).
//  1. one plan, one idempotency key, 4 commits at once → every answer is the same receipt;
//  2. one plan, 3 different keys at once → exactly one receipt id across every answer (the others are refused or replay
//     that same receipt as already ordered), every line committed once.
const BASE = (process.argv[2] ?? 'http://localhost:5173').replace(/\/$/, '');
const KEY = process.env.SMOKE_KEY ?? 'fx-kitchen-agent';
const KITCHEN = process.env.SMOKE_KITCHEN ?? 'k-hotel';
const PRODUCT = process.env.SMOKE_PRODUCT ?? '475214';
const tag = `smoke-${Date.now().toString(36)}`;

async function tool(name, body) {
	const r = await fetch(`${BASE}/api/tools/${name}`, {
		method: 'POST',
		headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(30_000)
	});
	const json = await r.json().catch(() => ({}));
	return { status: r.status, ...json };
}
const fail = (msg) => {
	console.log(`FAIL: ${msg}`);
	process.exit(1);
};

async function place(key) {
	const r = await tool('place_order', {
		kitchenId: KITCHEN,
		deliverBy: process.env.SMOKE_DELIVER_BY ?? '2026-12-10',
		idempotencyKey: key,
		lines: [{ productId: PRODUCT, qty: 2, unit: 'ST' }]
	});
	if (r.error) fail(`place_order: ${r.error.code} ${r.error.message}`);
	const held = r.plan.lines.filter((l) => l.state !== 'eligible');
	if (held.length)
		fail(`expected an in-mandate plan, got ${held.map((l) => `${l.state}:${l.reasons}`)}`);
	return r.plan;
}
const commit = (plan, key) =>
	tool('commit_order', { planId: plan.id, version: plan.version, idempotencyKey: key });

// 1. Same key, four at once.
const p1 = await place(`${tag}-p1`);
const same = await Promise.all([1, 2, 3, 4].map(() => commit(p1, `${tag}-c1`)));
const ids1 = new Set(same.filter((r) => !r.error).map((r) => r.receiptId));
const errs1 = same.filter((r) => r.error).map((r) => r.error.code);
console.log(`same key ×4: receipts ${[...ids1]} errors ${errs1}`);
if (ids1.size !== 1 || errs1.length) fail('same key must return one receipt to every caller');

// 2. Different keys, three at once.
const p2 = await place(`${tag}-p2`);
const diff = await Promise.all([1, 2, 3].map((n) => commit(p2, `${tag}-c2-${n}`)));
const ids2 = new Set(diff.filter((r) => !r.error).map((r) => r.receiptId));
console.log(
	`different keys ×3: receipts ${[...ids2]}, refused ${diff.filter((r) => r.error).map((r) => r.error.code)}`
);
if (ids2.size !== 1) fail(`expected exactly one receipt, got ${ids2.size}`);
const view = await tool('get_plan', { planId: p2.id });
if (view.error) fail(`get_plan: ${view.error.code}`);
const committed = view.plan.lines.filter((l) => l.state === 'committed').length;
if (committed !== p2.lines.length) fail(`lines committed ${committed} of ${p2.lines.length}`);
console.log('OK');
