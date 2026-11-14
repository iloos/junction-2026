import { describe, expect, it } from 'vitest';
import { addDays, weekdayOf, type Weekday } from './dates';
import { detectPatterns, usualOrder, windowRange, type HistoryLine } from './usual';

const AS_OF = '2026-12-07'; // Mon

/** Dates in [from, to) that pass `keep`. */
function dates(from: string, to: string, keep: (d: string, i: number) => boolean = () => true) {
	const out: string[] = [];
	for (let d = from, i = 0; d < to; d = addDays(d, 1), i++) if (keep(d, i)) out.push(d);
	return out;
}
const on =
	(...w: Weekday[]) =>
	(d: string) =>
		w.includes(weekdayOf(d));
const line = (productId: string, date: string, qty = 10, unit = 'ST'): HistoryLine => ({
	productId,
	date,
	qty,
	unit
});
const weeksBack = (n: number) => addDays(AS_OF, -7 * n);
/** A staple ordered on every given weekday, so those days count as open. */
const staple = (w: Weekday[], weeks = 12) =>
	dates(weeksBack(weeks), AS_OF, on(...w)).map((d) => line('staple', d, 5));

describe('detectPatterns', () => {
	it('reads a clean weekly product as every Tuesday, fully settled', () => {
		const h = dates(weeksBack(12), AS_OF, on('tue')).map((d) => line('A', d));
		const [p] = detectPatterns(h, { asOf: AS_OF });
		expect(p.period).toEqual({ kind: 'weekly', weekday: 'tue', everyWeeks: 1 });
		expect(p.status).toBe('settled');
		expect(p.seen).toEqual({ k: 12, n: 12 });
		expect(p.qty).toMatchObject({ median: 10, spread: 0 });
		expect(p.score).toBe(1);
		expect(p.sentence).toBe('seen 12 of the last 12 Tuesdays');
	});

	it('reads Mon–Fri as five weekday rhythms and nothing on the weekend', () => {
		const h = dates(weeksBack(12), AS_OF, on('mon', 'tue', 'wed', 'thu', 'fri')).map((d) =>
			line('milk', d, 30)
		);
		const ps = detectPatterns(h, { asOf: AS_OF });
		expect(ps.map((p) => (p.period.kind === 'weekly' ? p.period.weekday : '?')).sort()).toEqual([
			'fri',
			'mon',
			'thu',
			'tue',
			'wed'
		]);
		expect(ps.every((p) => p.status === 'settled')).toBe(true);
		expect(usualOrder({ lines: h, deliveryDate: '2026-12-08', asOf: AS_OF }).lines).toHaveLength(1);
		const sat = usualOrder({ lines: h, deliveryDate: '2026-12-12', asOf: AS_OF });
		expect(sat.lines).toHaveLength(0);
		expect(sat.sentence).toBe('Nothing usually comes on Saturdays in the last 12 weeks.');
	});

	it('reads every other Wednesday, and puts it only on the right Wednesdays', () => {
		const odd = dates(weeksBack(12), AS_OF, (d, i) => on('wed')(d) && Math.floor(i / 7) % 2 === 0);
		const h = [...staple(['wed']), ...odd.map((d) => line('B', d, 4))];
		const b = detectPatterns(h, { asOf: AS_OF }).find((p) => p.productId === 'B')!;
		expect(b.period).toEqual({ kind: 'weekly', weekday: 'wed', everyWeeks: 2 });
		expect(b.status).toBe('settled');
		expect(b.sentence).toMatch(/^every other Wednesday: seen 6 of the last 6$/);
		const last = odd[odd.length - 1];
		const due = addDays(last, 14);
		const off = addDays(last, 7);
		const ids = (date: string) =>
			usualOrder({ lines: h, deliveryDate: date, asOf: AS_OF }).lines.map((l) => l.productId);
		expect(ids(due)).toContain('B');
		expect(ids(off)).not.toContain('B');
	});

	it('reads a monthly order around the same day of the month', () => {
		const window = { n: 6, unit: 'months' as const };
		const h = [
			...staple(['mon', 'tue', 'wed', 'thu', 'fri'], 26),
			...['2026-06-02', '2026-07-02', '2026-08-03', '2026-09-02', '2026-10-02', '2026-11-02'].map(
				(d) => line('C', d, 3, 'KI')
			)
		];
		const c = detectPatterns(h, { asOf: AS_OF, window }).find((p) => p.productId === 'C')!;
		expect(c.period).toEqual({ kind: 'monthly', day: 2, everyMonths: 1 });
		expect(c.status).toBe('settled');
		expect(c.sentence).toMatch(/^monthly, around the 2nd: seen \d of the last \d months$/);
		const days: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
		const at = (date: string) =>
			usualOrder({ lines: h, deliveryDate: date, asOf: AS_OF, window, deliveryDays: days }).lines;
		// Wed 2 Dec 2026 is a receiving day: due there, not on Thu 3 Dec.
		expect(at('2026-12-02').map((l) => l.productId)).toContain('C');
		expect(at('2026-12-03').map((l) => l.productId)).not.toContain('C');
	});

	it('reads a steady gap of days as every n days', () => {
		const h = [
			...staple(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
			...dates(weeksBack(12), AS_OF, (_, i) => i % 10 === 0).map((d) => line('D', d))
		];
		const d = detectPatterns(h, { asOf: AS_OF }).find((p) => p.productId === 'D')!;
		expect(d.period).toEqual({ kind: 'every_n_days', days: 10 });
		expect(d.status).toBe('settled');
	});

	it('keeps a noisy weekly product settled, with its quantity spread', () => {
		const qty = [30, 34, 28, 31, 40, 29, 33, 27, 35, 30, 32, 31];
		const tues = dates(weeksBack(12), AS_OF, on('tue'));
		const h = [
			...staple(['tue']),
			...tues.filter((_, i) => i !== 3 && i !== 8).map((d, i) => line('E', d, qty[i]))
		];
		const e = detectPatterns(h, { asOf: AS_OF }).find((p) => p.productId === 'E')!;
		expect(e.status).toBe('settled');
		expect(e.seen).toEqual({ k: 10, n: 12 });
		expect(e.sentence).toBe('seen 10 of the last 12 Tuesdays');
		expect(e.qty.median).toBe(30);
		expect(e.qty.low).toBeLessThan(e.qty.high);
		expect(e.score).toBeGreaterThan(0.6);
		expect(e.score).toBeLessThan(0.83);
	});

	it('skips a week the kitchen was closed (a holiday gap) instead of counting a miss', () => {
		const closed = (d: string) => d >= '2026-10-12' && d <= '2026-10-16';
		const h = dates(weeksBack(12), AS_OF, (d) => on('mon', 'wed')(d) && !closed(d)).flatMap((d) => [
			line('milk', d, 40),
			line('butter', d, 6)
		]);
		const milk = detectPatterns(h, { asOf: AS_OF }).filter((p) => p.productId === 'milk');
		expect(milk.map((p) => p.seen)).toEqual([
			{ k: 11, n: 11 },
			{ k: 11, n: 11 }
		]);
		expect(milk.every((p) => p.status === 'settled')).toBe(true);
	});

	it('says "not settled yet" on too short a history', () => {
		const h = dates(weeksBack(2), AS_OF, on('tue')).map((d) => line('F', d));
		const [p] = detectPatterns(h, { asOf: AS_OF });
		expect(p.status).toBe('not_settled');
		expect(p.sentence).toBe('not settled yet: seen 2 times so far (every Tuesday)');
		const u = usualOrder({ lines: h, deliveryDate: '2026-12-08', asOf: AS_OF });
		expect(u.settled).toBe(false);
		expect(u.lines).toHaveLength(0);
		expect(u.notSettled.map((c) => c.productId)).toEqual(['F']);
		expect(u.sentence).toMatch(/^Not settled yet: \d+ days of history\.$/);
	});

	it('lists a product that joined recently and one that dropped out', () => {
		const tues = dates(weeksBack(12), AS_OF, on('tue'));
		const h = [
			...staple(['tue']),
			...tues.slice(-3).map((d) => line('new', d, 6)),
			...tues.slice(0, 7).map((d) => line('old', d, 8))
		];
		const u = usualOrder({ lines: h, deliveryDate: '2026-12-08', asOf: AS_OF });
		expect(u.lines.map((l) => l.productId)).toEqual(['staple']);
		expect(u.joined).toMatchObject([{ productId: 'new', qty: 6, dueOnDay: true }]);
		expect(u.joined[0].sentence).toMatch(/^joined Tue 17 Nov: on 3 of 3 Tuesdays since$/);
		expect(u.dropped).toMatchObject([{ productId: 'old', dueOnDay: true }]);
		expect(u.dropped[0].sentence).toMatch(
			/^dropped: last ordered Tue \d+ \w+, every Tuesday before that$/
		);
	});

	it('lets an explicit period win over detection, per product or per kitchen', () => {
		const h = [
			...staple(['tue']),
			...dates(weeksBack(12), AS_OF, on('tue')).map((d) => line('G', d))
		];
		const g = detectPatterns(h, {
			asOf: AS_OF,
			overrides: { products: { G: { every: 2, unit: 'weeks' } } }
		}).find((p) => p.productId === 'G')!;
		expect(g.source).toBe('override');
		expect(g.period).toEqual({ kind: 'weekly', weekday: 'tue', everyWeeks: 2 });
		expect(g.sentence).toMatch(/^set to every other Tuesday: /);
		// The chef's "every week" keeps an every-other-week product in the order (forming, 6 of 12).
		const odd = dates(weeksBack(12), AS_OF, (d, i) => on('tue')(d) && Math.floor(i / 7) % 2 === 0);
		const k = [...staple(['tue']), ...odd.map((d) => line('K', d))];
		const kp = detectPatterns(k, {
			asOf: AS_OF,
			overrides: { products: { K: { every: 1, unit: 'weeks' } } }
		}).find((p) => p.productId === 'K')!;
		expect(kp.status).toBe('forming');
		const all = detectPatterns(h, {
			asOf: AS_OF,
			overrides: { kitchen: { every: 7, unit: 'days' } }
		});
		expect(all.every((p) => p.source === 'override' && p.period.kind === 'every_n_days')).toBe(
			true
		);
	});

	it('caps the window at about six months and defaults to 12 weeks', () => {
		expect(windowRange(AS_OF).days).toBe(84);
		expect(windowRange(AS_OF, { n: 12, unit: 'months' }).days).toBe(184);
		expect(windowRange(AS_OF, { n: 30, unit: 'days' })).toEqual({
			from: '2026-11-07',
			to: AS_OF,
			days: 30
		});
	});

	it('ignores lines on or after asOf', () => {
		const h = [line('H', AS_OF), line('H', addDays(AS_OF, 7))];
		expect(detectPatterns(h, { asOf: AS_OF })).toEqual([]);
	});
});
