/**
 * Exa adapter: `POST /search` with highlights (the `Web` port) and with an `outputSchema`, which returns
 * structured fields plus per-field grounding (citation URLs and a confidence label). Plain fetch, no SDK.
 */
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
	grounding: Grounding[];
	results: ExaResult[];
	at: string;
	cached: boolean;
	latencyMs: number;
	costUsd?: number;
}

export interface StructuredQuery {
	query: string;
	systemPrompt: string;
	schema: object;
	/** Focus for the excerpts returned with each result (the quotes the UI shows). */
	highlightsQuery?: string;
	numResults?: number;
	includeDomains?: string[];
	/** Stable id for the recorded answer the fixture adapter replays ("facts:460002"). */
	key: string;
}

export interface FactSearch extends Web {
	readonly mode: 'live' | 'fixture';
	structured<T>(q: StructuredQuery): Promise<Structured<T>>;
}

interface ExaSearchBody {
	results?: (ExaResult & { text?: string })[];
	output?: { content?: unknown; grounding?: Grounding[] };
	costDollars?: { total?: number };
}

const trimResult = (r: ExaResult): ExaResult => ({
	url: r.url,
	title: r.title,
	publishedDate: r.publishedDate ?? null,
	highlights: (r.highlights ?? []).map((h) => h.slice(0, 700))
});

export function createExa(call: WebCall): FactSearch {
	return {
		mode: 'live',
		async search(query, opts = {}) {
			const r = await call<ExaSearchBody>(
				'/search',
				{ query, type: 'auto', numResults: opts.limit ?? 5, contents: { highlights: true } },
				{ purpose: 'search' }
			);
			return (r.body.results ?? []).map((x) => ({
				url: x.url,
				title: x.title,
				text: x.highlights?.join('\n…\n')
			}));
		},
		async structured<T>(q: StructuredQuery): Promise<Structured<T>> {
			const r = await call<ExaSearchBody>(
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
				{ purpose: q.key }
			);
			const content = r.body.output?.content;
			return {
				content: (typeof content === 'object' && content !== null ? content : null) as T | null,
				grounding: r.body.output?.grounding ?? [],
				results: (r.body.results ?? []).map(trimResult),
				at: r.at,
				cached: r.cached,
				latencyMs: r.latencyMs,
				costUsd: r.cost?.usd
			};
		}
	};
}
