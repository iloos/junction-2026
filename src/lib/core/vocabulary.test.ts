/**
 * VOCABULARY: never show "covers" for a head count. Guests for an event, lunches or meals for a day's service, per
 * guest or per meal for sizing. Internal field names (`breakfastCovers`, `covers` on a line) may stay, and "cover" in
 * its supply sense ("not counted as cover") is a different word. This scans the copy we render from data: every
 * seed string, every tool description an agent reads, every establishment card, and the /request size check.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toolSchemas } from './contracts/tools';
import { Kitchen } from './contracts';
import { establishmentCard } from './establishment';
import kitchensSeed from '../../../fixtures/seeds/kitchens.json';

const HEADCOUNT =
	/\b\d[\d,.\s]*covers?\b|\bcovers?\s+(?:a|per)\s+day\b|\bper\s+(?:daily\s+)?cover\b|\b(?:breakfast|lunch|dinner|bistro|restaurant|daily)\s+covers?\b|\b(?:menu|guests?)\s*×\s*covers\b/i;

function strings(v: unknown, out: string[] = []): string[] {
	if (typeof v === 'string') out.push(v);
	else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
	else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
	return out;
}

const offenders = (texts: string[]) => texts.filter((t) => HEADCOUNT.test(t));

describe('no "covers" for a head count in rendered copy', () => {
	it('the pattern catches the head-count sense and leaves the supply sense alone', () => {
		expect(HEADCOUNT.test('Wednesday lunch buffet, 320 covers')).toBe(true);
		expect(HEADCOUNT.test('15.8 kg per daily cover')).toBe(true);
		expect(HEADCOUNT.test('80 bistro covers')).toBe(true);
		expect(HEADCOUNT.test('serves 380 covers a day')).toBe(true);
		expect(HEADCOUNT.test('ordered, it is not counted as cover')).toBe(false);
		expect(HEADCOUNT.test('No option covers it all under your rules')).toBe(false);
		expect(HEADCOUNT.test('Partial: covers 12 kg')).toBe(false);
	});

	it('in the seeds (event titles, kitchens, factors, histories)', () => {
		const dir = 'fixtures/seeds';
		const texts = readdirSync(dir)
			.filter((f) => f.endsWith('.json'))
			.flatMap((f) => strings(JSON.parse(readFileSync(`${dir}/${f}`, 'utf-8'))));
		expect(offenders(texts)).toEqual([]);
	});

	it('in the tool descriptions agents read', () => {
		const texts = Object.values(toolSchemas).map((t) => (t as { description: string }).description);
		expect(offenders(texts)).toEqual([]);
	});

	it('on the establishment cards', () => {
		const texts = kitchensSeed.kitchens.flatMap((k) =>
			strings(establishmentCard(Kitchen.parse(k)))
		);
		expect(offenders(texts)).toEqual([]);
	});
});
