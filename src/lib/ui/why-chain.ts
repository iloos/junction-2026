/**
 * The Why chain for one purchase line: every number from the dish to the rule that decides the line, each with its
 * source, so a reader can trace a displayed number back to its input. Built only from what the plan carries (need,
 * line, read model); nothing is recomputed that the server did not state. Make-in-house is an AND of ingredients: the
 * dish is only as covered as its least-covered ingredient.
 */
import type { FulfilmentView, Line, LineView, Need } from '$lib/core/contracts';
import { BUCKETS } from './coverage';
import { money, num } from './format';
import { reasonShort } from './reasons';

export interface ChainNode {
	/** What this step is ("Portion", "Yield"). */
	label: string;
	/** The step's value, with its operator when it derives from the previous one ("÷ 0.7 = 27 kg"). */
	value: string;
	detail?: string;
	/** Provenance family key for SourceTag (team_estimate, user, valio_cache, mandate, …). */
	source: string;
	/** Numbers read in mono; names and rules in the text face. */
	numeric?: boolean;
}

export interface RecipeIngredient {
	lineId: string;
	name: string;
	buys: string;
	rounding?: string;
	/** Weakest bucket this ingredient's allocation reached, as a D10 label. */
	cover: string;
	state: Line['state'];
	tier?: Line['tier'];
	current: boolean;
}

export interface WhyChain {
	nodes: ChainNode[];
	recipe?: { title: string; note: string; ingredients: RecipeIngredient[] };
}

type Basis = Pick<LineView, 'physical' | 'unitPrice' | 'comparisonPrice'> | undefined;

const amt = (v: number, u: string) => `${num(v, v < 10 ? 2 : 1)} ${u}`;
// Lines without a strategy (older plans, the offline fixture) mark recipe lines in their id.
const isMake = (l: Line) => l.strategy?.kind === 'make_in_house' || /-(mih|make)-/.test(l.id);
const BUCKET_LABEL = Object.fromEntries(BUCKETS.map((b) => [b.key, b.label.toLowerCase()]));

function ruleNode(line: Line): ChainNode {
	const v = line.view;
	if (line.state === 'unorderable' || line.state === 'rejected') {
		const why = line.reasons.map(reasonShort).join(', ').toLowerCase() || 'cannot be ordered';
		return { label: 'Rule', value: `Not ordered: ${why}`, source: 'valio_cache' };
	}
	if (line.state === 'committed')
		return {
			label: 'Rule',
			value: 'Ordered',
			detail: 'Ordered from Valio.',
			source: 'mandate'
		};
	const held = line.reasons.filter((r) => r !== 'UNKNOWN_REQUIRED');
	if (line.tier === 'act' && !held.length)
		return {
			label: 'Rule',
			value: 'Within your mandate',
			detail: 'The agent may order this alone; it is still not supplier confirmed.',
			source: 'mandate'
		};
	const who = line.tier === 'sign_off' ? 'Needs your sign-off' : 'Needs your approval';
	return {
		label: 'Rule',
		value: `${who}: ${held.map(reasonShort).join(', ').toLowerCase() || 'outside the mandate'}`,
		detail:
			v?.nextAction === 'approve'
				? 'A human approval of these exact terms lets it go ahead.'
				: v?.blockedReason
					? `Blocked: ${reasonShort(v.blockedReason.code).toLowerCase()}.`
					: undefined,
		source: 'mandate'
	};
}

