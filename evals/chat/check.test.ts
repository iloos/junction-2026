// Self-tests of the chat-session checks on hand-built observations: each check must fail on the state it guards
// against and pass on the honest one. `node --test evals/chat/check.test.ts` (part of `pnpm gate`, evals:self).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkStep, checkTrial, type Observed, type TaskView } from './check.ts';

const m = (value: number, unit = 'kg') => ({ value, unit });
const need = (needId: string, confirmed = 0) => ({
	needId,
	required: m(4),
	supplierConfirmed: m(confirmed),
	awaitingSupplier: m(0),
	plannedKnown: m(4 - confirmed),
	plannedUnknown: m(0),
	unresolved: m(0)
});
const task = (over: Partial<TaskView> = {}): TaskView => ({
	id: 't1',
	state: 'open',
	requirement: { product: 'butter', qty: 4, unit: 'kg' },
	slots: {},
	plans: [{ planId: 'p1', role: 'primary' }],
	pending: { kind: 'none' },
	...over
});
const obs = (over: Partial<Observed> = {}): Observed => ({
	step: { chef: { text: '4 kg butter' } },
	events: [],
	task: task(),
	plans: [{ id: 'p1', approval: null, needs: [need('n1')] }],
	receipts: [],
	ops: [],
	...over
});
const failed = (r: { key: string; pass: boolean }[]) => r.filter((x) => !x.pass).map((x) => x.key);

test('an honest step passes every invariant', () => {
	assert.deepEqual(failed(checkStep(0, obs(), null)), []);
});

test('clarification: one question, never a held field again', () => {
	const two = obs({
		events: [
			{ type: 'clarify', field: 'date' },
			{ type: 'clarify', field: 'qty' }
		]
	});
	assert.deepEqual(failed(checkStep(0, two, null)), ['0.oneQuestion']);
	const prev = obs({ task: task({ slots: { date: '2026-12-08' } }) });
	const again = obs({ events: [{ type: 'clarify', field: 'date' }] });
	assert.deepEqual(failed(checkStep(1, again, prev)), ['1.neverReask']);
	assert.deepEqual(failed(checkStep(1, again, null, { asks: 'qty' })), ['1.asks']);
});

test('the typed requirement survives later turns', () => {
	const later = obs({ task: task({ requirement: { product: 'butter', qty: 4 } }) });
	assert.deepEqual(failed(checkStep(1, later, obs())), ['1.requirementKept']);
});

test('a chef turn never grants an approval; a human step may', () => {
	const ops = [
		{ type: 'RecordApproval', actor: 'kitchen_agent', initiatedBy: 'chef', state: 'granted' }
	];
	assert.deepEqual(failed(checkStep(0, obs({ ops }), null)), ['0.neverApproves']);
	assert.deepEqual(failed(checkStep(0, obs({ ops, step: { human: 'approve' } }), null)), []);
});

test('a pending decision must point at the live approval with a link', () => {
	const pending = {
		kind: 'decision' as const,
		approvalId: 'a1',
		planId: 'p1',
		approvalUrl: '/?plan=p1'
	};
	const live = [{ id: 'p1', approval: { id: 'a1', state: 'pending' }, needs: [need('n1')] }];
	assert.deepEqual(failed(checkStep(0, obs({ task: task({ pending }), plans: live }), null)), []);
	const voided = [{ id: 'p1', approval: { id: 'a1', state: 'voided' }, needs: [need('n1')] }];
	assert.deepEqual(failed(checkStep(0, obs({ task: task({ pending }), plans: voided }), null)), [
		'0.decisionLive'
	]);
});

test('continuation keeps the plan; a second receipt for one key is caught', () => {
	const next = obs({ task: task({ plans: [{ planId: 'p2', role: 'primary' }] }) });
	assert.deepEqual(failed(checkStep(1, next, obs(), { samePlan: true })), ['1.samePlan']);
	const r = { planId: 'p1', idempotencyKey: 'task:t1:commit:3', totalCents: 100 };
	const dup = obs({
		receipts: [
			{ ...r, id: 'r1' },
			{ ...r, id: 'r2' }
		]
	});
	assert.ok(failed(checkStep(0, dup, null)).includes('0.oneReceiptPerKey'));
});

test('truthful ledger: receipts, money, buckets and claims come from state', () => {
	const ledger = {
		needs: [{ ...need('n1'), planId: 'p1' }],
		committedCents: 0,
		receiptIds: [],
		decisionsLeft: 0
	};
	assert.deepEqual(failed(checkStep(0, obs({ task: task({ ledger }) }), null)), []);
	const said = obs({
		task: task({ ledger }),
		events: [{ type: 'done', text: 'Ordered 4 kg butter.' }]
	});
	assert.deepEqual(failed(checkStep(0, said, null)), ['0.ledger.orderedClaim']);
	const off = { ...ledger, needs: [{ ...need('n1', 4), planId: 'p1' }] };
	assert.deepEqual(failed(checkStep(0, obs({ task: task({ ledger: off }) }), null)), [
		'0.ledger.needs'
	]);
	const r = { id: 'r1', planId: 'p1', idempotencyKey: 'k', totalCents: 900 };
	const stale = obs({ task: task({ ledger }), receipts: [r] });
	assert.deepEqual(failed(checkStep(0, stale, null)), [
		'0.ledger.receipts',
		'0.ledger.committedCents'
	]);
	const confirmed = obs({
		task: task({ ledger }),
		events: [{ type: 'done', text: 'All supplier-confirmed.' }]
	});
	assert.deepEqual(failed(checkStep(0, confirmed, null)), ['0.ledger.confirmedClaim']);
	const owes = obs({
		task: task({ ledger }),
		plans: [{ id: 'p1', approval: { id: 'a', state: 'pending' }, needs: [need('n1')] }]
	});
	assert.deepEqual(failed(checkStep(0, owes, null)), ['0.ledger.decisionsLeft']);
});

test('checkTrial keys each step and applies per-step expectations', () => {
	const r = checkTrial([obs(), obs({ task: task({ state: 'done' }) })], {
		1: { taskState: 'done', samePlan: true }
	});
	assert.deepEqual(failed(r), []);
	assert.ok(r.some((x) => x.key === '1.taskState'));
});
