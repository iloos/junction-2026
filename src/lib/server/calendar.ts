/**
 * A kitchen's calendar feed from its workspace's current run: open decisions at their due time, each plan's
 * delivery day, the kitchen's receiving days and Finnish holidays (core/calendar.ts). Read-only; one workspace.
 */
import { buildCalendar } from '$lib/core/calendar';
import type { PlanState } from '$lib/core/contracts';
import { SCENARIO } from '$lib/core/scenario';
import { liveApprovals } from '$lib/core/services/orders';
import { withPlanView } from '$lib/core/services/views';
import { decisionsOf } from '$lib/ui/decisions';
import { inWorkspace } from '$lib/server/adapters/simulator/overlay';
import { ensureRunLoaded } from '$lib/server/demo/reset';
import { createServerPorts } from '$lib/server/store/server-ports';
import { dueOf } from '$lib/core/mandate/due';
import { realHandlers } from '$lib/server/tools/handlers';

/** The feed covers a month before the scenario's start and half a year after it. */
const WINDOW_BEFORE_DAYS = 30;
const WINDOW_AFTER_DAYS = 180;

const STATE_WORDS: Record<PlanState, string> = {
	draft: 'draft',
	quoted: 'priced',
	held: 'waiting on decisions',
	ready: 'ready to order',
	committed: 'ordered'
};

const day = (d: Date) => d.toISOString().slice(0, 10);

/** The ICS text, or null when the workspace has no such kitchen. */
export async function kitchenCalendar(
	workspaceId: string,
	kitchenId: string,
	now = new Date()
): Promise<string | null> {
	const runId = await ensureRunLoaded(workspaceId);
	await realHandlers();
	const { ports } = await createServerPorts();
	const kitchen = (await ports.store.kitchens(workspaceId)).find((k) => k.id === kitchenId);
	if (!kitchen) return null;

	return inWorkspace(workspaceId, async () => {
		const state = await ports.store.load(workspaceId, runId);
		const plans = Object.values(state.plans).filter((p) => p.kitchenId === kitchenId);
		const decisions = [];
		for (const plan of plans) {
			const approval = Object.values(state.approvals).find(
				(a) => a.planId === plan.id && a.state === 'pending'
			);
			if (!approval) continue;
			const viewed = await withPlanView(ports, plan, state, liveApprovals(state, plan.id));
			const due = dueOf(viewed, approval) ?? SCENARIO.cutoff;
			for (const d of decisionsOf(viewed, approval))
				decisions.push({
					key: d.key,
					title: `${d.reason} (${d.lines.length} line${d.lines.length === 1 ? '' : 's'})${d.signOff ? ', sign-off' : ''}`,
					detail: d.consequence,
					due
				});
		}
		const start = new Date(SCENARIO.start);
		return buildCalendar({
			kitchen: { id: kitchen.id, name: kitchen.name, deliveryDays: kitchen.deliveryDays },
			decisions,
			deliveries: plans.map((p) => ({
				planId: p.id,
				date: p.deliverBy,
				title: `${kitchen.name}, ${p.lines.length} lines, ${STATE_WORDS[p.state]}`
			})),
			window: {
				from: day(new Date(start.getTime() - WINDOW_BEFORE_DAYS * 86_400_000)),
				to: day(new Date(start.getTime() + WINDOW_AFTER_DAYS * 86_400_000))
			},
			stamp: now.toISOString()
		});
	});
}

export const ICS_HEADERS = {
	'content-type': 'text/calendar; charset=utf-8',
	'content-disposition': 'inline; filename="kitchen.ics"',
	// Calendar apps poll; five minutes keeps decisions current without hammering the server.
	'cache-control': 'private, max-age=300'
};
