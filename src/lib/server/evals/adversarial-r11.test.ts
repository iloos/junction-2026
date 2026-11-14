/* eslint-disable @typescript-eslint/no-explicit-any -- probes reach into plan, op and UI shapes across layers */
/**
 * Adversarial regression suite, round 11 (docs/review/ROUND11-ADVERSARIAL.md; probes from scratch/round11). Every case
 * asserts the CORRECT behaviour; an open one runs as `it.fails` under its owner until fixed. `ADV_SHOW=1` runs all
 * plainly. R11-14 (the mobile chat composer) is a browser check: evals/ui/mobile-dock.e2e.ts. R11-13 (the sponsor
 * smoke) is evals/ui/services.e2e.ts. The late-cancel probe is R10-02b in adversarial-r10.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Product, ok } from '$lib/core/contracts';
import { substituteKind } from '$lib/core/demand/basekey';
import { allOrderStages, orderStages } from '$lib/core/services/stages';
import { createFixtureDb } from '$lib/server/db/pglite';
import { drizzleOpsReader } from '$lib/server/bus';
import { orderedSender } from '$lib/server/bus/ordered';
import { commitKey, committableLines } from '$lib/server/request';
import { runRequest } from '$lib/server/request/run';
import { preferenceOrder } from '$lib/server/request/rank-by';
import { createMcpEndpoint } from '$lib/server/tools/mcp';
import { stubHandlers } from '$lib/server/tools/stub-handlers';
import { PlanEvents, planOf } from '$lib/ui/shell/plan-events.svelte';
import { milks, must, prober, setup } from './adversarial-harness';

const OPEN: Record<string, string> = {
	'R11-04a': '8d',
	'R11-04b': '8d',
	'R11-10': '8d'
};
const probe = prober(it, OPEN);

let fx: Awaited<ReturnType<typeof createFixtureDb>>;
beforeAll(async () => {
	fx = await createFixtureDb();
});
afterAll(async () => {
	await fx.client.close();
});

/** Named milks for the Request probes: the first lactose-free, the second ordinary. */
const named = [
	Product.parse({ ...milks[0], nameFi: 'Valio kevytmaito laktoositon 1 l', category: '10400' }),
	Product.parse({ ...milks[1], nameFi: 'Valio kevytmaito 1 l', category: '10400' })
];

/** No order came back: the request must have asked something (a question on a looked-up item, or the run's own). */
function expectAsked(r: any, hold?: string) {
	const items: any[] = r.lookup?.items ?? [];
	const asks = [r.message, ...items.map((i) => i.question)].filter(Boolean);
	expect(
		asks.length,
		`no order and no question: ${JSON.stringify(r).slice(0, 300)}`
	).toBeGreaterThan(0);
	if (hold) expect(items.map((i) => i.hold)).toContain(hold);
}

