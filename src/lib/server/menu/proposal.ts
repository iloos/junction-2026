/**
 * Brief → MenuProposal (revision 0, `proposed`), stored before its id is returned.
 *
 * The dishes come from the model (Gemini through the Llm port, JSON, zod-validated with bounds) or, on the fixture
 * path, from the team's dish templates below. Either way every amount is an estimate with its provenance (`llm` or
 * `team_estimate`), yield stays absent unless known, and every ingredient goes through `catalog.resolve(query,
 * {diet})`: a resolved one is pinned to the best product, an unresolved one stays on the menu with the reason.
 * The rubric (`reviewProposal`) runs on the result; its issues are returned, never folded into the proposal.
 */
import { z } from 'zod';
import {
	MenuProposal,
	type Course,
	type DishIngredient,
	type DishTemplate,
	type EventBrief,
	type MenuProposal as MenuProposalT,
	type Provenance
} from '$lib/core/contracts';
import { canonicalJson, sha256Hex } from '$lib/core/hash';
import type { Catalog, Llm, MenuStore, Resolution } from '$lib/core/ports';
import { slug } from '../request/parse';
import { dietBase, reviewProposal, type Issue } from './rubric';

/** Brief requirements the catalogue resolver can enforce, as its product flags. */
const RESOLVER_DIET: Record<string, string> = {
	'lactose-free': 'LACTOSE',
	'gluten-free': 'GLUTEN'
};
/** Valio allergen codes that break a flag: milk for lactose-free; gluten cereals for gluten-free. */
const BREAKS: Record<string, string[]> = {
	LACTOSE: ['AM'],
	GLUTEN: ['AW', 'UW', 'GB', 'NR', 'GO', 'AX']
};

/**
 * Resolves one ingredient. The brief's diet is not a filter on every ingredient (plain carrots carry no free-from
 * data and would lose to a processed product that does); the ingredient's own words carry it ("kerma laktoositon").
 * A pinned product whose allergen record contains what the brief excludes is resolved again under the diet, and stays
 * unresolved if nothing qualifies: a wrong pin is worse than a visible gap.
 */
async function resolveIngredient(
	catalog: Pick<Catalog, 'resolve' | 'get'>,
	query: string,
	flags: string[]
): Promise<Resolution | null> {
	if (!catalog.resolve) return null;
	const r = await catalog.resolve(query, { limit: 3 });
	if (r.status !== 'resolved' || !flags.length) return r;
	const got = await catalog.get(r.candidates.map((c) => c.productId));
	const breaks = (id: string) => {
		const p = got.get(id);
		return flags.some(
			(f) =>
				!p?.freeFrom.includes(f) && (BREAKS[f] ?? []).some((c) => p?.allergens.contains.includes(c))
		);
	};
	const safe = r.candidates.filter((c) => !breaks(c.productId));
	if (safe.length === r.candidates.length) return r;
	if (safe.length) return { ...r, candidates: safe };
	return catalog.resolve(query, { limit: 3, diet: flags });
}

/* ── Model output ─────────────────────────────────────────────────────────── */

const LlmIngredient = z.object({
	label: z.string().min(1).max(120),
	/** Finnish catalogue words. */
	query: z.string().min(1).max(120),
	amountPerCover: z.number().positive().max(2000),
	unit: z.enum(['g', 'ml', 'pcs'])
});
const LlmDish = z.object({
	name: z.string().min(1).max(160),
	course: z.enum([
		'starter',
		'soup',
		'fish',
		'main',
		'side',
		'dessert',
		'bread',
		'cheese',
		'drink',
		'other'
	]),
	claimedCompatible: z.array(z.string().max(60)).max(20).default([]),
	ingredients: z.array(LlmIngredient).min(1).max(20)
});
export const LlmMenu = z.object({
	dishes: z.array(LlmDish).min(1).max(15),
	open: z.array(z.string().max(300)).max(10).default([])
});
export type LlmMenu = z.infer<typeof LlmMenu>;

const SYSTEM = `You propose a menu for a professional kitchen in Finland, as JSON for a Finnish food wholesaler's catalogue.
Return only JSON: {"dishes":[{"name":string,"course":"starter"|"soup"|"fish"|"main"|"side"|"dessert"|"bread"|"cheese"|"drink"|"other","claimedCompatible":string[],"ingredients":[{"label":string,"query":string,"amountPerCover":number,"unit":"g"|"ml"|"pcs"}]}],"open":string[]}.
- One dish per requested course; a buffet has 5-8 dishes.
- amountPerCover is the served amount per guest; 250-1500 g of food per guest in total.
- query: 1-3 Finnish catalogue words in base form (lohifilee, peruna, kerma laktoositon).
- claimedCompatible: the brief requirements this dish meets, exactly as written in the brief.
- Every requirement in the brief must hold for every dish; one with a head count ("vegetarian:6") needs at least one dish for those guests.
- Never drop a requirement. Put anything you cannot meet, or would ask the chef, in open.`;

