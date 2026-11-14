import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { OpEnvelope } from '$lib/core/contracts';
import { applyOps, emptyState } from '$lib/core/state';
import { gatePaths, share } from './gate';

const read = (path: string) =>
	readFileSync(path, 'utf8')
		.trim()
		.split(/\r?\n/)
		.map((l) => JSON.parse(l) as OpEnvelope);
function stateOf(ops: OpEnvelope[]) {
	const r = applyOps(emptyState(ops[0].workspaceId, ops[0].runId), ops);
	if (!r.ok) throw new Error(JSON.stringify(r.error));
	return r.value;
}

describe('gate paths from what the log records', () => {
	it('the seeded buffet: nothing ordered, 14 lines waiting on a person, nothing refused', () => {
		const g = gatePaths(stateOf(read('src/routes/ops/fixtures/seeded-ops.ndjson')));
		expect(g).toEqual({ straight: 0, signed: 0, waiting: 14, refused: 0, lines: 14 });
		expect(share(g.waiting, g.lines)).toBe('100%');
	});

	it('an outside agent refused once, then the chef signed and the line was ordered', () => {
		const g = gatePaths(stateOf(read('src/lib/core/services/fixtures/ordered-ops.ndjson')));
		expect(g).toEqual({ straight: 0, signed: 1, waiting: 0, refused: 1, lines: 1 });
	});

	it('shares say "–" when nothing has been decided yet', () => {
		expect(share(0, 0)).toBe('–');
		expect(share(1, 3)).toBe('33%');
	});
});
