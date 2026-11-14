/**
 * MenuStore adapters: menu proposals per workspace, one immutable record per revision. A revision is stored before
 * any URL that names it is returned. Only `review()` writes the review record, and only for a chef: `put` never
 * accepts `chef_reviewed` or a review, so a client cannot mark its own edit as reviewed.
 *
 * The memory adapter serves tests; `drizzleMenuStore` (pg.ts) applies the same rules to the `menu_proposals` table.
 */
import {
	err,
	MenuProposal,
	ok,
	type Actor,
	type MenuProposal as MenuProposalT,
	type Result
} from '$lib/core/contracts';
import { canonicalJson, sha256Hex } from '$lib/core/hash';
import type { MenuStore } from '$lib/core/ports';

/** Who may review a menu: a chef session, never an agent key or an approver alone. */
export const REVIEWERS = new Set<Actor['kind']>(['chef']);

/**
 * The digest a review binds to: the canonical proposal without its status and review record, so the chef accepts
 * exactly these dishes, amounts and brief, and any later edit (a new revision) needs a new review.
 */
export async function proposalDigest(p: MenuProposalT): Promise<string> {
	// Status and review are what reviewing changes; everything else is what the chef accepted.
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { status, review, ...terms } = p;
	return sha256Hex(canonicalJson(terms));
}

export class MenuStoreError extends Error {}

/** Proposals in process memory, keyed by workspace, then id; revisions are dense from 0. */
export function memoryMenuStore(): MenuStore {
	const data = new Map<string, Map<string, MenuProposalT[]>>();
	const revisions = (ws: string, id: string) => {
		let w = data.get(ws);
		if (!w) data.set(ws, (w = new Map()));
		let r = w.get(id);
		if (!r) w.set(id, (r = []));
		return r;
	};
	const copy = (p: MenuProposalT | undefined) => (p ? structuredClone(p) : null);

	return {
		async get(ws, id, revision) {
			return copy(data.get(ws)?.get(id)?.[revision]);
		},
		async latest(ws, id) {
			return copy(data.get(ws)?.get(id)?.at(-1));
		},
		async put(ws, proposal) {
			const p = MenuProposal.parse(proposal);
			if (p.status !== 'proposed' || p.review)
				throw new MenuStoreError('put stores proposed revisions only; review() records a review');
			const revs = revisions(ws, p.id);
			const existing = revs[p.revision];
			if (existing) {
				// A retried put of the same revision is a no-op; different content under the same number is not.
				if ((await proposalDigest(existing)) === (await proposalDigest(p))) return;
				throw new MenuStoreError(`revision ${p.revision} of ${p.id} already exists`);
			}
			if (p.revision !== revs.length)
				throw new MenuStoreError(
					`revision ${p.revision} of ${p.id} is out of order: next is ${revs.length}`
				);
			revs.push(structuredClone(p));
		},
		async review(ws, id, revision, by, at): Promise<Result<MenuProposalT>> {
			if (!REVIEWERS.has(by.kind))
				return err('FORBIDDEN', 'only a chef reviews a menu', { sub: 'scope' });
			const revs = data.get(ws)?.get(id);
			const p = revs?.[revision];
			if (!revs || !p) return err('NOT_FOUND', `menu ${id} revision ${revision} not found`);
			if (revision !== revs.length - 1)
				return err('STALE_VERSION', `menu ${id} has a newer revision ${revs.length - 1}`, {
					detail: { latest: revs.length - 1 }
				});
			if (p.status === 'planned') return err('INVALID_INPUT', `menu ${id} is already planned`);
			const digest = await proposalDigest(p);
			// Reviewing the same revision again keeps the first record: the review is a fact, not a toggle.
			if (p.review && p.review.digest === digest) return ok(structuredClone(p));
			const reviewed: MenuProposalT = {
				...p,
				status: 'chef_reviewed',
				review: { by: { ...by }, at: at.toISOString(), digest }
			};
			revs[revision] = reviewed;
			return ok(structuredClone(reviewed));
		}
	};
}
