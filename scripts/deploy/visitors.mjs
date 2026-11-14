// Load test: N fresh visitors at once, each with its own cookie jar, open the kitchen (seeds a sandbox),
// plan the event, open /ops and read their own stream. Prints latency percentiles, errors, and /healthz latency
// sampled during the load. Usage: node scripts/deploy/visitors.mjs <url> [N=30]
const BASE = process.argv[2] ?? 'http://localhost:3000';
const N = Number(process.argv[3] ?? 30);

function visitor() {
	const jar = new Map();
	return async (path, init = {}) => {
		const t = performance.now();
		const r = await fetch(BASE + path, {
			...init,
			redirect: 'manual',
			headers: {
				...(init.headers ?? {}),
				cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
			}
		});
		for (const c of r.headers.getSetCookie?.() ?? []) {
			const [kv] = c.split(';');
			const i = kv.indexOf('=');
			jar.set(kv.slice(0, i), kv.slice(i + 1));
		}
		const body = await r.text();
		return { status: r.status, ms: performance.now() - t, body, path };
	};
}

const timings = {};
const errors = [];
const note = (step, r) => {
	(timings[step] ??= []).push(r.ms);
	if (r.status >= 400) errors.push(`${step} ${r.status} ${r.body.slice(0, 120)}`);
};

let loadDone = false;
const health = [];
const sampler = (async () => {
	while (!loadDone) {
		const t = performance.now();
		const r = await fetch(BASE + '/healthz').catch(() => null);
		health.push({ ms: performance.now() - t, ok: r?.status === 200 });
		await new Promise((res) => setTimeout(res, 500));
	}
})();

const workspaces = new Set();
const t0 = performance.now();
await Promise.all(
	Array.from({ length: N }, async () => {
		const go = visitor();
		note('snapshot', await go('/kitchen-api/snapshot'));
		const start = await go('/kitchen-api/scenario', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'start' })
		});
		note('plan', start);
		let ws = '';
		try {
			ws = JSON.parse(start.body).plan?.workspaceId ?? '';
			workspaces.add(ws);
		} catch {
			/* reported as an error above */
		}
		note('ops', await go('/ops'));
		note('events', await go(`/api/events?ws=${ws}&mode=poll`));
	})
);
loadDone = true;
await sampler;

const pct = (a, p) =>
	[...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((a.length * p) / 100))];
console.log(
	`${N} visitors in ${((performance.now() - t0) / 1000).toFixed(1)} s, ${workspaces.size} distinct sandboxes`
);
for (const [k, a] of Object.entries(timings))
	console.log(
		`${k.padEnd(9)} p50 ${(pct(a, 50) / 1000).toFixed(2)} s  p95 ${(pct(a, 95) / 1000).toFixed(2)} s  max ${(Math.max(...a) / 1000).toFixed(2)} s`
	);
const hm = health.map((h) => h.ms);
console.log(
	`healthz   p50 ${(pct(hm, 50) / 1000).toFixed(2)} s  max ${(Math.max(...hm) / 1000).toFixed(2)} s  failed ${health.filter((h) => !h.ok).length}/${health.length}`
);
console.log(
	errors.length
		? `errors (${errors.length}):\n  ${errors.slice(0, 10).join('\n  ')}`
		: 'errors: none'
);
