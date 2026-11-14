/**
 * The served image holds build/ and fixtures/, never src/. A server module that reads a file under src/ at runtime
 * works in dev and tests and fails on the deployed app (replay.json, then listings.json, the second a 500 on every
 * product card). Such data is imported, so Vite bundles it. This scans every non-test module under src/lib/server and
 * src/routes for a file read (readFileSync, readFile, createReadStream) in a module that also names a path under src/.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOTS = ['src/lib/server', 'src/routes'];
const SKIP = /\.(test|spec|e2e)\.ts$/;
const READ = /\b(readFileSync|readFile|createReadStream)\s*\(/;
/** A string that starts a path under src/: 'src/…', './src/…', or a bare 'src' segment in join/resolve. */
const SRC_PATH = /(['"`])(\.\/)?src(\/[^'"`]*)?\1/;

function modules(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const p = join(dir, e.name);
		if (e.isDirectory()) return modules(p);
		return /\.(ts|js)$/.test(e.name) && !SKIP.test(e.name) ? [p] : [];
	});
}

/** Lines that name a src/ path, in modules that read files at runtime. */
export function srcReads(files: { path: string; text: string }[]): string[] {
	return files.flatMap(({ path, text }) =>
		READ.test(text)
			? text
					.split('\n')
					.map((line, i) => ({ line, i }))
					.filter(({ line }) => SRC_PATH.test(line) && !line.trim().startsWith('//'))
					.map(({ line, i }) => `${path}:${i + 1}: ${line.trim()}`)
			: []
	);
}

describe('no runtime reads under src/', () => {
	it('finds the shape that broke the product card (self-test)', () => {
		const bad = `import { readFileSync } from 'node:fs';
const l = JSON.parse(readFileSync(join(process.cwd(), 'src/lib/server/web/fixtures/listings.json'), 'utf-8'));`;
		const ok = `import listings from '$lib/server/web/fixtures/listings.json';
import { readFileSync } from 'node:fs';
const k = readFileSync(join(process.cwd(), 'fixtures/seeds/kitchens.json'), 'utf-8');`;
		expect(srcReads([{ path: 'bad.ts', text: bad }])).toHaveLength(1);
		expect(srcReads([{ path: 'ok.ts', text: ok }])).toEqual([]);
		expect(srcReads([{ path: 'seg.ts', text: `readFile(resolve('src', 'x.json'))` }])).toHaveLength(
			1
		);
	});

	it('no server module or route reads a file under src/ at runtime (import it instead)', () => {
		const files = ROOTS.flatMap(modules).map((p) => ({
			path: relative(process.cwd(), p).replaceAll('\\', '/'),
			text: readFileSync(p, 'utf-8')
		}));
		expect(files.length, 'scanned modules').toBeGreaterThan(50);
		expect(srcReads(files)).toEqual([]);
	});
});
