/**
 * D16: one requirement vocabulary, one evaluator. Whether a product meets a need's hard requirements (and, when
 * given, the kitchen's own constraints), term by term: ok, unknown (no record either way: never ok) or no, each
 * with its reason in words. The validator (quote and commit), ranking, substitutes, the request filter and the UI's
 * diet marks all ask here, so a vegetarian dish can never be bought as meatballs through any door.
 */
import type { Kitchen, NeedRequirements, Product, RequirementCheck } from '../contracts';
import { inCategoryGroup } from './categories';
import { ALLERGEN_GROUPS, ALLERGEN_NAMES, allergenName, codesFor } from './allergens';

export type Verdict = 'ok' | 'unknown' | 'no';
export type RequirementTerm = 'freeFrom' | 'excludes' | 'diet' | 'origin' | 'labels' | 'kitchen';

export interface TermResult {
	term: RequirementTerm;
	/** What was asked, in words: "free from LACTOSE", "no meat", "vegetarian", "origin FI". */
	text: string;
	verdict: Verdict;
	/** Why this verdict, from which record: "allergens list AM (milk)", "no diet or allergen record". */
	why: string;
	/** Stable "term:value" code: diet:vegetarian, excludes:meat, freeFrom:LACTOSE, origin:fi, kitchen:AM. */
	code?: string;
}

export interface MeetsResult {
	verdict: Verdict;
	/** Every term that is not ok, worst first. */
	failing: TermResult[];
	/** The same, as the contract's RequirementCheck (requirement "term:value", from, verdict, fact). */
	checks: RequirementCheck[];
}

/** Words in Valio's name that state a free-from claim the structured data may lack. */
const NAME_CLAIMS: Record<string, string> = {
	LACTOSE: 'laktoositon',
	GLUTEN: 'gluteeniton',
	EU_ORGANIC_FARMING: 'luomu'
};
const named = (p: Product, code: string) =>
	NAME_CLAIMS[code] !== undefined &&
	p.nameFi
		.toLowerCase()
		.split(/[^a-zåäö]+/)
		.some((w) => w.startsWith(NAME_CLAIMS[code]));

/** Codes a free-from requirement is read against: a lactose-free need refuses listed milk unless the claim is made. */
const CODES: Record<string, readonly string[]> = {
	LACTOSE: ALLERGEN_GROUPS.milk,
	MILK: ALLERGEN_GROUPS.milk,
	GLUTEN: ALLERGEN_GROUPS.gluten,
	WHEAT: ['UW', 'WHEAT'],
	EGGS: ALLERGEN_GROUPS.egg,
	SOY: ALLERGEN_GROUPS.soy
};
/** Codes that contradict a free-from claim: lactose-free milk still lists AM, so only listed lactose does. */
const CONTRADICTS: Record<string, readonly string[]> = {
	...CODES,
	LACTOSE: ALLERGEN_GROUPS.lactose
};
export { ALLERGEN_NAMES };

const MEAT_WORD =
	/liha|kinkku|makkara|nakki|broiler|(?<!k)kana(?!pa|nmun)|kalkkun|naudan|porsa|possu|sian|lammas|poro|hirvi|pekoni|kassler|salami|maksa|chorizo|meetvursti|liivate/;
const FISH_WORD =
	/lohi|kala|silli|tonnikala|katkarap|äyriä|muikku|siika|ahven|hauki|turska|seiti|anjovis|makrilli|rapu|simpuk/;
const PORK_WORD = /porsa|possu|sian|sika|kinkku|pekoni|kassler|salami|chorizo|meetvursti/;

const ok = (term: RequirementTerm, text: string, why: string): TermResult => ({
	term,
	text,
	verdict: 'ok',
	why
});
const no = (term: RequirementTerm, text: string, why: string): TermResult => ({
	term,
	text,
	verdict: 'no',
	why
});
const unknown = (term: RequirementTerm, text: string, why: string): TermResult => ({
	term,
	text,
	verdict: 'unknown',
	why
});

/** By allergen codes: listed (contains or may contain) → no; declared without them → ok; undeclared → unknown. */
function byAllergens(
	p: Product,
	term: RequirementTerm,
	text: string,
	codes: readonly string[]
): TermResult {
	const hit = codes.find(
		(c) => p.allergens.contains.includes(c) || p.allergens.mayContain.includes(c)
	);
	if (hit) return no(term, text, `allergens list ${hit} (${allergenName(hit)})`);
	if (!p.allergens.declared) return unknown(term, text, 'no allergen record');
	return ok(term, text, 'declared allergens do not include it');
}

