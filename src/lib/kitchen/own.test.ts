import { describe, expect, it } from 'vitest';
import { NotYet, createKitchen, withOwn, type OwnKitchen } from './own';

const k = (id: string, name = id): OwnKitchen => ({
	kitchenId: id,
	name,
	mandateWords: 'Order alone up to €500 a line.',
	copiedFrom: ''
});

describe('own kitchens', () => {
	it('keeps the newest first and replaces by id', () => {
		expect(withOwn([k('a'), k('b')], k('b', 'B2')).map((x) => x.name)).toEqual(['B2', 'a']);
	});

	it('creates a blank kitchen through /kitchen-api/kitchen', async () => {
		let sent: unknown;
		const fake = (async (_u: string, init: RequestInit) => {
			sent = JSON.parse(String(init.body));
			return new Response(
				JSON.stringify({
					kitchen: {
						kitchenId: 'k-v-abc123',
						name: 'Pasta Bar',
						kind: 'a_la_carte_restaurant',
						city: '',
						copiedFrom: '',
						mandateWords: 'w',
						weeklyCapCents: 500000,
						createdAt: '2026-11-15T00:00:00Z'
					}
				}),
				{ status: 200 }
			);
		}) as unknown as typeof fetch;
		const r = await createKitchen({ name: 'Pasta Bar' }, fake);
		expect(sent).toEqual({ name: 'Pasta Bar' });
		expect(r.kitchen.kitchenId).toBe('k-v-abc123');
	});

	it('says plainly when create_kitchen is not served yet', async () => {
		const fake = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
		await expect(createKitchen({ name: 'X' }, fake)).rejects.toBeInstanceOf(NotYet);
	});
});
