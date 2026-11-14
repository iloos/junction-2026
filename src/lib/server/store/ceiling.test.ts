/**
 * Prod rehearsal P0: one sign-off click committed €2.7M of orange juice. Above the mandate's hard limit nothing is
 * orderable, approval or not; a quantity far beyond any kitchen order is a gap ("check the quantity").
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SCOPES_BY_ACTOR, type Kitchen } from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { createHandlers } from '$lib/core/services/handlers';
import { hardLimitCents, validateLine } from '$lib/core/mandate/validate';
import { createDbPorts } from './db-ports';

type Kind = keyof typeof SCOPES_BY_ACTOR;
const ctx = (kind: Kind): CallContext => ({
	workspaceId: 'ws-demo',
	runId: 'run-1',
	actor: { kind, id: `${kind}-1` },
	scopes: SCOPES_BY_ACTOR[kind],
	via: 'test'
});
const must = <T>(
	r: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
): T => {
	if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
	return r.value;
};
const JUICE = '472817'; // Valio orange juice 1 l; KI = 5 ST, CS = 20 ST

let h: ToolHandlers;
let env: Awaited<ReturnType<typeof createDbPorts>>;
beforeEach(async () => {
	env = await createDbPorts();
	env.overlay.clear();
	h = createHandlers(env.ports);
});

describe('hard limit', () => {
	it('defaults to the larger of 5× the order cap and 2× the weekly cap', () => {
		const m = { orderCapCents: 100_000, weeklyCapCents: 400_000 } as Kitchen['mandate'];
		expect(hardLimitCents(m)).toBe(800_000);
		expect(hardLimitCents({ ...m, hardLimitCents: 50_000 })).toBe(50_000);
	});

	it('forbids the €2.7M order outright: no approval is requested and commit refuses it', async () => {
		const placed = must(
			await h.place_order(ctx('kitchen_agent'), {
				kitchenId: 'k-hotel',
				deliverBy: '2026-12-10',
				idempotencyKey: 'juice-2.7m',
				lines: [{ productId: JUICE, qty: 200_000, unit: 'KI' }]
			})
		);
		const line = placed.plan.lines[0];
		expect(line.state).toBe('unorderable');
		expect(line.reasons).toContain('over_hard_limit');
		expect(line.view).toMatchObject({
			reviewable: false,
			committable: false,
			blockedReason: { code: 'over_hard_limit', effect: 'forbid' },
			nextAction: 'resolve_rule'
		});
		expect(placed.approvalId).toBeNull();

		for (const lineIds of [undefined, [line.id]]) {
			const r = await h.commit_order(ctx('chef'), {
				planId: placed.plan.id,
				version: placed.plan.version,
				idempotencyKey: `juice-commit-${lineIds ? 'explicit' : 'default'}`,
				...(lineIds ? { lineIds } : {})
			});
			expect(r.ok).toBe(false);
		}
	});

	it('forbids an order whose lines are each under the limit but whose total is over it', async () => {
		const placed = must(
			await h.place_order(ctx('kitchen_agent'), {
				kitchenId: 'k-hotel',
				deliverBy: '2026-12-10',
				idempotencyKey: 'split-order',
				// k-hotel: order cap €1,000, weekly €4,000 → hard limit €8,000. 2 × ~€6,800 of juice.
				lines: [
					{ productId: JUICE, qty: 100, unit: 'KI' },
					{ productId: '464201', qty: 4500, unit: 'ST' }
				]
			})
		);
		expect(placed.plan.lines.every((l) => l.state === 'unorderable')).toBe(true);
		expect(placed.plan.lines.every((l) => l.reasons.includes('over_hard_limit'))).toBe(true);
		expect(placed.approvalId).toBeNull();
	});
});

describe('quantity sanity', () => {
	it('holds a quantity beyond 500 of the largest pack as a gap, never approvable', async () => {
		const products = await env.ports.catalog.get([JUICE]);
		const p = products.get(JUICE)!;
		const k = {
			mandate: { orderCapCents: 1e12, weeklyCapCents: 1e12, lineCapCents: 1e12 },
			constraints: {
				origin: [],
				allergens: { freeFrom: [], unknownCounts: 'hold' },
				tenderListOnly: false,
				labels: []
			}
		} as unknown as Kitchen;
		const offer = {
			productId: JUICE,
			price: { unitCents: 1 },
			availability: { kind: 'known', amount: null }
		} as never;
		const at = (value: number, expectedQty?: number) =>
			validateLine(k, p, offer, { value, unit: 'ST' }, { expectedQty }).map((f) => f.reason);
		expect(at(10_000)).not.toContain('qty_implausible'); // 500 cases of 20
		expect(at(10_001)).toContain('qty_implausible');
		expect(
			validateLine(k, p, offer, { value: 10_001, unit: 'ST' }).find(
				(f) => f.reason === 'qty_implausible'
			)?.effect
		).toBe('gap');
		// Serving a dish: more than 20× its need.
		expect(at(200, 10)).not.toContain('qty_implausible');
		expect(at(201, 10)).toContain('qty_implausible');
	});

	it('holds an event line edited past 20× its dish need, at quote and at commit', async () => {
		const chef = ctx('chef');
		const { plan } = must(
			await h.plan_event(chef, { kitchenId: 'k-hotel', eventId: 'event-xmas-140' })
		);
		// An in-stock line priced low enough that 25× stays under the hard limit.
		const pick = plan.lines.find(
			(l) =>
				l.state !== 'unorderable' &&
				l.offer?.availability.amount == null &&
				(l.lineCents ?? Infinity) * 25 < 800_000
		)!;
		const edit = async (p: typeof plan, value: number) =>
			must(
				await h.edit_line(chef, {
					planId: p.id,
					version: p.version,
					lineId: pick.id,
					patch: { qty: value }
				})
			).plan;
		const ok20 = await edit(plan, pick.qty.value * 20);
		expect(ok20.lines.find((l) => l.id === pick.id)!.reasons).not.toContain('qty_implausible');

		const typo = await edit(ok20, pick.qty.value * 25);
		const line = typo.lines.find((l) => l.id === pick.id)!;
		expect(line.reasons).toContain('qty_implausible');
		expect(line.view).toMatchObject({
			committable: false,
			blockedReason: { code: 'qty_implausible', effect: 'gap' }
		});
		const r = await h.commit_order(chef, {
			planId: typo.id,
			version: typo.version,
			idempotencyKey: 'typo-commit',
			lineIds: [pick.id]
		});
		expect(r.ok).toBe(false);
	});
});
