import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ImageReading } from '$lib/core/contracts';
import { createLlmRouter } from '../adapters/llm/router';
import { readImage } from './read';

/**
 * The vision model on the three sample pictures, opt-in only (real Verda calls):
 *   IMAGE_LIVE=1 node --env-file=.env node_modules/vitest/vitest.mjs run --project server src/lib/server/images/live.test.ts
 * Per picture: latency, kind right, and line recall/precision against the hand-written expected reading (a line
 * matches when its quantity is equal and its product words overlap). Report: scratch/image-live.json.
 */
const book = (
	JSON.parse(readFileSync(join(process.cwd(), 'fixtures', 'images', 'readings.json'), 'utf-8')) as {
		readings: Record<string, { file: string; reading: ImageReading }>;
	}
).readings;

const words = (s: string) =>
	new Set(
		s
			.toLowerCase()
			.split(/[^a-zåäö0-9]+/)
			.filter((w) => w.length > 2)
	);
const matches = (a: ImageReading['lines'][number], b: ImageReading['lines'][number]) =>
	a.qty === b.qty &&
	[...words(`${a.productHint ?? ''} ${a.text}`)].some((w) =>
		words(`${b.productHint ?? ''} ${b.text}`).has(w)
	);

describe.skipIf(process.env.IMAGE_LIVE !== '1')('read_image on Nemotron (live)', () => {
	it('reads the three samples', { timeout: 300_000 }, async () => {
		const llm = createLlmRouter({ ...process.env, LLM_PROVIDER: 'gemini' } as never).for(
			'image.read'
		);
		const rows = [];
		for (const { file, reading: gold } of Object.values(book)) {
			const r = await readImage(
				{
					imageBase64: readFileSync(`fixtures/images/${file}`).toString('base64'),
					mimeType: 'image/png'
				},
				{ llm }
			);
			if (!r.ok) {
				rows.push({ file, error: r.error.message });
				continue;
			}
			const got = r.value.reading;
			const hit = gold.lines.filter((g) => got.lines.some((l) => matches(l, g))).length;
			const right = got.lines.filter((l) => gold.lines.some((g) => matches(l, g))).length;
			rows.push({
				file,
				latencyMs: r.value.latencyMs,
				kind: got.kind === gold.kind,
				recall: +(hit / gold.lines.length).toFixed(2),
				precision: got.lines.length ? +(right / got.lines.length).toFixed(2) : 0,
				confidence: got.confidence
			});
		}
		mkdirSync('scratch', { recursive: true });
		writeFileSync('scratch/image-live.json', JSON.stringify(rows, null, 1));
		console.log(JSON.stringify(rows));
		expect(rows).toHaveLength(3);
	});
});
