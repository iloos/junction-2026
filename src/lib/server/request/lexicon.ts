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

/**
 * Brands a chef may name (Valio catalogue brands, food service; ones that are also everyday words are left out).
 * A named brand is kept on the item and required at lookup.
 */
export const BRANDS = [
	'Valio',
	'Arla',
	'Fazer',
	'Atria',
	'Santa Maria',
	'Saarioinen',
	'HK',
	'Feelia',
	'Vaasan',
	'Meira',
	'Filos',
	'Apetit',
	'Felix',
	'Knorr',
	'Myllyn Paras',
	'Elovena',
	'Snellman',
	'Findus',
	'Kariniemen',
	'Taffel',
	'Oddlygood',
	'McCain',
	'Pingviini',
	'Dr. Oetker',
	'Tamminen',
	'Paulig',
	'Kikkoman',
	'Rummo',
	'De Cecco',
	'Heinz',
	'Alpro',
	'Valrhona',
	'Torino',
	'Dansukker',
	'Oatly',
	'Barilla',
	'Ingman',
	'Kokkikartano',
	'Mutti',
	'Juhla Mokka',
	'Dafgårds',
	'Old El Paso',
	'Schär',
	'Piltti',
	'Grandiosa',
	'Risella',
	'Castello',
	'Tage Lindblom',
	'Semper',
	'Gold&Green',
	'Eila',
	'Juustoportti',
	'Kotimaista',
	'Görans',
	'Rönkä',
	'Lagerblad',
	'Wernsing',
	'Aviko'
] as const;

/** Escapes a brand for a pattern ("Dr. Oetker", "Gold&Green"). */
export const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Hard diet asks in the request's words, as the tags core's requirementsFromDiet reads (D16's one vocabulary), plus
 * the few ways a chef says them that core's tags don't spell ("plant-based" is vegan, "meat-free" vegetarian).
 */
const DIET_WORDS: [string, string][] = [
	['vegan', 'vegan'],
	['vegaaninen', 'vegan'],
	['vegaani', 'vegan'],
	['plant-based', 'vegan'],
	['plant based', 'vegan'],
	['kasvipohjainen', 'vegan'],
	['vegetarian', 'vegetarian'],
	['kasvis', 'vegetarian'],
	['meat-free', 'vegetarian'],
	['lihaton', 'vegetarian'],
	['dairy-free', 'dairy-free'],
	['dairy free', 'dairy-free'],
	['milk-free', 'dairy-free'],
	['maidoton', 'dairy-free'],
	['no pork', 'no pork'],
	['pork-free', 'no pork'],
	['sianlihaton', 'no pork']
];

/** The hard diet tags the words state ("vegan", "dairy-free", "no pork"), each once. */
export function dietTagsIn(text: string): string[] {
	return [...new Set(DIET_WORDS.filter(([w]) => hasWord(text, w)).map(([, t]) => t))];
}

/** Diet asks this service cannot check against a product at all (no record to read): the reading stops. */
export const DIET_UNCHECKABLE = ['halal', 'kosher'];

/** `word` (one or more words) stands on its own in `text`, case-insensitive. */
export function hasWord(text: string, word: string): boolean {
	return new RegExp(`(^|[^\\p{L}])${esc(word.toLowerCase())}($|[^\\p{L}])`, 'u').test(
		text.toLowerCase().replace(/[®™]/g, '')
	);
}

/** The brand the words name, longest first ("Myllyn Paras" before "Paras"), or null. */
export function brandIn(text: string): string | null {
	const hit = [...BRANDS].sort((a, b) => b.length - a.length).find((b) => hasWord(text, b));
	return hit ?? null;
}

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
	{
		forms: ['pack', 'packs', 'pakkaus', 'pakkausta', 'paketti', 'pakettia', 'paketit', 'pkt'],
		unit: 'sales',
		factor: 1
	}
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
