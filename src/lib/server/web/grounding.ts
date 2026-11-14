/**
 * Grounded menu: after a menu is proposed, each dish's model-written ingredients are compared with 1–2 cited recipes
 * from the web (Exa, the make-in-house path) whose ingredients go through `Catalog.resolve`. Per dish it stores which
 * sources match, which model ingredients no source has, and which ingredients the sources use that the model left
 * out. Evidence only: the proposal is never changed; the chef decides. Runs in the background so the proposal is not
 * slowed; cached per dish name for the process (the Exa answers themselves sit in the shared response cache).
 */
import { createHash } from 'node:crypto';
import type { Catalog } from '$lib/core/ports';
import type { FactSearch } from './exa';
import type { Findings } from './findings';
import { findOutside, ingredientTerms, slug, type OutsideOption } from './lookup';
import { evidenceSource, type EvidenceSource } from './evidence';
import { reportExternal } from '../external/call';
import { currentScope, scopeFor, withExternalScope } from '../external/scope';
import { noTrace } from '../adapters/llm/trace';

/** Recipes compared per dish. */
export const RECIPES_PER_DISH = 2;
/** A source matches the dish when at least this share of the model's ingredients appears in it. */
export const MATCH_SHARE = 0.5;

export interface DishGrounding {
	dishName: string;
	state: 'done';
	/** Where the recipes came from: live (sent now), cache, replay (fixture mode). */
	source: EvidenceSource;
	at: string;
	/** Recipes sharing at least half of the model's ingredients, with how many they share. */
	matchedSources: { url: string; title: string; host: string; shared: number; of: number }[];
	/** Every recipe compared, matched or not. */
	compared: { url: string; title: string; host: string }[];
	/** Model ingredients (labels) that no compared source uses. */
	modelOnly: string[];
	/** Ingredients the sources use that the model left out (source wording). */
	sourceOnly: string[];
	note: string;
}
export type GroundingState =
	| DishGrounding
	| { dishName: string; state: 'pending' }
	| { dishName: string; state: 'failed'; error: string };

interface ModelIngredient {
	label: string;
	productId?: string;
}
export interface GroundDeps {
	exa: FactSearch;
	catalog: Catalog;
	findings: Findings;
	workspaceId?: string;
}

const host = (u: string) => {
	try {
		return new URL(u).host.replace(/^www\./, '');
	} catch {
		return u;
	}
};

/** One source ingredient: its words and the catalogue products it resolves to. */
async function sourceIngredient(
	text: string,
	fallback: { productId: string }[],
	catalog: Catalog
): Promise<{ text: string; terms: string[]; productIds: Set<string> }> {
	const terms = ingredientTerms(text);
	let ids = fallback.map((p) => p.productId);
	if (catalog.resolve) {
		const r = await catalog.resolve(text, { limit: 3 }).catch(() => null);
		if (r?.status === 'resolved') ids = r.candidates.map((c) => c.productId);
	}
	return { text, terms, productIds: new Set(ids) };
}

/** The model ingredient and the source ingredient name the same thing: same product, or a shared word stem. */
function same(
	m: ModelIngredient & { terms: string[] },
	s: { terms: string[]; productIds: Set<string> }
): boolean {
	if (m.productId && s.productIds.has(m.productId)) return true;
	const stem = (t: string) => t.slice(0, Math.max(5, Math.min(t.length, 7)));
	return m.terms.some((a) => s.terms.some((b) => stem(a) === stem(b)));
}

export async function groundDish(
	dish: { name: string; ingredients: ModelIngredient[] },
	d: GroundDeps
): Promise<DishGrounding> {
	const r = await findOutside(dish.name, {
		...d,
		context: 'a dish on a menu; recipes with ingredient lists'
	});
	const recipes = r.options
		.filter(
			(o): o is OutsideOption =>
				o.kind === 'recipe' && o.sources.length > 0 && o.ingredients.length > 0
		)
		.slice(0, RECIPES_PER_DISH);
	const model = dish.ingredients.map((i) => ({
		...i,
		terms: ingredientTerms(i.label).concat(
			i.label
				.toLowerCase()
				.split(/\s+/)
				.filter((w) => w.length > 3)
		)
	}));
	const perRecipe = await Promise.all(
		recipes.map(async (o) => ({
			o,
			ings: await Promise.all(
				o.ingredients.map((i) => sourceIngredient(i.text, i.catalogue, d.catalog))
			)
		}))
	);
	const matchedSources = perRecipe.flatMap(({ o, ings }) => {
		const shared = model.filter((m) => ings.some((s) => same(m, s))).length;
		return model.length && shared / model.length >= MATCH_SHARE
			? [
					{
						url: o.sources[0].url,
						title: o.title,
						host: host(o.sources[0].url),
						shared,
						of: model.length
					}
				]
			: [];
	});
	const modelOnly = recipes.length
		? model
				.filter((m) => !perRecipe.some(({ ings }) => ings.some((s) => same(m, s))))
				.map((m) => m.label)
		: [];
	const sourceOnly = [
		...new Set(
			perRecipe.flatMap(({ ings }) =>
				ings.filter((s) => s.terms.length && !model.some((m) => same(m, s))).map((s) => s.text)
			)
		)
	].slice(0, 12);
	const compared = recipes.map((o) => ({
		url: o.sources[0].url,
		title: o.title,
		host: host(o.sources[0].url)
	}));
	const source = evidenceSource(r.mode, r.cached);
	// One summary per dish in the caller's drawer (the Exa calls behind it are traced on their own).
	const scope = currentScope();
	reportExternal(
		scope?.trace ?? noTrace,
		'tool',
		{
			api: 'exa',
			purpose: 'menu.grounding',
			cache: source,
			ok: true,
			latencyMs: 0,
			workspaceId: scope?.workspaceId ?? d.workspaceId
		},
		{
			dish: dish.name,
			recipes: recipes.length,
			matched: matchedSources.length,
			modelOnly: modelOnly.length
		}
	);
	return {
		dishName: dish.name,
		state: 'done',
		source,
		at: r.at,
		matchedSources,
		compared,
		modelOnly,
		sourceOnly,
		note: !recipes.length
			? r.mode === 'fixture'
				? 'No recorded recipe for this dish in fixture mode.'
				: 'No cited recipe found for this dish.'
			: matchedSources.length
				? `Matches ${matchedSources.length} sourced recipe(s) (${matchedSources.map((m) => m.host).join(', ')}).`
				: `No compared recipe shares half of the model's ingredients (${compared.map((c) => c.host).join(', ')}).`
	};
}

