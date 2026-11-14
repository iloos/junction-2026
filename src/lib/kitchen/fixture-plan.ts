import type {
	AvailabilityKind,
	Criterion,
	Kitchen,
	Line,
	LineReason,
	LineState,
	Measure,
	MeasureUnit,
	Need,
	Plan,
	Provenance,
	ScoreBreakdown,
	Tier,
	Weights
} from '$lib/core/contracts';
import { CACHED_AT, CACHE_REF, SEED, product, type ProductFact } from './catalog';

/**
 * Pure builder: the Christmas buffet seed + a kitchen's rules + the chef's edits → a contract `Plan`
 * plus the view data the kitchen screen needs (dish rows, ranked candidates, the Why steps).
 * No clock, no randomness: the same input gives the same plan, so recompute on every edit is cheap.
 */

// ───────────────────────────── inputs ─────────────────────────────

export type PresetId = 'kitchen' | 'price' | 'finnish';

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

export interface Scenario {
	guests: number;
	/** Simulator overlay: another kitchen takes 4 of the 15 palvikinkku before we commit. */
	contention: boolean;
	/** Spend already committed this week (scenario), for the weekly cap. */
	weekSpentCents: number;
}

export interface BuildInput {
	kitchen: Kitchen;
	rules: Rules;
	grams: Record<string, number>;
	scenario: Scenario;
	version: number;
	/** Lines already committed (immutable): their state stays `committed`. */
	committed: Record<string, Line>;
}

