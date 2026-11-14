/**
 * Kitchen rules name product families in words ("meat", "fish", "milk"); the catalogue has 5-digit Valio
 * categories with no names. This is the explicit mapping between them (team mapping from the category contents,
 * checked against the catalogue on 14 Nov): a rule on a word applies to products whose category starts with one
 * of its prefixes. A word with no entry matches nothing, so an unmapped rule is visible here, never silently wide.
 */
export const CATEGORY_GROUPS: Record<string, { prefixes: string[]; note: string }> = {
	fish: { prefixes: ['1870'], note: 'fresh and cured fish, roe, shellfish (18701–18708)' },
	meat: {
		prefixes: ['172', '1871', '1872', '1873', '1874', '1875'],
		note: 'cold cuts and meat products (172xx); fresh pork, beef, reindeer, lamb, poultry (18710–18750)'
	},
	produce: {
		prefixes: ['1740', '1741', '1742', '1743', '1745', '1747', '1748'],
		note: 'fresh vegetables, fruit, potatoes, roots, herbs and sprouts, mushrooms, berries (1744x cut and prepared mixes excluded)'
	},
	milk: {
		prefixes: ['10400', '10401'],
		note: 'dairy milk and cream; plant drinks (10402) are not milk'
	}
};

/** Whether a product category belongs to a named family (or matches a numeric prefix given directly). */
export function inCategoryGroup(category: string, group: string): boolean {
	const g = CATEGORY_GROUPS[group];
	if (g) return g.prefixes.some((p) => category.startsWith(p));
	return /^\d+$/.test(group) && category.startsWith(group);
}
