import { describe, expect, it } from 'vitest';
import { Offer, Product, SCOPES_BY_ACTOR } from '$lib/core/contracts';
import { createHandlers } from '$lib/core/services/handlers';
import type { CallContext } from '$lib/core/ports';
import { createFixturePorts } from '../../store/fixture-ports';

const ports = createFixturePorts();
const handlers = createHandlers(ports);
const ctx = (kind: keyof typeof SCOPES_BY_ACTOR): CallContext => ({
	workspaceId: 'w1',
	runId: 'r1',
	actor: { kind, id: `${kind}-1` },
	scopes: SCOPES_BY_ACTOR[kind],
	via: 'test'
});

async function offer(id: string) {
	const r = await handlers.quote(ctx('external_agent'), { productIds: [id] });
	if (!r.ok) throw new Error(r.error.message);
	return r.value.offers[0];
}

describe('Valio catalog (fixture: cache only)', () => {
	it('normalises the hero products against the contract', async () => {
		const got = await ports.catalog.get(['462150', '462490', '463876', '464201']);
		for (const p of got.values()) expect(() => Product.parse(p)).not.toThrow();
		expect(got.get('462150')).toMatchObject({
			lotStep: 10,
			salesUnit: 'KG',
			catchWeight: true,
			origin: 'no'
		});
		expect(got.get('462490')).toMatchObject({ lotStep: 7 });
		expect(got.get('464201')?.valioSubstitutes).toEqual(['464440']);
	});

	it('maps availability to D6 kinds and keeps the raw value', async () => {
		const kinds = Object.fromEntries(
			await Promise.all(
				['462150', '462490', '462919', '462477', '464201'].map(async (id) => [
					id,
					(await offer(id)).availability
				])
			)
		);
		expect(kinds['462150']).toMatchObject({ kind: 'known', amount: 43, logisticModel: 'Stock' });
		expect(kinds['462490']).toMatchObject({ kind: 'out', amount: 0 });
		expect(kinds['462919']).toMatchObject({
			kind: 'unknown',
			amount: null,
			logisticModel: 'Terminal'
		});
		expect(kinds['462477']).toMatchObject({ kind: 'undeliverable' });
		// Valio: ≥999999 means availability unknown (orderable, never counted as known stock), on Stock too.
		expect(kinds['464201']).toMatchObject({
			kind: 'unknown',
			amount: null,
			logisticModel: 'Stock'
		});
		expect(kinds['464201'].provenance.note).toContain('≥999999 = availability unknown');
		expect(kinds['462150'].raw).toBeTruthy();
	});

	it('prices in integer cents ex VAT with the comparison basis', async () => {
		const o = Offer.parse(await offer('463876'));
		expect(o.price).toMatchObject({ unitCents: 2466, comparison: { cents: 1973, unit: 'kg' } });
		expect((await offer('464201')).price?.unitCents).toBe(156);
	});

	it('reports unknown ids as notFound without an offer', async () => {
		const r = await handlers.quote(ctx('external_agent'), { productIds: ['464201', '479999'] });
		expect(r.ok && r.value.notFound).toEqual(['479999']);
		expect(r.ok && r.value.offers.map((o) => o.productId)).toEqual(['464201']);
	});

	it('applies a simulator overlay with a simulated label', async () => {
		ports.overlay.setAvailability({
			productId: '462150',
			amount: 9,
			label: 'simulated: 34 of 43 kg committed elsewhere'
		});
		const a = (await offer('462150')).availability;
		ports.overlay.clear();
		expect(a).toMatchObject({ kind: 'known', amount: 9, provenance: { source: 'simulator' } });
	});

	it('refuses a tool outside the caller scope and invalid input', async () => {
		const r = await handlers.approve(ctx('external_agent'), {
			approvalId: 'a',
			planVersion: 0,
			termsHash: 'x',
			decision: 'grant'
		});
		expect(r.ok ? null : r.error.code).toBe('FORBIDDEN');
		const bad = await handlers.quote(ctx('chef'), { productIds: [] } as never);
		expect(bad.ok ? null : bad.error.code).toBe('INVALID_INPUT');
	});

	it('lists Valio rule candidates first', async () => {
		const c = await ports.catalog.candidates('463437');
		expect(c.slice(0, 2)).toMatchObject([
			{ productId: '462421', fromValioRule: true },
			{ productId: '464076', fromValioRule: true }
		]);
	});
});