describe('suite: adversarial (round 11: purchasing intent)', () => {
	probe(
		'R11-01',
		'"250 ml" never becomes 250 sales units: it asks, or plans a quarter litre',
		async () => {
			const s = await setup(fx.db, [named[0]]);
			const r: any = await runRequest('250 ml lactose-free milk for Thursday', {
				handlers: s.h,
				ctx: s.ctx('kitchen_agent'),
				today: '2026-12-07',
				kitchen: await s.kitchen(),
				clock: s.b.ports.clock,
				nonce: 'unsupported-unit'
			} as any);
			// Asking first is correct, as long as it really asks.
			if (!r.order) return expectAsked(r);
			const litres = r.order.plan.lines.reduce((n: number, l: any) => n + l.qty.value, 0);
			expect(litres, `planned ${litres} × 1 l for 250 ml`).toBeLessThanOrEqual(1);
		}
	);

	probe(
		'R11-02',
		'"4 packs lactose-free milk" keeps the requirement: a substitute never buys ordinary milk',
		async () => {
			const s = await setup(fx.db, named);
			const r: any = await runRequest('4 packs lactose-free milk for Thursday', {
				handlers: s.h,
				ctx: s.ctx('kitchen_agent'),
				today: '2026-12-07',
				kitchen: await s.kitchen(),
				clock: s.b.ports.clock,
				nonce: 'pack-request'
			} as any);
			expect(r.order, 'the request plans the lactose-free milk').toBeTruthy();
			const p = r.order.plan;
			await s.h.find_substitutes(s.ctx('chef'), {
				planId: p.id,
				version: p.version,
				lineId: p.lines[0].id,
				apply: true
			});
			await s.grant(p.id);
			const now = must(await s.h.get_plan(s.ctx('chef'), { planId: p.id })).plan;
			await s.h.commit_order(s.ctx('kitchen_agent'), {
				planId: p.id,
				version: now.version,
				idempotencyKey: 'pack-buy'
			});
			const bought = (await s.orders()).flatMap((o) => o.lines.map((l: any) => l.productId));
			expect(bought).not.toContain('100002');
		}
	);

	probe(
		'R11-03',
		"Request's commit after the chef approves the rest buys the rest, not the first receipt again",
		async () => {
			const s = await setup(fx.db);
			const offers = s.catalog.offers;
			s.catalog.offers = async (ids: string[], date: string) => {
				const r = await offers(ids, date);
				return {
					...r,
					offers: r.offers.map((o: any) =>
						o.productId === '100002'
							? { ...o, availability: { ...o.availability, kind: 'unknown', amount: null } }
							: o
					)
				};
			};
			const p = await s.place('request-mixed', ['100001', '100002']);
			// Commit exactly as Request's commitRequest does: the plan's committable lines now, keyed with its terms.
			const requestCommit = async () => {
				const before = must(await s.h.get_plan(s.ctx('chef'), { planId: p.id }));
				const lineIds = committableLines(before.plan, before.approval);
				if (!lineIds.length) return;
				await s.h.commit_order(s.ctx('chef'), {
					planId: p.id,
					version: before.plan.version,
					idempotencyKey: await commitKey(
						p.id,
						before.plan.version,
						before.plan.termsHash ?? null,
						lineIds
					),
					lineIds
				});
			};
			await requestCommit();
			await s.grant(p.id);
			await requestCommit();
			const bought = (await s.orders()).flatMap((o) => o.lines.map((l: any) => l.productId));
			expect(bought.sort()).toEqual(['100001', '100002']);
		}
	);

	probe(
		'R11-04a',
		'an identical commit retry returns its saved receipt during a supplier outage',
		async () => {
			const s = await setup(fx.db);
			const p = await s.place('two', ['100001', '100002']);
			const input = {
				planId: p.id,
				version: p.version,
				lineIds: [p.lines[0].id],
				idempotencyKey: 'first'
			};
			const first = must(await s.h.commit_order(s.ctx('kitchen_agent'), input));
			s.catalog.offers = async (ids: string[]) => {
				if (ids.length) throw new Error('supplier offline');
				return { offers: [], notFound: [] };
			};
			const retry = must(await s.h.commit_order(s.ctx('kitchen_agent'), input));
			expect(retry.orderId).toBe(first.orderId);
		}
	);

	probe(
		'R11-04b',
		'an identical place_order retry returns its saved plan during a supplier outage',
		async () => {
			const s = await setup(fx.db);
			const p = await s.place();
			s.catalog.offers = async () => {
				throw new Error('supplier offline');
			};
			const again = await s.place();
			expect(again.id).toBe(p.id);
		}
	);

	probe('R11-05', 'a direct need set to 0 and back to 4 l buys 4 l again', async () => {
		const s = await setup(fx.db);
		const p = await s.place();
		const zero = must(
			await s.h.edit_line(s.ctx('chef'), {
				planId: p.id,
				version: p.version,
				needId: p.needs[0].id,
				patch: { amount: { value: 0, unit: 'l' } }
			})
		).plan;
		const back = must(
			await s.h.edit_line(s.ctx('chef'), {
				planId: p.id,
				version: zero.version,
				needId: p.needs[0].id,
				patch: { amount: { value: 4, unit: 'l' } }
			})
		).plan;
		const active = back.lines.reduce((n: number, l: any) => n + l.qty.value, 0);
		expect(active).toBe(4);
	});

	probe(
		'R11-09',
		'rank by price compares what the request costs, not the price of one pack',
		() => {
			const kitchen = {
				weights: { price: 1, carbon: 0, finnish: 0, reliability: 0, organic: 0 }
			} as any;
			const product = (productId: string, kg: number) =>
				({
					productId,
					origin: 'fi',
					labels: [],
					netPerSalesUnit: { value: { value: kg, unit: 'kg' } }
				}) as any;
			const offers = new Map([
				['small', { price: { unitCents: 200, comparison: null } }],
				['large', { price: { unitCents: 1000, comparison: null } }]
			]) as any;
			// 1 kg asked: ten 100 g packs cost €20, one 1 kg pack €10.
			const order = preferenceOrder(
				'price',
				kitchen,
				[
					{ product: product('small', 0.1), qty: 10 },
					{ product: product('large', 1), qty: 1 }
				] as any,
				offers
			);
			expect(order?.[0]).toBe(1);
		}
	);

	probe(
		'R11-10',
		'cheese and goat cheese of one brand are not "another pack" of one product',
		() => {
			const a = {
				nameFi: 'Valio juusto 1 kg',
				brand: 'Valio',
				temperatureClass: 'chilled',
				category: '10500'
			} as any;
			const b = { ...a, nameFi: 'Valio vuohenjuusto 1 kg' };
			expect(substituteKind(a, b, false)).not.toBe('pack');
		}
	);
});

