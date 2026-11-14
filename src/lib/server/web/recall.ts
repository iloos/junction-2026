/**
 * Food-recall notices (Ruokavirasto, extracted by Context.dev) and how they match the catalogue.
 * Matching is tiered and says how sure it is: an exact GTIN is a hit; brand plus product words is a
 * probable hit; a shared supplier alone is only a lead and never names a product.
 */
import { z } from 'zod';
import type { Product } from '$lib/core/contracts';
import { createHash } from 'node:crypto';

/** JSON Schema sent to Context.dev `formats.json` for one notice page. */
export const RECALL_JSON_SCHEMA = {
	type: 'object',
	properties: {
		title: { type: 'string' },
		publishedDate: { type: ['string', 'null'], description: 'ISO date the notice was published' },
		reason: {
			type: ['string', 'null'],
			description: "Why the product is recalled (hazard), in the page's language"
		},
		hazard: {
			type: ['string', 'null'],
			enum: [
				'microbiological',
				'allergen',
				'foreign_body',
				'chemical',
				'labelling',
				'contact_material',
				'other',
				null
			]
		},
		products: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					name: { type: 'string' },
					brand: { type: ['string', 'null'] },
					manufacturer: { type: ['string', 'null'] },
					gtin: { type: ['string', 'null'], description: 'EAN/GTIN barcode digits only' },
					packageSize: { type: ['string', 'null'] },
					batch: { type: ['string', 'null'], description: 'lot/batch/packing-station codes' },
					bestBefore: {
						type: ['string', 'null'],
						description: 'best-before or use-by dates as written'
					}
				},
				required: ['name']
			}
		},
		distribution: {
			type: ['string', 'null'],
			description: 'where it was sold (shops, food service, regions)'
		},
		foodService: {
			type: ['boolean', 'null'],
			description: 'true if the notice says restaurants/food service/wholesale got the product'
		}
	},
	required: ['title', 'products']
} as const;

export const RECALL_INSTRUCTIONS =
	'Extract the recall notice. One entry per recalled product variant. Copy codes exactly; null when absent.';

/** JSON Schema for the recall list page: newest notices with links. */
export const RECALL_LIST_SCHEMA = {
	type: 'object',
	properties: {
		recalls: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					date: { type: 'string', description: 'ISO date of the notice' },
					title: { type: 'string' },
					url: { type: 'string', description: 'absolute URL of the notice page' }
				},
				required: ['title']
			}
		}
	},
	required: ['recalls']
} as const;

export const RECALL_LIST_URL =
	'https://www.ruokavirasto.fi/elintarvikkeet/ohjeita-kuluttajille/takaisinvedot/';

const nullish = <T extends z.ZodType>(t: T) =>
	t
		.nullish()
		.transform((v) => v ?? null)
		.catch(null);

export const RecalledProduct = z.object({
	name: z.string().min(1),
	brand: nullish(z.string()),
	manufacturer: nullish(z.string()),
	gtin: nullish(z.string()),
	packageSize: nullish(z.string()),
	batch: nullish(z.string()),
	bestBefore: nullish(z.string())
});
export type RecalledProduct = z.infer<typeof RecalledProduct>;

/** One extracted notice plus where and when it was read. */
export const RecallNotice = z.object({
	url: z.url(),
	fetchedAt: z.string(),
	title: z.string().min(1),
	publishedDate: nullish(z.string()),
	reason: nullish(z.string()),
	hazard: nullish(z.string()),
	products: z.array(RecalledProduct),
	distribution: nullish(z.string()),
	foodService: nullish(z.boolean()),
	/** Set when this is a recorded notice played back on stage, never for a live read. */
	replayOf: z.string().optional(),
	/** A presenter drill re-targeted at a catalogue GTIN: its own identity, never the real notice's. */
	drill: z.object({ gtin: z.string() }).optional()
});
export type RecallNotice = z.infer<typeof RecallNotice>;

export const RecallListItem = z.object({
	title: z.string(),
	date: nullish(z.string()),
	url: nullish(z.string())
});
export type RecallListItem = z.infer<typeof RecallListItem>;

