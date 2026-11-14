/**
 * `pnpm eval`: plays evals/scenarios/*.json through the tool handlers on PGlite and reports every expect key.
 * Every scenario must pass fully, except keys listed in its `expectFail` (known gaps by finding id): they gate CI.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyExpectFail, checkExpect } from '../../../../evals/check';
import type { Scenario } from '../../../../evals/types';
import { playScenario } from './adapter';

const dir = join(process.cwd(), 'evals', 'scenarios');
const scenarios: Scenario[] = readdirSync(dir)
	.filter((f) => f.endsWith('.json'))
	.sort()
	.map((f) => JSON.parse(readFileSync(join(dir, f), 'utf-8')));

describe('evals (tool handlers on PGlite)', () => {
	for (const s of scenarios)
		it(s.id, { timeout: 30000 }, async () => {
			const results = applyExpectFail(checkExpect(s.expect, await playScenario(s)), s.expectFail);
			const known = results.filter((r) => r.detail.startsWith('expected-fail'));
			const failed = results.filter((r) => !r.pass);
			console.log(
				`${failed.length ? '✗' : '✓'} ${s.id} ${results.length - failed.length}/${results.length}` +
					failed.map((r) => `\n    ✗ ${r.key}: ${r.detail}`).join('') +
					known.map((r) => `\n    ~ ${r.key}: ${r.detail}`).join('')
			);
			expect(failed).toEqual([]);
		});
});
