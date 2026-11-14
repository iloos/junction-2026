import { describe, expect, it } from 'vitest';
import type { OpEnvelope } from '$lib/core/contracts';
import { applyOps, emptyState } from '$lib/core/state';
import seeded from './fixtures/seeded-ops.ndjson?raw';
import { buildProblems, dishName } from './problems';
import { doorOf, storyOf } from './story';

/** The seeded Christmas run of a fresh visitor, as the op stream delivered it (bulky payloads trimmed). */
const ops = seeded
	.trim()
	.split(/\r?\n/)
	.map((l) => JSON.parse(l) as OpEnvelope);
const names: Record<string, string> = {
	'462490': 'HK Christmas ham',
	'476768': 'HK Palvikinkku',
	'462482': 'Saarioinen lanttulaatikko',
	'473317': 'Vaasan tähtitorttu'
};

function stateAfter(n = ops.length) {
	const r = applyOps(emptyState(ops[0].workspaceId, ops[0].runId), ops.slice(0, n));
	if (!r.ok) throw new Error(JSON.stringify(r.error));
	return r.value;
}

describe('problems on the seeded run', () => {
	const problems = buildProblems(stateAfter(), names, ops);
	const ham = problems.find((p) => p.id === 'outage:462490')!;

	it('states each outage as its consequence, with amount and kitchens', () => {
		expect(ham.title).toBe('Christmas ham: 28 kg short for 1 kitchen');
		expect(problems.find((p) => p.id === 'outage:462482')?.title).toBe(
			'Swede casserole: 8 packs short for 1 kitchen'
		);
		expect(problems.find((p) => p.id === 'outage:473317')?.title).toBe(
			"Prune star tart: 4 cases can't be delivered for 1 kitchen"
		);
	});

	it('says what agents already did, from the op log, and what is held', () => {
		expect(ham.already).toBe(
			'Agents already proposed HK Palvikinkku instead · waits for the chef (new product)'
		);
		expect(ham.waits).toBe('chef');
		expect(ham.heldCents).toBe(20059);
		expect(problems.find((p) => p.id === 'outage:462482')?.already).toMatch(
			/^Agents already planned it in house from 5 ingredients · waits for a named approver/
		);
	});

	it('puts outages before plain holds, and counts a rescue line once', () => {
		expect(problems.map((p) => p.kind)).toEqual(['outage', 'outage', 'outage', 'held']);
		const all = problems.flatMap((p) => p.lines.map((l) => l.lineId));
		expect(new Set(all).size).toBe(all.length);
		expect(problems.at(-1)?.already).toBe(
			'Agents already priced them on live terms and asked the chef'
		);
	});

	it('closes an outage once its rescue can be ordered', () => {
		const s = stateAfter();
		const plan = Object.values(s.plans)[0];
		const lines = plan.lines.map((l) =>
			l.productId === '476768' ? { ...l, state: 'eligible' as const } : l
		);
		const after = buildProblems({ ...s, plans: { [plan.id]: { ...plan, lines } } }, names, ops);
		expect(after.some((p) => p.id === 'outage:462490')).toBe(false);
	});

	it('shows the open outage before its substitute is proposed, as blocked', () => {
		const early = buildProblems(stateAfter(3), names, ops.slice(0, 3));
		const p = early.find((x) => x.id === 'outage:462490');
		expect(p?.tone).toBe('blocked');
		expect(p?.already).toBeNull();
	});

	it('glosses dish names in English', () => {
		expect(dishName('Joulukinkku (Christmas ham)')).toBe('Christmas ham');
		expect(dishName('Riisipuuro (rice porridge): rice')).toBe('Rice porridge');
		expect(dishName('Kalakeitto')).toBe('Kalakeitto');
	});
});

describe('the story of a problem', () => {
	const s = stateAfter();
	const problems = buildProblems(s, names, ops);
	const ham = problems.find((p) => p.id === 'outage:462490')!;
	const { steps, hidden } = storyOf(ham, ops, s, names);

	it('tells the ham case in seq order, one sentence per op that changed it', () => {
		expect(steps.map((x) => x.seq)).toEqual([...steps.map((x) => x.seq)].sort((a, b) => a - b));
		// No ISO dates or empty counts on the first screen.
		expect(steps[0].what).toBe('Started an order for Thu 10 Dec.');
		expect(steps[1]).toMatchObject({ chip: 'valio', tone: 'bad' });
		expect(steps[1].what).toBe("Valio's live terms: HK Christmas ham is out.");
		expect(steps[1].then).toBe('The plan lost its Christmas ham.');
		const propose = steps.find((x) => x.chip === 'kitchen_agent' && x.what.includes('proposed'));
		expect(propose?.what).toMatch(/proposed HK Palvikinkku\.$/);
		expect(steps.some((x) => x.what.startsWith('Asked the chef to decide'))).toBe(true);
		expect(hidden).toBe(0);
	});

	it('never writes an empty or generic sentence', () => {
		for (const p of problems)
			for (const st of storyOf(p, ops, s, names).steps) {
				expect(st.what.length).toBeGreaterThan(12);
				expect(st.then.length).toBeGreaterThan(8);
				expect(st.what).not.toMatch(/Product \d|undefined|NaN|Op recorded/);
			}
	});

	it('says a re-ask on a changed plan is a re-ask', () => {
		const held = problems.find((p) => p.kind === 'held')!;
		const asks = storyOf(held, ops, s, names).steps.filter((x) => x.what.startsWith('Asked'));
		expect(asks.length).toBeGreaterThan(1);
		expect(asks.slice(1).every((x) => x.what.includes('again'))).toBe(true);
	});

	it("shows an outside agent's refused approve as its own step", () => {
		const last = ops.at(-1)!;
		const planId = ham.lines[0].planId;
		const refusal: OpEnvelope = {
			workspaceId: last.workspaceId,
			runId: last.runId,
			seq: last.seq + 1,
			at: last.at,
			actor: { kind: 'external_agent', id: 'judge' },
			via: 'mcp',
			op: {
				type: 'RecordRefusal',
				tool: 'approve',
				code: 'FORBIDDEN',
				message: 'external_agent may not call approve (needs scope approve)',
				planId
			}
		};
		const all = [...ops, refusal];
		const after = applyOps(s, [refusal]);
		if (!after.ok) throw new Error('refusal rejected');
		expect(after.value.plans[planId]).toBe(s.plans[planId]);
		const story = storyOf(ham, all, after.value, names).steps;
		expect(story.at(-1)).toMatchObject({
			seq: refusal.seq,
			chip: 'outside',
			door: 'MCP',
			tone: 'bad',
			what: "An outside agent tried to approve on the chef's behalf."
		});
		expect(story.at(-1)!.then).toBe(
			'Refused: only the chef or a named approver can approve. Nothing changed.'
		);
	});

	it('names the door an outside agent came through from its via', () => {
		expect(doorOf('mcp')).toBe('MCP');
		expect(doorOf('rest')).toBe('API');
		expect(doorOf('kitchen')).toBeUndefined();
	});
});
