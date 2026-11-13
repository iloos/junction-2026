// Self-test for the checker and the scenario files: node --test evals/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkExpect } from './check.ts';
import { loadScenarios, loadSeeds, validate } from './run.ts';
import type { EndState } from './types.ts';

const base = (): EndState => ({
	lines: [],
	orders: [],
	attempts: [],
	receipts: [],
	approvalStates: [],
	weekSpentCents: 0,
	residualShortfall: [],
	unconfirmedCover: [],
	availabilityKinds: {},
	ranking: {},
	ops: [],
	valioCallIds: [],
	why: {},
	externalAgentTools: [],
	wording: {}
});

/** The end state a correct gate should produce for s1-milk-over-cap. */
const s1Good = (): EndState => ({
	...base(),
	lines: [
		{
			productId: '464201',
			qty: 1000,
			unit: 'ST',
			state: 'committed',
			tier: 'sign_off',
			reasons: ['CAP_EXCEEDED.line', 'CAP_EXCEEDED.order'],
			priceCents: 156,
			lineCents: 156000,
			deliveryDate: '2026-11-16',
			historyStates: ['proposed', 'held', 'committed'],
			pickable: false
		},
		{ productId: '464440', state: 'rejected', reasons: ['undeliverable'], pickable: false }
	],
	attempts: [
		{
			step: 2,
			action: 'commit',
			actor: 'chef',
			idempotencyKey: 's1-commit-1',
			result: 'receipt',
			receiptId: 'r1'
		},
		{
			step: 3,
			action: 'commit',
			actor: 'chef',
			idempotencyKey: 's1-commit-1',
			result: 'receipt',
			receiptId: 'r1'
		}
	],
	receipts: [{ id: 'r1', idempotencyKey: 's1-commit-1' }],
	approvalStates: ['pending', 'granted'],
	weekSpentCents: 156000,
	ops: [
		{ op: 'CreatePlan', actor: 'chef' },
		{ op: 'RecordApproval', actor: 'approver', approvalState: 'granted' },
		{ op: 'CommitOrder', actor: 'chef' }
	],
	why: { '464201': ['request', 'match', 'price', 'availability', '1000 ST', 'sign-off'] }
});

const s1 = () => loadScenarios('s1')[0];

test('every scenario resolves its seeds and has a checker for each expect key', () => {
	const seeds = loadSeeds();
	for (const s of loadScenarios()) {
		const bad = validate(s, seeds).filter((r) => !r.pass);
		assert.deepEqual(bad, [], `${s.id}: ${JSON.stringify(bad)}`);
	}
});

test('a correct s1 end state passes every check', () => {
	const failed = checkExpect(s1().expect, s1Good()).filter((r) => !r.pass);
	assert.deepEqual(failed, []);
});

test('a second receipt for the same key fails duplicate and count checks', () => {
	const end = s1Good();
	end.receipts.push({ id: 'r2', idempotencyKey: 's1-commit-1' });
	end.attempts[1].receiptId = 'r2';
	const failed = checkExpect(s1().expect, end)
		.filter((r) => !r.pass)
		.map((r) => r.key);
	assert.deepEqual(failed.sort(), ['duplicateReceipts', 'receipts', 'sameReceiptOnRetry']);
});

test('a missing cap reason and a pickable undeliverable rule both fail', () => {
	const end = s1Good();
	end.lines[0].reasons = ['CAP_EXCEEDED.line'];
	end.lines[1].pickable = true;
	const failed = checkExpect(s1().expect, end).filter((r) => !r.pass);
	assert.ok(
		failed.some((r) => r.key === 'lines[464201]' && r.detail.includes('CAP_EXCEEDED.order'))
	);
	assert.ok(failed.some((r) => r.key === 'notProposed[464440]'));
});

test('an approval tool in the external agent scope fails s5', () => {
	const s5 = loadScenarios('s5')[0];
	const end = { ...base(), externalAgentTools: ['search', 'quote', 'place_order', 'approve'] };
	const tools = checkExpect({ tools: s5.expect.tools }, end);
	assert.ok(tools.some((r) => r.key === 'tools[approve]' && !r.pass));
});

test('an unknown expect key fails instead of passing silently', () => {
	const [r] = checkExpect({ recipts: 1 }, base());
	assert.equal(r.pass, false);
});
