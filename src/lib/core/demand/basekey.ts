/**
 * What a product is, from its Finnish name, and how a substitute relates to the planned product. Deterministic: the
 * brand, pack and size tokens and the form words come out of the name; what is left is the base. The kind is a
 * lookup over base, brand and form, best first (research/substitutes.md): pack → brand → form → functional →
 * different. A name that leaves no base gives kind "unknown", never a guess. Kinds describe; they never rank or tier.
 */
import type { BaseKey, Product, SubstituteKind } from '../contracts';

/**
 * Form words: how the same thing is cut, cooked, preserved or stated (diet claims count, since a lactose-free and
 * an ordinary milk are not the same pack). Prefix-matched on whole tokens, so inflections still match.
 */
const FORM_WORDS = [
	'viipaloitu',
	'viipale',
	'siivutettu',
	'siivu',
	'suikale',
	'kuutio',
	'kuutioitu',
	'raaste',
	'raastettu',
	'paloiteltu',
	'pilkottu',
	'murskattu',
	'jauhettu',
	'rouhittu',
	'kokonainen',
	'luuton',
	'luullinen',
	'nahaton',
	'nahallinen',
	'kuorittu',
	'puhdistettu',
	'kypsä',
	'kypsennetty',
	'esikypsennetty',
	'keitetty',
	'paistettu',
	'esipaistettu',
	'grillattu',
	'savustettu',
	'kylmäsavustettu',
	'lämminsavustettu',
	'graavattu',
	'tuoresuolattu',
	'suolattu',
	'marinoitu',
	'raaka',
	'tuore',
	'pakaste',
	'pakastettu',
	'puolivalmis',
	'laktoositon',
	'vähälaktoosinen',
	'gluteeniton',
	'luomu',
	'vegaaninen',
	'uht'
] as const;

/** The short English word for a form word, for the "what changes" line. */
const FORM_EN: Record<string, string> = {
	viipaloitu: 'sliced',
	viipale: 'sliced',
	siivutettu: 'sliced',
	siivu: 'sliced',
	suikale: 'strips',
	kuutio: 'diced',
	kuutioitu: 'diced',
	raaste: 'grated',
	raastettu: 'grated',
	paloiteltu: 'cut',
	pilkottu: 'chopped',
	murskattu: 'crushed',
	jauhettu: 'ground',
	rouhittu: 'crushed',
	kokonainen: 'whole',
	luuton: 'boneless',
	luullinen: 'on the bone',
	nahaton: 'skinless',
	nahallinen: 'skin on',
	kuorittu: 'peeled',
	puhdistettu: 'cleaned',
	kypsä: 'cooked',
	kypsennetty: 'cooked',
	esikypsennetty: 'pre-cooked',
	keitetty: 'boiled',
	paistettu: 'fried',
	esipaistettu: 'part-baked',
	grillattu: 'grilled',
	savustettu: 'smoked',
	kylmäsavustettu: 'cold-smoked',
	lämminsavustettu: 'hot-smoked',
	graavattu: 'cured',
	tuoresuolattu: 'brined',
	suolattu: 'salted',
	marinoitu: 'marinated',
	raaka: 'raw',
	tuore: 'fresh',
	pakaste: 'frozen',
	pakastettu: 'frozen',
	puolivalmis: 'part-made',
	laktoositon: 'lactose-free',
	vähälaktoosinen: 'low-lactose',
	gluteeniton: 'gluten-free',
	luomu: 'organic',
	vegaaninen: 'vegan',
	uht: 'UHT'
};

/** Pack, count and size tokens: "1,5 kg", "6 x", "30x85g", "2,5/1,25kg", "n.1,8kg", "6-8 kg", "1/4", "250ps". */
const SIZE =
	/(?:^|\s)(?:n\.|noin|ca\.?|e)?\s*\d+(?:[.,]\d+)?(?:\s*[-x×/]\s*\d+(?:[.,]\d+)?)*\s*(?:kg|g|gr|l|dl|cl|ml|kpl|ps|pss|st|mm|cm|%)?(?=\s|$|[,.)])/giu;
const NOISE = new Set([
	'x',
	'kg',
	'g',
	'l',
	'dl',
	'cl',
	'ml',
	'kpl',
	'ps',
	'noin',
	'n',
	'ca',
	'à',
	'n.'
]);

const fold = (s: string) => s.normalize('NFC').toLowerCase();

/** Words that say the same thing: one canonical form each, so "viipaloitu" and "siivutettu" are one form. */
const SAME_AS: Record<string, string> = {
	viipale: 'viipaloitu',
	siivutettu: 'viipaloitu',
	siivu: 'viipaloitu',
	kuutioitu: 'kuutio',
	raastettu: 'raaste',
	kypsennetty: 'kypsä',
	pakastettu: 'pakaste'
};

