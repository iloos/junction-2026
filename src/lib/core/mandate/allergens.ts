/**
 * The one allergen table: Valio's GS1 allergen codes (and the plain names some records and kitchen rules use) to the
 * name a chef says, and each allergen group to every code that belongs to it. meets(), the agent door, the dock and
 * the UI marks all read these, so "gluten" means the same five cereals everywhere.
 */

/** Allergen groups as a requirement or a menu mark names them, to every code that declares one. */
export const ALLERGEN_GROUPS = {
	/** EU "cereals containing gluten": the umbrella code plus wheat, rye, barley, oats, spelt and kamut. */
	gluten: ['AW', 'UW', 'NR', 'GB', 'GO', 'GS', 'GK', 'GLUTEN', 'WHEAT'],
	milk: ['AM', 'ML', 'MILK', 'LACTOSE'],
	lactose: ['ML', 'LACTOSE'],
	egg: ['AE', 'EGG', 'EGGS'],
	fish: ['AF'],
	crustaceans: ['AC'],
	molluscs: ['UM'],
	nuts: ['AN', 'SA', 'SC', 'SH', 'SM', 'SP', 'SR', 'ST', 'SW'],
	peanuts: ['AP'],
	sesame: ['AS'],
	soy: ['AY', 'SOY'],
	celery: ['BC'],
	mustard: ['BM'],
	sulphites: ['AU'],
	lupin: ['NL']
} as const satisfies Record<string, readonly string[]>;
export type AllergenGroup = keyof typeof ALLERGEN_GROUPS;

/** Codes to readable names: one list for the agent door, the dock and the UI. */
export const ALLERGEN_NAMES: Record<string, string> = {
	AW: 'gluten cereals',
	UW: 'wheat',
	NR: 'rye',
	GB: 'barley',
	GO: 'oats',
	GS: 'spelt',
	GK: 'kamut',
	AM: 'milk',
	ML: 'lactose',
	AE: 'egg',
	AF: 'fish',
	AC: 'crustaceans',
	UM: 'molluscs',
	AN: 'tree nuts',
	SA: 'almond',
	SC: 'cashew',
	SH: 'hazelnut',
	SM: 'macadamia',
	SP: 'pecan',
	SR: 'Brazil nut',
	ST: 'pistachio',
	SW: 'walnut',
	AP: 'peanuts',
	AS: 'sesame',
	AY: 'soy',
	BC: 'celery',
	BM: 'mustard',
	AU: 'sulphites',
	NL: 'lupin',
	MILK: 'milk',
	LACTOSE: 'lactose',
	GLUTEN: 'gluten',
	WHEAT: 'wheat',
	EGG: 'egg',
	EGGS: 'egg',
	SOY: 'soy'
};

export const allergenName = (code: string) => ALLERGEN_NAMES[code] ?? code;

/** The group a code belongs to (its first, for ML: milk), if any. */
export function groupOf(code: string): AllergenGroup | undefined {
	return (Object.keys(ALLERGEN_GROUPS) as AllergenGroup[]).find((g) =>
		(ALLERGEN_GROUPS[g] as readonly string[]).includes(code)
	);
}

/**
 * Every code a kitchen rule or claim for `code` covers: a group's umbrella code or name (AW, GLUTEN, AM) covers the
 * whole group; a specific code (UW, ML, SA) covers only itself, since a wheat-free kitchen may still use oats.
 */
export function codesFor(code: string): string[] {
	const c = code.toUpperCase();
	const umbrella: Record<string, AllergenGroup> = {
		AW: 'gluten',
		GLUTEN: 'gluten',
		AM: 'milk',
		MILK: 'milk',
		LACTOSE: 'lactose',
		AE: 'egg',
		EGG: 'egg',
		EGGS: 'egg',
		AN: 'nuts',
		AY: 'soy',
		SOY: 'soy'
	};
	const g = umbrella[c];
	return g ? [...ALLERGEN_GROUPS[g]] : [c];
}
