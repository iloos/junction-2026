// Records the landing page's case cards from the live app: each case drives app.mandate.kitchen through its real
// HTTP endpoints in a fresh visitor sandbox (its own cookie jar), and every number and product name on a card comes
// from what the app answered. Plain Node 18+, no dependencies:
//   node site/record/record.mjs [baseUrl]                  → writes site/public/cases.json
//   node site/record/record.mjs [baseUrl] --only sponsors  → re-records only `sponsors`, keeping every other key
// Besides the cards it records the landing's chain (kitchen → event → dish → ingredient → product → order): one line
// of the seeded buffet, followed from the kitchen to its receipt, in its own sandbox.
// Spend: at most one Gemini parse per /request/run call (3 here) plus the buffet plan's substitute ranking (once per
// buffet start: 3 here), and one chat turn for the plan panel (a Gemini parse, a substitute ranking, one explain
// reply), and the sponsors step's one recall-list read (Context.dev, a stored copy under an hour old is reused). It only
// approves, orders or commits inside the sandboxes it creates, and never calls an admin or reset endpoint.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ARGS = process.argv.slice(2);
const onlyAt = ARGS.indexOf('--only');
const ONLY = onlyAt >= 0 ? ARGS[onlyAt + 1] : null;
const BASE = (ARGS.find((a, i) => !a.startsWith('--') && (onlyAt < 0 || i !== onlyAt + 1)) ?? 'https://app.mandate.kitchen').replace(/\/$/, '');
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
const unit = (u) => ({ ST: 'packs', KG: 'kg', KI: 'cases', BAG: 'bags', RAS: 'boxes', PRK: 'tubs', l: 'l', kg: 'kg' })[u] ?? u.toLowerCase();
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

/**
 * Card tokens, so quantity, product and asked item read apart (the app's product token look):
 * `{ qty }` a tabular quantity such as "10 × 1 l", `{ product }` a catalogue name, `{ item }` what was asked for.
 */
function packQty(line) {
	const phys = line.view?.physical;
	const n = line.qty.value;
	const su = unit(line.qty.unit);
	if (!phys || su === phys.unit) return `${num(n)} ${su}`;
	return `${num(n)} × ${num(Math.round((phys.value / n) * 1000) / 1000)} ${phys.unit}`;
}
/** The asked line split into tokens from the parsed request: "10 l" · "lactose-free milk" · "for Friday". */
function askOf(text, item) {
	const qty = item.qty != null && item.unit ? `${num(item.qty)} ${item.unit}` : null;
	const at = text.toLowerCase().indexOf(item.query.toLowerCase());
	if (!qty || at < 0) return null;
	return { qty, item: text.slice(at, at + item.query.length), rest: text.slice(at + item.query.length).trim() };
}

/** The seeded Christmas buffet in a fresh sandbox, started as the Kitchen's "Plan the event" does. */
async function buffet(go) {
	await go('/kitchen-api/snapshot');
	const s = await go('/kitchen-api/scenario', post({ action: 'start' }));
	need(s.status === 200 && s.json?.plan, `scenario start ${s.status}`);
	const { plan, view, clock } = s.json;
	need(clock?.runId, 'scenario start has no run id');
	// The Kitchen's own rule for "Order the N lines you can now" (ApprovalPanel: view.committable).
	const eligible = plan.lines.filter((l) => l.view?.committable === true);
	// What the Kitchen sends with each tool call: the run, plan and version the screen shows.
	const shown = { runId: clock.runId, planId: plan.id, version: plan.version };
	return { plan, view, eligible, shown };
}

/** One Kitchen tool call, as the chef's screen makes it (with the x-kitchen-view header). */
const kitchenTool = (go, name, input, shown) => {
	const init = post(input);
	init.headers['x-kitchen-view'] = JSON.stringify(shown);
	return go(`/kitchen-api/tool/${name}`, init);
};

// ---------------------------------------------------------------------------------------------------------------
// Cases. `claimable: false` keeps a case off the page until docs/CLAIMS.md says it may be said.