describe('suite: adversarial (round 11: recovery and read models)', () => {
	// The composed sender as /api/events builds it: pages of the op log ({events, complete}), retries on a failed
	// read, and onLost (close for a resync) instead of moving past a gap the log didn't rule out.
	const log = [1, 2, 3].map((seq) => ({ seq }));
	const page = (cap: number) => async (from: number) => {
		const events = log.filter((e) => e.seq > from).slice(0, cap);
		return { events, complete: log.filter((e) => e.seq > from).length <= cap };
	};
	const noWait = async () => {};

	probe('R11-06a', 'one failed gap read never loses the missing event', async () => {
		const sent: number[] = [];
		const lost: unknown[] = [];
		let fail = 1;
		const read = page(10);
		const stream = orderedSender<{ seq: number }>({
			after: 0,
			deliver: (e) => sent.push(e.seq),
			readAfter: async (from) => {
				if (fail-- > 0) throw new Error('transient database read failure');
				return read(from);
			},
			onLost: (err) => lost.push(err),
			wait: noWait
		});
		stream.push({ seq: 2 });
		await stream.idle();
		expect(lost, 'a transient failure is retried, not given up on').toEqual([]);
		expect(sent, 'the missing seq 1 is read from the log and everything goes out in order').toEqual(
			[1, 2, 3]
		);
		// A read that keeps failing gives up without passing the gap: the client reconnects from what it has.
		const sent2: number[] = [];
		const lost2: unknown[] = [];
		const dead = orderedSender<{ seq: number }>({
			after: 0,
			deliver: (e) => sent2.push(e.seq),
			readAfter: async () => {
				throw new Error('database down');
			},
			onLost: (err) => lost2.push(err),
			wait: noWait
		});
		dead.push({ seq: 2 });
		await dead.idle();
		expect(sent2, 'nothing past the gap goes out').toEqual([]);
		expect(dead.last(), 'the client keeps the seq it really has').toBe(0);
		expect(lost2.length, 'the stream closes for a resync').toBe(1);
	});

	probe('R11-06b', 'a capped catch-up read never skips the events above its cap', async () => {
		const sent: number[] = [];
		const stream = orderedSender<{ seq: number }>({
			after: 0,
			deliver: (e) => sent.push(e.seq),
			readAfter: page(2), // a page holds two: seq 3 is above the first read's cap
			onLost: () => {
				throw new Error('lost');
			},
			wait: noWait
		});
		stream.push({ seq: 4 });
		await stream.idle();
		expect(sent).toEqual([1, 2, 3, 4]);
	});

	probe(
		'R11-07a',
		'a change landing before the live feed opens reaches the page (as its ops or a re-read)',
		async () => {
			const bursts: { ops: unknown[]; resync: boolean }[] = [];
			class FakeSource {
				addEventListener() {}
				close() {}
			}
			vi.stubGlobal('EventSource', FakeSource);
			// The first poll reports seq 2 already in the log: the stream opens after it, so seq 2 never streams.
			vi.stubGlobal('fetch', async () => ({ json: async () => ({ last: 2, events: [] }) }));
			try {
				const feed = new PlanEvents();
				const off = feed.subscribe((b) => bursts.push(b));
				await new Promise((r) => setTimeout(r, 600)); // one burst window (400 ms) and margin
				off();
				expect(
					bursts.some((b) => b.resync || b.ops.length),
					'the page is told to re-read (or given the ops) once the stream opens'
				).toBe(true);
			} finally {
				vi.unstubAllGlobals();
			}
		}
	);

	probe('R11-07b', 'a recall op is routed to the plan it changes', () => {
		const op = {
			type: 'RecordAnomaly',
			anomaly: { id: 'recall', kind: 'recall', planId: 'p', productId: '100001' }
		} as any;
		expect(planOf(op)).toBe('p');
	});

	probe('R11-08', 'MCP never runs a tool it does not list', async () => {
		const was = process.env.VISION_LIVE;
		const pin = process.env.MANDATE_RUN;
		delete process.env.VISION_LIVE;
		process.env.MANDATE_RUN = 'run-1';
		let calls = 0;
		const endpoint = createMcpEndpoint(
			{
				...stubHandlers,
				read_image: async () => {
					calls++;
					return ok({ reading: { kind: 'list', lines: [], confidence: 1 } });
				}
			} as any,
			{ env: {}, dev: true } as any
		);
		const rpc = (method: string, params: object = {}) =>
			endpoint(
				new Request('http://localhost/mcp', {
					method: 'POST',
					headers: {
						authorization: 'Bearer fx-external-agent',
						'content-type': 'application/json',
						accept: 'application/json, text/event-stream',
						'mcp-protocol-version': '2025-06-18'
					},
					body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
				})
			);
		try {
			// The key works (the list has tools) and read_image is not on it, so a refused call is not an auth failure.
			const listed = await (await rpc('tools/list')).text();
			expect(listed, 'tools/list answered with tools').toMatch(/"tools"\s*:\s*\[\s*\{/);
			expect(listed, 'read_image is not listed').not.toMatch(/"name"\s*:\s*"read_image"/);
			await rpc('tools/call', {
				name: 'read_image',
				arguments: { imageBase64: 'iVBORw0KGgoAAAAA', mimeType: 'image/png' }
			});
			expect(calls).toBe(0);
		} finally {
			if (was === undefined) delete process.env.VISION_LIVE;
			else process.env.VISION_LIVE = was;
			if (pin === undefined) delete process.env.MANDATE_RUN;
			else process.env.MANDATE_RUN = pin;
		}
	});

	probe('R11-11', 'Ops never calls a kitchen-rule refusal "out of stock"', async () => {
		const s = await setup(fx.db);
		const p = must(
			await s.h.place_order(s.ctx('kitchen_agent'), {
				kitchenId: 'k-hotel',
				deliverBy: '2026-12-10',
				idempotencyKey: 'forbidden-product',
				lines: [
					{
						productId: '100002',
						qty: 4,
						unit: 'ST',
						amount: { value: 4, unit: 'l' },
						requirements: { freeFrom: ['LACTOSE'] }
					}
				]
			})
		).plan;
		expect(p.lines[0].reasons).toContain('requirement_unmet');
		const ops = await drizzleOpsReader(s.b.db as any)(s.ws, 0, 1000, 'run-1');
		const stages: any = orderStages(p.id, ops);
		const changes = stages?.proposed?.changes ?? [];
		const said = JSON.stringify(changes);
		expect(changes.length, 'Ops describes the refused line').toBeGreaterThan(0);
		expect(said).not.toMatch(/out of stock/i);
	});

	probe(
		'R11-15',
		'"250 ml milk" never buys a 5 l pack without asking: a rounding 20× the ask is a question',
		async () => {
			const tub = Product.parse({
				...milks[1],
				productId: '100009',
				nameFi: 'Valio kevytmaito 5 l',
				nameEn: 'milk 5 l',
				category: '10400',
				netPerSalesUnit: { value: { value: 5, unit: 'l' }, provenance: { source: 'seed' } }
			});
			const s = await setup(fx.db, [tub]);
			const r: any = await runRequest('250 ml milk for Thursday', {
				handlers: s.h,
				ctx: s.ctx('kitchen_agent'),
				today: '2026-12-07',
				kitchen: await s.kitchen(),
				clock: s.b.ports.clock,
				nonce: 'rounding-large'
			} as any);
			if (!r.order) return expectAsked(r, 'need_rounding_large');
			const p = r.order.plan;
			const alone = committableLines(p, r.order.approval ?? null);
			expect(
				alone,
				`ordered alone for 250 ml: ${JSON.stringify(p.lines.map((l: any) => [l.qty, l.tier ?? l.state]))}`
			).toEqual([]);
		}
	);

	probe('R11-12', 'the Ops projection reads the log once, not once per plan', async () => {
		const s = await setup(fx.db);
		for (let i = 0; i < 20; i++) await s.place(`plan-${i}`);
		const ops = await drizzleOpsReader(s.b.db as any)(s.ws, 0, 10_000, 'run-1');
		let reads = 0;
		const counted = new Proxy(ops, {
			get(t, k, r) {
				if (typeof k === 'string' && /^\d+$/.test(k)) reads++;
				return Reflect.get(t, k, r);
			}
		});
		allOrderStages(counted as any);
		// A single replay touches each op a few times; one replay per plan touches it ~20 times.
		expect(reads, `${reads} reads for ${ops.length} ops`).toBeLessThanOrEqual(5 * ops.length);
	});
});
