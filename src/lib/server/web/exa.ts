/**
 * Exa adapter: `POST /search` with highlights (the `Web` port) and with an `outputSchema`, which returns
 * structured fields plus per-field grounding (citation URLs and a confidence label). Plain fetch, no SDK.
 * Every response is parsed at runtime (zod): malformed results are dropped, structured content that
 * fails its schema becomes `null` and is not cached.
 */
import { z } from 'zod';
import type { Web } from '$lib/core/ports';
import type { WebCall } from './http';

export interface ExaResult {
	url: string;
	title: string;
	publishedDate?: string | null;
	highlights?: string[];
}

export interface Grounding {
	field: string;
	citations: { url: string; title?: string }[];
	confidence?: string;
}

export interface Structured<T> {
	content: T | null;
	/** Why `content` is null although Exa returned output (schema mismatch). */
	invalid?: string;
	grounding: Grounding[];
	results: ExaResult[];
	at: string;
	cached: boolean;
	latencyMs: number;
	costUsd?: number;
}

export interface StructuredQuery<T = unknown> {
	query: string;
	systemPrompt: string;
	schema: object;
	/** Runtime shape of `output.content`; the JSON Schema above is what Exa is asked for. */
	parse: z.ZodType<T>;
	/** Focus for the excerpts returned with each result (the quotes the UI shows). */
	highlightsQuery?: string;
	numResults?: number;
	includeDomains?: string[];
	/** Stable id for the recorded answer the fixture adapter replays ("facts:460002"). */
	key: string;
	/** A parsed answer that found nothing worth keeping for the day (no option, no fact). */
	empty?: (content: T) => boolean;
}

export interface FactSearch extends Web {
	readonly mode: 'live' | 'fixture';
	structured<T>(q: StructuredQuery<T>): Promise<Structured<T>>;
}

const ExaResultZ = z.object({
	url: z.url(),
	title: z
		.string()
		.nullish()
		.transform((v) => v ?? ''),
	publishedDate: z.string().nullish(),
	highlights: z.array(z.string()).nullish().catch(null)
});
const GroundingZ = z.object({
	field: z.string(),
	citations: z
		.array(z.object({ url: z.url(), title: z.string().nullish() }))
		.catch([])
		.transform((cs) => cs.map((c) => ({ url: c.url, ...(c.title ? { title: c.title } : {}) }))),
	confidence: z.string().nullish()
});

/** Keeps the items that parse, drops the rest (one bad result never loses the others). */
const each = <T extends z.ZodType>(item: T) =>
	z
		.array(z.unknown())
		.nullish()
		.catch(null)
		.transform((xs) =>
			(xs ?? []).flatMap((x) => {
				const p = item.safeParse(x);
				return p.success ? [p.data as z.output<T>] : [];
			})
		);

export const ExaSearchBody = z.object({
	results: each(ExaResultZ),
	output: z
		.object({ content: z.unknown(), grounding: each(GroundingZ) })
		.nullish()
		.catch(null),
	costDollars: z.object({ total: z.number().optional() }).nullish().catch(null)
});
export type ExaSearchBody = z.output<typeof ExaSearchBody>;

/** Shapes a raw `/search` body (live or recorded) into `Structured` content, validated by `parse`. */
export function shapeStructured<T>(
	raw: unknown,
	parse: z.ZodType<T>
): Pick<Structured<T>, 'content' | 'invalid' | 'grounding' | 'results'> {
	const b = ExaSearchBody.parse(raw ?? {});
	const out = b.output;
	let content: T | null = null;
	let invalid: string | undefined;
	if (out && out.content !== null && out.content !== undefined) {
		const p = parse.safeParse(out.content);
		if (p.success) content = p.data;
		else invalid = p.error.issues[0]?.message ?? 'output does not match the schema';
	}
	return {
		content,
		...(invalid ? { invalid } : {}),
		grounding: (out?.grounding ?? []).map((g) => ({
			field: g.field,
			citations: g.citations,
			...(g.confidence ? { confidence: g.confidence } : {})
		})),
		results: b.results.map(trimResult)
	};
}

const trimResult = (r: z.output<typeof ExaResultZ> | ExaResult): ExaResult => ({
	url: r.url,
	title: r.title ?? '',
	publishedDate: r.publishedDate ?? null,
	highlights: (r.highlights ?? []).map((h) => h.slice(0, 700))
});

export function createExa(call: WebCall): FactSearch {
	return {
		mode: 'live',
		async search(query, opts = {}) {
			const r = await call<unknown>(
				'/search',
				{ query, type: 'auto', numResults: opts.limit ?? 5, contents: { highlights: true } },
				{ purpose: 'search', accept: (b) => ExaSearchBody.safeParse(b).success }
			);
			return ExaSearchBody.parse(r.body ?? {}).results.map((x) => ({
				url: x.url,
				title: x.title,
				text: x.highlights?.join('\n…\n')
			}));
		},
		async structured<T>(q: StructuredQuery<T>): Promise<Structured<T>> {
			const r = await call<unknown>(
				'/search',
				{
					query: q.query,
					type: 'auto',
					numResults: q.numResults ?? 5,
					systemPrompt: q.systemPrompt,
					outputSchema: q.schema,
					...(q.includeDomains ? { includeDomains: q.includeDomains } : {}),
					contents: {
						highlights: q.highlightsQuery
							? { query: q.highlightsQuery, maxCharacters: 600 }
							: { maxCharacters: 600 }
					}
				},
				{
					purpose: q.key,
					accept: (b) => shapeStructured(b, q.parse).content !== null,
					// Nothing found is reused for minutes only: a later read asks Exa again.
					shortLived: (b) => {
						const c = shapeStructured(b, q.parse).content;
						return c === null || (q.empty?.(c) ?? false);
					}
				}
			);
			return {
				...shapeStructured(r.body, q.parse),
				at: r.at,
				cached: r.cached,
				latencyMs: r.latencyMs,
				costUsd: r.cost?.usd
			};
		}
	};
}
