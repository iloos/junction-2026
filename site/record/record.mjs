// Records the landing page's case cards from the live app: each case drives app.mandate.kitchen through its real
// HTTP endpoints in a fresh visitor sandbox (its own cookie jar), and every number and product name on a card comes
// from what the app answered. Plain Node 18+, no dependencies:
//   node site/record/record.mjs [baseUrl]        → writes site/public/cases.json
// Spend: at most one Gemini parse per /request/run call (3 here) plus the buffet plan's substitute ranking. It only
// approves, orders or commits inside the sandboxes it creates, and never calls an admin or reset endpoint.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.argv[2] ?? 'https://app.mandate.kitchen').replace(/\/$/, '');
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'cases.json');

/** A visitor: one cookie jar, so the app gives it its own sandbox. */
function visitor() {
	const jar = new Map();
	return async (path, init = {}) => {
		const r = await fetch(BASE + path, {
			...init,
			redirect: 'manual',
			headers: {
				...(init.headers ?? {}),
				cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
			},
			signal: AbortSignal.timeout(120_000)
		});
		for (const c of r.headers.getSetCookie?.() ?? []) {
			const [kv] = c.split(';');
			const i = kv.indexOf('=');
			jar.set(kv.slice(0, i), kv.slice(i + 1));
		}
		const body = await r.text();
		let json = null;
		try {
			json = JSON.parse(body);
		} catch {
			/* NDJSON or HTML: the caller parses */
		}
		return { status: r.status, body, json };
	};
}

const post = (body) => ({
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify(body)
});

class Unrecordable extends Error {}
const need = (cond, msg) => {
	if (!cond) throw new Unrecordable(msg);
};

const eur = (cents) => Math.round(cents) / 100;
const num = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
const unit = (u) => ({ ST: 'packs', KG: 'kg', KI: 'cases', l: 'l', kg: 'kg' })[u] ?? u.toLowerCase();
/** "Tue 8 Dec" from an ISO date (the app's scenario dates are calendar days). */
const day = (iso) =>
	new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		timeZone: 'UTC'
	});

/** /request/run streams one NDJSON line per step, then the result. */
async function request(go, text) {
	await go('/request');
	const r = await go(
		'/request/run',
		post({ text, kitchenId: 'k-hotel', nonce: `record-${Date.now().toString(36)}` })
	);
	need(r.status === 200, `/request/run ${r.status}`);
	const lines = r.body
		.trim()
		.split('\n')
		.map((l) => JSON.parse(l));
	const last = lines.at(-1);
	need(last.step === 'result', `/request/run ended with ${last.step}: ${last.message ?? ''}`);
	return last.data;
}

// ---------------------------------------------------------------------------------------------------------------
// Cases. `claimable: false` keeps a case off the page until docs/CLAIMS.md says it may be said.

