import { describe, expect, it } from 'vitest';
import seed from '../../../fixtures/seeds/kitchens.json';
import { Kitchen } from './contracts';
import { deliveryDaysWords, establishmentCard } from './establishment';

const kitchens = seed.kitchens.map((k) => Kitchen.parse(k));
const card = (id: string) => establishmentCard(kitchens.find((k) => k.id === id)!);

describe('establishment cards', () => {
	it('says delivery days as a range or a list', () => {
		expect(deliveryDaysWords(['mon', 'tue', 'wed', 'thu', 'fri', 'sat'])).toBe('Mon–Sat');
		expect(deliveryDaysWords(['mon', 'wed', 'fri'])).toBe('Mon, Wed, Fri');
		expect(deliveryDaysWords(['tue', 'fri'])).toBe('Tue, Fri');
	});

	it('gives each kitchen a type, a rhythm and its top two preferences', () => {
		expect(card('k-hotel')).toMatchObject({
			name: 'Hotel Rautatientori',
			type: 'City hotel',
			rhythm: 'Deliveries Mon–Sat · 300 breakfasts, 80 bistro guests',
			prefers: 'Reliable delivery first, then price'
		});
		expect(card('k-cafe').rhythm).toBe('Deliveries Mon–Sat · 40 seats, 400 coffees a day');
	});

	it('shows hard rules, never an empty list', () => {
		expect(card('k-carehome').rules.map((r) => r.label)).toEqual([
			'Lactose-free house',
			'No product without allergen data',
			'Orders alone up to €2,500'
		]);
		expect(card('k-central').rules.map((r) => r.key)).toEqual([
			'origin_required',
			'tender_list',
			'cap'
		]);
		expect(card('k-central').rules[0].label).toBe('Finnish meat, fish, milk only');
		for (const k of kitchens) expect(establishmentCard(k).rules.length).toBeGreaterThan(0);
	});
});
