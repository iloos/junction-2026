/**
 * The presenter's room tools on Ops: run a canned incident through the shortage cascade, and reset the room.
 * Presenter-only is enforced by the caller (the Ops form actions check the presenter session).
 */
import { and, eq, like, or, sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import type { ShortageReplanned } from '$lib/core/contracts';
import type { CallContext } from '$lib/core/ports';
import { SCENARIO } from '$lib/core/scenario';
import { replanShortage } from '$lib/core/services/shortage';
import { inWorkspace } from '$lib/server/adapters/simulator/overlay';
import { contextFor } from '$lib/server/auth';
import { publish } from '$lib/server/bus';
import { kitchens } from '$lib/server/db/schema';
import { createServerPorts } from '$lib/server/store/server-ports';
import { resetDemoRun } from './reset';

export interface IncidentInput {
	id: string;
	label: string;
	products: { productId: string }[];
	/** Share of the stock left, 0–1. */
	left: number;
}

/**
 * Every product of the incident goes short at once (all overlays first, so a substitute is never picked from another
 * product of the same incident), then each re-plans every store in turn (sequential: each re-plan reads the last).
 * Each result goes out as a `shortage.replanned` notice labelled with the incident, like the Kitchen's shortage.
 */
export async function runIncident(
	workspaceId: string,
	incident: IncidentInput
): Promise<ShortageReplanned[]> {
	const b = await createServerPorts();
	const ctx = {
		...contextFor('kitchen_agent', 'kitchen-agent', 'ops', env, workspaceId),
		// The presenter re-plans every store in the room; core's per-visitor room gate doesn't apply to it.
		sharedRoom: false
	} as CallContext;
	return inWorkspace(workspaceId, async () => {
		b.overlay.clearTagged('shortage');
		const { offers } = await b.ports.catalog.offers(
			incident.products.map((p) => p.productId),
			SCENARIO.delivery
		);
		// What the room's open plans need of each product: the fallback "before" level when Valio states no number.
		const state = await b.ports.store.load(workspaceId, ctx.runId);
		const need = new Map<string, number>();
		for (const pl of Object.values(state.plans))
			if (pl.state !== 'committed')
				for (const l of pl.lines) need.set(l.productId, (need.get(l.productId) ?? 0) + l.qty.value);
		const plan = incident.products.map((p) => {
			const a = offers.find((o) => o.productId === p.productId)?.availability;
			const known = a?.kind === 'known' && a.amount != null && a.amount < 1e6 ? a.amount : null;
			// No stated number (supplier-delivered): before the incident Valio had enough for the room, about 1.5 times
			// its need, so the incident's share visibly cuts below it.
			const had = known ?? Math.max(1, Math.ceil((need.get(p.productId) ?? 0) * 1.5));
			const left = Math.floor(had * Math.max(0, Math.min(1, incident.left)));
			return { productId: p.productId, had, left };
		});
		for (const p of plan)
			b.overlay.setAvailability({
				productId: p.productId,
				amount: p.left,
				label: `simulated: ${incident.label}`,
				tag: 'shortage'
			});
		const out: ShortageReplanned[] = [];
		for (const p of plan) {
			const r = await replanShortage(b.ports, ctx, {
				...p,
				shortageId: `sh-${incident.id}-${crypto.randomUUID().slice(0, 8)}`,
				note: incident.label
			});
			if (!r.ok) throw new Error(`incident ${incident.id}: ${r.error.code} ${r.error.message}`);
			out.push(r.value);
			const at = b.ports.clock.now().toISOString();
			await publish(workspaceId, [
				{
					kind: 'notice',
					workspaceId,
					runId: ctx.runId,
					at,
					event: {
						kind: 'shortage.replanned',
						productId: p.productId,
						simAt: at,
						detail: r.value,
						label: incident.label
					}
				}
			]);
		}
		return out;
	});
}

/**
 * Start the room over: the visitors' stores go (an owner, or create_kitchen's k-v- id), the seeded kitchens stay, the
 * simulated overlay clears, and a fresh run begins (no plans, no orders). Returns how many stores were removed.
 */
export async function resetRoom(workspaceId: string): Promise<{ runId: string; removed: number }> {
	const b = await createServerPorts();
	const gone = await b.db
		.delete(kitchens)
		.where(
			and(
				eq(kitchens.workspaceId, workspaceId),
				or(like(kitchens.id, 'k-v-%'), sql`${kitchens.doc} ->> 'owner' is not null`)
			)
		)
		.returning({ id: kitchens.id });
	inWorkspace(workspaceId, () => b.overlay.clear());
	const { runId } = await resetDemoRun(workspaceId);
	return { runId, removed: gone.length };
}
