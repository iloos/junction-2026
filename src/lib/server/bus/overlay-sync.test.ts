import { describe, expect, it } from 'vitest';
import { inWorkspace, SimOverlay } from '../adapters/simulator/overlay';
import { linkOverlay, type OverlayWire } from './overlay-sync';

/** Two app processes on one database: a shared in-memory channel stands in for LISTEN/NOTIFY. */
function pair() {
	const subs: ((w: OverlayWire) => void)[] = [];
	const t = {
		send: (w: OverlayWire) => subs.forEach((f) => f(structuredClone(w))),
		listen: (fn: (w: OverlayWire) => void) => void subs.push(fn)
	};
	const a = new SimOverlay();
	const b = new SimOverlay();
	linkOverlay(a, t, 'a');
	linkOverlay(b, t, 'b');
	return { a, b };
}

describe('overlay shared across processes', () => {
	it('a shortage set on one process cuts stock on the other, in the same workspace only', () => {
		const { a, b } = pair();
		inWorkspace('ws-judges', () =>
			a.setAvailability({ productId: 'p1', amount: 5, label: 'short', tag: 'shortage' })
		);
		inWorkspace('ws-judges', () =>
			expect(b.availabilityOf('p1')).toMatchObject({ amount: 5, tag: 'shortage' })
		);
		inWorkspace('ws-other', () => expect(b.availabilityOf('p1')).toBeUndefined());
	});

	it('clears travel too, and only the tagged ones', () => {
		const { a, b } = pair();
		inWorkspace('ws-judges', () => {
			a.setAvailability({ productId: 'p1', amount: 5, label: 's', tag: 'shortage' });
			a.setAvailability({ productId: 'p2', amount: 9, label: 'c', tag: 'contention' });
		});
		inWorkspace('ws-judges', () => b.clearTagged('shortage'));
		inWorkspace('ws-judges', () => {
			expect(a.availabilityOf('p1')).toBeUndefined();
			expect(a.availabilityOf('p2')?.tag).toBe('contention');
		});
		inWorkspace('ws-judges', () => a.clear());
		inWorkspace('ws-judges', () => expect(b.availabilityOf('p2')).toBeUndefined());
	});

	it('never echoes: a process ignores its own changes coming back', () => {
		const { a } = pair();
		let applied = 0;
		const orig = a.applyRemote.bind(a);
		a.applyRemote = (op) => {
			applied += 1;
			orig(op);
		};
		inWorkspace('ws-x', () => a.setAvailability({ productId: 'p', amount: 1, label: 'x' }));
		expect(applied).toBe(0);
	});
});