const CASES = [
	{
		id: 'out-of-stock',
		claimable: true,
		endpoints: ['GET /kitchen-api/snapshot', 'POST /kitchen-api/scenario {action:start}'],
		async run() {
			const go = visitor();
			await go('/kitchen-api/snapshot');
			const s = await go('/kitchen-api/scenario', post({ action: 'start' }));
			need(s.status === 200 && s.json?.plan, `scenario start ${s.status}`);
			const { plan, view } = s.json;
			const sub = plan.lines.find(
				(l) => l.substituteFor && l.state === 'held' && /kinkku/i.test(l.productName ?? '')
			);
			need(sub, 'no held ham substitute in the plan');
			const out = plan.lines.find(
				(l) =>
					l.productId === sub.substituteFor &&
					l.state === 'unorderable' &&
					l.reasons.includes('out')
			);
			need(out, 'the substituted product is not out of stock');
			need(sub.offer?.availability?.kind === 'known', 'the substitute is not known stock');
			const phys = sub.view.physical;
			const held = sub.reasons.includes('new_sku')
				? 'It is a new product for this kitchen, so it waits for the chef.'
				: 'It waits for the chef.';
			return {
				via: 'Started in the Kitchen',
				request: `Plan the event · ${view.title.replace(/^Christmas dinner buffet/, 'Christmas buffet')}`,
				steps: [
					{
						icon: 'search',
						text: `${out.productName} is out of stock at Valio.`
					},
					{
						icon: 'swap',
						text: `Proposed ${sub.productName}: ${num(sub.qty.value)} ${unit(sub.qty.unit)}, ${num(phys.value)} ${phys.unit}. A known-stock candidate: Valio states ${num(sub.offer.availability.amount)} in stock.`
					},
					{ icon: 'hold', text: held }
				],
				outcome: { state: 'held', label: 'Needs your approval', eur: eur(sub.lineCents) },
				link: `${BASE}/`
			};
		}
	},
	{
		id: 'contention-split',
		claimable: false, // another kitchen takes stock → split (src/lib/server/store/contention.test.ts)
		endpoints: ['POST /kitchen-api/scenario {action:contention}'],
		async run() {
			throw new Unrecordable('not claimable yet');
		}
	},
	{
		id: 'lactose-free',
		claimable: true,
		endpoints: ['POST /request/run'],
		async run() {
			const text = '10 l lactose-free milk for Friday';
			const r = await request(visitor(), text);
			const item = r.parsed.items[0];
			need(item?.constraints.includes('lactose_free'), 'lactose-free not read');
			const look = r.lookup.items[0];
			const line = r.order?.plan?.lines?.[0];
			need(line, 'nothing planned');
			need(
				r.order.plan.lines.every((l) => /laktoositon/i.test(l.productName)),
				'a planned line is not lactose-free'
			);
			need(line.state === 'eligible' && line.tier === 'act', `line is ${line.state}/${line.tier}`);
			return {
				request: text,
				steps: [
					{
						icon: 'search',
						text: `Read as ${num(item.qty)} ${item.unit} of milk that must be lactose-free, for ${day(r.parsed.deliverBy)}.`
					},
					{
						icon: 'check',
						text: `Picked ${line.productName}, ${num(look.pick.conversion.salesQty)} ${unit(look.pick.salesUnit)}. ${look.rejectedCount} catalogue matches filtered out, ${look.shortlist.length} shortlisted.`
					},
					{
						icon: 'shield',
						text: 'Inside the mandate, so it can be ordered without asking.'
					}
				],
				outcome: { state: 'within', label: 'Within your mandate', eur: eur(r.order.plan.totalCents) },
				link: `${BASE}/request`
			};
		}
	},
	{
		id: 'cut-off',
		claimable: true,
		endpoints: ['POST /request/run'],
		async run() {
			const text = '4 kg lactose-free butter for tomorrow';
			const r = await request(visitor(), text);
			const look = r.lookup.items[0];
			need(look.question && look.answer?.kind === 'date', 'no cut-off question');
			need(r.order === null, 'something was ordered');
			const item = r.parsed.items[0];
			return {
				request: text,
				steps: [
					{
						icon: 'search',
						text: `Read as ${num(item.qty)} ${item.unit} of lactose-free butter for ${day(r.parsed.deliverBy)}.`
					},
					{ icon: 'clock', text: look.question },
					{ icon: 'swap', text: `Offered: ${look.answer.label}.` }
				],
				outcome: { state: 'caught', label: 'Nothing ordered' },
				link: `${BASE}/request`
			};
		}
	},
	{
		id: 'agent-cannot-approve',
		claimable: true,
		endpoints: [
			'GET /api/demo/judge-key',
			'POST /api/tools/place_order',
			'POST /api/tools/approve',
			'POST /mcp/k/<key> tools/list',
			'GET /api/events?mode=poll'
		],
		async run() {
			const go = visitor();
			await go('/agents');
			const jk = await go('/api/demo/judge-key');
			need(jk.status === 200 && jk.json?.key, `judge key ${jk.status}`);
			const { key, mcpUrl, workspaceId } = jk.json;
			const tool = async (name, body) => {
				const r = await fetch(`${BASE}/api/tools/${name}`, {
					method: 'POST',
					headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
					body: JSON.stringify(body),
					signal: AbortSignal.timeout(60_000)
				});
				return { status: r.status, json: await r.json().catch(() => null) };
			};
			const ctx = await tool('get_context', {});
			need(ctx.status === 200, `get_context ${ctx.status}`);
			const placed = await tool('place_order', {
				kitchenId: 'k-hotel',
				deliverBy: ctx.json.scenario.delivery,
				idempotencyKey: `record-${Date.now().toString(36)}`,
				lines: [{ productId: '464201', qty: 30, unit: 'ST' }]
			});
			need(placed.status === 200 && placed.json.approvalId, `place_order ${placed.status}`);
			const plan = placed.json.plan;
			const tried = await tool('approve', {
				approvalId: placed.json.approvalId,
				planVersion: plan.version,
				termsHash: plan.termsHash,
				decision: 'grant'
			});
			need(tried.status === 403, `approve answered ${tried.status}`);

			const list = await fetch(mcpUrl, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					accept: 'application/json, text/event-stream'
				},
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
				signal: AbortSignal.timeout(60_000)
			}).then((r) => r.text());
			const data = list.includes('data: ') ? list.split('data: ')[1] : list;
			const tools = JSON.parse(data).result.tools.map((t) => t.name);
			need(!tools.includes('approve'), 'MCP lists approve');

			const ev = await go(`/api/events?ws=${workspaceId}&mode=poll`);
			const logged = JSON.stringify(ev.json ?? '').includes('RecordRefusal');
			const l = plan.lines[0];
			return {
				request: 'An outside agent tries to approve its own order',
				steps: [
					{
						icon: 'hold',
						text: `Its order (${l.productName}, ${num(l.qty.value)} ${unit(l.qty.unit)}) is held for the chef.`
					},
					{
						icon: 'shield',
						text: `It called approve itself: refused (${tried.status}).${logged ? ' Ops logs the attempt; nothing changed.' : ''}`
					},
					{
						icon: 'check',
						text: `Over MCP its key gets ${tools.length} tools, none of them approve.`
					}
				],
				outcome: { state: 'refused', label: 'Refused' },
				link: `${BASE}/agents`
			};
		}
	},
	{
		id: 'menu-recipes',
		claimable: false, // menu dishes checked against cited recipes
		endpoints: ['POST /request/menu'],
		async run() {
			throw new Unrecordable('not claimable yet');
		}
	},
	{
		id: 'one-receipt',
		claimable: true,
		endpoints: ['POST /request/run', 'POST /request/run {action:commit} ×4'],
		async run() {
			const go = visitor();
			const text = '10 l lactose-free milk for Friday';
			const r = await request(go, text);
			const plan = r.order?.plan;
			need(plan && plan.lines.every((l) => l.state === 'eligible'), 'plan not committable');
			const commits = await Promise.all(
				[1, 2, 3, 4].map((attempt) =>
					go(
						'/request/run',
						post({ action: 'commit', planId: plan.id, version: plan.version, attempt })
					)
				)
			);
			const ok = commits.filter((c) => c.status === 200 && c.json?.commit?.receiptId);
			need(ok.length === 4, `${4 - ok.length} of 4 commits failed`);
			const receipts = new Set(ok.map((c) => c.json.commit.receiptId));
			const keys = new Set(ok.map((c) => c.json.commit.idempotencyKey));
			need(keys.size === 1, 'commits used different keys');
			need(receipts.size === 1, `${receipts.size} receipts`);
			const c = ok[0].json.commit;
			const awaiting = c.awaitingSupplier.length;
			return {
				request: `${text}, then the order sent ${ok.length} times at once`,
				steps: [
					{
						icon: 'receipt',
						text: `${ok.length} sends of the same order, with one key.`
					},
					{
						icon: 'check',
						text: `${receipts.size} receipt for ${c.committedLineIds.length} line${c.committedLineIds.length === 1 ? '' : 's'}: ordered once, never twice.`
					}
				],
				outcome: {
					state: 'ordered',
					label: 'Ordered · 1 receipt',
					eur: eur(c.totalCents)
				},
				link: `${BASE}/request`
			};
		}
	}
];

// ---------------------------------------------------------------------------------------------------------------

const health = await fetch(`${BASE}/healthz`).then((r) => r.json());
const cases = [];
const failed = [];
for (const c of CASES) {
	if (!c.claimable) {
		console.log(`skip  ${c.id} (not claimable yet)`);
		continue;
	}
	try {
		const card = await c.run();
		cases.push({
			id: c.id,
			recordedAt: new Date().toISOString(),
			source: { app: BASE, endpoints: c.endpoints },
			...card
		});
		console.log(`ok    ${c.id}: ${card.outcome.label}${card.outcome.eur != null ? ` €${card.outcome.eur.toFixed(2)}` : ''}`);
	} catch (e) {
		failed.push(c.id);
		console.log(`FAIL  ${c.id}: ${e instanceof Unrecordable ? e.message : e.stack}`);
	}
}

writeFileSync(
	OUT,
	JSON.stringify(
		{ recordedAt: new Date().toISOString(), appCommit: health.commit, cases },
		null,
		'\t'
	) + '\n'
);
console.log(`wrote ${cases.length} cases to ${OUT}${failed.length ? `; failed: ${failed.join(', ')}` : ''}`);
if (failed.length) process.exitCode = 1;
