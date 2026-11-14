/**
 * Substitute ranking, frozen by D6. Hard constraints first: a candidate that fails one is excluded with every
 * reason that applies (so the Why drawer can show "out of stock and reliability 0.33"). Survivors are scored
 * Σ wⱼ·utilityⱼ over price, carbon, Finnish origin, reliability and organic (weights normalised; utilities on fixed
 * 0–1 scales; a missing value scores 0, never favourably) + w_fit·fit/4 when a recipe-fit score exists.
 * Ties break on productId. Unknown supply is not excluded here: the mandate holds it (UNKNOWN_REQUIRED).
 * D8: ranking is lexicographic on supply first. Known stock (Valio states availability) ranks above unknown stock
 * whatever the score, so a candidate whose supply nobody knows is never recommended over one whose supply is known.
 */
import type {
	Kitchen,
	LineReason,
	NeedRequirements,
	Offer,
	Product,
	ScoreBreakdown,
	SupplyTier
} from '../contracts';
import { blocking, validateLine } from '../mandate/validate';

/** Recipe fit from Decide: score 0–4, its source, and Gemini's confidence when calibrated. */
export interface Fit {
	score: number;
	source: string;
	model?: string;
	latencyMs?: number;
	confidence?: number;
	/** Extra evidence shown with the fit (e.g. "Finnish origin p 0.93"). */
	note?: string;
}

export interface RankInput {
	kitchen: Kitchen;
	candidates: { productId: string; fromValioRule: boolean; qty: number }[];
	products: Map<string, Product>;
	offers: Map<string, Offer>;
	/** Recipe-fit 0–4 from Decide, when it answered. */
	fit?: Map<string, Fit>;
	/** Products under a recall notice: never recommended. */
	recalled?: Set<string>;
	/** Weight of the fit term relative to the criteria (D6 w_fit). */
	fitWeight?: number;
	/** Hard requirements of the need being rescued: a candidate that misses one is never ranked. */
	requirements?: NeedRequirements;
}

export interface Ranked {
	productId: string;
	fromValioRule: boolean;
	rank: number | null;
	score?: ScoreBreakdown;
	/** D8 supply tier: Valio states availability (known_stock), or it does not (Terminal, no stock figure). */
	supply?: Supply;
	rejectedReasons: LineReason[];
}

const RELIABILITY_FLOOR = 0.7;

export type Supply = Extract<SupplyTier, 'known_stock' | 'unknown_stock'>;

/** D8: what Valio says about supply. Unknown never counts as cover, so it never outranks known stock. */
export function supplyOf(o: Offer | null | undefined): Supply {
	return o?.availability.kind === 'known' ? 'known_stock' : 'unknown_stock';
}
const SUPPLY_ORDER: Record<Supply, number> = { known_stock: 0, unknown_stock: 1 };

/** Hard constraints: availability, lot/quantity, tender list. Every failing reason is collected. */
/**
 * Hard exclusions: whatever the shared validator forbids or marks as a fact gap (the same rules tiering and commit
 * use), plus the reliability floor, a ranking policy. Waivable findings (unknown quantity, tender list, a broken
 * preference) stay rankable; the mandate holds the chosen line for a human.
 */
function exclusions(
	k: Kitchen,
	p: Product | undefined,
	o: Offer | undefined,
	qty: number,
	requirements?: NeedRequirements
): LineReason[] {
	if (!p) return ['NOT_FOUND'];
	const out = blocking(
		validateLine(k, p, o, { value: qty, unit: p.salesUnit }, { substitute: true, requirements })
	).map((f) => f.reason);
	if (p.reliability !== undefined && p.reliability < RELIABILITY_FLOOR) out.push('low_reliability');
	return out;
}

/** Price per comparison unit (kg/l) when known, else per sales unit: the basis must match across candidates. */
function unitPrice(o: Offer): { cents: number; basis: string } | null {
	if (!o.price) return null;
	return o.price.comparison
		? { cents: o.price.comparison.cents, basis: o.price.comparison.unit }
		: { cents: o.price.unitCents, basis: 'unit' };
}

