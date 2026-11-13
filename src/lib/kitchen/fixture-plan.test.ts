import { describe, expect, it } from 'vitest';
import { Plan } from '$lib/core/contracts';
import { KITCHENS } from './catalog';
import { buildEvent, rulesFor, type PresetId } from './fixture-plan';

const hotel = KITCHENS.find((k) => k.id === 'k-hotel')!;

function build(
	opts: { preset?: PresetId; grams?: Record<string, number>; contention?: boolean } = {}
) {
	return buildEvent({
		kitchen: hotel,
		rules: rulesFor(hotel, opts.preset ?? 'kitchen'),
		grams: opts.grams ?? {},
		scenario: { guests: 140, contention: opts.contention ?? false, weekSpentCents: 248_000 },
		version: 1,
		committed: {}
	});
}
const line = (b: ReturnType<typeof build>, id: string) => b.plan.lines.find((l) => l.id === id)!;

describe('fixture plan for the Christmas buffet', () => {
	it('is a valid contract Plan', () => {
		expect(() => Plan.parse(build().plan)).not.toThrow();
	});

	it('matches the seed totals with the hand-checked rescue', () => {
		// seed: 957.98 as planned; minus ham, lanttu, torttu; plus 476768 × 13 and both make-in-house baskets
		expect(build().plan.totalCents).toBe(93404);
	});

	it('rounds salmon to Valio lots, as the pitch says', () => {
		expect(line(build(), 'l-salmon').qty.rounding).toBe('11.5 kg → 2 × 10 kg lot = 20 kg');
	});

	it('recomputes the ham rescue when grams per guest change', () => {
		const sub = line(build({ grams: { ham: 120 } }), 'l-ham-sub-476768');
		expect(sub.qty.value).toBe(12);
		expect(sub.lineCents).toBe(18516);
	});

	it('never counts Terminal supply as cover', () => {
		const rosolli = line(build(), 'l-rosolli');
		expect(rosolli.reasons).toContain('unknown');
		expect(rosolli.covers?.value).toBe(0);
	});

	it('keeps out and undeliverable distinct', () => {
		const b = build();
		expect(line(b, 'l-ham').reasons).toEqual(['out']);
		expect(line(b, 'l-torttu').reasons).toEqual(['undeliverable']);
	});

	it('states the shortfall honestly when Finnish is required and stock is contended', () => {
		const ham = build({ preset: 'finnish', contention: true }).view.dishes.find(
			(d) => d.id === 'ham'
		)!;
		expect(ham.status).toBe('partial');
		expect(ham.rescue?.residual?.value).toBe(2.4);
		expect(ham.rescue?.candidates.find((c) => c.productId === '463159')?.rejected).toContain(
			'origin_required'
		);
	});
});
