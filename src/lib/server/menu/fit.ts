/**
 * Fit warnings: a pinned product that matches the ingredient's words but not the dish. Signals for the chef, never a
 * block, and never a diet decision (core enforces dish codes and requirements, D16): they only point at a likely
 * wrong pick so it gets a second look before acceptance.
 *
 * - Cooked or smoked meat in a dish that cooks the meat from raw (kassler in cochinita pibil, an overcooked belly in
 *   hong shao rou).
 * - Meat or fish pinned in a dish the menu offers as vegetarian or vegan.
 */
import type { MenuProposal } from '$lib/core/contracts';
import type { Catalog } from '$lib/core/ports';
import { dietBase, type Issue } from './rubric';

/** Dishes whose method cooks raw meat slowly: a cured, smoked or precooked cut is the wrong start. */
const FROM_RAW =
	/pibil|carnitas|haudut|braise|hong ?shao|confit|pulled|nyhtö|stew|pata\b|patarui|ragu|ragout|kylkipaisti|barbacoa|birria/i;
/** A product name that says the meat is already cured, smoked or cooked. */
const PRECOOKED = /kassler|savustettu|savu|\bkypsä|ylikypsä|keitetty|grillattu|paistettu|leikkele/i;
/** Finnish compounds hide the meat mid-word ("Viljaporsaan"); English words are matched whole. */
const MEAT_OR_FISH =
	/liha|porsa|possu|nauta|naudan|broiler|kanan|kalkkuna|lammas|lampaan|kinkku|pekoni|makkara|kassler|lohi|siika|kuha|silakka|tonnikala|katkarapu|\b(kana|kala|meat|pork|beef|chicken|ham|bacon|fish|salmon|shrimp)\b/i;
const PLANT = new Set(['vegetarian', 'vegan']);

export async function fitIssues(
	catalog: Pick<Catalog, 'get'>,
	p: Pick<MenuProposal, 'dishes'>
): Promise<Issue[]> {
	const ids = [
		...new Set(
			p.dishes.flatMap((d) => d.ingredients.flatMap((i) => (i.productId ? [i.productId] : [])))
		)
	];
	if (!ids.length) return [];
	const got = await catalog.get(ids);
	const out: Issue[] = [];
	for (const dish of p.dishes) {
		const plant = dish.claimedCompatible.map(dietBase).find((b) => PLANT.has(b));
		const fromRaw = FROM_RAW.test(dish.name);
		for (const i of dish.ingredients) {
			const prod = i.productId ? got.get(i.productId) : undefined;
			if (!prod) continue;
			const name = `${prod.nameFi} ${prod.nameEn ?? ''}`;
			const words = `${i.label} ${i.provenance.ref ?? ''}`;
			const pre = PRECOOKED.exec(name)?.[0];
			if (fromRaw && pre && MEAT_OR_FISH.test(name) && !new RegExp(pre, 'i').test(words))
				out.push({
					id: `fit:${i.id}`,
					severity: 'warn',
					text: `${i.label}: ${prod.nameFi} is already ${/kassler|savu/i.test(pre) ? 'cured or smoked' : 'cooked'}, and ${dish.name} cooks the meat from raw`,
					targets: [i.id],
					fixes: ['removeIngredient']
				});
			if (plant && MEAT_OR_FISH.test(name))
				out.push({
					id: `fit:${i.id}`,
					severity: 'warn',
					text: `${i.label}: ${prod.nameFi} looks like meat or fish, in a dish offered as ${plant}`,
					targets: [i.id],
					fixes: ['removeIngredient']
				});
		}
	}
	return out;
}