/**
 * A free-from claim the allergen list contradicts (claims gluten-free, lists wheat) is never ok: the chef reads the
 * label. Gluten-free bread made with gluten-free wheat starch is real, so it is held, not refused.
 */
function contradicted(p: Product, x: string): string | undefined {
	const hit = (CONTRADICTS[x] ?? []).find(
		(c) => p.allergens.contains.includes(c) || p.allergens.mayContain.includes(c)
	);
	return hit && `claims free from ${x.toLowerCase()} but lists ${allergenName(hit)} (${hit})`;
}

function freeFrom(p: Product, x: string): TermResult {
	return { ...freeFromTerm(p, x), code: `freeFrom:${x}` };
}
function freeFromTerm(p: Product, x: string): TermResult {
	const text = `free from ${x}`;
	const claimed = p.freeFrom.includes(x) || named(p, x);
	const clash = claimed ? contradicted(p, x) : undefined;
	if (clash) return unknown('freeFrom', text, clash);
	if (p.freeFrom.includes(x)) return ok('freeFrom', text, `claims free from ${x}`);
	if (named(p, x)) return ok('freeFrom', text, `the name says ${NAME_CLAIMS[x]}`);
	if ((x === 'LACTOSE' || x === 'MILK') && p.diet.includes('vegan'))
		return ok('freeFrom', text, 'diet record: vegan (no milk)');
	if ((x === 'LACTOSE' || x === 'MILK') && dairyLike(p))
		return no('freeFrom', text, `a dairy product (category or name) with no free-from ${x} claim`);
	if (x === 'GLUTEN' && glutenLike(p))
		return no('freeFrom', text, 'a gluten grain in the name, with no gluten-free claim');
	const codes = CODES[x];
	if (!codes) return no('freeFrom', text, `no free-from ${x} claim`);
	return byAllergens(p, 'freeFrom', text, codes);
}

/**
 * Dairy and gluten grains by what the product is, whatever its allergen list says (a declared but empty record must not
 * make ordinary milk lactose-free). A vegan diet record overrides: plant drinks and cheeses use the same words.
 */
const DAIRY_WORD =
	/maito|kerma|juusto|jogurtti|rahka|viili|piimä|smetana|kefir|\bvoi\b|voita\b|maitojauhe|herajauhe/;
const GLUTEN_WORD = /vehnä|ruis|rukii|ohra|speltti|durum|manna|bulgur|couscous|seitan|kaura/;
const dairyLike = (p: Product) =>
	!p.diet.includes('vegan') &&
	(inCategoryGroup(p.category, 'milk') || DAIRY_WORD.test(p.nameFi.toLowerCase()));
const glutenLike = (p: Product) => GLUTEN_WORD.test(p.nameFi.toLowerCase());

const meatLike = (p: Product) =>
	inCategoryGroup(p.category, 'meat') || MEAT_WORD.test(p.nameFi.toLowerCase());
const fishLike = (p: Product) =>
	inCategoryGroup(p.category, 'fish') || FISH_WORD.test(p.nameFi.toLowerCase());
const plantRecord = (p: Product) => p.diet.includes('vegan') || p.diet.includes('vegetarian');
/**
 * Prepared foods: chilled ready meals, salads and sauces (173xx), frozen prepared foods (417xx), sauces, soups and
 * snacks (219xx), sweets (522xx). Their recipe can hide meat stock or gelatine, so without a diet record they are
 * unknown.
 */
const PREPARED = ['173', '417', '219', '522'];