function formOf(token: string): string | null {
	// The longest form word the token starts with ("kylmäsavustettu" before "savustettu"); compounds ending in a form
	// word ("saunapalvikinkku") are bases, so only prefixes count.
	let best: string | null = null;
	for (const f of FORM_WORDS)
		if (token.startsWith(f) && (!best || f.length > best.length)) best = f;
	return best;
}

type KeyInput = Pick<Product, 'nameFi' | 'temperatureClass'> &
	Partial<Pick<Product, 'brand' | 'netPerSalesUnit' | 'netVolumePerSalesUnit' | 'category'>>;

/** The product's base key from its Finnish name; `baseSource: 'unknown'` when nothing is left to be the base. */
export function baseKeyOf(p: KeyInput): BaseKey {
	let name = fold(p.nameFi).replace(/[®™©]/g, ' ');
	const brand = p.brand?.trim();
	if (brand) {
		const b = fold(brand);
		// The brand wherever it stands, as whole words ("HK", "Valio", "Mattila Bros.").
		name = name.split(b).join(' ');
	}
	name = name.replace(SIZE, ' ');
	const tokens = name
		.split(/[^a-zåäöüé]+/u)
		.map((t) => t.trim())
		.filter((t) => t.length > 1 && !NOISE.has(t));
	const form = new Set<string>();
	const rest: string[] = [];
	for (const t of tokens) {
		const f = formOf(t);
		if (f) form.add(SAME_AS[f] ?? f);
		else rest.push(t);
	}
	const base = rest.length ? rest.join(' ') : null;
	// Liquids by their volume when Valio states it (0.5 l, not 0.517 kg), else the net content.
	const net = p.netVolumePerSalesUnit?.value ?? p.netPerSalesUnit?.value;
	return {
		base,
		form: [...form].sort(),
		...(brand ? { brand } : {}),
		temperatureClass: p.temperatureClass,
		...(net ? { netQty: { value: net.value, unit: net.unit } } : {}),
		baseSource: base ? 'parsed' : 'unknown'
	};
}

const keyOf = (p: Product): BaseKey => p.baseKey ?? baseKeyOf(p);
const sameSet = (a: string[], b: string[]) =>
	a.length === b.length && a.every((x) => b.includes(x));
/**
 * Same base: the same words, or the shorter base's words end words of the longer one with at most one word to
 * spare ("palvikinkku" ~ "aito saunapalvikinkku"): a Finnish compound names its head last. Same category only.
 */
function sameBase(a: Product, b: Product, ka: BaseKey, kb: BaseKey): boolean {
	if (ka.base === null || kb.base === null || a.category !== b.category) return false;
	if (ka.base === kb.base) return true;
	const [short, long] = [ka.base.split(' '), kb.base.split(' ')].sort(
		(x, y) => x.length - y.length
	);
	if (long.length - short.length > 1) return false;
	return short.every((w) => w.length >= 5 && long.some((l) => l.endsWith(w)));
}

/**
 * How `candidate` relates to `original`. `named`: a source names the candidate for this role (Valio's substitute
 * rule, the event seed's candidates or rescue), which makes an otherwise different product "functional".
 */
export function substituteKind(
	original: Product,
	candidate: Product,
	named: boolean
): SubstituteKind {
	const a = keyOf(original);
	const b = keyOf(candidate);
	if (a.base === null || b.base === null) return 'unknown';
	if (sameBase(original, candidate, a, b)) {
		const sameForm = sameSet(a.form, b.form) && a.temperatureClass === b.temperatureClass;
		if (sameForm) return (a.brand ?? '') === (b.brand ?? '') ? 'pack' : 'brand';
		return 'form';
	}
	return named ? 'functional' : 'different';
}

const qtyText = (q: NonNullable<BaseKey['netQty']>) =>
	`${+q.value.toFixed(3)} ${q.unit === 'pcs' ? 'pcs' : q.unit}`;

/** One line of what changes from the original to the candidate: form words, brand, pack size, temperature. */
export function whatChanges(original: Product, candidate: Product): string {
	const a = keyOf(original);
	const b = keyOf(candidate);
	const parts: string[] = [];
	const en = (f: string) => FORM_EN[f] ?? f;
	const added = [...new Set(b.form.filter((f) => !a.form.includes(f)).map(en))];
	const lost = [...new Set(a.form.filter((f) => !b.form.includes(f)).map(en))]
		.filter((w) => !added.includes(w))
		.map((w) => `not ${w}`);
	parts.push(...added.filter((w) => !lost.includes(`not ${w}`)), ...lost);
	if (b.temperatureClass !== a.temperatureClass) parts.push(b.temperatureClass);
	if (b.brand && b.brand !== a.brand) parts.push(b.brand);
	if (
		b.netQty &&
		(!a.netQty || a.netQty.value !== b.netQty.value || a.netQty.unit !== b.netQty.unit)
	)
		parts.push(`${qtyText(b.netQty)} packs`);
	return parts.join(', ');
}
