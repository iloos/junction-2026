/**
 * MenuStore on the `menu_proposals` table (PGlite fixture or Aiven Postgres; same migrations). One row per
 * revision, immutable except the review columns, with the same rules as the memory adapter: dense revisions,
 * `put` stores `proposed` revisions only, a retried put of the same content is a no-op, and only a chef reviews
 * the latest revision. The review runs in a transaction that locks the revision's row.
 */
import { and, desc, eq } from 'drizzle-orm';
import {
	err,
	MenuProposal,
	ok,
	type MenuProposal as MenuProposalT,
	type Result
} from '$lib/core/contracts';
import type { MenuStore } from '$lib/core/ports';
import { menuProposals } from '../db/schema';
import type { AnyDb } from '../store/drizzle-store';
import { MenuStoreError, proposalDigest, REVIEWERS } from './store';

type Row = typeof menuProposals.$inferSelect;

const toProposal = (r: Row): MenuProposalT => MenuProposal.parse(r.body);

export function drizzleMenuStore(db: AnyDb): MenuStore {
	const at = (ws: string, id: string) =>
		and(eq(menuProposals.workspaceId, ws), eq(menuProposals.id, id));

	return {
		async get(ws, id, revision) {
			const [r] = await db
				.select()
				.from(menuProposals)
				.where(and(at(ws, id), eq(menuProposals.revision, revision)));
			return r ? toProposal(r) : null;
		},
		async latest(ws, id) {
			const [r] = await db
				.select()
				.from(menuProposals)
				.where(at(ws, id))
				.orderBy(desc(menuProposals.revision))
				.limit(1);
			return r ? toProposal(r) : null;
		},
		async put(ws, proposal) {
			const p = MenuProposal.parse(proposal);
			if (p.status !== 'proposed' || p.review)
				throw new MenuStoreError('put stores proposed revisions only; review() records a review');
			const digest = await proposalDigest(p);
			const same = async () => {
				const [r] = await db
					.select({ digest: menuProposals.digest })
					.from(menuProposals)
					.where(and(at(ws, p.id), eq(menuProposals.revision, p.revision)));
				if (!r) return false;
				if (r.digest === digest) return true;
				throw new MenuStoreError(`revision ${p.revision} of ${p.id} already exists`);
			};
			if (await same()) return;
			const [last] = await db
				.select({ revision: menuProposals.revision })
				.from(menuProposals)
				.where(at(ws, p.id))
				.orderBy(desc(menuProposals.revision))
				.limit(1);
			const next = last ? last.revision + 1 : 0;
			if (p.revision !== next)
				throw new MenuStoreError(
					`revision ${p.revision} of ${p.id} is out of order: next is ${next}`
				);
			const inserted = await db
				.insert(menuProposals)
				.values({
					workspaceId: ws,
					id: p.id,
					revision: p.revision,
					kitchenId: p.kitchenId,
					status: p.status,
					body: p,
					digest
				})
				.onConflictDoNothing()
				.returning({ revision: menuProposals.revision });
			// Lost a race for this revision number: fine if the winner stored the same content.
			if (!inserted.length && !(await same()))
				throw new MenuStoreError(`revision ${p.revision} of ${p.id} was taken concurrently`);
		},
		async review(ws, id, revision, by, when): Promise<Result<MenuProposalT>> {
			if (!REVIEWERS.has(by.kind))
				return err('FORBIDDEN', 'only a chef reviews a menu', { sub: 'scope' });
			return db.transaction(async (tx) => {
				const [r] = await tx
					.select()
					.from(menuProposals)
					.where(and(at(ws, id), eq(menuProposals.revision, revision)))
					.for('update');
				if (!r) return err('NOT_FOUND', `menu ${id} revision ${revision} not found`);
				const [last] = await tx
					.select({ revision: menuProposals.revision })
					.from(menuProposals)
					.where(at(ws, id))
					.orderBy(desc(menuProposals.revision))
					.limit(1);
				if (last.revision !== revision)
					return err('STALE_VERSION', `menu ${id} has a newer revision ${last.revision}`, {
						detail: { latest: last.revision }
					});
				const p = toProposal(r);
				if (p.status === 'planned') return err('INVALID_INPUT', `menu ${id} is already planned`);
				if (p.review && p.review.digest === r.digest) return ok(p);
				const reviewed: MenuProposalT = {
					...p,
					status: 'chef_reviewed',
					review: { by: { ...by }, at: when.toISOString(), digest: r.digest }
				};
				await tx
					.update(menuProposals)
					.set({
						status: 'chef_reviewed',
						body: reviewed,
						reviewedByKind: by.kind,
						reviewedById: by.id,
						reviewedAt: when.toISOString(),
						reviewDigest: r.digest
					})
					.where(and(at(ws, id), eq(menuProposals.revision, revision)));
				return ok(reviewed);
			});
		}
	};
}
