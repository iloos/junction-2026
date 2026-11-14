/**
 * Diet and allergen marks as a Finnish menu shows them (G, L, VL, M, VEG, VE), from the product's own record:
 * Valio's allergen list (GS1 codes), its free-from claims and its diet claims, plus the name's own claim words.
 * A product without an allergen record is "no allergen record", never "free from" (D5: absent ≠ allergen-free).
 * Pure: the line, the dish and the order roll up with the same rules.
 */

export interface DietFacts {
	nameFi?: string;
	allergens: { contains: string[]; mayContain: string[]; declared: boolean };
	freeFrom: string[];
	diet: string[];
}

export type MenuCode = 'G' | 'L' | 'VL' | 'M' | 'VEG' | 'VE';

/** The legend: one line under the table. */
export const CODE_WORDS: Record<MenuCode, string> = {
	G: 'gluten-free',
	L: 'lactose-free',
	VL: 'low lactose',
	M: 'milk-free',
	VEG: 'vegetarian',
	VE: 'vegan'
};
export const CODES: MenuCode[] = ['G', 'L', 'VL', 'M', 'VEG', 'VE'];

/** EU allergens by their GS1 codes, as a chef names them. */
export const ALLERGEN_NAMES: Record<string, string> = {
	AM: 'milk',
	AE: 'egg',
	AF: 'fish',
	AC: 'crustaceans',
	UM: 'molluscs',
	AN: 'tree nuts',
	AP: 'peanuts',
	AS: 'sesame',
	AY: 'soy',
	AW: 'gluten cereals',
	UW: 'wheat',
	GB: 'barley',
	GO: 'oats',
	NR: 'rye',
	BC: 'celery',
	BM: 'mustard',
	AU: 'sulphites',
	NL: 'lupin'
};
const GLUTEN = ['AW', 'UW', 'GB', 'GO', 'NR'];
const name = (code: string) => ALLERGEN_NAMES[code] ?? code;

export interface Marks {
	codes: MenuCode[];
	/** Allergens the record says it contains, by name. */
	contains: string[];
	mayContain: string[];
	/** False: Valio has no allergen record for it (or, rolled up, for some of the items). */
	recorded: boolean;
	/** Rolled up: how many items have no allergen record. */
	unrecorded?: number;
}

/** One product's marks. A code is claimed (free-from or diet data, or the name says it) or read off a declared record. */
export function marksOf(p: DietFacts | undefined): Marks {
	if (!p) return { codes: [], contains: [], mayContain: [], recorded: false };
	const n = (p.nameFi ?? '').toLowerCase();
	const free = new Set(p.freeFrom.map((x) => x.toUpperCase()));
	const diet = new Set(p.diet.map((x) => x.toLowerCase()));
	const rec = p.allergens.declared;
	const has = (codes: string[]) =>
		codes.some((c) => p.allergens.contains.includes(c) || p.allergens.mayContain.includes(c));
	const codes: MenuCode[] = [];
	if (free.has('GLUTEN') || /gluteeniton/.test(n) || (rec && !has(GLUTEN))) codes.push('G');
	const milkFree = free.has('MILK') || /maidoton/.test(n) || (rec && !has(['AM']));
	if (milkFree || free.has('LACTOSE') || /laktoositon/.test(n)) codes.push('L');
	else if (/vähälaktoosi/.test(n)) codes.push('VL');
	if (milkFree) codes.push('M');
	if (diet.has('vegan')) codes.push('VEG', 'VE');
	else if (diet.has('vegetarian')) codes.push('VEG');
	return {
		codes,
		contains: p.allergens.contains.map(name),
		mayContain: p.allergens.mayContain.filter((c) => !p.allergens.contains.includes(c)).map(name),
		recorded: rec
	};
}

/**
 * Many items as one: a code holds only when every item carries it (a dish is G only if all its lines are), allergens
 * are the union, and items without a record are counted, never read as free from anything.
 */
export function rollUp(items: Marks[]): Marks {
	if (!items.length)
		return { codes: [], contains: [], mayContain: [], recorded: true, unrecorded: 0 };
	const unrecorded = items.filter((m) => !m.recorded).length;
	const codes = CODES.filter((c) => items.every((m) => m.recorded && m.codes.includes(c)));
	const contains = [...new Set(items.flatMap((m) => m.contains))];
	const mayContain = [...new Set(items.flatMap((m) => m.mayContain))].filter(
		(x) => !contains.includes(x)
	);
	return { codes, contains, mayContain, recorded: unrecorded === 0, unrecorded };
}

/** The marks as one tooltip sentence. */
export function marksTitle(m: Marks): string {
	const bits: string[] = [];
	if (m.codes.length) bits.push(m.codes.map((c) => `${c} ${CODE_WORDS[c]}`).join(', '));
	if (m.contains.length) bits.push(`contains ${m.contains.join(', ')}`);
	if (m.mayContain.length) bits.push(`may contain ${m.mayContain.join(', ')}`);
	if (m.unrecorded) bits.push(`${m.unrecorded} without an allergen record`);
	else if (!m.recorded) bits.push('no allergen record: allergens unknown');
	return bits.join('; ') || 'no diet claims';
}