export const PRESETS: Record<PresetId, { label: string; hint: string }> = {
	kitchen: { label: 'Kitchen default', hint: "The hotel's own weights: reliability first" },
	price: { label: 'Price first', hint: 'Cheapest that does the job; no origin preference' },
	finnish: { label: 'Finnish required', hint: 'Meat, fish and milk must be Finnish' }
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
	/** Reasons it would need a human (tier ≠ act). */
	holdReasons: string[];
	tier: Tier;
	chosen: boolean;
	verdict: string;
	reliability?: number;
	co2PerKg?: number;
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

export interface RescueView {
	forLineId: string;
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

export interface Built {
	plan: Plan;
	view: EventView;
}

// ───────────────────────────── dish model ─────────────────────────────

interface DishDef {
	id: string;
	name: string;
	nameFi: string;
	gDefault: number;
	yield: number;
	yieldNote?: string;
	/** Lines: product and amount per guest-gram (kg of product per kg served, or pieces). */
	parts: { productId: string; perServedKg: number; unit: MeasureUnit; note?: string }[];
	rescueKey?: 'ham' | 'lanttu' | 'torttu';
}

const DISHES: DishDef[] = [
	{
		id: 'ham',
		name: 'Christmas ham',
		nameFi: 'Joulukinkku',
		gDefault: 135,
		yield: 0.7,
		yieldNote: 'on the bone → cooked, sliced',
		parts: [{ productId: '462490', perServedKg: 1, unit: 'kg' }],
		rescueKey: 'ham'
	},
	{
		id: 'salmon',
		name: 'Cured salmon, in-house',
		nameFi: 'Graavilohi',
		gDefault: 70,
		yield: 0.85,
		yieldNote: 'fillet → cured, trimmed',
		parts: [{ productId: '462150', perServedKg: 1, unit: 'kg' }]
	},
	{
		id: 'sinappisilli',
		name: 'Mustard herring',
		nameFi: 'Sinappisilli',
		gDefault: 17,
		yield: 1,
		parts: [{ productId: '463876', perServedKg: 1, unit: 'kg' }]
	},
	{
		id: 'tomaattisilli',
		name: 'Tomato herring',
		nameFi: 'Tomaattisilli',
		gDefault: 17,
		yield: 1,
		parts: [{ productId: '463804', perServedKg: 1, unit: 'kg' }]
	},
	{
		id: 'lasimestari',
		name: "Glassblower's herring",
		nameFi: 'Lasimestarinsilli',
		gDefault: 17,
		yield: 1,
		parts: [{ productId: '463928', perServedKg: 1, unit: 'kg' }]
	},
	{
		id: 'rosolli',
		name: 'Beetroot salad',
		nameFi: 'Rosolli',
		gDefault: 90,
		yield: 1,
		parts: [{ productId: '463860', perServedKg: 1, unit: 'kg' }]
	},
	{
		id: 'lanttu',
		name: 'Swede casserole',
		nameFi: 'Lanttulaatikko',
		gDefault: 40,
		yield: 1,
		parts: [{ productId: '462482', perServedKg: 1, unit: 'kg' }],
		rescueKey: 'lanttu'
	},
	{
		id: 'porkkana',
		name: 'Carrot casserole',
		nameFi: 'Porkkanalaatikko',
		gDefault: 40,
		yield: 1,
		parts: [{ productId: '461210', perServedKg: 1, unit: 'kg' }]
	},
	{
		id: 'peruna',
		name: 'Sweetened potato casserole',
		nameFi: 'Imelletty perunalaatikko',
		gDefault: 40,
		yield: 1,
		parts: [{ productId: '462455', perServedKg: 1, unit: 'kg' }]
	},
	{
		id: 'potatoes',
		name: 'Boiled potatoes',
		nameFi: 'Keitetyt perunat',
		gDefault: 125,
		yield: 0.95,
		yieldNote: 'peeled raw → boiled',
		parts: [{ productId: '475214', perServedKg: 1, unit: 'kg' }]
	},
	{
		id: 'puuro',
		name: 'Rice porridge',
		nameFi: 'Riisipuuro',
		gDefault: 100,
		yield: 1,
		parts: [
			{ productId: '466964', perServedKg: 0.12, unit: 'kg', note: '0.12 kg rice per kg porridge' },
			{ productId: '464201', perServedKg: 0.75, unit: 'l', note: '0.75 l milk per kg porridge' }
		]
	},
	{
		id: 'torttu',
		name: 'Prune star tart',
		nameFi: 'Joulutorttu',
		gDefault: 60,
		yield: 1,
		parts: [{ productId: '473317', perServedKg: 1, unit: 'pcs' }],
		rescueKey: 'torttu'
	}
];

/** A normal week at this hotel for the SKUs the event also uses (team estimate, scenario). */
export const NORMAL_WEEK = {
	cents: 312_000,
	lines: 46,
	usual: {
		'462150': { qty: 10, unit: 'KG' },
		'475214': { qty: 3, unit: 'ST' },
		'464201': { qty: 36, unit: 'ST' },
		'466964': { qty: 1, unit: 'BAG' }
	} as Record<string, { qty: number; unit: string }>
};

const TART_G = 60;

// ───────────────────────────── helpers ─────────────────────────────

const round2 = (v: number) => Math.round(v * 100) / 100;
const f1 = (v: number) => v.toFixed(1);
const f2 = (v: number) => (Math.round(v * 100) / 100).toString();

const CACHE_PROV: Provenance = { source: 'valio_cache', at: CACHED_AT, ref: CACHE_REF };
const TEAM_PROV: Provenance = {
	source: 'team_estimate',
	ref: 'fixtures/seeds/christmas-buffet-140.json'
};
const USER_PROV: Provenance = { source: 'user', note: 'chef edit' };

interface Rounded {
	qty: number;
	unit: string;
	rounding: string;
	supplied: number;
}

/** Round a need up to Valio's lot step (KG) or to whole sales units, and say how. */
export function roundToLots(p: ProductFact, need: number, unit: MeasureUnit): Rounded {
	if (p.salesUnit === 'KG') {
		const step = p.lotStep >= 0.5 ? p.lotStep : 0.1;
		const n = Math.max(1, Math.ceil(need / step - 1e-9));
		const q = round2(n * step);
		const rounding =
			p.lotStep >= 1
				? `${f1(need)} kg → ${n} × ${step} kg lot = ${f2(q)} kg`
				: `${f2(need)} kg → ${f2(q)} kg`;
		return { qty: q, unit: 'KG', rounding, supplied: q };
	}
	const n = Math.max(1, Math.ceil(need / p.perUnit - 1e-9));
	const supplied = round2(n * p.perUnit);
	const m = unit === 'pcs' ? 'pcs' : unit;
	const needTxt = unit === 'pcs' ? `${Math.ceil(need)}` : f2(need);
	const rounding = `${needTxt} ${m} ÷ ${f2(p.perUnit)} ${m} → ${n} ${p.salesUnit} = ${f2(supplied)} ${m}`;
	return { qty: n, unit: p.salesUnit, rounding, supplied };
}

function availText(p: ProductFact): string {
	const a = p.availability;
	if (a.kind === 'known')
		return a.amount === null
			? 'In stock (no stated limit)'
			: `${f2(a.amount)} ${p.salesUnit} in stock`;
	if (a.kind === 'unknown') return 'Terminal · quantity unknown';
	if (a.kind === 'out') return 'Out of stock · 0';
	if (a.kind === 'undeliverable') return 'Not deliverable here';
	return a.kind;
}

/** Physical amount available, in the product's measure; Infinity when unlimited, 0 when not known. */
function coverable(p: ProductFact, contention: boolean): number {
	const a = p.availability;
	if (a.kind !== 'known') return 0;
	if (a.amount === null) return Infinity;
	const amount = contention && p.productId === '476768' ? Math.max(0, a.amount - 4) : a.amount;
	return amount * p.perUnit;
}

function normWeights(w: Weights): Record<Criterion, number> {
	const keys: Criterion[] = ['price', 'reliability', 'finnish', 'carbon', 'organic'];
	const sum = keys.reduce((s, k) => s + (w[k] ?? 0), 0);
	return Object.fromEntries(
		keys.map((k) => [k, sum > 0 ? (w[k] ?? 0) / sum : 1 / keys.length])
	) as Record<Criterion, number>;
}

const NEVER_KEY: Record<string, string> = {
	new_sku: 'new_sku',
	substitute_breaks_preference: 'substitute_breaks_preference',
	allergen_unknown: 'allergen_change',
	allergen_change: 'allergen_change',
	off_tender_list: 'off_tender_list',
	origin_required: 'origin_requirement'
};

/** Which policy reasons hold a line, and at which tier, under these rules. */
function tierFor(reasons: string[], rules: Rules): { tier: Tier; hold: string[] } {
	const hold = reasons.filter(
		(r) => r.startsWith('CAP_EXCEEDED') || rules.neverDelegate.includes(NEVER_KEY[r] ?? r)
	);
	if (hold.length === 0) return { tier: 'act', hold: [] };
	const signOff = hold.some((r) => r !== 'new_sku');
	return { tier: signOff ? 'sign_off' : 'propose', hold };
}

function originCheck(
	p: ProductFact,
	rules: Rules,
	isSubstitute: boolean
): { reject?: string; hold?: string } {
	if (rules.originRequire.includes(p.categoryGroup)) {
		if (!p.origin) return { hold: 'origin_required' };
		if (p.origin !== 'fi') return { reject: 'origin_required' };
	}
	if (isSubstitute && rules.originPrefer.includes(p.categoryGroup) && p.origin && p.origin !== 'fi')
		return { hold: 'substitute_breaks_preference' };
	return {};
}

// ───────────────────────────── ranking ─────────────────────────────

function rankCandidates(
	ids: string[],
	needKg: number,
	originalPerKgCents: number,
	rules: Rules,
	scenario: Scenario
): CandidateView[] {
	const w = normWeights(rules.weights);
	const rows: CandidateView[] = ids.map((id) => {
		const p = product(id);
		const rejected: string[] = [];
		const kind = p.availability.kind;
		if (kind === 'out' || kind === 'undeliverable' || kind === 'blocked') rejected.push(kind);
		if (kind === 'unknown') rejected.push('unknown');
		const origin = originCheck(p, rules, true);
		if (origin.reject) rejected.push(origin.reject);
		const holdCodes: string[] = ['new_sku'];
		if (origin.hold) holdCodes.push(origin.hold);
		if (rules.tenderList && !rules.tenderList.includes(id)) holdCodes.push('off_tender_list');

		const perKgCents = p.priceCents !== null ? Math.round(p.priceCents / p.perUnit) : null;
		const available = coverable(p, scenario.contention);
		const coverValue = Math.min(needKg, available);
		const partial = rejected.length === 0 && coverValue < needKg - 1e-9;
		let qty: number | null = null;
		let rounding: string | undefined;
		let lineCents: number | null = null;
		if (p.priceCents !== null) {
			const r = roundToLots(p, partial ? coverValue : needKg, 'kg');
			let q = r.qty;
			if (partial)
				q =
					p.salesUnit === 'KG'
						? round2(Math.floor(coverValue / Math.max(p.lotStep, 0.01)) * Math.max(p.lotStep, 0.01))
						: Math.floor(coverValue / p.perUnit);
			qty = q;
			rounding = partial
				? `only ${f2(q)} ${p.salesUnit} available → ${f1(coverValue)} kg of ${f1(needKg)} kg`
				: r.rounding;
			lineCents = Math.round(q * p.priceCents);
		}
		if (partial) holdCodes.push('partial');

		const utilities: Record<Criterion, number> = {
			price: perKgCents ? Math.max(0, Math.min(1, originalPerKgCents / perKgCents)) : 0,
			reliability: p.reliability ?? 0,
			finnish: p.origin === 'fi' ? 1 : 0,
			carbon: p.co2PerKg !== undefined ? Math.max(0, 1 - p.co2PerKg / 30) : 0,
			organic: 0
		};
		const components = Object.fromEntries(
			(Object.keys(utilities) as Criterion[]).map((k) => [
				k,
				{ utility: round2(utilities[k]), weight: round2(w[k]) }
			])
		);
		const total = round2(
			(Object.keys(utilities) as Criterion[]).reduce((s, k) => s + utilities[k] * w[k], 0)
		);
		const t = tierFor(
			holdCodes.filter((h) => h !== 'partial'),
			rules
		);
		return {
			productId: id,
			name: p.name,
			origin: p.origin,
			kind,
			logistic: p.availability.logistic,
			availableText:
				scenario.contention && id === '476768'
					? '11 ST in stock (4 taken by another kitchen)'
					: availText(p),
			perKgCents,
			qty,
			unit: p.salesUnit,
			rounding,
			lineCents,
			coverValue: rejected.length ? 0 : coverValue,
			partial,
			rank: null,
			score: { total, components, ...(rejected.length ? { excludedBy: rejected } : {}) },
			rejected,
			holdReasons: t.hold,
			tier: t.tier,
			chosen: false,
			verdict: '',
			reliability: p.reliability,
			co2PerKg: p.co2PerKg
		};
	});
	const viable = rows.filter((r) => r.rejected.length === 0);
	const order = (a: CandidateView, b: CandidateView) =>
		Number(a.partial) - Number(b.partial) ||
		(b.score?.total ?? 0) - (a.score?.total ?? 0) ||
		a.productId.localeCompare(b.productId);
	viable.sort(order);
	viable.forEach((r, i) => (r.rank = i + 1));
	const rejectedRows = rows
		.filter((r) => r.rejected.length > 0)
		.sort((a, b) => a.productId.localeCompare(b.productId));
	for (const r of [...viable, ...rejectedRows]) r.verdict = verdictFor(r);
	return [...viable, ...rejectedRows];
}

function verdictFor(c: CandidateView): string {
	if (c.rejected.includes('unknown')) return 'Terminal: unknown quantity never counts as cover';
	if (c.rejected.includes('out')) return 'Rejected: out of stock (0)';
	if (c.rejected.includes('undeliverable')) return "Rejected: Valio can't deliver it here";
	if (c.rejected.includes('origin_required'))
		return `Rejected: origin ${c.origin?.toUpperCase() ?? '?'}, your rules require FI`;
	if (c.partial) return `Partial: covers ${f1(c.coverValue)} kg`;
	if (c.tier === 'sign_off') return 'Full cover, needs sign-off';
	if (c.tier === 'propose') return 'Full cover, one tap to approve';
	return 'Full cover, within your mandate';
}

// ───────────────────────────── make in house ─────────────────────────────

function ingredient(id: string, need: string, qty: number): MakeIngredient {
	const p = product(id);
	return {
		productId: id,
		name: p.name,
		origin: p.origin,
		need,
		qty,
		unit: p.salesUnit,
		lineCents: Math.round(qty * (p.priceCents ?? 0)),
		availText: availText(p)
	};
}

function makeLanttu(bakedKg: number, rules: Rules): MakeView {
	const swede = Math.ceil(((bakedKg * 0.85) / 0.8) * 10 - 1e-9) / 10;
	const creamL = bakedKg * 0.09;
	const crumbsKg = bakedKg * 0.02;
	const eggs = Math.ceil(bakedKg);
	const syrupKg = bakedKg * 0.035;
	const ingredients = [
		ingredient(
			'460879',
			`${f1(bakedKg)} × 0.85 ÷ 0.8 peel yield = ${f2((bakedKg * 0.85) / 0.8)} kg`,
			swede
		),
		ingredient('464249', `${f2(creamL)} l`, Math.ceil(creamL - 1e-9)),
		ingredient('460613', `${f2(crumbsKg)} kg`, Math.ceil(crumbsKg / 0.3 - 1e-9)),
		ingredient('467464', `${eggs} eggs (case of 90)`, Math.ceil(eggs / 90 - 1e-9)),
		ingredient('461314', `${f2(syrupKg)} kg`, Math.ceil(syrupKg / 0.7 - 1e-9))
	];
	const t = tierFor(withTender(['new_sku', 'allergen_unknown'], ingredients, rules), rules);
	return {
		title: 'Make lanttulaatikko in house',
		ingredients,
		totalCents: ingredients.reduce((s, i) => s + i.lineCents, 0),
		vsReadyMadeCents: Math.round(Math.ceil(bakedKg / 0.7 - 1e-9) * 409),
		labourNote: 'About 40 min prep + 2 h at 150 °C',
		allergenNote:
			'Milk (lactose-free cream), egg, wheat. Check against the 462482 label before serving.',
		caveats: ['Swede origin NL: Finnish swede 460687 is undeliverable'],
		tier: t.tier,
		holdReasons: t.hold,
		chosen: true,
		recipeNote:
			'Per kg baked: 0.85 kg peeled swede, 0.09 l cream, 20 g crumbs, 1 egg, 35 g syrup (team estimate)'
	};
}

function makeTorttu(pieces: number, rules: Rules): MakeView {
	const pastryG = pieces * 45;
	const pruneG = pieces * 15;
	const ingredients = [
		ingredient(
			'460373',
			`${pieces} × 45 g = ${f1(pastryG / 1000)} kg`,
			Math.ceil(pastryG / 500 - 1e-9)
		),
		ingredient(
			'461378',
			`${pieces} × 15 g = ${f1(pruneG / 1000)} kg`,
			Math.ceil(pruneG / 1000 - 1e-9)
		)
	];
	const t = tierFor(withTender(['new_sku'], ingredients, rules), rules);
	return {
		title: 'Bake joulutorttu in house',
		ingredients,
		totalCents: ingredients.reduce((s, i) => s + i.lineCents, 0),
		vsReadyMadeCents: Math.ceil(pieces / 40 - 1e-9) * 2385,
		labourNote: `About 1 h to cut, fill and bake ${pieces}`,
		caveats: ['Prune purée is thinner than jam: a chef may cook it down'],
		tier: t.tier,
		holdReasons: t.hold,
		chosen: true,
		recipeNote: 'Per tart: 45 g puff pastry, 15 g prune filling (team estimate)'
	};
}

function withTender(reasons: string[], ings: MakeIngredient[], rules: Rules): string[] {
	if (rules.tenderList && ings.some((i) => !rules.tenderList!.includes(i.productId)))
		return [...reasons, 'off_tender_list'];
	return reasons;
}

// ───────────────────────────── build ─────────────────────────────

function mkLine(args: {
	id: string;
	needId: string;
	p: ProductFact;
	qty: number;
	rounding?: string;
	state: LineState;
	tier?: Tier;
	reasons: string[];
	covers?: Measure;
	residual?: Measure;
	substituteFor?: string;
	score?: ScoreBreakdown;
	provenance: Provenance;
}): Line {
	const { p } = args;
	const lineCents =
		p.priceCents !== null && args.state !== 'rejected' && args.state !== 'unorderable'
			? Math.round(args.qty * p.priceCents)
			: null;
	return {
		id: args.id,
		needId: args.needId,
		productId: p.productId,
		qty: { value: args.qty, unit: p.salesUnit, rounding: args.rounding },
		state: args.state,
		tier: args.tier,
		reasons: args.reasons as LineReason[],
		offer: {
			productId: p.productId,
			price:
				p.priceCents !== null
					? {
							unitCents: p.priceCents,
							comparison: null,
							taxRate: 0.14,
							validTo: null,
							provenance: CACHE_PROV
						}
					: null,
			availability: {
				kind: p.availability.kind,
				amount: p.availability.amount,
				logisticModel: p.availability.logistic,
				availableDate: '2026-11-16',
				closingTime: null,
				raw: p.availability.raw,
				provenance: CACHE_PROV
			}
		},
		lineCents,
		covers: args.covers,
		residual: args.residual,
		substituteFor: args.substituteFor,
		score: args.score,
		provenance: args.provenance
	};
}

/** Settle a line's state from its hold reasons and tier. Committed lines never change. */
function settle(line: Line, holds: string[], rules: Rules): Line {
	const t = tierFor(holds, rules);
	return {
		...line,
		tier: t.tier,
		state: t.tier === 'act' ? 'eligible' : 'held',
		reasons: [...new Set([...line.reasons, ...t.hold])] as LineReason[]
	};
}

export function buildEvent(input: BuildInput): Built {
	const { rules, scenario, grams } = input;
	const guests = scenario.guests;
	const lines: Line[] = [];
	const dishes: DishView[] = [];
	const why: Record<string, WhyStep[]> = {};
	const needs: Need[] = [];

	const w = normWeights(rules.weights);
	const weightText = (Object.keys(w) as Criterion[])
		.filter((k) => w[k] > 0)
		.map((k) => `${k} ${Math.round(w[k] * 100)}%`)
		.join(' · ');

	for (const d of DISHES) {
		const g = grams[d.id] ?? d.gDefault;
		const edited = g !== d.gDefault;
		const servedKg = (guests * g) / 1000;
		const needId = `n-${d.id}`;
		const dishLineIds: string[] = [];
		const main = d.parts[0];
		const mainP = product(main.productId);
		const isPcs = main.unit === 'pcs';
		const pieces = Math.ceil((guests * g) / TART_G - 1e-9);
		const needKg = servedKg / d.yield;
		const need: Measure = isPcs
			? { value: pieces, unit: 'pcs' }
			: { value: round2(needKg), unit: 'kg' };
		const needFormula = isPcs
			? `${guests} guests × ${g} g ÷ ${TART_G} g = ${pieces} tarts`
			: d.parts.length > 1
				? `${guests} × ${g} g = ${f1(servedKg)} kg porridge`
				: d.yield < 1
					? `${guests} × ${g} g ÷ ${d.yield} yield = ${f1(needKg)} kg`
					: `${guests} × ${g} g = ${f2(needKg)} kg`;
		needs.push({
			id: needId,
			label: `${d.nameFi} (${d.name})`,
			amount: need,
			provenance: edited ? USER_PROV : TEAM_PROV
		});

		const baseWhy = (p: ProductFact, partNote?: string): WhyStep[] => [
			{
				text: `${d.nameFi} is on the menu for ${guests} guests, ${SEED.serviceStyle}`,
				source: 'seed',
				detail: 'Booking is scenario data'
			},
			{
				text: `${g} g served per guest${edited ? ` (you changed it from ${d.gDefault} g)` : ''}`,
				source: edited ? 'user' : 'team_estimate',
				detail: d.yieldNote ? `Yield ${d.yield}: ${d.yieldNote}` : undefined
			},
			{
				text: partNote ? `${needFormula}; ${partNote}` : `Need: ${needFormula}`,
				source: 'team_estimate'
			},
			{
				text: `${p.name} (${p.productId}), sold per ${p.salesUnit}${p.perUnitNote ? `, ${p.perUnitNote}` : ''}${p.salesUnit === 'KG' && p.lotStep >= 1 ? `, lot ${p.lotStep} kg` : ''}`,
				source: 'valio_static'
			},
			{ text: `Availability: ${availText(p)} (${p.availability.raw})`, source: 'valio_cache' },
			{
				text: `Price ${p.priceCents !== null ? `€${(p.priceCents / 100).toFixed(2)} / ${p.salesUnit}` : 'unknown'}, catalogue price ex VAT at 14 Nov`,
				source: 'valio_cache'
			}
		];

		let status: DishStatus = 'ok';
		let rescue: RescueView | undefined;
		let outage: DishView['outage'];

		for (const [pi, part] of d.parts.entries()) {
			const p = product(part.productId);
			const lineId = `l-${d.id}${d.parts.length > 1 ? `-${pi}` : ''}`;
			const partNeed = isPcs ? pieces : d.parts.length > 1 ? servedKg * part.perServedKg : needKg;
			const r = roundToLots(p, partNeed, part.unit);
			const kind = p.availability.kind;
			const committed = input.committed[lineId];
			if (committed) {
				lines.push(committed);
				dishLineIds.push(lineId);
				why[lineId] = [
					...baseWhy(p, part.note),
					{
						text: 'Committed: this line is part of a placed order and no longer changes',
						source: 'simulator'
					}
				];
				continue;
			}
			if (kind === 'out' || kind === 'undeliverable') {
				outage = kind;
				lines.push(
					mkLine({
						id: lineId,
						needId,
						p,
						qty: r.qty,
						rounding: r.rounding,
						state: 'rejected',
						reasons: [kind],
						residual: need,
						provenance: TEAM_PROV
					})
				);
				dishLineIds.push(lineId);
				why[lineId] = [
					...baseWhy(p, part.note),
					{
						text:
							kind === 'out'
								? 'Out of stock: 0 at Valio for this delivery. Not ordered.'
								: "Valio can't deliver this product here. Not a stock problem, and not ordered.",
						source: 'valio_cache'
					}
				];
				continue;
			}
			const holds: string[] = [];
			const o = originCheck(p, rules, false);
			if (o.hold) holds.push(o.hold);
			if (o.reject) holds.push('origin_required');
			if (rules.tenderList && !rules.tenderList.includes(p.productId))
				holds.push('off_tender_list');
			const cents = Math.round(r.qty * (p.priceCents ?? 0));
			if (cents > rules.lineCapCents) holds.push('CAP_EXCEEDED.line');
			const unknown = kind === 'unknown';
			if (unknown) status = 'unknown';
			const supplied: Measure = { value: round2(isPcs ? r.supplied : r.supplied), unit: part.unit };
			let line = mkLine({
				id: lineId,
				needId,
				p,
				qty: r.qty,
				rounding: r.rounding,
				state: 'eligible',
				reasons: unknown ? ['unknown'] : [],
				covers: unknown ? { value: 0, unit: part.unit } : supplied,
				residual: unknown
					? { value: round2(partNeed), unit: part.unit }
					: { value: 0, unit: part.unit },
				provenance: edited ? USER_PROV : TEAM_PROV
			});
			line = settle(line, holds, rules);
			lines.push(line);
			dishLineIds.push(lineId);
			const steps = baseWhy(p, part.note);
			steps.push({
				text: `Rounded: ${r.rounding}`,
				source: 'valio_static',
				detail: `Lot step from Valio allowedLotSize`
			});
			if (unknown)
				steps.push({
					text: 'Terminal item: ordered, but the quantity is unknown, so it is not counted as cover',
					source: 'valio_cache'
				});
			steps.push(tierStep(line, rules));
			why[lineId] = steps;
		}

		// Rescue for real outages.
		if (outage && d.rescueKey) {
			const forLineId = `l-${d.id}`;
			if (d.rescueKey === 'ham') {
				const originalPerKg = Math.round((mainP.priceCents ?? 0) / d.yield);
				const cands = rankCandidates(
					['476768', '476648', '463159', '462919'],
					servedKg,
					originalPerKg,
					rules,
					scenario
				);
				const chosen = cands.find((c) => c.rank === 1);
				let residual: RescueView['residual'];
				if (chosen) {
					chosen.chosen = true;
					const p = product(chosen.productId);
					const subId = `l-${d.id}-sub-${chosen.productId}`;
					const coverKg = chosen.partial ? chosen.coverValue : servedKg;
					const left = round2(servedKg - coverKg);
					let line = mkLine({
						id: subId,
						needId,
						p,
						qty: chosen.qty ?? 0,
						rounding: chosen.rounding,
						state: 'eligible',
						reasons: chosen.partial ? [] : [],
						covers: { value: round2(coverKg), unit: 'kg' },
						residual: { value: left, unit: 'kg' },
						substituteFor: mainP.productId,
						score: chosen.score,
						provenance: {
							source: 'llm',
							note: 'kitchen agent proposal (fixture: deterministic ranking)'
						}
					});
					const committed = input.committed[subId];
					line = committed ?? settle(line, chosen.holdReasons, rules);
					lines.push(line);
					dishLineIds.push(subId);
					status = chosen.partial ? 'partial' : 'rescued';
					if (chosen.partial) {
						const fit = Math.floor((coverKg * 1000) / guests / 5) * 5;
						residual = {
							value: left,
							unit: 'kg',
							text: `${f1(left)} kg short: about ${Math.ceil((left * 1000) / g)} portions at ${g} g`,
							fitGrams: fit
						};
					}
					why[subId] = [
						...baseWhy(mainP).slice(0, 2),
						{
							text: `Served need: ${guests} × ${g} g = ${f1(servedKg)} kg cooked ham (the planned ham is out of stock)`,
							source: 'team_estimate'
						},
						{
							text: `${cands.length} candidates checked; Terminal items never count as cover`,
							source: 'valio_cache'
						},
						...cands.map((c) => ({
							text: `${c.rank ? `#${c.rank}` : 'Not ranked:'} ${c.name}: ${c.verdict}${c.score && !c.rejected.length ? ` · score ${c.score.total.toFixed(2)}` : ''}`,
							source: c.rejected.length ? 'valio_cache' : 'mandate'
						})),
						{
							text: `Ranked by your weights: ${weightText}. Missing values score 0, never favourably.`,
							source: 'mandate'
						},
						{ text: `Rounded: ${chosen.rounding ?? ''}`, source: 'valio_static' },
						{
							text: `Price €${((p.priceCents ?? 0) / 100).toFixed(2)} / ${p.salesUnit}, catalogue price ex VAT at 14 Nov`,
							source: 'valio_cache'
						},
						...(chosen.partial
							? [{ text: `Shortfall stated: ${residual?.text}`, source: 'simulator' }]
							: []),
						{
							text: 'Dish fit (smoked palvikinkku vs oven-baked juhlakinkku) is a chef question: not scored in fixture mode',
							source: 'team_estimate'
						},
						tierStep(line, rules)
					];
				} else {
					status = 'shortfall';
					residual = {
						value: round2(servedKg),
						unit: 'kg',
						text: `No candidate qualifies: ${f1(servedKg)} kg ham uncovered`
					};
				}
				rescue = {
					forLineId,
					kind: chosen ? 'product' : 'none',
					needServed: { value: round2(servedKg), unit: 'kg' },
					candidates: cands,
					residual,
					summary: chosen
						? chosen.partial
							? `Best option covers ${f1(chosen.coverValue)} of ${f1(servedKg)} kg. The rest is a shortfall, stated.`
							: `${product(chosen.productId).name} covers the full ${f1(servedKg)} kg.`
						: 'Nothing qualifies under your rules. The ham is a shortfall.'
				};
			} else {
				const readyIds =
					d.rescueKey === 'lanttu'
						? ['462157', '462447', '462210', '471247']
						: ['473482', '464273', '468013'];
				const cands = rankCandidates(
					readyIds,
					isPcs ? pieces * (TART_G / 1000) : needKg,
					1,
					rules,
					scenario
				);
				const make =
					d.rescueKey === 'lanttu' ? makeLanttu(needKg, rules) : makeTorttu(pieces, rules);
				status = 'rescued';
				for (const ing of make.ingredients) {
					const p = product(ing.productId);
					const subId = `l-${d.id}-make-${ing.productId}`;
					const committed = input.committed[subId];
					let line = mkLine({
						id: subId,
						needId,
						p,
						qty: ing.qty,
						rounding: `${ing.need} → ${ing.qty} ${ing.unit}`,
						state: 'eligible',
						reasons: [],
						covers: { value: 0, unit: 'kg' },
						substituteFor: mainP.productId,
						provenance: { source: 'team_estimate', note: 'make-in-house recipe' }
					});
					const o = originCheck(p, rules, false);
					line =
						committed ?? settle(line, [...make.holdReasons, ...(o.hold ? [o.hold] : [])], rules);
					lines.push(line);
					dishLineIds.push(subId);
					why[subId] = [
						{
							text: `${d.nameFi}: no ready-made option can be delivered (${readyIds.length} checked)`,
							source: 'valio_cache'
						},
						{ text: `Make in house instead: ${make.recipeNote}`, source: 'team_estimate' },
						{ text: `${ing.name}: ${ing.need} → ${ing.qty} ${ing.unit}`, source: 'team_estimate' },
						{ text: `Availability: ${ing.availText}`, source: 'valio_cache' },
						{
							text: `Price €${((p.priceCents ?? 0) / 100).toFixed(2)} / ${p.salesUnit}, ex VAT at 14 Nov`,
							source: 'valio_cache'
						},
						{ text: make.labourNote, source: 'team_estimate' },
						...(make.allergenNote
							? [{ text: `Allergens: ${make.allergenNote}`, source: 'team_estimate' }]
							: []),
						tierStep(line, rules)
					];
				}
				rescue = {
					forLineId,
					kind: 'make_in_house',
					needServed: need,
					candidates: cands,
					make,
					summary: `No ready-made ${d.nameFi.toLowerCase()} can be delivered. Make it from in-stock ingredients: €${(make.totalCents / 100).toFixed(2)} vs €${(make.vsReadyMadeCents / 100).toFixed(2)} ready-made.`
				};
			}
		}

		const usual = NORMAL_WEEK.usual[mainP.productId];
		const dishLines = lines.filter((l) => dishLineIds.includes(l.id));
		dishes.push({
			id: d.id,
			needId,
			name: d.name,
			nameFi: d.nameFi,
			gServed: g,
			gDefault: d.gDefault,
			editable: true,
			yield: d.yield,
			need,
			needFormula,
			productId: mainP.productId,
			productName: mainP.name,
			plannedLineId: `l-${d.id}${d.parts.length > 1 ? '-0' : ''}`,
			lineIds: dishLineIds,
			status,
			outage,
			usual: usual
				? { ...usual, cents: Math.round(usual.qty * (mainP.priceCents ?? 0)) }
				: undefined,
			isNew: !usual,
			rescue,
			eventCents: dishLines.reduce((s, l) => s + (l.lineCents ?? 0), 0)
		});
	}

	// Order-level caps.
	const orderable = lines.filter((l) => l.state === 'eligible' || l.state === 'held');
	const totalCents = orderable.reduce((s, l) => s + (l.lineCents ?? 0), 0);
	const planReasons: string[] = [];
	if (totalCents > rules.orderCapCents) planReasons.push('CAP_EXCEEDED.order');
	if (scenario.weekSpentCents + totalCents > rules.weeklyCapCents)
		planReasons.push('CAP_EXCEEDED.weekly');
	const finalLines = planReasons.length
		? lines.map((l) =>
				l.state === 'eligible'
					? {
							...l,
							state: 'held' as const,
							tier: 'sign_off' as const,
							reasons: [...l.reasons, ...planReasons] as LineReason[]
						}
					: l
			)
		: lines;

	const held = finalLines.filter((l) => l.state === 'held').length;
	const eligible = finalLines.filter((l) => l.state === 'eligible').length;
	const committedN = finalLines.filter((l) => l.state === 'committed').length;
	const eventCents = finalLines
		.filter((l) => l.state !== 'rejected')
		.reduce((s, l) => s + (l.lineCents ?? 0), 0);
	const newLines = finalLines.filter(
		(l) => l.state !== 'rejected' && !NORMAL_WEEK.usual[l.productId]
	).length;
	const eventKg = dishes.reduce(
		(s, d) => s + (d.need.unit === 'pcs' ? (d.need.value * TART_G) / 1000 : d.need.value),
		0
	);

	const plan: Plan = {
		workspaceId: 'ws-demo',
		runId: 'run-fixture',
		id: 'plan-xmas-140',
		kitchenId: input.kitchen.id,
		version: input.version,
		state: committedN && !held && !eligible ? 'committed' : held ? 'held' : 'ready',
		deliverBy: '2026-12-10',
		eventId: SEED.id,
		needs,
		lines: finalLines,
		totalCents: eventCents,
		termsHash: null,
		createdBy: { kind: 'kitchen_agent', id: 'agent-kitchen' }
	};

	return {
		plan,
		view: {
			eventId: SEED.id,
			title: SEED.title,
			date: SEED.date,
			guests,
			serviceStyle: SEED.serviceStyle,
			dishes,
			why,
			normalWeek: { cents: NORMAL_WEEK.cents, lines: NORMAL_WEEK.lines },
			thisWeek: { cents: NORMAL_WEEK.cents + eventCents, lines: NORMAL_WEEK.lines + newLines },
			eventKg: round2(eventKg),
			planReasons,
			weekSpentCents: scenario.weekSpentCents,
			counts: {
				outages: dishes.filter((d) => d.outage).length,
				unknown: finalLines.filter((l) => l.reasons.includes('unknown' as LineReason)).length,
				held,
				eligible,
				committed: committedN
			}
		}
	};

	function tierStep(line: Line, r: Rules): WhyStep {
		if (line.state === 'committed') return { text: 'Committed', source: 'simulator' };
		if (line.tier === 'act' || !line.tier)
			return {
				text: `Within your mandate: €${((line.lineCents ?? 0) / 100).toFixed(2)} ≤ €${(r.lineCapCents / 100).toFixed(0)} line cap, nothing on your never-delegate list. The agent may order it.`,
				source: 'mandate'
			};
		const why = line.reasons.filter((x) => x !== 'unknown').join(', ');
		return {
			text: `${line.tier === 'sign_off' ? 'Held for sign-off' : 'Proposed: one tap to approve'} (${why}). Your words: “${r.words}”`,
			source: 'mandate'
		};
	}
}