function excludes(p: Product, x: NonNullable<NeedRequirements['excludes']>[number]): TermResult {
	return { ...excludesTerm(p, x), code: `excludes:${x}` };
}
function excludesTerm(
	p: Product,
	x: NonNullable<NeedRequirements['excludes']>[number]
): TermResult {
	const text = x === 'gluten_cereals' ? 'no gluten cereals' : `no ${x}`;
	switch (x) {
		case 'milk':
			if (dairyLike(p)) return no('excludes', text, 'a dairy product (category or name)');
			if (p.diet.includes('vegan')) return ok('excludes', text, 'diet record: vegan (no milk)');
			return byAllergens(p, 'excludes', text, CODES.MILK);
		case 'gluten_cereals':
			if (p.freeFrom.includes('GLUTEN') || named(p, 'GLUTEN')) {
				const clash = contradicted(p, 'GLUTEN');
				return clash
					? unknown('excludes', text, clash)
					: ok('excludes', text, 'claims gluten-free');
			}
			if (glutenLike(p)) return no('excludes', text, 'a gluten grain in the name');
			return byAllergens(p, 'excludes', text, CODES.GLUTEN);
		case 'meat':
			if (meatLike(p)) return no('excludes', text, 'a meat product (category or name)');
			if (plantRecord(p)) return ok('excludes', text, `diet record: ${p.diet.join(', ')}`);
			if (PREPARED.some((c) => p.category.startsWith(c)))
				return unknown('excludes', text, 'a prepared food with no diet record');
			return ok('excludes', text, 'not a meat product');
		case 'fish':
			if (fishLike(p)) return no('excludes', text, 'a fish product (category or name)');
			if (plantRecord(p)) return ok('excludes', text, `diet record: ${p.diet.join(', ')}`);
			if (PREPARED.some((c) => p.category.startsWith(c)))
				return unknown('excludes', text, 'a prepared food with no diet record');
			return ok('excludes', text, 'not a fish product');
		case 'pork':
			if (PORK_WORD.test(p.nameFi.toLowerCase())) return no('excludes', text, 'pork in the name');
			if (plantRecord(p)) return ok('excludes', text, `diet record: ${p.diet.join(', ')}`);
			if (!meatLike(p)) return ok('excludes', text, 'not a meat product');
			return unknown('excludes', text, 'a meat product that does not say which');
	}
}

/**
 * Vegetarian and vegan as exclusions from category and allergen facts (diet tags are sparse in the catalogue): meat or
 * fish is no; a diet record is supporting evidence (ok); a prepared food with no record is unknown (held, not
 * refused); anything else (raw potatoes, flour, cream) is ok. Vegan also excludes listed milk, lactose and egg.
 */
function diet(p: Product, d: 'vegetarian' | 'vegan'): TermResult {
	return { ...dietTerm(p, d), code: `diet:${d}` };
}
function dietTerm(p: Product, d: 'vegetarian' | 'vegan'): TermResult {
	if (meatLike(p)) return no('diet', d, 'a meat product (category or name)');
	if (fishLike(p)) return no('diet', d, 'a fish product (category or name)');
	if (d === 'vegan') {
		const animal = ['AM', 'ML', 'AE', 'MILK', 'LACTOSE', 'EGG'].find((c) =>
			p.allergens.contains.includes(c)
		);
		if (animal) return no('diet', d, `allergens list ${animal} (${allergenName(animal)})`);
		if (p.diet.includes('vegan')) return ok('diet', d, 'diet record: vegan');
	} else if (plantRecord(p)) return ok('diet', d, `diet record: ${p.diet.join(', ')}`);
	if (PREPARED.some((c) => p.category.startsWith(c)))
		return unknown('diet', d, 'a prepared food with no diet record');
	// Raw fruit, vegetables, herbs and mushrooms are plant food by kind, allergen record or not.
	if (inCategoryGroup(p.category, 'produce'))
		return ok('diet', d, 'category evidence: fresh fruit, vegetables or herbs');
	if (d === 'vegan' && !p.allergens.declared) return unknown('diet', d, 'no allergen record');
	return ok('diet', d, 'not meat or fish');
}

const RANK: Record<Verdict, number> = { no: 0, unknown: 1, ok: 2 };

/**
 * Whether `p` meets `r` (a need's and the order's requirements, merged) and, when given, the kitchen's allergen
 * exclusions and required origins. Origin and labels are facts with no unknown: a missing origin is "no".
 */
