import { describe, expect, it } from 'vitest';
import { readPrefs } from './prefs';

describe('remembered request choices', () => {
	it('keeps only known values', () => {
		expect(readPrefs({ rankBy: 'price', dishOption: 'raw', usualDay: 'Thursday', x: 1 })).toEqual({
			rankBy: 'price',
			dishOption: 'raw',
			usualDay: 'Thursday'
		});
		expect(readPrefs({ rankBy: 'drop table', dishOption: 'soy', usualDay: 'Funday' })).toEqual({});
		expect(readPrefs(null)).toEqual({});
	});
});
