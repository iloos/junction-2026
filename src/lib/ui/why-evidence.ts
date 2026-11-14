/**
 * The Why drawer's web evidence loader: one read per product per page (kept), through the kitchen helper, which
 * holds no key and charges the visitor's own workspace. Offline (/offline) there is no server, so nothing loads.
 */
import { livePost } from '$lib/kitchen/api';
import type { MakeInHouseProposal, WhyEvidence } from '$lib/server/web/evidence';

export type { MakeInHouseProposal, WhyEvidence };

export type Loaded<T> =
	| { state: 'idle' }
	| { state: 'loading' }
	| { state: 'done'; value: T }
	| { state: 'error'; message: string };

const evidence = new Map<string, Promise<WhyEvidence>>();

export function loadEvidence(productId: string): Promise<WhyEvidence> {
	let p = evidence.get(productId);
	if (!p) {
		p = livePost<WhyEvidence>('/kitchen-api/web/evidence', { productId });
		evidence.set(productId, p);
		p.catch(() => evidence.delete(productId));
	}
	return p;
}

export function makeInHouse(need: string, context?: string): Promise<MakeInHouseProposal> {
	return livePost<MakeInHouseProposal>('/kitchen-api/web/make-in-house', {
		need,
		...(context ? { context } : {})
	});
}

/** A line that no product covers: the place to offer a recipe from the web. */
export const unresolved = (l: { state: string; reasons: readonly string[] }) =>
	l.state === 'unorderable' ||
	l.state === 'rejected' ||
	l.reasons.some((r) => r === 'out' || r === 'undeliverable' || r === 'INSUFFICIENT_STOCK');