export function whyChain(i: {
	need: Need | undefined;
	line: Line;
	/** All lines of the same need (for the replaced product and recipe siblings). */
	siblings: Line[];
	fulfilment?: FulfilmentView;
	basis: (l: Line) => Basis;
	name: (productId: string) => string;
	/** Dish facts when the need carries none (the offline fixture keeps them on its own dish view). */
	dish?: NonNullable<Need['dish']>;
}): WhyChain {
	const { need, line } = i;
	const nodes: ChainNode[] = [];
	const d = need?.dish ?? i.dish;
	const src = need?.provenance?.source ?? 'team_estimate';

	// Demand: dish → portion → served → yield → need
	if (d) {
		nodes.push({
			label: 'Dish',
			value: `${need?.label ?? 'Dish'} for ${d.guests} guests`,
			source: 'seed'
		});
		const edited = d.gServed !== d.defaultGServed;
		nodes.push({
			label: 'Portion',
			numeric: true,
			value: `${num(d.gServed)} g per guest`,
			detail: edited ? `Changed from ${num(d.defaultGServed)} g.` : undefined,
			source: edited ? 'user' : src
		});
		const servedKg = (d.gServed * d.guests) / 1000;
		if (need && need.amount.unit === 'kg') {
			nodes.push({
				label: 'Served',
				numeric: true,
				value: `× ${d.guests} = ${amt(servedKg, 'kg')}`,
				source: 'seed'
			});
			if (d.yield !== 1)
				nodes.push({
					label: 'Yield',
					numeric: true,
					value: `÷ ${num(d.yield)} = ${amt(need.amount.value, need.amount.unit)} to buy`,
					detail: 'Purchased weight before trimming and cooking losses.',
					source: src
				});
		} else if (need) {
			nodes.push({
				label: 'Need',
				value: amt(need.amount.value, need.amount.unit),
				detail: d.formula,
				source: src
			});
		}
	} else if (need) {
		nodes.push({
			label: 'Need',
			value: `${need.label}: ${amt(need.amount.value, need.amount.unit)}`,
			source: need.provenance?.source ?? 'user'
		});
	}

	// Product: the planned product, or what this line replaces
	if (line.substituteFor) {
		const orig = i.siblings.find((s) => s.productId === line.substituteFor && !s.substituteFor);
		const why = orig?.reasons.map(reasonShort).join(', ').toLowerCase();
		nodes.push({
			label: 'Replaces',
			value: i.name(line.substituteFor),
			detail: why ? `Not orderable: ${why}.` : undefined,
			source: 'valio_cache'
		});
	}
	const b = i.basis(line);
	const perUnit =
		b?.physical && line.qty.value > 0 && b.physical.unit !== line.qty.unit.toLowerCase()
			? `${amt(b.physical.value / line.qty.value, b.physical.unit)} per ${line.qty.unit}`
			: undefined;
	nodes.push({
		label: 'Product',
		value: line.productName ?? i.name(line.productId),
		detail: perUnit,
		source: 'valio_static'
	});

	// Lots: what the need becomes in sales units
	const phys =
		b?.physical && b.physical.unit !== line.qty.unit.toLowerCase()
			? ` ≈ ${amt(b.physical.value, b.physical.unit)}${b.physical.basis ? ` ${b.physical.basis}` : ''}`
			: '';
	nodes.push({
		label: 'Packs',
		numeric: true,
		value: `${num(line.qty.value)} ${line.qty.unit}${phys}`,
		detail: line.qty.rounding,
		source: 'valio_static'
	});

	// Cover: this line's share of the need, by certainty, and what it buys beyond the need
	const mine = (i.fulfilment?.allocations ?? []).filter((a) => a.lineId === line.id);
	if (mine.length && !isMake(line)) {
		const covered = mine.filter((a) => a.bucket !== 'excess' && a.amount.value > 0);
		const over = mine.find((a) => a.bucket === 'excess' && a.amount.value > 0);
		nodes.push({
			label: 'Covers',
			numeric: true,
			value: covered.length
				? covered
						.map((a) => `${amt(a.amount.value, a.amount.unit)} ${BUCKET_LABEL[a.bucket]}`)
						.join(', ')
				: 'Nothing of the need',
			detail: over
				? `Packs add ${amt(over.amount.value, over.amount.unit)} over the need; not cover.`
				: undefined,
			source: 'valio_cache'
		});
	}

	// Price
	if (line.lineCents != null) {
		const up = b?.unitPrice;
		nodes.push({
			label: 'Price',
			numeric: true,
			value: up
				? `${num(line.qty.value)} × ${money(up.cents)}/${up.per} = ${money(line.lineCents)}`
				: money(line.lineCents),
			detail: b?.comparisonPrice
				? `${money(b.comparisonPrice.cents)}/${b.comparisonPrice.per} to compare across pack sizes. Ex VAT.`
				: 'Ex VAT.',
			source: line.offer?.price?.provenance.source ?? 'valio_cache'
		});
	}

	nodes.push(ruleNode(line));

	// Make in house: every ingredient is required (AND)
	let recipe: WhyChain['recipe'];
	if (isMake(line)) {
		const ings = i.siblings.filter(isMake);
		const allocs = i.fulfilment?.allocations ?? [];
		const order = BUCKETS.map((x) => x.key as string);
		recipe = {
			title: `Make ${need?.label.split(' (')[0].toLowerCase() ?? 'it'} in house`,
			note: 'Every ingredient is required. The dish is covered only as far as its least-covered ingredient; kitchen time and equipment are assumed, not checked.',
			ingredients: ings.map((s) => {
				const buckets = allocs.filter(
					(a) => a.lineId === s.id && a.bucket !== 'excess' && a.amount.value > 0
				);
				const weakest = buckets.sort(
					(x, y) => order.indexOf(y.bucket) - order.indexOf(x.bucket)
				)[0];
				return {
					lineId: s.id,
					name: s.productName ?? i.name(s.productId),
					buys: `${num(s.qty.value)} ${s.qty.unit}`,
					rounding: s.qty.rounding,
					cover: weakest
						? BUCKET_LABEL[weakest.bucket]
						: s.state === 'unorderable'
							? 'not orderable'
							: 'no coverage data',
					state: s.state,
					tier: s.tier,
					current: s.id === line.id
				};
			})
		};
	}
	return { nodes, recipe };
}
