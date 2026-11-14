/**
 * Scores an image reading against a hand-written expected one. A line matches when its quantity and unit agree (units
 * compared case-insensitively, a missing unit matches only a missing unit) and its product words overlap. Matching
 * is one-to-one: a line read twice counts once, the duplicate is a wrong line.
 */
import type { ImageReading } from '$lib/core/contracts';

type Line = ImageReading['lines'][number];

const words = (s: string) =>
	new Set(
		s
			.toLowerCase()
			.split(/[^a-zåäö0-9]+/)
			.filter((w) => w.length > 2)
	);
const unit = (u?: string) => (u ?? '').trim().toLowerCase();

export function lineMatches(a: Line, b: Line): boolean {
	if (a.qty !== b.qty || unit(a.unit) !== unit(b.unit)) return false;
	const wb = words(`${b.productHint ?? ''} ${b.text}`);
	return [...words(`${a.productHint ?? ''} ${a.text}`)].some((w) => wb.has(w));
}

export interface ReadingScore {
	kindRight: boolean;
	/** Expected lines found, matched one-to-one. */
	recall: number;
	/** Read lines that match an expected line, one-to-one. */
	precision: number;
	matched: number;
}

export function scoreReading(gold: ImageReading, got: ImageReading): ReadingScore {
	const free = new Set(gold.lines.map((_, i) => i));
	let matched = 0;
	for (const l of got.lines) {
		const i = [...free].find((j) => lineMatches(l, gold.lines[j]));
		if (i === undefined) continue;
		free.delete(i);
		matched++;
	}
	return {
		kindRight: got.kind === gold.kind,
		recall: gold.lines.length ? matched / gold.lines.length : 1,
		precision: got.lines.length ? matched / got.lines.length : 0,
		matched
	};
}

/** The bar for calling the live reader usable: every picture read, kinds right, lines mostly right. */
export const VISION_BAR = { minRecall: 0.5, meanRecall: 0.7, meanPrecision: 0.7 } as const;

export function meetsBar(rows: ({ error: string } | ReadingScore)[]): string[] {
	const misses: string[] = [];
	const ok = rows.filter((r): r is ReadingScore => !('error' in r));
	if (ok.length !== rows.length)
		misses.push(`${rows.length - ok.length} of ${rows.length} readings failed`);
	if (!ok.length) return misses;
	if (ok.some((r) => !r.kindRight)) misses.push('a picture read as the wrong kind');
	if (ok.some((r) => r.recall < VISION_BAR.minRecall))
		misses.push(`a picture below recall ${VISION_BAR.minRecall}`);
	const mean = (f: (r: ReadingScore) => number) => ok.reduce((s, r) => s + f(r), 0) / ok.length;
	if (mean((r) => r.recall) < VISION_BAR.meanRecall)
		misses.push(`mean recall ${mean((r) => r.recall).toFixed(2)} < ${VISION_BAR.meanRecall}`);
	if (mean((r) => r.precision) < VISION_BAR.meanPrecision)
		misses.push(
			`mean precision ${mean((r) => r.precision).toFixed(2)} < ${VISION_BAR.meanPrecision}`
		);
	return misses;
}
