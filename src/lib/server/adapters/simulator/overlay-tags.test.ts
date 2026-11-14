import { describe, expect, it } from 'vitest';
import { inWorkspace, SimOverlay } from './overlay';

describe('overlay tags (OM-7)', () => {
	it('clears only the tagged overrides of the current workspace and reads one back', () => {
		const o = new SimOverlay();
		inWorkspace('ws-a', () => {
			o.setAvailability({ productId: 'p1', amount: 9, label: 'c', tag: 'contention' });
			o.setAvailability({ productId: 'p2', amount: 3, label: 's', tag: 'shortage' });
		});
		inWorkspace('ws-b', () =>
			o.setAvailability({ productId: 'p1', amount: 1, label: 'c', tag: 'contention' })
		);
		inWorkspace('ws-a', () => o.clearTagged('shortage'));
		inWorkspace('ws-a', () => {
			expect(o.availabilityOf('p2')).toBeUndefined();
			expect(o.availabilityOf('p1')?.tag).toBe('contention');
		});
		// Another workspace's overlay is untouched.
		inWorkspace('ws-b', () => expect(o.availabilityOf('p1')?.amount).toBe(1));
	});
});
