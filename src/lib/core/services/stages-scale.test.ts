import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { OpEnvelope } from '../contracts';
import { allOrderStages } from './stages';

/** The seeded run, cloned into `n` plans of one workspace: distinct plan ids and seqs, ops interleaved. */
function scaled(n: number): OpEnvelope[] {
	const text = readFileSync('src/routes/ops/fixtures/seeded-ops.ndjson', 'utf8').trim();
	const ops = text.split(/\r?\n/).map((l) => JSON.parse(l) as OpEnvelope);
	const planId = (ops[0].op as { plan: { id: string } }).plan.id;
	const copies = Array.from({ length: n }, (_, k) =>
		text
			.replaceAll(planId, `${planId}-x${k}`)
			.split(/\r?\n/)
			.map((l) => JSON.parse(l) as OpEnvelope)
	);
	const out: OpEnvelope[] = [];
	for (let i = 0; i < ops.length; i++)
		for (const c of copies) out.push({ ...c[i], seq: out.length + 1 });
	return out;
}

describe('order stages at scale', () => {
	it('10× the demo: every plan comes back, each with its own stages', () => {
		const stages = allOrderStages(scaled(10));
		expect(stages).toHaveLength(10);
		expect(new Set(stages.map((s) => s.planId)).size).toBe(10);
		for (const s of stages) {
			expect(s.held.lines).toBe(14);
			expect(s.proposed.changes.filter((c) => c.kind === 'substitute')).toHaveLength(1);
		}
	});

	it('one replay, not one per plan: 100 plans and 1,200 ops stay well under a second', () => {
		const ops = scaled(100);
		expect(ops).toHaveLength(1200);
		allOrderStages(ops); // warm
		const t0 = performance.now();
		const stages = allOrderStages(ops);
		const ms = performance.now() - t0;
		console.info(`[stages] 100 plans, ${ops.length} ops: ${Math.round(ms)} ms`);
		expect(stages).toHaveLength(100);
		expect(ms).toBeLessThan(1000);
	});
});