export function rankCandidates(input: RankInput): Ranked[] {
	const { kitchen, products, offers } = input;
	const w = kitchen.weights;
	const criteria = ['price', 'carbon', 'finnish', 'reliability', 'organic'] as const;
	const total = criteria.reduce((s, c) => s + (w[c] ?? 0), 0) || 1;
	const weight = (c: (typeof criteria)[number]) => (w[c] ?? 0) / total;
	const fitWeight = input.fitWeight ?? 0.25;

	const checked = input.candidates.map((c) => ({
		c,
		p: products.get(c.productId),
		o: offers.get(c.productId),
		reasons: [
			...exclusions(
				kitchen,
				products.get(c.productId),
				offers.get(c.productId),
				c.qty,
				input.requirements
			),
			...(input.recalled?.has(c.productId) ? (['recall'] as LineReason[]) : [])
		]
	}));
	const valid = checked.filter((x) => x.reasons.length === 0);
	const prices = valid
		.map((x) => unitPrice(x.o!))
		.filter((x): x is { cents: number; basis: string } => x !== null);
	const basis = prices.find((x) => x.basis !== 'unit')?.basis ?? 'unit';
	const minPrice = Math.min(...prices.filter((x) => x.basis === basis).map((x) => x.cents));
	const co2s = valid
		.map((x) => x.p!.co2PerKg?.value)
		.filter((v): v is number => v !== undefined && v > 0);
	const minCo2 = Math.min(...co2s);

	const scored = valid.map((x) => {
		const up = unitPrice(x.o!);
		const co2 = x.p!.co2PerKg?.value;
		const utility = {
			price: up && up.basis === basis && up.cents > 0 ? minPrice / up.cents : 0,
			carbon: co2 && co2 > 0 && Number.isFinite(minCo2) ? minCo2 / co2 : 0,
			finnish: x.p!.origin === 'fi' ? 1 : 0,
			reliability: x.p!.reliability ?? 0,
			organic: x.p!.labels.some((l) => /ORGANIC/i.test(l)) ? 1 : 0
		};
		const components = Object.fromEntries(
			criteria.map((c) => [c, { utility: +utility[c].toFixed(4), weight: +weight(c).toFixed(4) }])
		);
		const fit = input.fit?.get(x.c.productId);
		const base = criteria.reduce((s, c) => s + weight(c) * utility[c], 0);
		const totalScore = fit ? (base + fitWeight * (fit.score / 4)) / (1 + fitWeight) : base;
		const score: ScoreBreakdown = {
			total: +totalScore.toFixed(4),
			supplyTier: supplyOf(x.o),
			components,
			...(fit
				? {
						fit: {
							score: fit.score,
							provenance: {
								source:
									fit.source === 'gemini' || fit.source === 'replay' ? 'llm' : 'team_estimate',
								ref: fit.model,
								note: [
									`recipe fit ${fit.score.toFixed(1)}/4 via ${fit.source}`,
									fit.confidence !== undefined ? `conf ${fit.confidence.toFixed(2)}` : '',
									fit.latencyMs !== undefined ? `${Math.round(fit.latencyMs)} ms` : '',
									fit.note ?? ''
								]
									.filter(Boolean)
									.join(', ')
							}
						}
					}
				: {})
		};
		return { x, score, supply: supplyOf(x.o) };
	});
	scored.sort(
		(a, b) =>
			SUPPLY_ORDER[a.supply] - SUPPLY_ORDER[b.supply] ||
			b.score.total - a.score.total ||
			(a.x.c.productId < b.x.c.productId ? -1 : 1)
	);

	const ranked: Ranked[] = scored.map((s, i) => ({
		productId: s.x.c.productId,
		fromValioRule: s.x.c.fromValioRule,
		rank: i + 1,
		score: s.score,
		supply: s.supply,
		rejectedReasons: []
	}));
	for (const x of checked)
		if (x.reasons.length)
			ranked.push({
				productId: x.c.productId,
				fromValioRule: x.c.fromValioRule,
				rank: null,
				rejectedReasons: x.reasons
			});
	return ranked;
}
