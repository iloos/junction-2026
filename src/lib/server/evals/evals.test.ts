/**
 * `pnpm eval`: plays evals/scenarios/*.json through the tool handlers on PGlite and reports every expect key.
 * Scenarios listed in READY must pass fully (they gate CI); the others are reported until their slice lands.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkExpect } from '../../../../evals/check';
import type { Scenario } from '../../../../evals/types';
import { playScenario } from './adapter';

const READY = new Set(['s1-milk-over-cap', 's2-christmas-plan', 's5-external-agent-split']);
const dir = join(process.cwd(), 'evals', 'scenarios');
const scenarios: Scenario[] = readdirSync(dir)
	.filter((f) => f.endsWith('.json'))
	.sort()
	.map((f) => JSON.parse(readFileSync(join(dir, f), 'utf-8')));

describe('evals (tool handlers on PGlite)', () => {
	for (const s of scenarios)
		it(s.id, { timeout: 30000 }, async () => {
			const results = checkExpect(s.expect, await playScenario(s));
			const failed = results.filter((r) => !r.pass);
			console.log(
				`${failed.length ? '✗' : '✓'} ${s.id} ${results.length - failed.length}/${results.length}` +
					failed.map((r) => `\n    ✗ ${r.key}: ${r.detail}`).join('')
			);
			if (READY.has(s.id)) expect(failed).toEqual([]);
			else expect(results.length).toBeGreaterThan(0);
		});
});
