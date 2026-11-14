/**
 * The kitchen screen's server side in live mode. The browser never holds a key: it calls /kitchen-api/*, and this
 * module acts as the chef through the same tool handlers REST, MCP and the agent use (one gate, one store, one bus).
 * The snapshot is assembled here because the view needs product facts (origin, availability) for every candidate,
 * which the catalogue port has and the tool outputs don't carry.
 */
import { env } from '$env/dynamic/private';
import type { Approval, Kitchen, ToolInput, ToolName } from '$lib/core/contracts';
import { isoWeek } from '$lib/core/mandate/tier';
import { contextFor } from '$lib/server/auth';
import { createServerPorts } from '$lib/server/store/server-ports';
import { handlers } from '$lib/server/tools/handlers';
import { serveTool, type Served } from '$lib/server/tools/serve';
import { rulesFor, type PresetId } from '$lib/kitchen/fixture-plan';
import type { CommitRecord, FixtureSnapshot } from '$lib/kitchen/fixture-server';
import { buildLiveView, type ProductFacts, type SubstitutesOut } from '$lib/kitchen/live-view';
import seed from '../../../../fixtures/seeds/christmas-buffet-140.json';

const EVENT_ID = 'event-xmas-140';
/** The palvikinkku the ham rescue relies on (13 of 15 in stock): the contention preset takes 4 of them. */
const CONTENDED = { productId: '476768', left: 11 };

const state: { kitchenId: string; preset: PresetId; contention: boolean } = {
	kitchenId: 'k-hotel',
	preset: 'kitchen',
	contention: false
};

const chef = () => contextFor('chef', 'kitchen-ui', 'kitchen', env);
const agent = () => contextFor('kitchen_agent', 'kitchen-agent', 'kitchen', env);

/** One tool call as the chef, through the shared gate. */
export function callTool(name: string, input: unknown): Promise<Served> {
	return serveTool(name, chef(), input, handlers);
}

async function must<N extends ToolName>(
	name: N,
	input: ToolInput<N>,
	ctx = chef()
): Promise<unknown> {
	const r = await serveTool(name, ctx, input, handlers);
	if (!r.ok) throw new Error(`${name}: ${r.error.code} ${r.error.message}`);
	return r.value;
}

type PlanOut = { plan: import('$lib/core/contracts').Plan };

/** Plans the event, then lets the kitchen agent propose a rescue for every real outage that has none yet. */
async function ensurePlan() {
	let { plan } = (await must('plan_event', {
		kitchenId: state.kitchenId,
		eventId: EVENT_ID
	})) as PlanOut;
	for (;;) {
		const covered = new Set(plan.lines.map((l) => l.substituteFor).filter(Boolean));
		const out = plan.lines.find(
			(l) => l.state === 'unorderable' && !l.substituteFor && !covered.has(l.productId)
		);
		if (!out) return plan;
		const r = (await must(
			'find_substitutes',
			{ planId: plan.id, version: plan.version, lineId: out.id },
			agent()
		)) as SubstitutesOut;
		if (r.plan.version === plan.version) return plan; // nothing proposed: stop instead of looping
		plan = r.plan;
	}
}

function presetInput(kitchen: Kitchen) {
	if (state.preset === 'kitchen') return {};
	const rules = rulesFor(kitchen, state.preset);
	return {
		weights: rules.weights as Record<string, number>,
		...(state.preset === 'finnish' ? { requireOrigin: 'fi' } : {})
	};
}

