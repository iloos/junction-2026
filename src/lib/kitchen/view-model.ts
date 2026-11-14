/**
 * The kitchen screen's view model: the shapes both the live builder (live-view.ts) and the offline stand-in
 * (fixture-plan.ts) produce, the rule presets, and the hotel's normal week. Nothing here plans or prices.
 */
import type { SubstituteKind } from '$lib/core/contracts';
import type {
	AvailabilityKind,
	Kitchen,
	Measure,
	MeasureUnit,
	ScoreBreakdown,
	Tier,
	Weights
} from '$lib/core/contracts';
import { KITCHENS } from './catalog';

export type PresetId = 'kitchen' | 'price' | 'finnish' | 'carbon' | 'reliable';

export interface Rules {
	preset: PresetId;
	weights: Weights;
	/** Category groups where Finnish origin is required (reject non-FI, hold unknown). */
	originRequire: string[];
	/** Category groups where Finnish origin is preferred (a non-FI substitute breaks the preference). */
	originPrefer: string[];
	lineCapCents: number;
	orderCapCents: number;
	weeklyCapCents: number;
	neverDelegate: string[];
	tenderList: string[] | null;
	mandateVersion: number;
	words: string;
}

export const PRESETS: Record<PresetId, { label: string; hint: string }> = {
	kitchen: { label: 'Kitchen default', hint: "The hotel's own weights: reliability first" },
	price: { label: 'Price first', hint: 'Cheapest that does the job; no origin preference' },
	finnish: { label: 'Finnish required', hint: 'Meat, fish and milk must be Finnish' },
	carbon: {
		label: 'Lowest carbon',
		hint: 'Ranks lower CO₂e per kg first; your mandate and who decides stay the same'
	},
	reliable: {
		label: 'Most reliable',
		hint: "Ranks Valio's delivery reliability first; your mandate and who decides stay the same"
	}
};

export function rulesFor(kitchen: Kitchen, preset: PresetId, mandateVersion = 1): Rules {
	const prefer = kitchen.constraints.origin
		.filter((o) => o.rule === 'prefer')
		.map((o) => o.categoryGroup);
	const require = kitchen.constraints.origin
		.filter((o) => o.rule === 'require')
		.map((o) => o.categoryGroup);
	const base: Rules = {
		preset,
		weights: { ...kitchen.weights },
		originRequire: require,
		originPrefer: prefer,
		lineCapCents: kitchen.mandate.lineCapCents,
		orderCapCents: kitchen.mandate.orderCapCents,
		weeklyCapCents: kitchen.mandate.weeklyCapCents,
		neverDelegate: [...kitchen.mandate.neverDelegate],
		tenderList: kitchen.constraints.tenderListOnly ? (kitchen.constraints.tenderList ?? []) : null,
		mandateVersion,
		words: kitchen.mandate.words
	};
	if (preset === 'price')
		return {
			...base,
			weights: { price: 0.7, reliability: 0.3, finnish: 0, carbon: 0, organic: 0 },
			originPrefer: [],
			neverDelegate: base.neverDelegate.filter((n) => n !== 'substitute_breaks_preference')
		};
	// Weights only: a ranking preference never changes a line's tier or who must decide it.
	if (preset === 'carbon')
		return {
			...base,
			weights: { carbon: 0.6, price: 0.2, reliability: 0.2, finnish: 0, organic: 0 }
		};
	if (preset === 'reliable')
		return {
			...base,
			weights: { reliability: 0.7, price: 0.2, carbon: 0.1, finnish: 0, organic: 0 }
		};
	if (preset === 'finnish')
		return {
			...base,
			weights: { finnish: 0.4, reliability: 0.3, price: 0.2, carbon: 0.1, organic: 0 },
			originRequire: ['meat', 'fish', 'milk'],
			originPrefer: [],
			neverDelegate: [...new Set([...base.neverDelegate, 'origin_requirement'])]
		};
	return base;
}

// ───────────────────────────── view types ─────────────────────────────

export type DishStatus = 'ok' | 'unknown' | 'rescued' | 'partial' | 'shortfall';

