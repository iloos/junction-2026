/**
 * Mixed-diet splits in a brief: a share of the guests is a counted requirement, never a diet for every dish; a split
 * of the mains is a note the menu model sizes its dishes by (DishTemplate.guests).
 */
import { describe, expect, it } from 'vitest';
import { draftBrief, guestShares } from './brief';

const read = (t: string) => draftBrief(t, '2026-12-07');

describe('shares of the guests', () => {
	it('"120 guests, half vegetarian" is vegetarian for 60, not for everyone', () => {
		const d = read('Dinner for 120 guests on Friday, half vegetarian');
		expect(d.guests).toBe(120);
		expect(d.dietary).toEqual(['vegetarian:60']);
	});

	it('"50/50 meat and fish" splits the mains in a note', () => {
		const d = read('Lunch for 80 on Friday, 50/50 meat and fish');
		expect(d.notes).toContain('the mains are split: 40 meat and 40 fish');
		expect(read('Lunch for 80, half meat, half fish').notes).toContain(
			'the mains are split: 40 meat and 40 fish'
		);
	});

	it('"20 vegan, 40 vegetarian, 60 the rest" keeps both counts', () => {
		const d = read('Buffet for 120 on Saturday: 20 vegan, 40 vegetarian, 60 the rest');
		expect([...(d.dietary ?? [])].sort()).toEqual(['vegan:20', 'vegetarian:40']);
	});

	it('fractions and percentages of the guests', () => {
		expect(guestShares('a third vegan', 100).dietary).toEqual(['vegan:33']);
		expect(guestShares('25% gluten-free', 60).dietary).toEqual(['gluten-free:15']);
		expect(guestShares('2/1 meat and vegetarian', 90)).toEqual({
			dietary: ['vegetarian:30'],
			notes: ['the mains are split: 60 meat and 30 vegetarian']
		});
	});

	it('a menu-wide diet stays menu-wide', () => {
		expect(read('Dinner for 40, all vegetarian').dietary).toEqual(['vegetarian']);
	});
});