/* ── Fixture: the team's dish templates ───────────────────────────────────── */

interface Template {
	name: string;
	course: Course;
	/** Requirements the dish meets as written, before swaps. */
	meets: string[];
	ingredients: {
		label: string;
		query: string;
		amountPerCover: number;
		unit: 'g' | 'ml' | 'pcs';
		dairy?: true;
	}[];
}

const T: Record<string, Template> = {
	gravlax: {
		name: 'Gravlax with dill and rye crisp',
		course: 'starter',
		meets: ['lactose-free', 'dairy-free', 'nut-free'],
		ingredients: [
			{ label: 'salmon fillet', query: 'lohifilee', amountPerCover: 70, unit: 'g' },
			{ label: 'dill', query: 'tilli', amountPerCover: 3, unit: 'g' }
		]
	},
	rosolli: {
		name: 'Rosolli beetroot salad',
		course: 'starter',
		meets: ['lactose-free', 'gluten-free', 'vegetarian', 'vegan', 'dairy-free', 'nut-free'],
		ingredients: [
			{ label: 'beetroot', query: 'punajuuri', amountPerCover: 60, unit: 'g' },
			{ label: 'carrot', query: 'porkkana', amountPerCover: 30, unit: 'g' },
			{ label: 'pickled cucumber', query: 'suolakurkku', amountPerCover: 20, unit: 'g' }
		]
	},
	soup: {
		name: 'Root vegetable soup',
		course: 'soup',
		meets: ['gluten-free', 'vegetarian', 'nut-free'],
		ingredients: [
			{ label: 'potato', query: 'peruna', amountPerCover: 80, unit: 'g' },
			{ label: 'carrot', query: 'porkkana', amountPerCover: 60, unit: 'g' },
			{ label: 'onion', query: 'sipuli', amountPerCover: 20, unit: 'g' },
			{ label: 'cream', query: 'ruokakerma', amountPerCover: 30, unit: 'ml', dairy: true }
		]
	},
	fish: {
		name: 'Pike-perch with butter potatoes',
		course: 'fish',
		meets: ['gluten-free', 'nut-free'],
		ingredients: [
			{ label: 'pike-perch fillet', query: 'kuhafilee', amountPerCover: 120, unit: 'g' },
			{ label: 'butter', query: 'voi', amountPerCover: 10, unit: 'g', dairy: true },
			{ label: 'potato', query: 'peruna', amountPerCover: 120, unit: 'g' }
		]
	},
	beef: {
		name: 'Roast beef, potato gratin',
		course: 'main',
		meets: ['gluten-free', 'nut-free'],
		ingredients: [
			{ label: 'beef roast', query: 'naudan paisti', amountPerCover: 160, unit: 'g' },
			{ label: 'potato', query: 'peruna', amountPerCover: 150, unit: 'g' },
			{ label: 'cream', query: 'ruokakerma', amountPerCover: 40, unit: 'ml', dairy: true }
		]
	},
	ham: {
		name: 'Christmas ham with swede casserole',
		course: 'main',
		meets: ['nut-free'],
		ingredients: [
			{ label: 'Christmas ham', query: 'joulukinkku', amountPerCover: 150, unit: 'g' },
			{ label: 'swede', query: 'lanttu', amountPerCover: 100, unit: 'g' },
			{ label: 'potato', query: 'peruna', amountPerCover: 120, unit: 'g' }
		]
	},
	risotto: {
		name: 'Mushroom risotto',
		course: 'main',
		meets: ['vegetarian', 'nut-free'],
		ingredients: [
			{ label: 'risotto rice', query: 'risottoriisi', amountPerCover: 70, unit: 'g' },
			{ label: 'mushrooms', query: 'herkkusieni', amountPerCover: 90, unit: 'g' },
			{ label: 'cheese', query: 'juusto', amountPerCover: 20, unit: 'g', dairy: true }
		]
	},
	cheese: {
		name: 'Finnish cheese plate',
		course: 'cheese',
		meets: ['gluten-free', 'vegetarian', 'nut-free'],
		ingredients: [{ label: 'cheese', query: 'juusto', amountPerCover: 50, unit: 'g', dairy: true }]
	},
	pudding: {
		name: 'Rice pudding with plum compote',
		course: 'dessert',
		meets: ['gluten-free', 'vegetarian', 'nut-free'],
		ingredients: [
			{ label: 'porridge rice', query: 'puuroriisi', amountPerCover: 30, unit: 'g' },
			{ label: 'milk', query: 'maito', amountPerCover: 150, unit: 'ml', dairy: true },
			{ label: 'dried plums', query: 'kuivattu luumu', amountPerCover: 30, unit: 'g' }
		]
	},
	amuse: {
		name: 'Smoked salmon on rye',
		course: 'other',
		meets: ['lactose-free', 'nut-free'],
		ingredients: [
			{ label: 'cold-smoked salmon', query: 'kylmäsavulohi', amountPerCover: 25, unit: 'g' },
			{ label: 'rye bread', query: 'ruisleipä', amountPerCover: 20, unit: 'g' }
		]
	},
	salad: {
		name: 'Green salad',
		course: 'side',
		meets: ['lactose-free', 'gluten-free', 'vegetarian', 'vegan', 'dairy-free', 'nut-free'],
		ingredients: [
			{ label: 'salad leaves', query: 'salaatti', amountPerCover: 40, unit: 'g' },
			{ label: 'tomato', query: 'tomaatti', amountPerCover: 40, unit: 'g' }
		]
	}
};

