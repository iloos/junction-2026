/**
 * Contention re-rescue: the supplier has less of a product than a live plan counts on (another kitchen took stock).
 * For every open line on that product, the kitchen agent keeps what is left and sizes the next eligible candidate to
 * the rest of the need, on the served basis. It goes through the same rescue as find_substitutes (ranking, sticky
 * preference reasons, requote), so a candidate that breaks a preference lands held in its sign-off group and the
 * edit voids any earlier approval (getPlan's lastVoided carries the diff). Ops gets a `contention` anomaly. Nothing
 * is committed here: the agent repairs, a person still decides.
 */
import type { CallContext } from '../ports';
import type { Anomaly, Line, Plan, Provenance } from '../contracts';
import { ok, type Result } from '../contracts';
import { rescueFor, seedEntryFor, servedKgOf, type PoolEntry } from '../demand/sizing';
import { draftFromLine } from '../mandate/tier';
import { editLine, type ServicePorts } from './events';
import { pending } from './orders';
import { findSubstitutes } from './substitutes';

export interface ContentionInput {
	productId: string;
	/** What happened, in words: "another kitchen took 4 × 476768". Lands on the new lines and the anomaly. */
	note: string;
	/** The simulator event's id, for provenance. */
	ref?: string;
}

export interface ContentionRescue {
	planId: string;
	/** The contended line as it was. */
	lineId: string;
	/** Sales units of the contended product still available, and how many the line had. */
	left: number;
	had: number;
	/** The rescue's lines after the split (the kept part and the new candidate). */
	chosen: Line[];
	anomalyId: string;
	plan: Plan;
}

const open = (l: Line) => l.state !== 'committed' && l.qty.value > 0;

export async function rescueContention(
	ports: ServicePorts,
	ctx: CallContext,
	input: ContentionInput
): Promise<Result<{ rescued: ContentionRescue[] }>> {
	const state = await ports.store.load(ctx.workspaceId, ctx.runId);
	const provenance: Provenance = {
		source: 'simulator',
		note: input.note,
		...(input.ref ? { ref: input.ref } : {})
	};
	const rescued: ContentionRescue[] = [];
	for (const plan0 of Object.values(state.plans)) {
		if (plan0.state === 'committed') continue;
		const line = plan0.lines.find((l) => l.productId === input.productId && open(l));
		if (!line) continue;
		const { offers } = await ports.catalog.offers([input.productId], plan0.deliverBy);
		const a = offers[0]?.availability;
		const left = a?.kind === 'out' ? 0 : a?.kind === 'known' ? (a.amount ?? null) : null;
		if (left === null || left >= line.qty.value) continue;
		const kept = Math.max(0, Math.floor(left));

		const need = plan0.needs.find((n) => n.id === line.needId);
		const seed = plan0.eventId ? ports.events?.[plan0.eventId] : undefined;
		const dish = seed?.dishes.find((d) => d.dish === need?.label);
		const original = line.substituteFor
			? plan0.lines.find((l) => l.productId === line.substituteFor && l.needId === line.needId)
			: undefined;
		const [product] = [...(await ports.catalog.get([input.productId])).values()];
		const entry: PoolEntry =
			original && need
				? seedEntryFor(seed, need.label, original.productId, line.productId)
				: { productId: line.productId, fromValioRule: false, yield: dish?.yield };
		// A substitute from the seed's rescue carries its own pack; the planned product its catalogue pack.
		const rescue = original ? rescueFor(seed, original.productId) : undefined;
		if (!entry.pack && rescue?.chosen?.productId === line.productId)
			entry.pack = rescue.chosen.pack;
		const qtyKept = { ...line.qty, value: kept };
		const covered = need?.amount.unit === 'kg' ? (servedKgOf(product, entry, qtyKept) ?? 0) : 0;
		const note = `${kept} of ${line.qty.value} left: ${input.note}`;

		let target: Line = line;
		let version = plan0.version;
		let keep: ReturnType<typeof draftFromLine>[] = [];
		if (original) {
			// The contended line is itself a rescue: re-rescue the original, keeping what is left of this one.
			target = original;
			if (kept > 0)
				keep = [
					{
						...draftFromLine(line),
						qty: qtyKept,
						provenance: { ...line.provenance, note }
					}
				];
		} else if (kept > 0) {
			// The planned product itself: cut it to what is left, then rescue the rest.
			const cut = await editLine(ports, ctx, {
				planId: plan0.id,
				version,
				lineId: line.id,
				patch: { qty: kept }
			});
			if (!cut.ok) return cut;
			version = cut.value.plan.version;
		}
		const r = await findSubstitutes(
			ports,
			ctx,
			{ planId: plan0.id, version, lineId: target.id, apply: true },
			{ keep, coveredServedKg: covered, exclude: [input.productId], note: input.note }
		);
		if (!r.ok) return r;

		const name = product?.nameFi ?? line.productName ?? input.productId;
		const anomaly: Anomaly = {
			workspaceId: ctx.workspaceId,
			runId: ctx.runId,
			id: `contention-${plan0.id}-${input.productId}-v${r.value.plan.version}`,
			kind: 'contention',
			productId: input.productId,
			planId: plan0.id,
			message: `${need?.label ?? name}: another kitchen took stock; ${kept} of ${line.qty.value} × ${name} left, the rest re-planned`,
			detectedAt: ports.clock.now().toISOString(),
			provenance
		};
		const recorded = await ports.store.transact(ctx.workspaceId, async () => ({
			ops: [pending(ctx, { type: 'RecordAnomaly', anomaly })],
			value: null
		}));
		if (!recorded.ok) return recorded;
		rescued.push({
			planId: plan0.id,
			lineId: line.id,
			left: kept,
			had: line.qty.value,
			chosen: r.value.chosen,
			anomalyId: anomaly.id,
			plan: r.value.plan
		});
	}
	return ok({ rescued });
}