export interface CandidateView {
	productId: string;
	name: string;
	/** Live: the rules being previewed recommend this one (may differ from what the order holds). */
	recommended?: boolean;
	origin?: string;
	kind: AvailabilityKind;
	logistic: 'Stock' | 'Terminal' | null;
	availableText: string;
	perKgCents: number | null;
	qty: number | null;
	unit: string;
	rounding?: string;
	lineCents: number | null;
	coverValue: number;
	partial: boolean;
	rank: number | null;
	score?: ScoreBreakdown;
	/** Hard exclusions, as reason codes. */
	rejected: string[];
	/** Model cautions (CAUTION.*): still selectable, held for a human if chosen. */
	cautions?: string[];
	/** The caution in words ("Gemini: may break … (p 0.51) … check"). */
	cautionNote?: string;
	/** Reasons it would need a human (tier ≠ act). */
	holdReasons: string[];
	tier: Tier;
	chosen: boolean;
	verdict: string;
	reliability?: number;
	co2PerKg?: number;
	/** What kind of swap it is (find_substitutes): another pack, brand or form, a swap in the dish, a different product. */
	subKind?: SubstituteKind;
	/** One line of what changes for the kitchen, e.g. "sliced, not brined, 1.5 kg packs". */
	whatChanges?: string;
	/** Reliability and carbon in words where they say something, and the labels the product has. */
	facts?: { words: string[]; labels: string[] };
}

export interface MakeIngredient {
	productId: string;
	name: string;
	origin?: string;
	need: string;
	qty: number;
	unit: string;
	lineCents: number;
	availText: string;
}

export interface MakeView {
	title: string;
	ingredients: MakeIngredient[];
	totalCents: number;
	vsReadyMadeCents: number;
	labourNote: string;
	allergenNote?: string;
	caveats: string[];
	tier: Tier;
	holdReasons: string[];
	chosen: boolean;
	recipeNote: string;
}

/** A short description of a purchase: "HK Palvikinkku viipaloitu 1,5 kg · 13 ST". */
export interface PurchaseText {
	productId: string;
	name: string;
	qtyText: string;
	/** For the preview's "what changes": the line's price and the product's carbon, when known. */
	lineCents?: number | null;
	co2PerKg?: number;
}

export interface RescueView {
	forLineId: string;
	/**
	 * Preview vs saved (live): what the active rules recommend, what the order holds now. They differ when a
	 * preset is being previewed; "Apply these rules" makes the order follow the recommendation.
	 */
	preview?: { recommended: PurchaseText[]; saved: PurchaseText[]; differs: boolean };
	kind: 'product' | 'make_in_house' | 'none';
	needServed: Measure;
	candidates: CandidateView[];
	make?: MakeView;
	residual?: { value: number; unit: MeasureUnit; text: string; fitGrams?: number };
	summary: string;
}

export interface DishView {
	id: string;
	needId: string;
	name: string;
	nameFi: string;
	gServed: number;
	gDefault: number;
	editable: boolean;
	yield: number;
	need: Measure;
	needFormula: string;
	productId: string;
	productName: string;
	plannedLineId: string;
	/** Lines in the plan that serve this dish (planned or rescue). */
	lineIds: string[];
	status: DishStatus;
	outage?: 'out' | 'undeliverable';
	usual?: { qty: number; unit: string; cents: number };
	isNew: boolean;
	rescue?: RescueView;
	eventCents: number;
}

export interface WhyStep {
	text: string;
	source: string;
	detail?: string;
}

export interface EventView {
	eventId: string;
	title: string;
	date: string;
	guests: number;
	serviceStyle: string;
	dishes: DishView[];
	why: Record<string, WhyStep[]>;
	normalWeek: { cents: number; lines: number };
	thisWeek: { cents: number; lines: number };
	eventKg: number;
	planReasons: string[];
	weekSpentCents: number;
	counts: { outages: number; unknown: number; held: number; eligible: number; committed: number };
}

/** Usual weekly quantities for the hotel's standing-order products (team estimate, scenario). */
const USUAL_QTY: Record<string, { qty: number; unit: string }> = {
	'462150': { qty: 10, unit: 'KG' },
	'475214': { qty: 3, unit: 'ST' },
	'464201': { qty: 36, unit: 'ST' },
	'466964': { qty: 1, unit: 'BAG' }
};

/**
 * A normal week at this hotel for the SKUs the event also uses. Which products are usual comes from the kitchen
 * seed's `usualProducts`, the same baseline the mandate's `new_sku` rule reads, so the view and the rule agree.
 */
export const NORMAL_WEEK = {
	cents: 312_000,
	lines: 46,
	usual: Object.fromEntries(
		(KITCHENS.find((k) => k.id === 'k-hotel')?.usualProducts ?? []).map((id) => {
			const q = USUAL_QTY[id];
			if (!q) throw new Error(`usual product ${id} has no weekly quantity`);
			return [id, q];
		})
	) as Record<string, { qty: number; unit: string }>
};