export async function snapshot(): Promise<FixtureSnapshot> {
	const ctx = chef();
	const planned = await ensurePlan();
	const b = await createServerPorts();
	const kitchens = await b.ports.store.kitchens(ctx.workspaceId);
	const kitchen = kitchens.find((k) => k.id === state.kitchenId) ?? kitchens[0];
	const { plan } = (await must('get_plan', { planId: planned.id })) as PlanOut;

	// Rankings under the active rules preset (previews: nothing is persisted).
	const rescues: Record<string, SubstitutesOut> = {};
	for (const l of plan.lines.filter((x) => x.state === 'unorderable' && !x.substituteFor))
		rescues[l.id] = (await must('find_substitutes', {
			planId: plan.id,
			version: plan.version,
			lineId: l.id,
			...presetInput(kitchen)
		})) as SubstitutesOut;

	const ids = [
		...new Set([
			...plan.lines.map((l) => l.productId),
			...Object.values(rescues).flatMap((r) => r.candidates.map((c) => c.productId))
		])
	];
	const [products, { offers }] = await Promise.all([
		b.ports.catalog.get(ids),
		b.ports.catalog.offers(ids, plan.deliverBy)
	]);
	const facts: Record<string, ProductFacts> = {};
	for (const id of ids) {
		const p = products.get(id);
		if (!p) continue;
		facts[id] = {
			name: p.nameFi,
			origin: p.origin,
			reliability: p.reliability,
			co2PerKg: p.co2PerKg?.value,
			salesUnit: p.salesUnit,
			offer: offers.find((o) => o.productId === id)
		};
	}

	const ws = await b.ports.store.load(ctx.workspaceId, ctx.runId);
	const approvals = Object.values(ws.approvals).filter((a) => a.planId === plan.id);
	const current =
		approvals
			.filter((a) => a.state === 'pending' || a.state === 'granted')
			.sort((a, b) => b.planVersion - a.planVersion)[0] ?? null;
	const lastInvalidated: Approval | null =
		approvals
			.filter((a) => a.state === 'invalidated')
			.sort((a, b) => b.planVersion - a.planVersion)[0] ?? null;
	const orders: CommitRecord[] = Object.values(ws.orders)
		.filter((o) => o.planId === plan.id)
		.sort((a, b) => (a.committedAt < b.committedAt ? -1 : 1))
		.map((o) => {
			const receipt = Object.values(ws.receipts).find((r) => r.orderId === o.id)!;
			return {
				output: {
					orderId: o.id,
					receiptId: receipt?.id ?? '',
					totalCents: o.totalCents,
					committedLineIds: o.lines.map((l) => l.lineId),
					awaitingSupplier: (receipt?.awaitingSupplier ?? []).map((a) => a.productId)
				},
				receipt,
				lines: plan.lines.filter((l) => o.lines.some((x) => x.lineId === l.id)),
				at: o.committedAt
			};
		});
	const week = isoWeek(plan.deliverBy);
	const spent = await b.ports.store.transact(ctx.workspaceId, async (tx) => ({
		ops: [],
		value: await b.ports.store.lockBudget(tx, {
			workspaceId: ctx.workspaceId,
			kitchenId: kitchen.id,
			week
		})
	}));
	const rules = rulesFor(kitchen, state.preset, kitchen.mandate.version);
	return {
		plan,
		view: buildLiveView({
			plan,
			rescues,
			facts,
			seed: {
				title: seed.title,
				date: seed.date,
				guests: seed.guests.estimate,
				serviceStyle: seed.serviceStyle,
				rescue: (seed as { rescue?: Record<string, unknown> }).rescue
			},
			rules,
			weekSpentCents: spent.ok ? spent.value.value : 0,
			previewRanking: state.preset !== 'kitchen'
		}),
		approval: current,
		lastInvalidated,
		orders,
		kitchen,
		rules,
		preset: state.preset,
		contention: state.contention,
		mandateVersion: kitchen.mandate.version
	};
}

/** Re-quotes the plan so a simulator change shows up on its lines (an edit to the same g/guest re-quotes). */
async function requote() {
	const plan = await ensurePlan();
	const need = plan.needs.find(
		(n) => n.dish && !plan.lines.some((l) => l.needId === n.id && l.state === 'committed')
	);
	if (!need?.dish) return;
	await must('edit_line', {
		planId: plan.id,
		version: plan.version,
		needId: need.id,
		patch: { gramsPerGuest: need.dish.gServed }
	});
}

export async function scenario(action: string, value: unknown) {
	const b = await createServerPorts();
	if (action === 'preset' && (value === 'kitchen' || value === 'price' || value === 'finnish'))
		state.preset = value;
	else if (action === 'kitchen' && typeof value === 'string') {
		state.kitchenId = value;
		state.preset = 'kitchen';
	} else if (action === 'contention') {
		state.contention = Boolean(value);
		b.overlay.clear();
		if (state.contention)
			b.overlay.setAvailability({
				productId: CONTENDED.productId,
				amount: CONTENDED.left,
				label: `simulated: another kitchen took 4 × ${CONTENDED.productId}`
			});
		await requote();
	} else if (action === 'reset') {
		state.preset = 'kitchen';
		state.contention = false;
		b.overlay.clear();
	} else throw new Error(`unknown scenario action ${action}`);
	return snapshot();
}
