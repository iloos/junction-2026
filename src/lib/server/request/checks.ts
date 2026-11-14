/**
 * Product checks against what the request asks for: a product that contradicts the words (soy for "cow", a
 * vegetarian product for a meat ask, chicken for beef) is filtered out with a stated reason, never kept as "best
 * remaining match". Pure; reads only the product's name and diet flags.
 */
import type { Product } from '$lib/core/contracts';

export type Animal = 'beef' | 'pork' | 'chicken' | 'lamb';

const words = (s: string) =>
	s
		.toLowerCase()
		.split(/[^\p{L}\d/]+/u)
		.filter(Boolean);

/** Plant-based words in Finnish product names. */
const PLANT =
	/(soija|soy|vege|kasvis|härkäpapu|papu|herne|nyhtökaura|mifu|vegetale|tofu|seitan|gold&green|kaura(?!pasta))/i;

/** Which animals a request's words ask for: "cow", "beef", "nauta" → beef. */
export function animalsAsked(text: string): Animal[] {
	const t = text.toLowerCase();
	const out: Animal[] = [];
	if (/\b(cow|cows|beef|ox|bovine)\b|naud|nauta|härä/.test(t)) out.push('beef');
	if (/\b(pork|pig|pigs|swine)\b|porsa|possu|\bsika|sian\b/.test(t)) out.push('pork');
	if (/\b(chicken|hen)\b|kana|broiler/.test(t)) out.push('chicken');
	if (/\b(lamb|mutton)\b|karits|lammas/.test(t)) out.push('lamb');
	return out;
}

/** The words ask for meat at all: an animal, or "meat", "mince", "liha", "jauheliha". */
export function meatAsked(text: string): boolean {
	return (
		animalsAsked(text).length > 0 || /\b(meat|mince|minced|meaty)\b|liha|jauheliha/i.test(text)
	);
}

/** The animals a product name says it is made of. */
export function animalsIn(p: Pick<Product, 'nameFi'>): Animal[] {
	const n = p.nameFi.toLowerCase();
	const w = words(n);
	const out: Animal[] = [];
	if (/naud|nauta|härä|\bna\b|\bna\/|\/na\b/.test(n) || w.includes('na')) out.push('beef');
	if (/sika|sian|porsa|possu|\bsi\/|\/si\b/.test(n) || w.includes('si')) out.push('pork');
	if (/kana|broiler/.test(n)) out.push('chicken');
	if (/karits|lammas/.test(n)) out.push('lamb');
	return [...new Set(out)];
}

/** The product is plant-based by its flags or its name. */
export function plantBased(p: Pick<Product, 'nameFi' | 'diet'>): boolean {
	return (
		(p.diet ?? []).includes('vegan') ||
		(p.diet ?? []).includes('vegetarian') ||
		PLANT.test(p.nameFi)
	);
}

/**
 * Why the product contradicts a meat ask, or null. `asked` are the animals the words name; with none named but
 * meat asked, only plant-based products contradict.
 */
export function meatContradiction(
	p: Pick<Product, 'nameFi' | 'diet'>,
	asked: readonly Animal[],
	meat: boolean
): string | null {
	if (!meat && !asked.length) return null;
	if (plantBased(p)) {
		const what = /soija|soy/i.test(p.nameFi)
			? 'a soy product'
			: /härkäpapu|papu|herne/i.test(p.nameFi)
				? 'a bean or pea product'
				: 'a vegetarian product';
		return `${what}: you asked for ${asked.length ? asked.join(' and ') : 'meat'}`;
	}
	const has = animalsIn(p);
	const other = has.filter((a) => !asked.includes(a));
	if (asked.length && has.length && !asked.some((a) => has.includes(a)))
		return `${other.join(' and ')}, not ${asked.join(' or ')}`;
	return null;
}
