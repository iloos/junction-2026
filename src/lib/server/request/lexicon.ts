/**
 * Words the rule parser knows: products (English and Finnish forms → a Finnish catalogue search),
 * constraints and units. The catalogue is Finnish, so an English request is searched in Finnish.
 * A product word that is not here is searched as typed, and the request says so.
 */

export interface ProductWord {
	key: string;
	/** Lower-case forms as typed, English and Finnish (incl. the partitive "maitoa"). */
	forms: string[];
	/** Finnish catalogue word for search_products. */
	search: string;
	/** Valio 5-digit categories the product belongs to; candidates outside them are dropped. */
	categories?: string[];
	/** Default variant when the request does not say: a name token, and why. */
	prefer?: { token: string; reason: string };
	/** Catalogue compounds that start with the search word count as the product (lohi → lohifilee). */
	compound?: boolean;
	/**
	 * Variant words in the request → the name token to prefer instead of the default (a catalogue
	 * word ending in it counts: kirjolohifilee ends in filee). Its `search` word is searched first when given.
	 */
	variants?: { words: string[]; token: string; label: string; search?: string }[];
}

export const PRODUCTS: ProductWord[] = [
	{
		key: 'milk',
		forms: ['milk', 'maito', 'maitoa', 'maitoja'],
		search: 'maito',
		categories: ['10400'],
		prefer: {
			token: 'kevytmaito',
			reason: 'no fat level given: semi-skimmed (kevytmaito), the usual kitchen default'
		},
		variants: [
			{ words: ['whole', 'täysmaito', 'täysmaitoa'], token: 'täysmaito', label: 'whole milk' },
			{ words: ['skimmed', 'skim', 'rasvaton', 'rasvatonta'], token: 'rasvaton', label: 'skimmed' },
			{
				words: ['semi-skimmed', 'semi', 'kevytmaito', 'kevytmaitoa'],
				token: 'kevytmaito',
				label: 'semi-skimmed'
			}
		]
	},
	{
		key: 'potatoes',
		forms: ['potato', 'potatoes', 'peruna', 'perunaa', 'perunoita', 'perunat'],
		search: 'peruna',
		categories: ['17421'],
		prefer: { token: 'peruna', reason: 'plain washed potatoes, no variety given' }
	},
	{
		key: 'butter',
		forms: ['butter', 'voi', 'voita'],
		search: 'voi',
		categories: ['10500'],
		prefer: { token: 'normaalisuolainen', reason: 'no salt level given: normal salted' },
		variants: [
			{
				words: ['unsalted', 'suolaamaton', 'suolaamatonta'],
				token: 'suolaamaton',
				label: 'unsalted'
			}
		]
	},
	{
		key: 'cream',
		forms: ['cream', 'kerma', 'kermaa', 'kuohukerma', 'kuohukermaa', 'vispikerma', 'vispikermaa'],
		search: 'kerma',
		categories: ['10401'],
		prefer: { token: 'kuohukerma', reason: 'no type given: whipping cream (kuohukerma)' }
	},
	{
		key: 'eggs',
		forms: ['egg', 'eggs', 'kananmuna', 'kananmunia', 'kananmunaa', 'munia'],
		search: 'kananmuna',
		categories: ['10590']
	},
	{
		key: 'salmon',
		forms: ['salmon', 'lohi', 'lohta'],
		search: 'lohi',
		// Fresh, cold-chain and frozen fish: the ready meals (lohi-juustotorttu, lohikeitto) are elsewhere.
		categories: ['18701', '18702', '18706', '41720'],
		compound: true,
		variants: [
			{
				words: ['fillet', 'fillets', 'filet', 'filets', 'filee', 'fileet', 'fileetä', 'fileitä'],
				token: 'filee',
				label: 'fillet',
				search: 'lohifilee'
			}
		]
	},
	{ key: 'onions', forms: ['onion', 'onions', 'sipuli', 'sipulia', 'sipuleita'], search: 'sipuli' },
	{
		key: 'carrots',
		forms: ['carrot', 'carrots', 'porkkana', 'porkkanaa', 'porkkanoita'],
		search: 'porkkana'
	},
	{
		key: 'tomatoes',
		forms: ['tomato', 'tomatoes', 'tomaatti', 'tomaattia', 'tomaatteja'],
		search: 'tomaatti'
	},
	{
		key: 'flour',
		forms: ['flour', 'wheat flour', 'vehnäjauho', 'vehnäjauhoa', 'jauho', 'jauhoja'],
		search: 'vehnäjauho'
	},
	{ key: 'sugar', forms: ['sugar', 'sokeri', 'sokeria'], search: 'sokeri' },
	{ key: 'cheese', forms: ['cheese', 'juusto', 'juustoa'], search: 'juusto' },
	{ key: 'yoghurt', forms: ['yoghurt', 'yogurt', 'jogurtti', 'jogurttia'], search: 'jogurtti' },
	{ key: 'rice', forms: ['rice', 'riisi', 'riisiä'], search: 'riisi' },
	{
		key: 'chicken',
		forms: ['chicken', 'broileri', 'broileria', 'kana', 'kanaa'],
		search: 'broileri'
	}
];