export function meets(
	p: Product,
	r: NeedRequirements | undefined,
	kitchen?: Pick<Kitchen['constraints'], 'allergens' | 'origin'>
): MeetsResult {
	const terms: TermResult[] = [
		...(r?.freeFrom ?? []).map((x) => freeFrom(p, x)),
		...(r?.excludes ?? []).map((x) => excludes(p, x)),
		...(r?.diet ?? []).map((d) => diet(p, d)),
		...(r?.origin
			? [
					{
						...(p.origin === r.origin
							? ok('origin', `origin ${r.origin.toUpperCase()}`, `origin ${p.origin}`)
							: no(
									'origin',
									`origin ${r.origin.toUpperCase()}`,
									p.origin ? `origin ${p.origin}` : 'no origin on record'
								)),
						code: `origin:${r.origin}`
					}
				]
			: []),
		// A diet named as a label ("vegetarian", as some seeds and requests write it) is the diet requirement.
		...(r?.labels ?? [])
			.filter((x) => x === 'vegetarian' || x === 'vegan')
			.map((x) => diet(p, x as 'vegetarian' | 'vegan')),
		...(r?.labels ?? [])
			.filter((x) => x !== 'vegetarian' && x !== 'vegan')
			.map((x) => ({
				...(p.labels.includes(x) || named(p, x)
					? ok('labels', `label ${x}`, `labelled ${x}`)
					: no('labels', `label ${x}`, `no ${x} label`)),
				code: `labels:${x}`
			})),
		// Kitchen terms in readable codes (an outside agent can't decode AM); the fact keeps the raw code.
		...(kitchen?.allergens.freeFrom ?? []).map((code) => ({
			...byAllergens(p, 'kitchen', `kitchen excludes ${allergenName(code)}`, codesFor(code)),
			code: `kitchen:allergen:${allergenName(code).replace(/\s+/g, '_')}`
		})),
		...(kitchen?.origin ?? [])
			.filter((o) => o.rule === 'require' && inCategoryGroup(p.category, o.categoryGroup))
			.map((o) => ({
				...(p.origin === o.country
					? ok(
							'kitchen',
							`${o.categoryGroup} from ${o.country.toUpperCase()}`,
							`origin ${p.origin}`
						)
					: no(
							'kitchen',
							`${o.categoryGroup} from ${o.country.toUpperCase()}`,
							`origin ${p.origin ?? 'unknown'}`
						)),
				code: `kitchen:origin:${o.categoryGroup}:${o.country}`
			}))
	];
	const failing = terms
		.filter((t) => t.verdict !== 'ok')
		.sort((a, b) => RANK[a.verdict] - RANK[b.verdict]);
	const checks: RequirementCheck[] = failing.map((t) => ({
		requirement: t.code ?? `${t.term}:${t.text}`,
		from: t.term === 'kitchen' ? 'kitchen' : 'need',
		verdict: t.verdict as 'no' | 'unknown',
		fact: t.why
	}));
	return { verdict: failing[0]?.verdict ?? 'ok', failing, checks };
}

/**
 * A dish's diet codes (G, L, VL, M, VEG, VE) or a request's words as requirements. Counted scopes ("vegetarian:6")
 * bind some covers, not every need, so they are left out; so are unknown codes. VL (low lactose) is not lactose-free
 * and adds nothing a product could be checked against.
 */
export function requirementsFromDiet(tags: readonly string[]): NeedRequirements | undefined {
	const free = new Set<string>();
	const ex = new Set<NonNullable<NeedRequirements['excludes']>[number]>();
	const d = new Set<'vegetarian' | 'vegan'>();
	for (const raw of tags) {
		if (raw.includes(':')) continue;
		const t = raw.trim().toLowerCase();
		if (['l', 'lactose-free', 'lactose free', 'laktoositon'].includes(t)) free.add('LACTOSE');
		else if (['m', 'milk-free', 'dairy-free', 'maidoton'].includes(t)) ex.add('milk');
		else if (['g', 'gluten-free', 'gluten free', 'gluteeniton'].includes(t))
			ex.add('gluten_cereals');
		else if (['veg', 'vegetarian', 'kasvis'].includes(t)) d.add('vegetarian');
		else if (['ve', 'vegan', 'vegaaninen'].includes(t)) d.add('vegan');
		else if (['no pork', 'pork-free', 'sianlihaton'].includes(t)) ex.add('pork');
	}
	if (!free.size && !ex.size && !d.size) return undefined;
	return {
		...(free.size ? { freeFrom: [...free].sort() } : {}),
		...(ex.size ? { excludes: [...ex].sort() } : {}),
		...(d.size ? { diet: [...d].sort() } : {})
	};
}