const g = globalThis as typeof globalThis & { __grounding?: Map<string, GroundingState> };
const store = (g.__grounding ??= new Map<string, GroundingState>());
type Dish = { name: string; ingredients: ModelIngredient[] };
/**
 * The verdict depends on this dish's ingredients, not only its name: keyed by the name and a digest of the sorted
 * ingredient labels, so two visitors' "Kalakeitto" with different ingredients never share a verdict. The Exa answers
 * behind it stay shared (the response cache is keyed by the query).
 */
const keyOf = (x: Dish) =>
	`${slug(x.name)}:${createHash('sha256')
		.update(
			x.ingredients
				.map((i) => i.label.trim().toLowerCase())
				.sort()
				.join('|')
		)
		.digest('hex')
		.slice(0, 16)}`;

/** Test hook. */
export function resetGrounding() {
	store.clear();
	settledAt.clear();
}

/** What is known for each dish name now: done, pending, failed, or absent (never asked). */
export function groundingFor(dishes: Dish[]): Record<string, GroundingState> {
	return Object.fromEntries(
		dishes.flatMap((x) => {
			const s = store.get(keyOf(x));
			return s ? [[x.name, s]] : [];
		})
	);
}

/** A failure or a "no cited recipe" verdict stands this long; after it, the next read or proposal asks again. */
export const RETRY_AFTER_MS = 5 * 60_000;
const settledAt = new Map<string, number>();
const retryable = (s: GroundingState) =>
	s.state === 'failed' || (s.state === 'done' && s.compared.length === 0);
/** Known and still standing: pending, a verdict with sources, or a failure/empty verdict younger than the retry. */
function standing(k: string, now = Date.now()): boolean {
	const s = store.get(k);
	if (!s) return false;
	return !retryable(s) || now - (settledAt.get(k) ?? 0) < RETRY_AFTER_MS;
}
/** Some dish has no standing verdict (never asked, or a failure/empty verdict past its retry): worth starting. */
export const needsGrounding = (dishes: Dish[], now = Date.now()) =>
	dishes.some((x) => !standing(keyOf(x), now));

/**
 * Starts grounding every dish without a standing verdict (two at a time) and returns at once. A failure or an empty
 * verdict stands for `RETRY_AFTER_MS`, so a refresh does not retry a paid call in a loop, and a later read does.
 */
export function startGrounding(
	dishes: { name: string; ingredients: ModelIngredient[] }[],
	d: GroundDeps
): Promise<void> {
	const todo = dishes.filter((x) => !standing(keyOf(x)));
	for (const x of todo) store.set(keyOf(x), { dishName: x.name, state: 'pending' });
	const queue = [...todo];
	const worker = async () => {
		for (let x = queue.shift(); x; x = queue.shift()) {
			try {
				store.set(keyOf(x), await groundDish(x, d));
			} catch (e) {
				store.set(keyOf(x), {
					dishName: x.name,
					state: 'failed',
					error: String((e as Error)?.message ?? e).slice(0, 200)
				});
			}
			settledAt.set(keyOf(x), Date.now());
		}
	};
	return Promise.all([worker(), worker()]).then(() => {});
}

/**
 * Grounds a proposed menu's dishes in the background, as the visitor (its own daily web cap) with the live or fixture
 * Exa client this env selects. Returns once the work is queued; the menu view reads progress with `groundingFor`.
 */
export async function groundMenuInBackground(
	env: Record<string, string | undefined>,
	workspaceId: string,
	dishes: { name: string; ingredients: ModelIngredient[] }[],
	catalog: Catalog
): Promise<void> {
	const { findingsFor, webClients, webStateReady } = await import('.');
	await webStateReady(env);
	const { exa } = webClients(env, undefined, `visitor:${workspaceId}`);
	const { currentRun } = await import('../demo/run');
	// The background work traces into the visitor's drawer and charges its caps, like a tool call.
	const scope = scopeFor({
		workspaceId,
		runId: currentRun(workspaceId),
		actor: { kind: 'chef', id: 'menu-grounding' }
	});
	void withExternalScope({ ...scope, spendKey: `visitor:${workspaceId}` }, () =>
		startGrounding(dishes, { exa, catalog, findings: findingsFor(env), workspaceId })
	).catch(() => {});
}
