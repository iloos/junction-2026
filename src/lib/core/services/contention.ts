/**
 * Contention re-rescue: the supplier has less of a product than a live plan counts on (another kitchen took stock).
 * For every open line on that product, the kitchen agent keeps what is left and sizes the next eligible candidate to
 * the rest of the need, on the served basis. It goes through the same rescue as find_substitutes (ranking, sticky
 * preference reasons, requote), so a candidate that breaks a preference lands held in its sign-off group and the
 * edit voids any earlier approval (getPlan's lastVoided carries the diff). Ops gets a `contention` anomaly. Nothing
 * is committed here: the agent repairs, a person still decides.
 */
import type { CallContext } from '../ports';
import type { Anomaly, Line, MeasureUnit, Plan, Product, Provenance } from '../contracts';
import { ok, type Result } from '../contracts';
import {
	contentValue,
	rescueFor,
	seedEntryFor,
	servedKgOf,
	type PoolEntry
} from '../demand/sizing';
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
	/**
	 * One stock for every plan (a shortage across kitchens): plans keep what is left in the order they were made,
	 * so a later plan sees only what earlier ones did not keep. Without it each plan is compared to the whole stock.
	 */
	shared?: boolean;
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

/** What `units` sales units of `p` deliver in `unit`: by weight for KG-sold, by content, or one piece per unit. */
function keptAmount(p: Product, units: number, unit: MeasureUnit): number {
	if (units <= 0) return 0;
	if (p.salesUnit === 'KG') return unit === 'kg' ? units : 0;
	if (unit === 'pcs') return units;
	return units * (contentValue(p, unit) ?? 0);
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
	let remaining: number | null = null;
	// State keeps plans in the order their CreatePlan ops were applied: the order they were made.
	for (const plan0 of Object.values(state.plans)) {
		if (plan0.state === 'committed') continue;
		const line = plan0.lines.find((l) => l.productId === input.productId && open(l));
		if (!line) continue;
		const { offers } = await ports.catalog.offers([input.productId], plan0.deliverBy);
		const a = offers[0]?.availability;
		const stock = a?.kind === 'out' ? 0 : a?.kind === 'known' ? (a.amount ?? null) : null;
		if (stock === null) continue;
		if (input.shared && remaining === null) remaining = stock;
		const left: number = input.shared ? remaining! : stock;
		if (left >= line.qty.value) {
			if (input.shared) remaining = left - line.qty.value;
			continue;
		}
		const kept = Math.max(0, Math.floor(left));
		if (input.shared) remaining = left - kept;

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
		const covered =
			need?.kind !== 'direct' && need?.amount.unit === 'kg'
				? (servedKgOf(product, entry, qtyKept) ?? 0)
				: 0;
		// A direct need ("4 l milk") counts what is kept in its own unit, so the substitute covers only the rest.
		const coveredAmount =
			need?.kind === 'direct' && product ? keptAmount(product, kept, need.amount.unit) : 0;
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
			{
				keep,
				coveredServedKg: covered,
				coveredAmount,
				exclude: [input.productId],
				note: input.note,
				keepOriginal: !original && kept > 0
			}
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
