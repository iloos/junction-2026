import { describe, expect, it } from 'vitest';
import type { ImageReading } from '$lib/core/contracts';
import { meetsBar, scoreReading } from './score';

const gold: ImageReading = {
	kind: 'list',
	lines: [
		{ text: 'Butter, unsalted 4 kg', qty: 4, unit: 'kg', productHint: 'Butter, unsalted' },
		{ text: 'Lactose-free milk 12 l', qty: 12, unit: 'l', productHint: 'Lactose-free milk' }
	],
	confidence: 0.9
} as ImageReading;
const read = (lines: ImageReading['lines'], kind: ImageReading['kind'] = 'list') =>
	({ kind, lines, confidence: 0.8 }) as ImageReading;

describe('image reading score', () => {
	it('a perfect reading scores 1 and meets the bar', () => {
		const s = scoreReading(gold, read(gold.lines));
		expect(s).toMatchObject({ kindRight: true, recall: 1, precision: 1 });
		expect(meetsBar([s, s, s])).toEqual([]);
	});

	it('a wrong unit is not a match', () => {
		const s = scoreReading(gold, read([{ ...gold.lines[0], unit: 'g' }, gold.lines[1]]));
		expect(s.recall).toBe(0.5);
	});

	it('a duplicated line counts once and the copy is a wrong line', () => {
		const s = scoreReading(gold, read([gold.lines[0], gold.lines[0]]));
		expect(s).toMatchObject({ recall: 0.5, precision: 0.5 });
	});

	it('three failed readings never meet the bar', () => {
		const e = { error: 'provider unavailable' };
		expect(meetsBar([e, e, e])).toContain('3 of 3 readings failed');
	});

	it('one failed reading, a wrong kind or low line accuracy each miss the bar', () => {
		const good = scoreReading(gold, read(gold.lines));
		expect(meetsBar([good, good, { error: 'timeout' }])).toContain('1 of 3 readings failed');
		expect(meetsBar([good, good, scoreReading(gold, read(gold.lines, 'label'))])).toContain(
			'a picture read as the wrong kind'
		);
		const poor = scoreReading(gold, read([{ text: 'Sugar 1 kg', qty: 1, unit: 'kg' }]));
		expect(meetsBar([poor, poor, poor]).length).toBeGreaterThan(0);
	});
});
