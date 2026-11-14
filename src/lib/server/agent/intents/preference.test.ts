import { describe, expect, it } from 'vitest';
import type { Product, RankBy, ToolOutput } from '$lib/core/contracts';
import { presetWeights, sortByPreference } from '$lib/core/rank/presets';
import { scenarioDate } from '$lib/core/scenario';
import { byPreference, preferenceNote } from '../loop';
import type { OfferFacts, RoutineCandidate } from '../routine';
import { trialWorkspace } from '../trial-harness';
import { FIDELITY_NOW } from '../../evals/fidelity';
import { chatTurn } from '../../chat/turn';
import { preferenceSentence, readPreference } from './preference';

describe('readPreference (EN + FI)', () => {
	it.each([
		['Order 4 kg butter for Friday, cheapest', 'price'],
		['Halvin voi 4 kg perjantaiksi', 'price'],
		['lowest carbon cream for the buffet', 'carbon'],
		['vähähiilisin kerma', 'carbon'],
		['prefer Finnish salmon', 'finnish'],
		['lohta, mieluiten kotimaista', 'finnish'],
		['most reliable milk supplier please', 'reliability'],
		['luotettavin toimitus', 'reliability']
	])('%s → %s', (text, want) => {
		expect(readPreference(text)?.rankBy).toBe(want);
	});

	it('reads nothing from plain requests, and flags an asked requirement without setting one', () => {
		expect(readPreference('Order 4 kg butter for Friday')).toBeNull();
		expect(readPreference('Finnish butter 4 kg')).toBeNull();
		const must = readPreference('salmon, must be Finnish');
		expect(must).toMatchObject({ rankBy: 'finnish', requirementAsked: true });
		const names = { price: 'p', carbon: 'c', finnish: 'f', reliability: 'r' };
		expect(preferenceSentence(must!, [], names)).toContain('chef’s mandate rule');
	});
});

describe('presets', () => {
	it('makes the preferred criterion dominant and keeps the kitchen’s other weights', () => {
		expect(presetWeights({ price: 0.4, finnish: 0.3, carbon: 0.3 }, 'carbon')).toEqual({
			price: 0.4,
			finnish: 0.3,
			carbon: 2.0999999999999996
		});
		expect(presetWeights({ price: 1 }, 'default')).toEqual({ price: 1 });
		expect(presetWeights({}, 'reliability')).toEqual({ reliability: 1 });
	});

	it('sorts static hits by carbon, origin or reliability; unknown last; price keeps relevance order', () => {
		const p = (id: string, x: Partial<Product>) => ({ productId: id, ...x }) as Product;
		const hits = [
			p('a', { co2PerKg: { value: 3, provenance: { source: 'seed' } }, origin: 'SE' }),
			p('b', { origin: 'FI', reliability: 0.9 }),
			p('c', { co2PerKg: { value: 1, provenance: { source: 'seed' } }, reliability: 0.5 })
		];
		const ids = (r: RankBy) => sortByPreference(hits, r).map((x) => x.productId);
		expect(ids('carbon')).toEqual(['c', 'a', 'b']);
		expect(ids('finnish')).toEqual(['b', 'a', 'c']);
		expect(ids('reliability')).toEqual(['b', 'c', 'a']);
		expect(ids('price')).toEqual(['a', 'b', 'c']);
	});
});

describe('routine choice under a preference', () => {
	const c = (id: string, x: Partial<RoutineCandidate> = {}): RoutineCandidate => ({
		productId: id,
		name: id.toUpperCase(),
		unit: 'KG',
		salesQty: 2,
		amount: { value: 4, unit: 'kg' },
		conversion: '',
		...x
	});
	const offers = new Map<string | undefined, OfferFacts>([
		['a', { productId: 'a', unitCents: 900 }],
		['b', { productId: 'b', unitCents: 700 }]
	]);

	it('picks the cheaper buyable candidate and says what changed', () => {
		const cands = [c('a'), c('b')];
		const picked = byPreference(cands, offers, 'price');
		expect(picked[0].productId).toBe('b');
		expect(preferenceNote(cands[0], picked[0], offers, 'price')).toBe(
			'Picked B over A: cheaper (€14.00 vs €18.00)'
		);
		expect(byPreference(cands, offers, undefined)).toBe(cands);
		expect(preferenceNote(cands[0], cands[0], offers, 'price')).toBeNull();
	});

	it('never favours an unknown value', () => {
		const picked = byPreference([c('a'), c('b', { co2PerKg: 2 })], offers, 'carbon');
		expect(picked.map((x) => x.productId)).toEqual(['b', 'a']);
	});
});

