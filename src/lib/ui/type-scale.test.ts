/**
 * The type scale is six tokens (layout.css `--text-*`). Arbitrary sizes crept to 13 before; this keeps them out.
 * Classes are checked everywhere; inline `font-size: <n>px` in style blocks is checked on the shared kitchen paths.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(process.cwd(), 'src');

function files(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) return files(p);
		return /\.(svelte|ts)$/.test(name) ? [p] : [];
	});
}

const all = files(root).map((p) => ({
	path: relative(root, p).replaceAll('\\', '/'),
	text: readFileSync(p, 'utf-8')
}));

describe('type scale', () => {
	it('uses text-display|title|heading|body|meta|micro, never text-[<n>px]', () => {
		const hits = all.flatMap((f) =>
			[...f.text.matchAll(/\btext-\[\d[\d.]*(px|rem|em)\]/g)].map((m) => `${f.path}: ${m[0]}`)
		);
		expect(hits).toEqual([]);
	});

	it('style blocks in shared UI and the kitchen use var(--text-*), not pixel sizes', () => {
		const owned = all.filter(
			(f) => f.path.startsWith('lib/ui/') || f.path.startsWith('routes/(kitchen)/')
		);
		const hits = owned.flatMap((f) =>
			[...f.text.matchAll(/font-size:\s*\d[\d.]*px/g)].map((m) => `${f.path}: ${m[0]}`)
		);
		expect(hits).toEqual([]);
	});
});