/** Served courses in the order a menu adds them. */
const COURSE_ORDER = ['starter', 'main', 'dessert', 'soup', 'fish', 'cheese', 'amuse'] as const;

/** The fixture menu: templates by style and course count, with lactose-free swaps where the brief asks. */
export function fixtureMenu(brief: EventBrief): LlmMenu {
	const xmas = /christmas|xmas|joulu/i.test(brief.title);
	const pick: Record<(typeof COURSE_ORDER)[number], Template> = {
		starter: xmas ? T.rosolli : T.gravlax,
		main: xmas ? T.ham : T.beef,
		dessert: T.pudding,
		soup: T.soup,
		fish: T.fish,
		cheese: T.cheese,
		amuse: T.amuse
	};
	const open: string[] = [];
	let chosen: Template[];
	if (brief.courses !== undefined) {
		const n = Math.min(brief.courses, COURSE_ORDER.length);
		if (brief.courses > n) open.push(`${brief.courses} courses: the templates cover ${n}`);
		const order = COURSE_ORDER.slice(0, n);
		// Served order, not the order courses are added in.
		const served = ['amuse', 'starter', 'soup', 'fish', 'main', 'cheese', 'dessert'];
		chosen = [...order].sort((a, b) => served.indexOf(a) - served.indexOf(b)).map((c) => pick[c]);
	} else chosen = [pick.starter, T.salad, T.fish, pick.main, T.pudding];

	const wants = brief.dietary.map(dietBase);
	const lactoseFree = wants.includes('lactose-free');
	// A head-counted vegetarian requirement gets its own main next to the others.
	if (brief.dietary.some((d) => dietBase(d) === 'vegetarian' && d.includes(':')))
		chosen.splice(chosen.indexOf(pick.main) + 1, 0, T.risotto);

	const dishes = chosen.map((t) => {
		const meets = new Set(t.meets);
		if (lactoseFree && t.ingredients.some((i) => i.dairy)) meets.add('lactose-free');
		return {
			name: t.name,
			course: t.course,
			claimedCompatible: brief.dietary.filter((d) => meets.has(dietBase(d))),
			ingredients: t.ingredients.map((i) => ({
				label: i.label,
				query: lactoseFree && i.dairy ? `${i.query} laktoositon` : i.query,
				amountPerCover: i.amountPerCover,
				unit: i.unit
			}))
		};
	});
	for (const d of brief.dietary) {
		const base = dietBase(d);
		if (d.includes(':')) continue;
		const not = dishes.filter((x) => !x.claimedCompatible.includes(d));
		if (not.length)
			open.push(
				`diet:${base}|${base} for every dish: ${not.map((x) => x.name).join(', ')} need a change`
			);
	}
	return { dishes, open };
}

/* ── Proposal ─────────────────────────────────────────────────────────────── */

/** Stable ids from names, numbered when repeated; short enough that dish + ingredient fit a 64-character id. */
function idsFor(names: string[], prefix: string): string[] {
	const seen = new Map<string, number>();
	return names.map((n) => {
		const b = `${prefix}${slug(n, 24)}`;
		const k = (seen.get(b) ?? 0) + 1;
		seen.set(b, k);
		return k === 1 ? b : `${b}-${k}`;
	});
}

