import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Kitchen } from './kitchen';
import { LineReason } from './plan';
import kitchens from '../../../../fixtures/seeds/kitchens.json';
import s1 from '../../../../evals/scenarios/s1-milk-over-cap.json';
import s2 from '../../../../evals/scenarios/s2-christmas-plan.json';
import s3 from '../../../../evals/scenarios/s3-salmon-below-lot.json';
import s4 from '../../../../evals/scenarios/s4-real-outages-stale-approval.json';
import s5 from '../../../../evals/scenarios/s5-external-agent-split.json';

/** Collect every `reasons` array anywhere in an eval's expect block. */
function reasonsIn(v: unknown, out: string[] = []): string[] {
	if (Array.isArray(v)) v.forEach((x) => reasonsIn(x, out));
	else if (v && typeof v === 'object')
		for (const [k, x] of Object.entries(v)) {
			if ((k === 'reasons' || k === 'historyReasons') && Array.isArray(x))
				out.push(...(x as string[]));
			else reasonsIn(x, out);
		}
	return out;
}

describe('seeds and evals match the contracts', () => {
	it('parses every seed kitchen', () => {
		expect(z.array(Kitchen).parse(kitchens.kitchens)).toHaveLength(3);
	});

	it('uses only contract reason codes in eval expectations', () => {
		const bad = [s1, s2, s3, s4, s5].flatMap((s) =>
			reasonsIn(s.expect).filter((r) => !LineReason.safeParse(r).success)
		);
		expect(bad).toEqual([]);
	});
});