/** Stable id of a notice: the same page always dedups to the same anomaly. */
export function noticeKey(url: string): string {
	const u = new URL(url);
	const norm = `${u.host}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();
	return createHash('sha256').update(norm).digest('hex').slice(0, 16);
}

/**
 * Who a notice is. A real notice is its page (`recall:<key>`); a drill lives in its own namespace
 * (`drill:<key>:<gtin>`), so playing one never marks the real notice as seen or collides with its
 * anomalies.
 */
export function noticeIdentity(n: Pick<RecallNotice, 'url' | 'drill'>): {
	key: string;
	/** Infix of anomaly ids. */
	id: string;
	findingId: string;
} {
	const key = noticeKey(n.url);
	return n.drill
		? { key, id: `drill-${key}-${n.drill.gtin}`, findingId: `drill:${key}:${n.drill.gtin}` }
		: { key, id: key, findingId: `recall:${key}` };
}

const itemKey = (p: RecalledProduct) =>
	p.gtin?.replace(/\D/g, '') || p.name.toLowerCase().replace(/\s+/g, ' ').trim();
const ITEM_FIELDS = ['name', 'gtin', 'batch', 'bestBefore', 'packageSize'] as const;

/**
 * What a notice says, as a short hash: title, hazard and every recalled item's codes. The same page read
 * twice gives the same revision; an edited notice (a batch added, a product added) gives a new one.
 */
export function noticeRevision(n: RecallNotice): string {
	const items = n.products
		.map((p) => ITEM_FIELDS.map((f) => (p[f] ?? '').toString().trim().toLowerCase()).join('|'))
		.sort();
	const norm = JSON.stringify([n.title.trim(), n.hazard ?? '', items]);
	return createHash('sha256').update(norm).digest('hex').slice(0, 10);
}

export interface NoticeDiff {
	added: RecalledProduct[];
	removed: RecalledProduct[];
	changed: {
		item: RecalledProduct;
		field: (typeof ITEM_FIELDS)[number];
		from: string | null;
		to: string | null;
	}[];
}

/** Item-level difference between two reads of the same notice (items keyed by GTIN, else name). */
export function diffNotice(prev: RecallNotice, next: RecallNotice): NoticeDiff {
	const before = new Map(prev.products.map((p) => [itemKey(p), p]));
	const after = new Map(next.products.map((p) => [itemKey(p), p]));
	const out: NoticeDiff = { added: [], removed: [], changed: [] };
	for (const [k, p] of after) {
		const q = before.get(k);
		if (!q) {
			out.added.push(p);
			continue;
		}
		for (const f of ITEM_FIELDS)
			if ((q[f] ?? null) !== (p[f] ?? null))
				out.changed.push({ item: p, field: f, from: q[f] ?? null, to: p[f] ?? null });
	}
	for (const [k, p] of before) if (!after.has(k)) out.removed.push(p);
	return out;
}

/** Recalled items the diff touches (added or changed), as item keys. */
export const touchedItems = (d: NoticeDiff) =>
	new Set([...d.added, ...d.changed.map((c) => c.item)].map(itemKey));
export { itemKey as recalledItemKey };

export type MatchTier = 'gtin' | 'name' | 'supplier';

export interface RecallMatch {
	productId: string;
	productName: string;
	tier: MatchTier;
	/** 0–1: gtin 1.0; name = brand agreement × product-word overlap; supplier ≤ 0.3. */
	confidence: number;
	/** Which recalled item it matched, and why, in words a chef reads. */
	recalled: RecalledProduct;
	why: string;
}

/** Below this a match is a lead, not a product: it never sets `productId` on an anomaly. */
export const NAME_MATCH_MIN = 0.6;

/** The catalogue reads matching needs; the store and file catalogue both provide them. */
export interface CatalogIndex {
	byGtin(gtins: string[]): Promise<Product[]>;
	/** Products whose brand or vendor contains `term` (case-insensitive). */
	byBrandOrVendor(term: string, limit?: number): Promise<Product[]>;
}

const LEGAL = /\b(oy|oyj|ab|ky|oü|ltd|gmbh|as|a\/s|inc|suomi|finland|tuore|kuiva|pakaste)\b/g;
export function normCompany(s: string | null | undefined): string {
	return (s ?? '')
		.toLowerCase()
		.replace(/[®™©.,]/g, ' ')
		.replace(LEGAL, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** `term` appears in `name` as whole words ("sok" is not in "sokeri"). */
export function hasWords(name: string | null | undefined, term: string): boolean {
	if (!term) return false;
	return ` ${normCompany(name)} `.includes(` ${term} `);
}

const SIZE = /^\d+([.,]\d+)?(g|kg|l|dl|cl|ml|kpl|x)?$/;
const STOP = new Set(['ja', 'tai', 'with', 'and', 'the', 'laktoositon', 'lactose', 'free']);
/** Product words: lower-case, no brand words, sizes or filler. */
export function productWords(name: string, brand?: string | null): Set<string> {
	const brandWords = new Set(normCompany(brand).split(' ').filter(Boolean));
	return new Set(
		name
			.toLowerCase()
			.replace(/[®™©(),/%*]/g, ' ')
			.split(/\s+/)
			.filter((w) => w.length > 2 && !SIZE.test(w) && !STOP.has(w) && !brandWords.has(w))
	);
}

/**
 * Overlap of product words, counting a shared stem of ≥5 letters as a match (Finnish compounds:
 * "vanukas"/"suklaavanukas", "kananmuna"/"kananmunat").
 */
export function wordOverlap(a: Set<string>, b: Set<string>): number {
	if (!a.size || !b.size) return 0;
	let hit = 0;
	for (const x of a)
		for (const y of b)
			if (x === y || (x.length >= 5 && y.includes(x)) || (y.length >= 5 && x.includes(y))) {
				hit++;
				break;
			}
	return hit / a.size;
}

/** Match every recalled item against the catalogue; best match per product, strongest first. */
export async function matchNotice(notice: RecallNotice, idx: CatalogIndex): Promise<RecallMatch[]> {
	const best = new Map<string, RecallMatch>();
	const keep = (m: RecallMatch) => {
		const prev = best.get(m.productId);
		if (!prev || m.confidence > prev.confidence) best.set(m.productId, m);
	};

	const gtins = notice.products.map((p) => p.gtin?.replace(/\D/g, '')).filter(Boolean) as string[];
	if (gtins.length) {
		for (const prod of await idx.byGtin(gtins)) {
			const recalled = notice.products.find((p) => p.gtin?.replace(/\D/g, '') === prod.gtin)!;
			keep({
				productId: prod.productId,
				productName: prod.nameFi,
				tier: 'gtin',
				confidence: 1,
				recalled,
				why: `GTIN ${prod.gtin} is on the notice`
			});
		}
	}

	for (const r of notice.products) {
		const brand = normCompany(r.brand);
		const maker = normCompany(r.manufacturer);
		const want = productWords(r.name, r.brand);
		if (brand.length >= 3) {
			for (const prod of await idx.byBrandOrVendor(brand, 400)) {
				const brandOk = hasWords(prod.brand, brand);
				if (!brandOk) continue;
				const overlap = wordOverlap(want, productWords(prod.nameFi, prod.brand));
				if (overlap === 0) continue;
				keep({
					productId: prod.productId,
					productName: prod.nameFi,
					tier: 'name',
					confidence: round(0.4 + 0.5 * overlap),
					recalled: r,
					why: `brand ${r.brand} and ${Math.round(overlap * 100)}% of the product words match; no GTIN match`
				});
			}
		}
		for (const term of new Set([maker, brand].filter((t) => t.length >= 3))) {
			for (const prod of await idx.byBrandOrVendor(term, 400)) {
				const viaBrand = hasWords(prod.brand, term);
				const viaVendor = hasWords(prod.vendor, term);
				if (!viaBrand && !viaVendor) continue;
				keep({
					productId: prod.productId,
					productName: prod.nameFi,
					tier: 'supplier',
					confidence: viaBrand ? 0.3 : 0.25,
					recalled: r,
					why: viaBrand
						? `same brand (${prod.brand}); different product`
						: `same supplier (${prod.vendor}); different product`
				});
			}
		}
	}
	return [...best.values()].sort((a, b) => b.confidence - a.confidence);
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Matches strong enough to name a product on an anomaly. */
export const strongMatches = (ms: RecallMatch[]) =>
	ms.filter((m) => m.tier === 'gtin' || (m.tier === 'name' && m.confidence >= NAME_MATCH_MIN));

/** In-memory index over the file catalogue (fixture path and tests). */
export function memoryIndex(products: Iterable<Product>): CatalogIndex {
	const all = [...products];
	const byG = new Map(all.filter((p) => p.gtin).map((p) => [p.gtin!, p]));
	return {
		async byGtin(gtins) {
			return gtins.flatMap((g) => (byG.has(g) ? [byG.get(g)!] : []));
		},
		async byBrandOrVendor(term, limit = 400) {
			const t = term.toLowerCase();
			return all.filter((p) => hasWords(p.brand, t) || hasWords(p.vendor, t)).slice(0, limit);
		}
	};
}
