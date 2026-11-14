import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ImageReading } from '$lib/core/contracts';
import { createLlmRouter } from '../adapters/llm/router';
import { readImage } from './read';
import { meetsBar, scoreReading, VISION_BAR } from './score';

/**
 * The vision model on the three sample pictures, opt-in only (real Verda calls):
 *   IMAGE_LIVE=1 node --env-file=.env node_modules/vitest/vitest.mjs run --project server src/lib/server/images/live.test.ts
 * Per picture: latency, kind right, and line recall/precision against the hand-written expected reading (score.ts:
 * quantity and unit agree, product words overlap, one-to-one). Passes only when every picture is read and the
 * readings meet VISION_BAR; failed calls stay in the report as rows. Report: scratch/image-live.json.
 */
const book = (
	JSON.parse(readFileSync(join(process.cwd(), 'fixtures', 'images', 'readings.json'), 'utf-8')) as {
		readings: Record<string, { file: string; reading: ImageReading }>;
	}
).readings;

describe.skipIf(process.env.IMAGE_LIVE !== '1')('read_image on Nemotron (live)', () => {
	it('reads the three samples', { timeout: 300_000 }, async () => {
		const llm = createLlmRouter({ ...process.env, LLM_PROVIDER: 'gemini' } as never).for(
			'image.read'
		);
		const rows: Record<string, unknown>[] = [];
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
			rows.push({
				file,
				latencyMs: r.value.latencyMs,
				confidence: r.value.reading.confidence,
				...scoreReading(gold, r.value.reading)
			});
		}
		mkdirSync('scratch', { recursive: true });
		writeFileSync('scratch/image-live.json', JSON.stringify(rows, null, 1));
		console.log(JSON.stringify(rows));
		expect(rows).toHaveLength(3);
		expect(meetsBar(rows as never), `the bar: ${JSON.stringify(VISION_BAR)}`).toEqual([]);
	});
});
