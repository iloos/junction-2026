import { describe, expect, it } from 'vitest';
import type { FulfilmentView, Line, Plan } from '$lib/core/contracts';
import rescued from '../../../fixtures/views/christmas-rescued.json';
import { whyChain } from './why-chain';

const plan = rescued as unknown as Plan;
const chainFor = (lineId: string) => {
	const line = plan.lines.find((l) => l.id === lineId)!;
	const need = plan.needs.find((n) => n.id === line.needId);
	return whyChain({
		need,
		line,
		siblings: plan.lines.filter((l) => l.needId === line.needId),
		fulfilment: plan.view!.fulfilment.find((f: FulfilmentView) => f.needId === line.needId),
		basis: (l: Line) => l.view,
		name: (id) => id
	});
};

describe('Why chain (core fixture)', () => {
	it('traces the ham substitute from dish to rule with the server numbers', () => {
		const c = chainFor('pl-run-1-c64330f1472b-need:joulukinkku-sub-476768');
		expect(c.nodes.map((n) => n.label)).toEqual([
			'Dish',
			'Portion',
			'Served',
			'Yield',
			'Replaces',
			'Product',
			'Packs',
			'Covers',
			'Price',
			'Rule'
		]);
		const v = Object.fromEntries(c.nodes.map((n) => [n.label, n.value]));
		expect(v.Served).toBe('× 140 = 18.9 kg');
		expect(v.Yield).toBe('÷ 0.7 = 27 kg to buy');
		expect(v.Packs).toBe('13 ST ≈ 19.5 kg net');
		// Served basis: 13 ST of cooked ham covers the 18.9 kg served (27 kg raw on the bone).
		expect(v.Covers).toBe('18.9 kg planned, known stock');
		expect(v.Rule).toMatch(/^Needs your approval/);
		expect(c.nodes.map((n) => n.value).join(' ')).not.toMatch(/supplier confirmed/i);
	});

	it('shows make-in-house as an AND of every ingredient', () => {
		const c = chainFor('pl-run-1-c64330f1472b-need:lanttulaatikko-mih-460879');
		expect(c.recipe?.ingredients).toHaveLength(5);
		expect(c.recipe?.ingredients.filter((g) => g.current)).toHaveLength(1);
		expect(c.recipe?.note).toMatch(/Every ingredient is required/);
		expect(c.nodes.some((n) => n.label === 'Covers')).toBe(false);
	});

	it('an act-tier line is within the mandate but not called confirmed', () => {
		const c = chainFor('pl-run-1-c64330f1472b-need:graavilohi');
		expect(c.nodes.at(-1)?.value).toBe('Within your mandate');
		expect(c.nodes.at(-1)?.detail).toMatch(/not supplier confirmed/);
	});
});
