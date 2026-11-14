/**
 * Handlers for the planned web tools (`contracts/tools-next.ts`): `lookup_facts`, `find_outside`,
 * `check_recall`. Each runs under a `WebExecutionContext` (the caller's workspace, run and spend key),
 * validates its input and output against the planned schema, and returns a `Result`. The lead moves the
 * schemas into the registry and points the tool layer at `createWebTools(env)`.
 * - lookup_facts and find_outside call Exa (cached; uncached calls count against the caller's daily cap)
 *   and record nothing on the plan or the product.
 * - check_recall reads the watched notices already on file; it never calls the network.
 */
import type { z } from 'zod';
import { err, ok, type DomainError, type Result } from '$lib/core/contracts';
import { plannedToolSchemas, type WebFact } from '$lib/core/contracts/tools-next';
import type { WebExecutionContext } from '$lib/core/ports';
import type { RecallSource } from './contextdev';
import type { FactSearch } from './exa';
import type { Findings } from './findings';
import type { RecallFindingData } from './ingest';
import { findOutside, lookupFacts } from './lookup';
import { WebLimitError } from './spend';

type In<N extends keyof typeof plannedToolSchemas> = z.infer<
	(typeof plannedToolSchemas)[N]['input']
>;
type Out<N extends keyof typeof plannedToolSchemas> = z.infer<
	(typeof plannedToolSchemas)[N]['output']
>;
export type WebToolName = 'lookup_facts' | 'find_outside' | 'check_recall';

export interface WebToolDeps {
	/** The paid clients for this caller, charged to `w.spendKey`. */
	clients(w: WebExecutionContext): { exa: FactSearch; recalls: RecallSource };
	findings: Findings;
}

/** Notices with no match listed after the matching ones, at most this many. */
export const MAX_UNMATCHED = 10;

/** A cap or a provider rate limit as a domain error the caller can wait out. */
export function webError(e: unknown): { ok: false; error: DomainError } {
	if (e instanceof WebLimitError)
		return err('PROVIDER_UNAVAILABLE', e.message, {
			sub: e.reason === 'rate-limit' ? 'rate_limit' : 'daily_cap',
			detail: { api: e.api, retryAfter: e.retryAfterS }
		});
	const msg = e instanceof Error ? e.message : String(e);
	if (/^unknown product/.test(msg)) return err('NOT_FOUND', msg);
	return err('PROVIDER_UNAVAILABLE', msg);
}

function checked<N extends WebToolName>(name: N, value: Out<N>): Result<Out<N>> {
	const p = plannedToolSchemas[name].output.safeParse(value);
	return p.success
		? ok(p.data as Out<N>)
		: err('INTERNAL', `${name} output: ${p.error.issues[0]?.message ?? 'invalid'}`);
}

function input<N extends WebToolName>(
	name: N,
	raw: unknown
): In<N> | { ok: false; error: DomainError } {
	const p = plannedToolSchemas[name].input.safeParse(raw ?? {});
	return p.success
		? (p.data as In<N>)
		: err(
				'INVALID_INPUT',
				p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
			);
}
const isErr = (x: unknown): x is { ok: false; error: DomainError } =>
	typeof x === 'object' && x !== null && (x as { ok?: unknown }).ok === false;

