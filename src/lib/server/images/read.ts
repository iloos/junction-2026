/**
 * Reading a picture (a prep list, a delivery note, a product label) into an ImageReading. The image is validated
 * (JPEG, PNG or WebP by its bytes, at most 4 MB), sent once to the vision model (router job `image.read`: Nemotron
 * 3.5 Super VL on Verda) with a JSON-schema prompt, and parsed. The image is never stored: only the reading leaves
 * this function. Without a model (fixture mode) the sample pictures in fixtures/images/ answer from their
 * hand-written expected readings, labelled `fixture`; any other picture is refused rather than guessed.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { err, ok, ImageReading, type Result } from '$lib/core/contracts';
import type { Llm } from '$lib/core/ports';
import { LimitError } from '../external/ledger';

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

export interface ReadImageInput {
	imageBase64: string;
	mimeType: string;
	purpose?: string;
}
export interface ReadImageResult {
	reading: ImageReading;
	/** live = the vision model read it now; fixture = a sample picture's hand-written reading. */
	source: 'live' | 'fixture';
	model: string;
	latencyMs: number;
	bytes: number;
}

/** The picture's own bytes say which format it is; the declared type must agree. */
export function sniff(b: Uint8Array): ImageType | null {
	if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
	if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
	const ascii = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
	if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
	return null;
}

const SCHEMA = {
	type: 'object',
	required: ['kind', 'lines', 'confidence'],
	properties: {
		kind: { enum: ['list', 'delivery_note', 'label', 'other'] },
		lines: {
			type: 'array',
			maxItems: 60,
			items: {
				type: 'object',
				required: ['text'],
				properties: {
					text: { type: 'string', description: 'the line as written' },
					qty: {
						type: ['number', 'null'],
						description: 'for a delivery note: the delivered amount'
					},
					unit: { type: ['string', 'null'], description: 'as written: kg, g, l, ST, pcs …' },
					productHint: {
						type: ['string', 'null'],
						description: 'the product name or code as written (a GTIN/EAN when printed)'
					}
				}
			}
		},
		notes: {
			type: ['string', 'null'],
			description: 'anything else that matters: dates, shortages, allergens'
		},
		confidence: { type: 'number', minimum: 0, maximum: 1 }
	}
};

const SYSTEM = `You read photos and scans for a professional kitchen's purchasing assistant. Report only what is written in the picture, in its own language; never invent a line, a quantity or a product. One line per item. Answer with JSON only, matching this schema: ${JSON.stringify(SCHEMA)}`;

/** Model JSON → ImageReading: nulls dropped, then validated with the contract. */
export function parseReading(text: string): ImageReading | null {
	let raw: unknown;
	try {
		raw = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
	} catch {
		return null;
	}
	const drop = (o: unknown): unknown =>
		Array.isArray(o)
			? o.map(drop)
			: o && typeof o === 'object'
				? Object.fromEntries(
						Object.entries(o).flatMap(([k, v]) => (v === null ? [] : [[k, drop(v)]]))
					)
				: o;
	const p = ImageReading.safeParse(drop(raw));
	return p.success ? p.data : null;
}

let fixtureBook: Record<string, { file: string; reading: ImageReading }> | null = null;
function fixtureReading(sha: string) {
	fixtureBook ??= (
		JSON.parse(
			readFileSync(join(process.cwd(), 'fixtures', 'images', 'readings.json'), 'utf-8')
		) as { readings: Record<string, { file: string; reading: ImageReading }> }
	).readings;
	return fixtureBook[sha];
}

/**
 * The service the chat dock, /request and the read_image tool call. `llm` is the router's `image.read` job (null in
 * fixture mode).
 */
export async function readImage(
	input: ReadImageInput,
	d: { llm: Llm | null; signal?: AbortSignal }
): Promise<Result<ReadImageResult>> {
	const t0 = performance.now();
	if (!(IMAGE_TYPES as readonly string[]).includes(input.mimeType))
		return err('INVALID_INPUT', `send a JPEG, PNG or WebP picture, not ${input.mimeType}`);
	const b64 = input.imageBase64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
	if (!/^[A-Za-z0-9+/]+=*$/.test(b64)) return err('INVALID_INPUT', 'imageBase64 is not base64');
	const bytes = Buffer.from(b64, 'base64');
	if (bytes.length > MAX_IMAGE_BYTES)
		return err(
			'INVALID_INPUT',
			`the picture is ${(bytes.length / 1048576).toFixed(1)} MB; the limit is 4 MB`
		);
	const kind = sniff(bytes);
	if (kind !== input.mimeType)
		return err(
			'INVALID_INPUT',
			`the bytes are ${kind ?? 'not a JPEG, PNG or WebP'}, not ${input.mimeType}`
		);

	if (!d.llm) {
		const hit = fixtureReading(createHash('sha256').update(bytes).digest('hex'));
		if (!hit)
			return err(
				'PROVIDER_UNAVAILABLE',
				'no vision model in fixture mode; only the sample pictures in fixtures/images/ have readings'
			);
		return ok({
			reading: hit.reading,
			source: 'fixture',
			model: `fixture (${hit.file})`,
			latencyMs: Math.round(performance.now() - t0),
			bytes: bytes.length
		});
	}
	try {
		const r = await d.llm.generate({
			system: SYSTEM,
			prompt: `Read this picture.${input.purpose ? ` It is for: ${input.purpose.slice(0, 200)}.` : ''}`,
			images: [{ mimeType: input.mimeType, base64: b64 }],
			maxTokens: 1500,
			json: true,
			signal: d.signal
		});
		const reading = parseReading(r.text);
		if (!reading)
			return err(
				'PROVIDER_UNAVAILABLE',
				'the vision model answer did not match the reading schema'
			);
		return ok({
			reading,
			source: 'live',
			model: r.model,
			latencyMs: r.latencyMs,
			bytes: bytes.length
		});
	} catch (e) {
		if (e instanceof LimitError)
			return err('PROVIDER_UNAVAILABLE', e.message, {
				sub: e.reason === 'rate-limit' ? 'rate_limit' : 'daily_cap',
				detail: { api: 'verda', retryAfter: e.retryAfterS }
			});
		return err(
			'PROVIDER_UNAVAILABLE',
			`the vision model failed: ${String((e as Error)?.message ?? e).slice(0, 200)}`
		);
	}
}
