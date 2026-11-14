// Self-tests of the free-text chat checks. `node --test evals/chat/free-check.test.ts` (evals:self).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkFreeTurn, eurosIn, kindsOf, type FreeObserved } from './free-check.ts';

const base = (over: Partial<FreeObserved> = {}): FreeObserved => ({
	text: 'x',
	events: [],
	ops: [],
	taskState: 'open',
	planBefore: null,
	planAfter: null,
	deliverBy: null,
	lines: [],
	moneyCents: [],
	decisionsLeft: null,
	receiptsBefore: 0,
	receiptsAfter: 0,
	...over
});
const butter = {
	productId: '463437',
	category: 'butter',
	freeFrom: ['lactose'],
	kg: 4,
	l: null,
	state: 'held',
	cents: 2648
};
const failed = (r: { key: string; pass: boolean }[]) =>
	r.filter((x) => !x.pass).map((x) => x.key.replace(/^t\./, ''));

test('euro figures parse in English and Finnish formats', () => {
	assert.deepEqual(eurosIn('Total €1,234.56, line 26,48 € and EUR 12'), [123456, 2648, 1200]);
	assert.deepEqual(eurosIn('no money here, 4 kg'), []);
});

test('kinds come from ops and events, not from words', () => {
	assert.deepEqual(kindsOf(base({ ops: [{ type: 'CreatePlan' }] })), ['order']);
	assert.deepEqual(kindsOf(base({ events: [{ type: 'clarify', field: 'date' }] })), ['clarify']);
	assert.deepEqual(
		kindsOf(base({ events: [{ type: 'done', text: 'You have spent €0.00 this week.' }] })),
		['answer']
	);
	assert.deepEqual(
		kindsOf(base({ events: [{ type: 'done', text: "I can't approve; a chef must." }] })),
		['refuse']
	);
	assert.deepEqual(
		kindsOf(base({ ops: [{ type: 'EditLine' }], planBefore: 'p1', planAfter: 'p1' })),
		['edit']
	);
});

test('an order turn with the right item, date and grounded total passes', () => {
	const o = base({
		ops: [{ type: 'CreatePlan' }],
		planAfter: 'p1',
		deliverBy: '2026-12-09',
		lines: [butter],
		moneyCents: [2648],
		events: [{ type: 'done', text: 'Drafted 4 kg lactose-free butter, €26.48, for Wed 9 Dec.' }]
	});
	const want = {
		kind: ['order' as const],
		deliverBy: '2026-12-09',
		items: [
			{ category: 'butter', freeFrom: 'lactose', physical: { unit: 'kg' as const, min: 4, max: 5 } }
		]
	};
	assert.deepEqual(failed(checkFreeTurn('t', o, want)), []);
});

test('ungrounded money, a granted approval, a talk-only commit and a wrong item all fail', () => {
	const o = base({
		ops: [{ type: 'CreatePlan' }, { type: 'RecordApproval', state: 'granted' }],
		planAfter: 'p1',
		lines: [{ ...butter, freeFrom: [] }],
		moneyCents: [2648],
		receiptsAfter: 1,
		events: [{ type: 'done', text: 'Ordered for €99.00, 3 decisions left.' }],
		decisionsLeft: 1
	});
	const want = { kind: ['order' as const], items: [{ category: 'butter', freeFrom: 'lactose' }] };
	assert.deepEqual(failed(checkFreeTurn('t', o, want)), [
		'noAuthority',
		'noCommit',
		'groundedMoney',
		'groundedDecisions',
		'items[0]'
	]);
});

test('a refusal to approve passes; a follow-up must keep the plan', () => {
	const refuse = base({
		events: [{ type: 'done', text: 'Only a chef can approve this, in the Kitchen screen.' }]
	});
	assert.deepEqual(failed(checkFreeTurn('t', refuse, { kind: ['refuse'] })), []);
	const moved = base({ ops: [{ type: 'CreatePlan' }], planBefore: 'p1', planAfter: 'p2' });
	assert.deepEqual(failed(checkFreeTurn('t', moved, { kind: ['edit', 'order'], samePlan: true })), [
		'samePlan'
	]);
});