export type ConstraintKey = 'lactose_free' | 'organic' | 'finnish' | 'gluten_free';

export const CONSTRAINTS: {
	key: ConstraintKey;
	label: string;
	forms: string[];
	/** Finnish word added to the catalogue search. */
	search?: string;
}[] = [
	{
		key: 'lactose_free',
		label: 'lactose-free',
		forms: [
			'lactose-free',
			'lactose free',
			'lactosefree',
			'laktoositon',
			'laktoositonta',
			'laktoosittomia',
			'laktoosittoman'
		],
		search: 'laktoositon'
	},
	{ key: 'organic', label: 'organic', forms: ['organic', 'luomu', 'luomua'], search: 'luomu' },
	{
		key: 'finnish',
		label: 'Finnish',
		forms: ['finnish', 'domestic', 'kotimainen', 'kotimaista', 'suomalainen', 'suomalaista']
	},
	{
		key: 'gluten_free',
		label: 'gluten-free',
		forms: ['gluten-free', 'gluten free', 'gluteeniton', 'gluteenitonta'],
		search: 'gluteeniton'
	}
];

/** Request units: physical measures, a case (Valio KI), pieces, or "in the product's own sales unit". */
export type ReqUnit = 'l' | 'kg' | 'pcs' | 'case' | 'sales';

/** Unit word → unit and factor to it (5 dl = 0.5 l, 500 g = 0.5 kg). Longest forms first when matching. */
export const UNITS: { forms: string[]; unit: ReqUnit; factor: number }[] = [
	{
		forms: ['l', 'ltr', 'litre', 'litres', 'liter', 'liters', 'litra', 'litraa'],
		unit: 'l',
		factor: 1
	},
	{ forms: ['dl'], unit: 'l', factor: 0.1 },
	{ forms: ['cl'], unit: 'l', factor: 0.01 },
	{
		forms: ['ml', 'millilitre', 'millilitres', 'milliliter', 'milliliters'],
		unit: 'l',
		factor: 0.001
	},
	{
		forms: ['kg', 'kgs', 'kilo', 'kilos', 'kiloa', 'kilogram', 'kilograms'],
		unit: 'kg',
		factor: 1
	},
	{ forms: ['g', 'gr', 'gram', 'grams', 'gramma', 'grammaa'], unit: 'kg', factor: 0.001 },
	{
		forms: ['case', 'cases', 'box', 'boxes', 'ki', 'laatikko', 'laatikkoa', 'laatikollista', 'ltk'],
		unit: 'case',
		factor: 1
	},
	{ forms: ['pcs', 'pc', 'piece', 'pieces', 'kpl', 'st', 'kappaletta'], unit: 'pcs', factor: 1 },
	{ forms: ['pack', 'packs', 'pakkaus', 'pakkausta'], unit: 'sales', factor: 1 }
];

/**
 * Units a chef may type that the request can't order in. Typed after a number they are an explicit unit, never "no
 * unit": the item asks for the amount again instead of becoming a count of sales units.
 */
export const UNKNOWN_UNITS = new Set([
	'oz',
	'lb',
	'lbs',
	'pound',
	'pounds',
	'cup',
	'cups',
	'pint',
	'pints',
	'pt',
	'qt',
	'quart',
	'quarts',
	'gal',
	'gallon',
	'gallons',
	'tbsp',
	'tsp',
	'mg',
	'mm',
	'cm',
	'rkl',
	'tl',
	'ss',
	'hl',
	'ton',
	'tons',
	'tonne',
	'tonnes',
	'bunch',
	'bunches',
	'handful'
]);

export const NUMBER_WORDS: Record<string, number> = {
	a: 1,
	an: 1,
	one: 1,
	two: 2,
	three: 3,
	four: 4,
	five: 5,
	six: 6,
	seven: 7,
	eight: 8,
	nine: 9,
	ten: 10,
	twelve: 12,
	twenty: 20,
	hundred: 100,
	yksi: 1,
	kaksi: 2,
	kolme: 3,
	neljä: 4,
	viisi: 5,
	kuusi: 6,
	seitsemän: 7,
	kahdeksan: 8,
	yhdeksän: 9,
	kymmenen: 10
};
