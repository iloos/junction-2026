/** Where the key-less /request page acts, and the inline answers it accepts. No I/O. */
import { JUDGES_WORKSPACE, type Env } from '$lib/server/auth';
import { presenterOpen } from '$lib/server/demo/presenter';
import type { RequestAnswer } from '$lib/ui/request/types';

/** Re-exported for callers that import the request module's helpers. */
export { presenterOpen };

export interface PageWorkspace {
	id: string;
	stage: boolean;
}

/** Stage run for the presenter, the judges' sandbox for everyone else. */
export function pageWorkspace(env: Env, dev: boolean): PageWorkspace {
	return presenterOpen(env, dev)
		? { id: env.MANDATE_WORKSPACE || 'ws-demo', stage: true }
		: { id: JUDGES_WORKSPACE, stage: false };
}

const UNITS = new Set(['l', 'kg', 'pcs', 'case', 'sales']);

/** Inline answers from a request body; anything malformed is dropped, never trusted. */
export function readAnswers(raw: unknown): RequestAnswer[] {
	if (!Array.isArray(raw)) return [];
	const out: RequestAnswer[] = [];
	for (const a of raw.slice(0, 12)) {
		if (!a || typeof a !== 'object') continue;
		const { item, qty, unit, productId } = a as Record<string, unknown>;
		if (!Number.isInteger(item) || (item as number) < 0 || (item as number) > 11) continue;
		const ans: RequestAnswer = { item: item as number };
		if (
			typeof qty === 'number' &&
			qty > 0 &&
			qty <= 1e6 &&
			typeof unit === 'string' &&
			UNITS.has(unit)
		) {
			ans.qty = qty;
			ans.unit = unit as RequestAnswer['unit'];
		}
		if (typeof productId === 'string' && /^\d{6}$/.test(productId)) ans.productId = productId;
		if (ans.qty !== undefined || ans.productId) out.push(ans);
	}
	return out;
}
