/**
 * Seeds Postgres with the Valio catalogue and cached Valio API responses, so builds without data/valio/
 * (third-party data, gitignored) can serve the Catalog port from the `products` and `offer_cache` tables.
 *
 *   node --env-file=.env scripts/seed-db.ts [--dir data/valio] [--customer 123] [--dry-run]
 *
 * Self-contained on purpose: Node runs this file directly (type stripping) and cannot resolve `$lib`, so it reads
 * the JSON itself and writes with parameterised SQL. The row mapping matches rowsFromCacheFile in
 * src/lib/server/adapters/catalog/pg.ts. It does not run migrations; run the app's migrator / drizzle-kit migrate
 * first. Idempotent: products are upserted, cache rows keep the newer fetched_at.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import postgres from 'postgres';

const BATCH = 500;
const t0 = Date.now();

const { values: args } = parseArgs({
	options: {
		dir: { type: 'string', default: join('data', 'valio') },
		customer: { type: 'string' },
		'dry-run': { type: 'boolean', default: false }
	}
});
const dir = args.dir!;
const dryRun = args['dry-run']!;

function fail(msg: string): never {
	console.error(`seed-db: ${msg}`);
	process.exit(1);
}

const productsFile = join(dir, 'normalized', 'products.json');
if (!existsSync(productsFile))
	fail(
		`${productsFile} not found. Build it with \`pnpm vitest run --project server src/lib/server/adapters\` ` +
			`(loadCatalogue in src/lib/server/adapters/catalog/valio.ts writes it from the raw Valio files in ${dir}).`
	);

interface ProductDoc {
	productId: string;
	nameFi: string;
	nameEn?: string;
	category: string;
	isFood: boolean;
}
interface CacheRow {
	endpoint: 'price' | 'availability';
	customer: string;
	requested_date: string;
	product_id: string;
	body: unknown;
	fetched_at: string;
}

const docs: ProductDoc[] = JSON.parse(readFileSync(productsFile, 'utf-8'));

/** Newest entry per primary key across all cache files; non-2xx responses carry no entries. */
const cache = new Map<string, CacheRow>();
let files = 0;
let skippedFiles = 0;
for (const endpoint of ['price', 'availability'] as const) {
	const folder = join(dir, 'cache', endpoint);
	if (!existsSync(folder)) continue;
	for (const f of readdirSync(folder)) {
		if (!f.endsWith('.json')) continue;
		files++;
		const rec = JSON.parse(readFileSync(join(folder, f), 'utf-8'));
		if (!(rec.status >= 200 && rec.status < 300)) {
			skippedFiles++;
			continue;
		}
		const customer = String(rec.customer);
		if (args.customer && customer !== args.customer) continue;
		for (const e of rec.body?.products ?? []) {
			if (e?.productId === undefined || e?.productId === null) continue;
			const row: CacheRow = {
				endpoint,
				customer,
				requested_date: String(rec.requestedDate),
				product_id: String(e.productId),
				body: e,
				fetched_at: String(rec.fetched_at)
			};
			const k = `${endpoint}|${customer}|${row.requested_date}|${row.product_id}`;
			const prev = cache.get(k);
			if (!prev || Date.parse(prev.fetched_at) < Date.parse(row.fetched_at)) cache.set(k, row);
		}
	}
}
const cacheRows = [...cache.values()];

console.log(
	`seed-db: ${docs.length} products, ${cacheRows.length} offer_cache rows ` +
		`(from ${files} cache files, ${skippedFiles} non-2xx skipped)` +
		(args.customer ? `, customer ${args.customer}` : '')
);
if (dryRun) {
	console.log(`seed-db: dry run, nothing written (${Date.now() - t0} ms)`);
	process.exit(0);
}

const url = process.env.DATABASE_URL;
if (!url)
	fail(
		'DATABASE_URL is not set. Load it yourself, e.g. `node --env-file=.env scripts/seed-db.ts`.'
	);

const host = new URL(url).hostname;
const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
const ca = process.env.PG_CA_CERT;
const sql = postgres(url, {
	ssl: ca ? { ca } : local ? false : 'require',
	max: 1,
	onnotice: () => {}
});

try {
	const [t] = await sql<{ products: string | null; offer_cache: string | null }[]>`
		select to_regclass('public.products')::text as products,
		       to_regclass('public.offer_cache')::text as offer_cache`;
	if (!t.products || !t.offer_cache)
		fail(
			'tables products/offer_cache are missing. This script does not run migrations: ' +
				'run `pnpm drizzle-kit migrate` (or start the app with its migrator) against DATABASE_URL first.'
		);

	for (let i = 0; i < docs.length; i += BATCH) {
		const part = docs.slice(i, i + BATCH);
		await sql`
			insert into products (product_id, name_fi, name_en, category, is_food, doc)
			select x.product_id, x.name_fi, x.name_en, x.category, x.is_food, x.doc
			from jsonb_to_recordset(${sql.json(
				part.map((p) => ({
					product_id: p.productId,
					name_fi: p.nameFi,
					name_en: p.nameEn ?? null,
					category: p.category,
					is_food: p.isFood,
					doc: p
				})) as never
			)}::jsonb) as x(product_id text, name_fi text, name_en text, category text, is_food boolean, doc jsonb)
			on conflict (product_id) do update set
				name_fi = excluded.name_fi, name_en = excluded.name_en, category = excluded.category,
				is_food = excluded.is_food, doc = excluded.doc`;
		process.stdout.write(`\rseed-db: products ${Math.min(i + BATCH, docs.length)}/${docs.length}`);
	}
	process.stdout.write('\n');

	let written = 0;
	for (let i = 0; i < cacheRows.length; i += BATCH) {
		const part = cacheRows.slice(i, i + BATCH);
		const res = await sql`
			insert into offer_cache (endpoint, customer, requested_date, product_id, body, fetched_at)
			select x.endpoint, x.customer, x.requested_date, x.product_id, x.body, x.fetched_at
			from jsonb_to_recordset(${sql.json(part as never)}::jsonb)
				as x(endpoint text, customer text, requested_date text, product_id text, body jsonb, fetched_at timestamptz)
			on conflict (endpoint, customer, requested_date, product_id) do update set
				body = excluded.body, fetched_at = excluded.fetched_at
			where offer_cache.fetched_at < excluded.fetched_at`;
		written += res.count;
		process.stdout.write(
			`\rseed-db: offer_cache ${Math.min(i + BATCH, cacheRows.length)}/${cacheRows.length}`
		);
	}
	process.stdout.write('\n');
	console.log(
		`seed-db: done. ${docs.length} products upserted, ${written}/${cacheRows.length} offer_cache rows ` +
			`inserted or refreshed (older ones kept), ${((Date.now() - t0) / 1000).toFixed(1)} s`
	);
} finally {
	await sql.end();
}