const CASES = [
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
			need(line.state === 'held' && line.reasons.includes('UNKNOWN_REQUIRED'), `line is ${line.state} ${line.reasons}`);
			need(line.offer?.availability?.kind === 'unknown', 'availability is not unknown');
			return {
				request: text,
				ask: askOf(text, item),
				steps: [
					{
						icon: 'search',
						text: `Read as ${num(item.qty)} ${item.unit} of milk that must be lactose-free, for ${day(r.parsed.deliverBy)}.`,
						parts: [{ t: 'Read as ' }, { qty: `${num(item.qty)} ${item.unit}` }, { t: ` of milk that must be lactose-free, for ${day(r.parsed.deliverBy)}.` }]
					},
					{
						icon: 'check',
						text: `Picked ${line.productName}, ${num(look.pick.conversion.salesQty)} ${unit(look.pick.salesUnit)}. ${look.rejectedCount} catalogue matches filtered out, ${look.shortlist.length} shortlisted.`,
						parts: [{ t: 'Picked ' }, { qty: packQty(line) }, { product: line.productName }, { t: `. ${look.rejectedCount} catalogue matches filtered out, ${look.shortlist.length} shortlisted.` }]
					},
					{
						icon: 'hold',
						// The app's own words for UNKNOWN_REQUIRED (src/lib/ui/reasons.ts).
						text: "Valio doesn't state a quantity: your mandate asks before buying it."
					}
				],
				outcome: { state: 'held', label: 'Needs your approval', eur: eur(r.order.plan.totalCents) },
				link: `${BASE}/request`
			};
		}
	},
	{
		id: 'within-mandate',
		claimable: true,
		endpoints: ['POST /request/run', 'POST /request/run {action:commit}'],
		async run() {
			const go = visitor();
			const text = '10 kg salmon fillet for Friday';
			const r = await request(go, text);
			const item = r.parsed.items[0];
			const plan = r.order?.plan;
			const line = plan?.lines?.[0];
			need(line, 'nothing planned');
			need(plan.lines.every((l) => l.state === 'eligible' && l.tier === 'act'), 'not inside the mandate');
			const c = await go('/request/run', post({ action: 'commit', planId: plan.id, version: plan.version, attempt: 1 }));
			need(c.status === 200 && c.json?.commit?.receiptId, `commit ${c.status}`);
			const awaiting = c.json.commit.awaitingSupplier.length > 0;
			return {
				request: text,
				ask: askOf(text, item),
				steps: [
					{
						icon: 'check',
						text: `Picked ${line.productName}, ${packQty(line)}, a product this kitchen already buys.`,
						parts: [{ t: 'Picked ' }, { qty: packQty(line) }, { product: line.productName }, { t: ', a product this kitchen already buys.' }]
					},
					{ icon: 'shield', text: 'Inside the mandate: under the caps, Valio states the stock, nothing to sign off.' },
					{ icon: 'receipt', text: awaiting ? 'Ordered with no approval needed, on one receipt; awaiting the supplier.' : 'Ordered with no approval needed, on one receipt; supplier confirmed.' }
				],
				outcome: { state: 'ordered', label: 'Ordered within your mandate', eur: eur(c.json.commit.totalCents) },
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
						text: `Its order (${l.productName}, ${num(l.qty.value)} ${unit(l.qty.unit)}) is held for the chef.`,
						parts: [{ t: 'Its order of ' }, { qty: `${num(l.qty.value)} ${unit(l.qty.unit)}` }, { product: l.productName }, { t: ' is held for the chef.' }]
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
				ask: askOf(text, r.parsed.items[0]),
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
		id: 'one-receipt',
		claimable: true,
		endpoints: ['POST /request/run', 'POST /request/run {action:approve}', 'POST /request/run {action:commit} ×4'],
		async run() {
			const go = visitor();
			const text = '10 l lactose-free milk for Friday';
			const r = await request(go, text);
			const plan = r.order?.plan;
			const ap = r.order?.approval;
			need(plan && ap?.state === 'pending', 'no pending approval');
			const g = await go(
				'/request/run',
				post({ action: 'approve', approvalId: ap.id, planId: plan.id, planVersion: ap.planVersion, termsHash: ap.termsHash, decision: 'grant' })
			);
			need(g.status === 200, `approve ${g.status} ${g.body.slice(0, 120)}`);
			const version = g.json?.plan?.version ?? g.json?.order?.plan?.version ?? plan.version;
			const commits = await Promise.all(
				[1, 2, 3, 4].map((attempt) => go('/request/run', post({ action: 'commit', planId: plan.id, version, attempt })))
			);
			const ok = commits.filter((c) => c.status === 200 && c.json?.commit?.receiptId);
			need(ok.length === 4, `${4 - ok.length} of 4 commits failed: ${commits.map((c) => c.status).join(',')}`);
			const receipts = new Set(ok.map((c) => c.json.commit.receiptId));
			const keys = new Set(ok.map((c) => c.json.commit.idempotencyKey));
			need(keys.size === 1, 'commits used different keys');
			need(receipts.size === 1, `${receipts.size} receipts`);
			const c = ok[0].json.commit;
			const ask = askOf(text, r.parsed.items[0]);
			return {
				// Only the request was typed; what happened after it goes in the label above it.
				via: `Asked · approved by the chef · sent ${ok.length} times at once`,
				request: text,
				ask,
				steps: [
					{ icon: 'hold', text: 'The chef approves the exact terms (Approve on the request page).' },
					{ icon: 'receipt', text: `${ok.length} sends of the same order, with one key.` },
					{ icon: 'check', text: `${receipts.size} receipt: ordered once, never twice.` }
				],
				outcome: { state: 'ordered', label: 'Ordered · 1 receipt', eur: eur(c.totalCents) },
				link: `${BASE}/request`
			};
		}
	},
	{
		id: 'out-of-stock',
		claimable: true,
		endpoints: ['GET /kitchen-api/snapshot', 'POST /kitchen-api/scenario {action:start}', 'POST /kitchen-api/tool/approve (lineIds)', 'POST /kitchen-api/tool/commit_order (lineIds)'],
		async run() {
			const go = visitor();
			await go('/kitchen-api/snapshot');
			const s = await go('/kitchen-api/scenario', post({ action: 'start' }));
			need(s.status === 200 && s.json?.plan, `scenario start ${s.status}`);
			const { plan, view, clock, approval } = s.json;
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
			// The ham line's trace (need → packs → line → the chef's decision → receipt) for the /how map and /story:
			// in this same sandbox the chef approves only this line, then orders only this line.
			const shown = { runId: clock?.runId, planId: plan.id, version: plan.version };
			need(shown.runId && approval?.state === 'pending', 'no run id or pending approval');
			const needRow = plan.needs.find((x) => x.id === sub.needId);
			need(needRow?.amount, 'the ham line has no need');
			const g = await kitchenTool(
				go,
				'approve',
				{ approvalId: approval.id, planVersion: approval.planVersion, termsHash: approval.termsHash, decision: 'grant', lineIds: [sub.id] },
				shown
			);
			need(g.status === 200, `approve ${g.status} ${g.body.slice(0, 120)}`);
			const c = await kitchenTool(
				go,
				'commit_order',
				{ planId: plan.id, version: plan.version, idempotencyKey: `record-ham-${plan.id}-v${plan.version}`, lineIds: [sub.id] },
				shown
			);
			need(c.status === 200 && c.json?.receiptId, `commit_order ${c.status} ${c.body.slice(0, 120)}`);
			need(c.json.committedLineIds.length === 1 && c.json.committedLineIds[0] === sub.id, 'committed more than the ham line');
			const awaiting = (c.json.awaitingSupplier ?? []).includes(sub.id);
			const trace = {
				// The need is the raw amount (per guest × guests ÷ yield); the served amount is per guest × guests, which a
				// ready-to-serve substitute is sized on. Both come from the plan, so the trace can show 27 kg raw vs 19.5 kg bought.
				need: {
					label: needRow.label,
					value: Math.round(needRow.amount.value * 100) / 100,
					unit: needRow.amount.unit,
					perGuestG: needRow.dish?.gServed ?? null,
					guests: view.guests,
					servedKg: needRow.dish?.gServed != null ? Math.round(((needRow.dish.gServed * view.guests) / 1000) * 100) / 100 : null
				},
				bought: sub.view?.physical ? { value: sub.view.physical.value, unit: sub.view.physical.unit } : null,
				pack: { qty: packQty(sub), product: sub.productName, replaces: out.productName },
				line: { eur: eur(sub.lineCents), state: sub.state, reasons: sub.reasons, label: 'Needs your approval' },
				decision: { state: 'granted', by: 'the chef', label: 'Approved by the chef' },
				receipt: { state: awaiting ? 'awaiting supplier' : 'supplier confirmed', label: awaiting ? 'Ordered, awaiting supplier' : 'Supplier confirmed', eur: eur(c.json.totalCents) }
			};
			return {
				trace,
				via: 'Started in the Kitchen',
				request: `Plan the event · ${view.title.replace(/^Christmas dinner buffet/, 'Christmas buffet')}`,
				steps: [
					{
						icon: 'search',
						text: `${out.productName} is out of stock at Valio.`,
						parts: [{ product: out.productName }, { t: ' is out of stock at Valio.' }]
					},
					{
						icon: 'swap',
						text: `Proposed ${sub.productName}: ${num(sub.qty.value)} ${unit(sub.qty.unit)}, ${num(phys.value)} ${phys.unit}. A known-stock candidate: Valio states ${num(sub.offer.availability.amount)} in stock.`,
						parts: [{ t: 'Proposed ' }, { qty: packQty(sub) }, { product: sub.productName }, { t: `. A known-stock candidate: Valio states ${num(sub.offer.availability.amount)} in stock.` }]
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
		id: 'menu-recipes',
		claimable: false, // menu dishes checked against cited recipes
		endpoints: ['POST /request/menu'],
		async run() {
			throw new Unrecordable('not claimable yet');
		}
	},
];

// ---------------------------------------------------------------------------------------------------------------
// The chain: one line of the seeded buffet from the kitchen to its receipt. Every value comes from the scenario
// response and the commit's answer; the counts in the "decides" markers come from the same plan.

/** The chain's kitchen: the lunch restaurant, so the landing doesn't lean on the hotel buffet the cards already show. */
const CHAIN_KITCHEN = process.env.CHAIN_KITCHEN ?? 'k-lounas';

async function recordChain() {
	const go = visitor();
	await go('/kitchen-api/snapshot');
	// Switching kitchen plans that kitchen's event, as the Kitchen's kitchen picker does.
	const s = await go('/kitchen-api/scenario', post({ action: 'kitchen', value: CHAIN_KITCHEN }));
	need(s.status === 200 && s.json?.plan, `scenario start ${s.status}`);
	const { plan, view, clock, kitchen } = s.json;
	need(clock?.runId && kitchen?.name, 'scenario start has no run id or kitchen');
	const shown = { runId: clock.runId, planId: plan.id, version: plan.version };
	const eligible = plan.lines.filter((l) => l.view?.committable === true);
	need(eligible.length > 0, 'no line can be ordered now');
	const dishOf = (l) => view.dishes.find((d) => d.needId === l.needId);
	const needOf = (l) => plan.needs.find((n) => n.id === l.needId);
	// A need that is one ingredient of a dish is labelled "Riisipuuro (rice porridge): rice".
	const isIngredient = (l) => Boolean(needOf(l)?.label.includes(': '));
	// Prefer a line that is one ingredient of a dish ("Rice porridge: rice"), so dish and ingredient are two steps.
	const candidates = eligible.filter((l) => dishOf(l) && needOf(l)?.dish && l.view?.physical);
	need(candidates.length > 0, 'no eligible line serves a dish');
	// Pick first, then order only that line (commit_order's lineIds), so the card never vouches for other lines.
	const line = [...candidates].sort((a, b) => (isIngredient(a) ? 0 : 1) - (isIngredient(b) ? 0 : 1))[0];
	const r = await kitchenTool(go, 'commit_order', {
		planId: plan.id,
		version: plan.version,
		idempotencyKey: `record-chain-${plan.id}-v${plan.version}`,
		lineIds: [line.id]
	}, shown);
	need(r.status === 200 && r.json?.receiptId, `commit_order ${r.status} ${r.body.slice(0, 120)}`);
	const committed = new Set(r.json.committedLineIds);
	need(committed.size === 1 && committed.has(line.id), 'the chosen line was not the one committed');
	const awaiting = new Set(r.json.awaitingSupplier ?? []);
	const confirmed = (l) => committed.has(l.id) && !awaiting.has(l.id) && !awaiting.has(l.productId);

	const d = dishOf(line);
	const n = needOf(line);
	const [dishName, ingredient] = isIngredient(line) ? d.name.split(': ') : [d.name.split(': ')[0], null];
	const phys = line.view.physical;
	const pack = phys.value / line.qty.value;
	const held = plan.lines.filter((l) => l.state === 'held');
	const unknown = held.filter((l) => l.reasons.includes('UNKNOWN_REQUIRED'));
	// A sibling ingredient of the same dish that waits because Valio doesn't state a quantity (the porridge's milk).
	const sibling = unknown.find((l) => {
		const sd = dishOf(l);
		return sd && sd.needId !== d.needId && isIngredient(l) && sd.name.split(': ')[0] === dishName;
	});
	const siblingName = sibling ? dishOf(sibling).name.split(': ')[1] : null;
	const capEur = kitchen.mandate?.lineCapCents != null ? `€${num(kitchen.mandate.lineCapCents / 100)}` : null;
	const per = `${num(n.dish.gServed)} g`;
	const total = `${num(Math.round(n.amount.value * 100) / 100)} ${n.amount.unit}`;
	const isConfirmed = confirmed(line);
	const fictional = / \(fictional\)$/.test(kitchen.name);
	const kind = String(kitchen.kind ?? 'kitchen').replace(/_/g, ' ');
	// "Wednesday lunch buffet, 320 covers" → the head count as the title states it.
	const count = view.title.match(/, ([\d,]+ [\p{L}]+)$/u);
	const dishes = new Set(view.dishes.map((x) => x.name.split(': ')[0])).size;
	const packs = unit(line.qty.unit) === phys.unit ? '' : `${num(line.qty.value)} ${unit(line.qty.unit)} × `;
	const size = `${num(unit(line.qty.unit) === phys.unit ? phys.value : pack)} ${phys.unit}`;

	return {
		recordedAt: new Date().toISOString(),
		line: { dish: dishName, ingredient, product: line.productName, eur: eur(line.lineCents), dishes, per },
		counts: { canOrderNow: eligible.length, waiting: held.length, unknownQuantity: unknown.length },
		steps: [
			{
				key: 'kitchen',
				title: 'The kitchen',
				value: kitchen.name.replace(/ \(fictional\)$/, ''),
				text: `${fictional ? 'A fictional' : 'A'} ${kind} in ${kitchen.city}. The agent may order alone up to ${capEur ?? 'a set amount'} a line.`
			},
			{
				key: 'event',
				title: 'The event',
				// VOCABULARY: never "covers"; the head count in the words the kitchen uses for that service.
				value: `${num(view.guests)} ${/lunch|lounas/i.test(view.title) ? 'lunches' : /school|meal|koulu/i.test(view.title) ? 'meals' : 'guests'}`,
				text: `${count ? view.title.slice(0, count.index) : view.title} on ${day(view.date)}.`
			},
			{
				key: 'dish',
				title: 'The dish',
				value: dishName,
				text: `One of ${dishes} dishes on the menu, ${per} a guest.`,
				// A held ingredient of the same dish, so the marker sits on the dish, not on the line shown.
				...(sibling
					? {
							decides: {
								kind: 'unknown',
								text: `Its ${siblingName} waits for one tap: Valio doesn't state a quantity.`
							}
						}
					: {})
			},
			{
				key: 'ingredient',
				title: 'The ingredient',
				value: ingredient ? `${total} ${ingredient}` : total,
				text: `${ingredient ? `${ingredient[0].toUpperCase()}${ingredient.slice(1)}` : 'What to buy'} for ${view.guests} guests at ${per} of ${dishName.toLowerCase()} each.`
			},
			{
				key: 'product',
				title: 'The product',
				value: line.productName,
				text: `From Valio Aimo's catalogue: ${packs}${size}, €${eur(line.lineCents).toFixed(2)}.`,
				...(line.tier === 'act' && line.reasons.length === 0
					? { decides: { kind: 'rule', text: 'Inside the mandate: ordered without asking.' } }
					: {})
			},
			{
				key: 'order',
				title: 'The order',
				value: isConfirmed ? 'Supplier confirmed' : 'Ordered, awaiting supplier',
				text: 'Ordered on one receipt.',
				decides: {
					kind: 'signoff',
					text: `${eligible.length} lines can be ordered now · ${held.length} wait for the chef · ${unknown.length} of them because Valio doesn't state a quantity`
				}
			}
		]
	};
}

// ---------------------------------------------------------------------------------------------------------------
// The plan: one chat turn that plans the seeded Christmas buffet, for the /story "ask → plan → decision" panel. The
// steps, reply and guard are the chat's own words; the lines come from the same plan read back through the Kitchen
// snapshot. The chat only plans and holds: the record asserts nothing was ordered.

const PLAN_ASK = 'Plan the Christmas buffet for 140 on Saturday.';
const PLAN_ENDPOINTS = ['POST /api/chat/turn', 'GET /kitchen-api/snapshot?plan=<id>&peek=1'];

/** Supply as VOCABULARY says it: 'confirmed' only with a receipt (none before an order), else what Valio states. */
const supplyOf = (l) => {
	const k = l.offer?.availability?.kind;
	if (k === 'known') return 'known';
	if (k === 'unknown') return 'unknown';
	return 'none'; // out, undeliverable, or no offer
};

async function recordPlan() {
	const go = visitor();
	await go('/kitchen-api/snapshot');
	const t = await go('/api/chat/turn', post({ text: PLAN_ASK, kitchenId: 'k-hotel' }));
	need(t.status === 200, `/api/chat/turn ${t.status} ${t.body.slice(0, 120)}`);
	const events = t.body
		.trim()
		.split('\n')
		.map((l) => JSON.parse(l));
	const steps = events.filter((e) => e.type === 'step');
	const decision = events.find((e) => e.type === 'decision');
	const ledger = events.find((e) => e.type === 'ledger')?.ledger;
	const done = events.find((e) => e.type === 'done');
	need(done?.state === 'awaiting_chef', `the turn ended ${done?.state ?? 'without done'}`);
	need(steps.some((s) => s.tool === 'plan_event'), 'the chat did not plan the event');
	need(decision?.planId && decision.groups?.length > 0, 'the turn has no decision groups');
	need(ledger, 'the turn has no ledger');

	const s = await go(`/kitchen-api/snapshot?plan=${encodeURIComponent(decision.planId)}&peek=1`);
	need(s.status === 200 && s.json?.plan?.id === decision.planId, `snapshot of the chat's plan ${s.status}`);
	const { plan, view } = s.json;
	need(plan.version === decision.planVersion, `the plan moved on: v${plan.version}, decision on v${decision.planVersion}`);

	// Nothing ordered: no receipt, nothing committed, no order on the Kitchen's list.
	const ordered = (view.counts?.committed ?? 0) + (ledger.receiptIds?.length ?? 0) + (s.json.orders?.length ?? 0);
	need(ordered === 0 && ledger.committedCents === 0, `the chat turn ordered something (${ordered})`);
	need(ledger.decisionsLeft === decision.groups.length, `ledger says ${ledger.decisionsLeft} decisions, the card ${decision.groups.length}`);

	const held = plan.lines.filter((l) => l.state === 'held');
	const byId = new Map(plan.lines.map((l) => [l.id, l]));
	const lineOf = (l, kind, extra = {}) => ({
		kind,
		...extra,
		product: l.productName,
		qty: packQty(l),
		eur: eur(l.lineCents),
		supply: supplyOf(l),
		...(supplyOf(l) === 'known' ? { stated: l.offer.availability.amount } : {})
	});

	const ham = plan.lines.find((l) => l.substituteFor && /kinkku/i.test(l.productName ?? ''));
	need(ham, 'no ham substitute in the chat plan');
	const hamOut = plan.lines.find((l) => l.productId === ham.substituteFor && l.state === 'unorderable');
	need(hamOut?.reasons.includes('out'), 'the substituted ham is not out of stock');
	need(ham.state === 'held', `the ham substitute is ${ham.state}`);

	const unknowns = held.filter((l) => l.reasons.includes('UNKNOWN_REQUIRED'));
	// Prefer a line held only because Valio doesn't state a quantity, so the reason reads alone.
	const unknown = unknowns.find((l) => l.reasons.length === 1) ?? unknowns[0];
	need(unknown && supplyOf(unknown) === 'unknown', 'no line held for an unknown quantity');

	const inHouse = plan.lines.find((l) => l.strategy?.kind === 'make_in_house');
	const known = plan.lines.find((l) => l.state === 'eligible' && supplyOf(l) === 'known' && l.lineCents != null);
	const third = inHouse ?? known;
	need(third, 'no make-in-house or known-stock line');

	// The decision group that holds the ham swap (the chat's plan has no make-in-house group unless one is planned).
	const groupOf = (g) => decision.decisions?.find((d) => d.reason === g.reason) ?? {};
	const dishOf = (l) => view.dishes.find((d) => d.needId === l.needId);
	const groups = decision.groups.map((g) => {
		const d = groupOf(g);
		const lines = g.lineIds.map((id) => byId.get(id)).filter(Boolean);
		need(lines.length === g.lineIds.length, `a decision line is not in the plan (${g.reason})`);
		// Lines carry no allergen list; the dish's make-in-house card states the recipe's allergens.
		const mihDishes = [...new Set(lines.filter((l) => l.strategy?.kind === 'make_in_house').map(dishOf))].filter(Boolean);
		const allergens = mihDishes
			.filter((x) => x.rescue?.make?.allergenNote)
			.map((x) => ({ dish: x.nameFi ?? x.name, note: x.rescue.make.allergenNote }));
		return {
			title: d.title ?? null,
			reason: g.reason,
			why: d.why || null,
			lines: g.lineIds.length,
			eur: eur(g.totalCents),
			lineReasons: [...new Set(lines.flatMap((l) => l.reasons))],
			newProducts: lines.filter((l) => l.reasons.includes('new_sku')).length,
			...(mihDishes.length
				? { makeInHouse: mihDishes.map((x) => x.nameFi ?? x.name), ...(allergens.length ? { allergens } : {}) }
				: {})
		};
	});
	const mihGroup = groups.findIndex((g) => g.makeInHouse);
	const pick = mihGroup >= 0 ? mihGroup : decision.groups.findIndex((g) => g.lineIds.includes(ham.id));
	need(pick >= 0, 'the ham swap is in no decision group');

	// The Kitchen's proposal for an out dish with no deliverable product: make it in house. A proposal on the
	// dish card (view.dishes[].rescue.make), not a plan line, unless the chef accepts it.
	const mihDish =
		(inHouse && dishOf(inHouse)?.rescue?.make ? dishOf(inHouse) : null) ??
		view.dishes.find((d) => d.rescue?.kind === 'make_in_house' && d.rescue.make);
	const proposal = mihDish
		? {
				inPlan: plan.lines.some((l) => l.needId === mihDish.needId && l.strategy?.kind === 'make_in_house'),
				dish: mihDish.nameFi ?? mihDish.name,
				title: mihDish.rescue.make.title,
				summary: mihDish.rescue.summary ?? null,
				ingredients: mihDish.rescue.preview?.recommended?.length ?? mihDish.rescue.make.ingredients.length,
				labour: mihDish.rescue.make.labourNote ?? null,
				allergens: mihDish.rescue.make.allergenNote ?? null,
				caveats: mihDish.rescue.make.caveats ?? [],
				source: 'GET /kitchen-api/snapshot view.dishes[].rescue.make'
			}
		: null;

	const explain = steps.find((x) => x.tool === 'explain');
	const unresolved = ledger.needs
		.filter((n) => n.unresolved?.value > 0)
		.map((n) => ({ label: n.label, value: n.unresolved.value, unit: n.unresolved.unit }));

	return {
		ask: PLAN_ASK,
		source: { app: BASE, endpoints: PLAN_ENDPOINTS },
		event: {
			title: view.title,
			guests: view.guests,
			date: day(view.date),
			deliverBy: day(plan.deliverBy)
		},
		steps: steps.map((x) => ({ tool: x.tool, summary: x.summary, ...(x.source ? { source: x.source } : {}) })),
		reply: done.text,
		modelGuard: explain?.source === 'rules' && explain.detail ? explain.detail : null,
		counts: {
			dishes: new Set(view.dishes.map((x) => x.name.split(': ')[0])).size,
			lines: plan.lines.length,
			waiting: held.length,
			decisions: decision.groups.length,
			ordered
		},
		eur: eur(plan.totalCents),
		unresolved: { needs: unresolved, source: 'chat ledger: needs[].unresolved' },
		lines: [
			lineOf(ham, 'swap', { was: hamOut.productName }),
			lineOf(unknown, 'unknown'),
			inHouse ? lineOf(inHouse, 'in-house', { dish: dishOf(inHouse)?.nameFi ?? dishOf(inHouse)?.name ?? null }) : lineOf(known, 'known')
		],
		decision: groups[pick],
		decisions: groups,
		makeInHouse: proposal
	};
}

// ---------------------------------------------------------------------------------------------------------------
// Sponsors: what the live app's own health check says about each outside service, plus the recall list as the app
// reads it through Context.dev. Numbers only, as the app reported them; the landing's sponsor tiles print them with
// their time. `/healthz` counts calls in its process since the last start, over the last 15 minutes (`recent`), so a
// service with no call says so instead of a number.

const SPONSOR_SERVICES = ['valio', 'gemini', 'exa', 'contextdev'];

async function recordSponsors() {
	// The recall list first, with a judge key in a fresh sandbox (read scope; a stored copy under an hour old is reused),
	// so the health check below includes that read.
	let recallList = null;
	{
		const go = visitor();
		await go('/agents');
		const jk = await go('/api/demo/judge-key');
		need(jk.status === 200 && jk.json?.key, `judge key ${jk.status}`);
		const t0 = Date.now();
		const r = await fetch(`${BASE}/api/web/recall`, {
			method: 'POST',
			headers: { authorization: `Bearer ${jk.json.key}`, 'content-type': 'application/json' },
			body: '{}',
			signal: AbortSignal.timeout(60_000)
		});
		const j = await r.json().catch(() => null);
		if (r.status === 200 && Array.isArray(j?.recalls)) {
			const dates = j.recalls.map((x) => x.date).filter(Boolean).sort();
			recallList = {
				readAt: new Date().toISOString(),
				count: j.recalls.length,
				newest: dates.at(-1) ?? null,
				latencyMs: Date.now() - t0,
				endpoint: 'POST /api/web/recall {}'
			};
		}
	}
	const h = await fetch(`${BASE}/healthz`, { signal: AbortSignal.timeout(30_000) }).then((r) => r.json());
	need(h?.commit && Array.isArray(h.services), 'healthz has no commit or services');
	const services = {};
	for (const name of SPONSOR_SERVICES) {
		const s = h.services.find((x) => x.service === name);
		need(s, `healthz has no ${name}`);
		services[name] = {
			mode: s.mode,
			breaker: s.breaker ?? null,
			configured: s.configured ?? null,
			last: s.last ?? null,
			lastLive: s.lastLive ?? null,
			recent: s.recent ?? {},
			// The latency of the latest call when that call was sent live and answered with a timed latency; otherwise none
			// (a live call logged without its timing reports 0 ms, which is not a measurement).
			liveMs: s.last?.source === 'live' && s.last.ok && s.last.latencyMs > 0 ? s.last.latencyMs : null
		};
	}
	if (recallList) services.contextdev.recallList = { ...recallList, source: services.contextdev.last?.source ?? null };
	return {
		recordedAt: h.time ?? new Date().toISOString(),
		appCommit: h.commit,
		source: { app: BASE, endpoints: ['GET /healthz', 'POST /api/web/recall {} (judge key)'] },
		db: { ok: h.db === 'ok', latencyMs: h.latencyMs ?? null, tls: h.tls ?? null },
		services
	};
}

const sponsorLine = (sp) =>
	[
		`db ${sp.db.latencyMs} ms ${sp.db.tls}`,
		...SPONSOR_SERVICES.map((n) => `${n} ${sp.services[n].mode}${sp.services[n].liveMs != null ? ` ${sp.services[n].liveMs} ms` : ''}`),
		sp.services.contextdev.recallList ? `${sp.services.contextdev.recallList.count} recall notices` : 'no recall list'
	].join(' · ');

// ---------------------------------------------------------------------------------------------------------------

if (ONLY && ONLY !== 'sponsors') {
	console.log(`--only ${ONLY}: only "sponsors" can be recorded on its own`);
	process.exit(2);
}

if (ONLY === 'sponsors') {
	// Merge into the existing file: every other key stays as it was recorded.
	const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
	try {
		const sponsors = await recordSponsors();
		writeFileSync(OUT, JSON.stringify({ ...prev, sponsors }, null, '\t') + '\n');
		console.log(`ok    sponsors: ${sponsorLine(sponsors)}`);
		console.log(`wrote sponsors to ${OUT}`);
	} catch (e) {
		console.log(`FAIL  sponsors: ${e instanceof Unrecordable ? e.message : e.stack}`);
		process.exitCode = 1;
	}
} else {
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

	let chain = null;
	try {
		chain = { ...(await recordChain()), appCommit: health.commit };
		console.log(`ok    chain: ${chain.steps.map((s) => s.value).join(' → ')}`);
	} catch (e) {
		failed.push('chain');
		console.log(`FAIL  chain: ${e instanceof Unrecordable ? e.message : e.stack}`);
	}

	let plan = null;
	try {
		plan = { recordedAt: new Date().toISOString(), appCommit: health.commit, ...(await recordPlan()) };
		console.log(`ok    plan: ${plan.counts.lines} lines, ${plan.counts.waiting} waiting, ${plan.counts.decisions} decisions, ${plan.counts.ordered} ordered`);
	} catch (e) {
		failed.push('plan');
		console.log(`FAIL  plan: ${e instanceof Unrecordable ? e.message : e.stack}`);
	}

	let sponsors = null;
	try {
		sponsors = await recordSponsors();
		console.log(`ok    sponsors: ${sponsorLine(sponsors)}`);
	} catch (e) {
		failed.push('sponsors');
		console.log(`FAIL  sponsors: ${e instanceof Unrecordable ? e.message : e.stack}`);
	}

	writeFileSync(
		OUT,
		JSON.stringify(
			{ recordedAt: new Date().toISOString(), appCommit: health.commit, chain, plan, cases, sponsors },
			null,
			'\t'
		) + '\n'
	);
	console.log(`wrote ${cases.length} cases to ${OUT}${failed.length ? `; failed: ${failed.join(', ')}` : ''}`);
	if (failed.length) process.exitCode = 1;
}
