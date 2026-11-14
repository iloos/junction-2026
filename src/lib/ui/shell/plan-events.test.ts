import { describe, expect, it } from 'vitest';
import type { OpEnvelope } from '$lib/core/contracts';
import { describeOps } from '$lib/ui/chat/turn-view';
import { planOf, productOf } from './plan-events.svelte';

const recall = (o: { planId?: string; productId?: string }) =>
	({
		type: 'RecordAnomaly',
		anomaly: { id: 'a', kind: 'recall', message: 'm', ...o }
	}) as unknown as OpEnvelope['op'];

describe('what an op touches', () => {
	it('matches a recall by its plan, or by its product when it names no plan', () => {
		expect(planOf(recall({ planId: 'p1', productId: '476768' }))).toBe('p1');
		expect(planOf(recall({ productId: '476768' }))).toBeNull();
		expect(productOf(recall({ productId: '476768' }))).toBe('476768');
	});
	it('says a recall in one plain line', () => {
		const env = {
			seq: 1,
			at: '',
			actor: { kind: 'job', id: 'j' },
			via: 'job',
			op: recall({ planId: 'p1' })
		};
		expect(describeOps([env as unknown as OpEnvelope])).toBe(
			'A recall touches this plan: check the affected line before ordering.'
		);
	});
});