export function createWebTools(d: WebToolDeps) {
	return {
		async lookup_facts(w: WebExecutionContext, raw: unknown): Promise<Result<Out<'lookup_facts'>>> {
			const i = input('lookup_facts', raw);
			if (isErr(i)) return i;
			try {
				const r = await lookupFacts(
					{ productId: i.productId, question: i.question },
					{
						exa: d.clients(w).exa,
						catalog: w.ports.catalog,
						findings: d.findings,
						workspaceId: w.ctx.workspaceId
					}
				);
				const facts: WebFact[] = r.suggestions.map((s) => ({
					field: s.field,
					value: s.value,
					gtinCited: s.gtinCited,
					sources: s.sources
						.slice(0, 10)
						.map((x) => ({ url: x.url, ...(x.title ? { title: x.title } : {}) })),
					provenance: {
						source: 'web',
						at: r.at,
						ref: s.sources[0].url,
						note: `Exa search, ${s.gtinCited ? 'a cited page mentions this GTIN' : 'matched by name only'}; a suggestion, never a catalogue fact`
					}
				}));
				return checked('lookup_facts', {
					facts,
					cached: r.cached,
					meta: {
						summary: facts.length
							? `${facts.length} web fact(s) for ${r.productName}, with sources; ${facts.filter((f) => f.gtinCited).length} cite its GTIN. Catalogue facts win.`
							: `${r.note} (${r.productName})`.slice(0, 400)
					}
				});
			} catch (e) {
				return webError(e);
			}
		},

		async find_outside(w: WebExecutionContext, raw: unknown): Promise<Result<Out<'find_outside'>>> {
			const i = input('find_outside', raw);
			if (isErr(i)) return i;
			try {
				const r = await findOutside(i.need.trim(), {
					exa: d.clients(w).exa,
					catalog: w.ports.catalog,
					findings: d.findings,
					workspaceId: w.ctx.workspaceId,
					...(i.amount ? { context: `${i.amount.value} ${i.amount.unit}` } : {})
				});
				// No citation, no option.
				const options = r.options
					.filter((o) => o.sources.length)
					.map((o) => {
						const mapped = o.ingredients.filter((x) => x.catalogue.length).length;
						const note = [
							o.kind.replace('_', ' '),
							o.yield && `yield ${o.yield}`,
							o.note,
							o.ingredients.length &&
								`${mapped}/${o.ingredients.length} ingredients have catalogue matches`
						]
							.filter(Boolean)
							.join('; ');
						return {
							title: o.title,
							url: o.sources[0].url,
							...(note ? { note: note.slice(0, 500) } : {}),
							provenance: {
								source: 'web' as const,
								at: r.at,
								ref: o.sources[0].url,
								note: 'Exa search; information for the chef, never ordered'
							}
						};
					});
				return checked('find_outside', {
					options,
					meta: {
						summary: options.length
							? `${options.length} option(s) outside the catalogue for "${i.need}", each with its source. Nothing is ordered.`.slice(
									0,
									400
								)
							: r.note
					}
				});
			} catch (e) {
				return webError(e);
			}
		},

		async check_recall(w: WebExecutionContext, raw: unknown): Promise<Result<Out<'check_recall'>>> {
			const i = input('check_recall', raw);
			if (isErr(i)) return i;
			const product = (await w.ports.catalog.get([i.productId])).get(i.productId);
			if (!product) return err('NOT_FOUND', `unknown product ${i.productId}`);
			const gtin = product.gtin?.replace(/\D/g, '');
			const rows = d.findings.list('recall', w.ctx.workspaceId).flatMap((f) => {
				const data = f.data as Partial<RecallFindingData> | undefined;
				if (!data?.notice) return [];
				const byGtin =
					!!gtin && data.notice.products.some((p) => p.gtin?.replace(/\D/g, '') === gtin);
				const byName = (data.matches ?? []).some(
					(m) => m.productId === product.productId && m.tier === 'name'
				);
				return [
					{
						url: data.notice.url.replace(/#.*$/, ''),
						title: data.notice.title,
						match: byGtin ? ('gtin' as const) : byName ? ('name' as const) : ('none' as const),
						drill: f.id.startsWith('drill:'),
						seenAt: f.at
					}
				];
			});
			const hits = rows.filter((r) => r.match !== 'none');
			const notices = [...hits, ...rows.filter((r) => r.match === 'none').slice(0, MAX_UNMATCHED)];
			const real = hits.filter((r) => !r.drill);
			return checked('check_recall', {
				notices,
				meta: {
					summary: (real.length
						? `${real.length} recall notice(s) cite ${product.nameFi} (${real.map((r) => r.match).join(', ')}). A GTIN citation is this product; a name match needs the pack checked.`
						: hits.length
							? `Only a drill cites ${product.nameFi}; no real notice does.`
							: `No watched recall notice cites ${product.nameFi} (${rows.length} notice(s) checked).`
					).slice(0, 400)
				}
			});
		}
	};
}

export type WebTools = ReturnType<typeof createWebTools>;