describe('a preference never changes tiers or exclusions', () => {
	it(
		'find_substitutes: the same candidates are excluded for the same reasons under every preset',
		{ timeout: 120_000 },
		async () => {
			const w = await trialWorkspace();
			w.env.ports.clock = { now: () => FIDELITY_NOW };
			const ctx = w.ctx('chef');
			const planned = await w.handlers.plan_event(ctx, {
				kitchenId: 'k-hotel',
				eventId: 'event-xmas-140'
			});
			if (!planned.ok) throw new Error(planned.error.message);
			const plan = planned.value.plan;
			const line = plan.lines.find((l) => l.state === 'unorderable') ?? plan.lines[0];
			const runs: ToolOutput<'find_substitutes'>[] = [];
			for (const rankBy of ['default', 'price', 'carbon', 'finnish', 'reliability'] as const) {
				const r = await w.handlers.find_substitutes(ctx, {
					planId: plan.id,
					version: plan.version,
					lineId: line.id,
					rankBy,
					apply: false
				});
				if (!r.ok) throw new Error(r.error.message);
				runs.push(r.value);
			}
			const exclusions = (v: (typeof runs)[number]) =>
				Object.fromEntries(v.candidates.map((x) => [x.productId, [...x.rejectedReasons].sort()]));
			for (const v of runs.slice(1)) {
				expect(exclusions(v)).toEqual(exclusions(runs[0]));
				expect(v.applied).toBe(false);
			}
			// A product chosen under two presets has the same tier and state under both.
			const tierOf = new Map<string, string>();
			for (const v of runs)
				for (const l of v.chosen) {
					const t = `${l.state}:${(l as { tier?: string }).tier ?? ''}`;
					if (tierOf.has(l.productId)) expect(t).toBe(tierOf.get(l.productId));
					else tierOf.set(l.productId, t);
				}
		}
	);
});

describe('chat: "cheapest" for one request', () => {
	it(
		'orders a product no dearer than the usual pick, and says so when it changed',
		{ timeout: 180_000 },
		async () => {
			const run = async (text: string) => {
				const w = await trialWorkspace();
				w.env.ports.clock = { now: () => FIDELITY_NOW };
				const deps = {
					handlers: w.handlers,
					ctx: w.ctx('chef'),
					ports: w.env.ports,
					workspaceId: w.env.workspaceId,
					kitchen: { id: 'k-lounas' },
					today: scenarioDate(FIDELITY_NOW)
				};
				const events = await chatTurn({ text }, deps);
				// The plan's lines arrive with its quote (RecordOffer), not with CreatePlan.
				const offer = w.ops.find((o) => o.op.type === 'RecordOffer');
				const line = offer?.op.type === 'RecordOffer' ? offer.op.lines[0] : undefined;
				// One product, one line: the quote's total is that line's cost.
				const cost = offer?.op.type === 'RecordOffer' ? offer.op.totalCents : null;
				return { events, line, cost };
			};
			const usual = await run('Order 4 kg butter for k-lounas tomorrow');
			const cheap = await run('Order 4 kg butter for k-lounas tomorrow, cheapest');
			expect(cheap.line).toBeTruthy();
			if (usual.cost !== null && cheap.cost !== null)
				expect(cheap.cost).toBeLessThanOrEqual(usual.cost);
			const done = cheap.events.at(-1);
			expect(done?.type).toBe('done');
			if (done?.type === 'done' && cheap.line?.productId !== usual.line?.productId)
				expect(done.text).toMatch(/Picked .+ over .+: cheaper/);
			// The preference words are a ranking, not part of the product searched for.
			expect(cheap.line?.productName ?? '').not.toMatch(/cheap/i);
		}
	);
});
