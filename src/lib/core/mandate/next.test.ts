import { describe, expect, it } from 'vitest';
import type { Line, Plan } from '../contracts';
import { earliestDelivery } from '../scenario';
import { nextActionFor } from './next';

const MON_2140 = new Date('2026-12-07T21:40:00+02:00');
const WED_0900 = new Date('2026-12-09T09:00:00+02:00');

type View = NonNullable<Line['view']>;
function line(id: string, o: Partial<Line> & { next?: View['nextAction']; closes?: string }): Line {
	const { next = 'commit', closes = '2026-12-08T15:00:00+02:00', ...rest } = o;
	return {
		id,
		needId: 'n1',
		productId: id,
		qty: { value: 1, unit: 'KG' },
		state: 'eligible',
		tier: 'act',
		reasons: [],
		offer: {
			productId: id,
			price: null,
			availability: {
				kind: 'known',
				amount: 10,
				logisticModel: 'Terminal',
				availableDate: '2026-12-10',
				closingTime: closes,
				raw: null,
				provenance: { source: 'valio_cache' }
			}
		},
		lineCents: 100,
		view: {
			reviewable: next === 'approve',
			committable: next === 'commit',
			nextAction: next
		} as View,
		provenance: { source: 'user' },
		...rest
	} as Line;
}
const plan = (lines: Line[], needs: Plan['needs'] = []): Plan =>
	({ id: 'p', deliverBy: '2026-12-10', needs, lines }) as unknown as Plan;

describe('nextActionFor', () => {
	it('commit, with the earliest cut-off as the deadline', () => {
		const a = nextActionFor(
			plan([line('a', {}), line('b', { closes: '2026-12-09T15:00:00+02:00' })]),
			MON_2140
		);
		expect(a).toMatchObject({
			action: 'commit',
			lineIds: ['a', 'b'],
			deadline: '2026-12-08T15:00:00+02:00'
		});
		expect(a.text).toBe('2 lines can be ordered now before Tue 15:00');
	});

	it('approval comes before commit', () => {
		const a = nextActionFor(
			plan([line('a', {}), line('b', { next: 'approve', state: 'held' })]),
			MON_2140
		);
		expect(a.action).toBe('approve');
		expect(a.text).toBe('1 line needs an approval before Tue 15:00');
	});

	it('a passed cut-off asks for a later date, not a substitute', () => {
		const late = line('a', {
			next: 'find_substitute',
			reasons: ['cutoff_passed'],
			view: {
				reviewable: false,
				committable: false,
				nextAction: 'find_substitute',
				blockedReason: { code: 'cutoff_passed', effect: 'forbid' }
			} as View
		});
		const a = nextActionFor(plan([late]), WED_0900);
		expect(a).toMatchObject({ action: 'change_date', lineIds: ['a'], earliestDate: '2026-12-11' });
		expect(a.text).toContain('earliest delivery is Fri 11 Dec');
		expect(a.text).toContain('(Tue 15:00)');
	});

	it('a line that is out stays a substitute case even past its cut-off', () => {
		const out = line('a', { next: 'find_substitute', reasons: ['out', 'cutoff_passed'] });
		expect(nextActionFor(plan([out]), WED_0900).action).toBe('find_substitute');
	});

	it('an unresolved need is named', () => {
		const p = plan(
			[],
			[
				{
					id: 'n1',
					label: 'Tilli',
					amount: { value: 1, unit: 'kg' },
					unresolved: 'no dill',
					provenance: { source: 'llm' }
				}
			]
		);
		expect(nextActionFor(p, MON_2140)).toMatchObject({
			action: 'resolve_need',
			needIds: ['n1'],
			text: '1 need not covered yet: Tilli'
		});
	});

	it('committed and unconfirmed waits; nothing open is done', () => {
		const c = line('a', { state: 'committed', next: 'wait_for_supplier' });
		expect(nextActionFor(plan([c]), MON_2140).action).toBe('wait_for_supplier');
		expect(nextActionFor(plan([]), MON_2140).action).toBe('done');
	});
});

describe('earliestDelivery', () => {
	it('is the first date whose cut-off is still ahead', () => {
		expect(earliestDelivery(MON_2140, 'Stock', '15:00:00')).toBe('2026-12-09');
		expect(earliestDelivery(MON_2140, 'Terminal', '15:00:00')).toBe('2026-12-10');
		expect(earliestDelivery(new Date('2026-12-07T14:00:00+02:00'), 'Stock', '15:00:00')).toBe(
			'2026-12-08'
		);
	});
});