export interface ProposeDeps {
	kitchenId: string;
	workspaceId: string;
	brief: EventBrief;
	store: MenuStore;
	catalog: Pick<Catalog, 'resolve' | 'get'>;
	now: Date;
	/** Absent: the fixture templates. */
	llm?: Llm | null;
	/** Makes two proposals for the same brief distinct; the same nonce returns the stored one. */
	nonce?: string;
}

export interface Proposed {
	proposal: MenuProposalT;
	issues: Issue[];
	/** Set when the model path failed and the templates answered instead. */
	fallback?: string;
	model: string;
}

async function fromModel(llm: Llm, brief: EventBrief): Promise<{ menu: LlmMenu; model: string }> {
	const r = await llm.generate({
		system: SYSTEM,
		prompt: `Brief: ${JSON.stringify({
			title: brief.title,
			date: brief.date,
			guests: brief.guests,
			serviceStyle: brief.serviceStyle,
			courses: brief.courses ?? null,
			dietary: brief.dietary,
			budgetEurosExVat: brief.budgetCents ? brief.budgetCents / 100 : null,
			notes: brief.notes ?? null
		})}`,
		maxTokens: 2500,
		json: true
	});
	const raw = r.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
	return { menu: LlmMenu.parse(JSON.parse(raw)), model: r.model };
}

/** Proposes, resolves every ingredient, stores revision 0 and returns it with the rubric's issues. */
export async function proposeMenu(d: ProposeDeps): Promise<Proposed> {
	const id = `m-${(await sha256Hex(canonicalJson({ k: d.kitchenId, b: d.brief, n: d.nonce ?? '' }))).slice(0, 16)}`;
	const stored = await d.store.get(d.workspaceId, id, 0);
	if (stored)
		return {
			proposal: stored,
			issues: reviewProposal(d.brief, stored),
			model: stored.provenance.ref ?? ''
		};

	let menu: LlmMenu;
	let model = 'templates';
	let fallback: string | undefined;
	let source: Provenance['source'] = 'team_estimate';
	if (d.llm) {
		try {
			({ menu, model } = await fromModel(d.llm, d.brief));
			source = 'llm';
		} catch (e) {
			fallback = `model proposal failed: ${String((e as Error)?.message ?? e).slice(0, 160)}`;
			menu = fixtureMenu(d.brief);
		}
	} else menu = fixtureMenu(d.brief);

	const at = d.now.toISOString();
	const flags = d.brief.dietary.map((x) => RESOLVER_DIET[dietBase(x)]).filter(Boolean);
	const dishIds = idsFor(
		menu.dishes.map((x) => x.name),
		'd-'
	);
	const dishes: DishTemplate[] = [];
	for (const [di, dish] of menu.dishes.entries()) {
		const ingIds = idsFor(
			dish.ingredients.map((i) => i.label),
			`${dishIds[di]}.`
		);
		const ingredients: DishIngredient[] = [];
		for (const [ii, i] of dish.ingredients.entries()) {
			const base = {
				id: ingIds[ii],
				label: i.label,
				amountPerCover: i.amountPerCover,
				unit: i.unit
			};
			const r = await resolveIngredient(d.catalog, i.query, flags);
			if (r?.status === 'resolved' && r.candidates.length)
				ingredients.push({
					...base,
					productId: r.candidates[0].productId,
					provenance: {
						source,
						at,
						ref: i.query,
						note: `amount: ${source === 'llm' ? 'model' : 'team'} estimate; product: best of ${r.candidates.length} for "${i.query}"`
					}
				});
			else
				ingredients.push({
					...base,
					unresolved: r?.status === 'unresolved' ? r.reason : 'no catalogue resolver',
					provenance: { source, at, ref: i.query }
				});
		}
		dishes.push({
			id: dishIds[di],
			name: dish.name,
			course: dish.course,
			claimedCompatible: dish.claimedCompatible,
			ingredients,
			provenance: { source, at }
		});
	}

	const proposal = MenuProposal.parse({
		id,
		revision: 0,
		kitchenId: d.kitchenId,
		status: 'proposed',
		brief: d.brief,
		dishes,
		open: menu.open.map((text, i) => {
			const [k, rest] = text.includes('|') ? text.split('|', 2) : [`open-${i + 1}`, text];
			return { id: k, text: rest.slice(0, 300) };
		}),
		provenance: { source, at, ref: model, ...(fallback ? { note: fallback } : {}) }
	});
	await d.store.put(d.workspaceId, proposal);
	return { proposal, issues: reviewProposal(d.brief, proposal), fallback, model };
}
