/**
 * A kitchen's calendar from its workspace's current run: open decisions at their due time, each plan's delivery
 * day, the kitchen's receiving days, Finnish holidays and festivities (core/calendar.ts). One input feeds both the
 * iCalendar feed and the day picker's days. Read-only; one workspace.
 */
import factorsSeed from '../../../fixtures/seeds/calendar-factors.json';
import {
	buildCalendar,
	buildPlanEvents,
	googleDecideUrl,
	decideSummary,
	deliverySummary,
	type PlanDates,
	calendarDays,
	type CalendarDay,
	type CalendarInput,
	type DaysInput,
	helsinkiDate,
	type LogisticModel
} from '$lib/core/calendar';
import type { PlanState } from '$lib/core/contracts';
import type { ServicePorts } from '$lib/core/services/events';
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

type Loaded = Omit<CalendarInput, 'window' | 'stamp'> & Omit<DaysInput, 'decisions' | 'deliveries'>;

/** Everything the feed and the picker read for one kitchen, or null when the workspace has no such kitchen. */
async function load(workspaceId: string, kitchenId: string): Promise<Loaded | null> {
	const runId = await ensureRunLoaded(workspaceId);
	await realHandlers();
	const { ports } = await createServerPorts();
	const kitchen = (await ports.store.kitchens(workspaceId)).find((k) => k.id === kitchenId);
	if (!kitchen) return null;

	return inWorkspace(workspaceId, async () => {
		const state = await ports.store.load(workspaceId, runId);
		const plans = Object.values(state.plans).filter((p) => p.kitchenId === kitchenId);
		const decisions = [];
		const offerCutoffs: NonNullable<DaysInput['offerCutoffs']> = [];
		const closeTimes: Partial<Record<LogisticModel, string>> = {};
		for (const plan of plans) {
			// Valio's own cut-off per offer: the earliest per delivery date and model, and its time of day.
			for (const l of plan.lines) {
				const a = l.offer?.availability;
				if (!a?.closingTime) continue;
				const model = a.logisticModel ?? 'Stock';
				const prev = offerCutoffs.find((o) => o.date === plan.deliverBy && o.model === model);
				if (!prev) offerCutoffs.push({ date: plan.deliverBy, model, at: a.closingTime });
				else if (new Date(a.closingTime) < new Date(prev.at)) prev.at = a.closingTime;
				closeTimes[model] ??= a.closingTime.slice(11, 16);
			}
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
		const seeds = Object.values((ports as ServicePorts).events ?? {});
		return {
			kitchen: { id: kitchen.id, name: kitchen.name, deliveryDays: kitchen.deliveryDays },
			decisions,
			deliveries: plans.map((p) => ({
				planId: p.id,
				date: p.deliverBy,
				title: `${kitchen.name}, ${p.lines.length} lines, ${STATE_WORDS[p.state]}`
			})),
			now: ports.clock.now().toISOString(),
			closeTimes,
			offerCutoffs,
			closedDays: factorsSeed.holidays.days,
			// Only the factors this kitchen feels, at its own strength (1 + (value − 1) × sensitivity, as in demand).
			factors: factorsSeed.factors.flatMap((f) => {
				const k = kitchen.factorSensitivity?.[f.kind] ?? 0;
				return k > 0 ? [{ ...f, value: 1 + (f.value - 1) * k }] : [];
			}),
			events: seeds
				.filter((e) => e.kitchenId === kitchenId)
				.map((e) => ({ id: e.id, date: e.date, title: e.title }))
		};
	});
}

/** The ICS text, or null when the workspace has no such kitchen. */
export async function kitchenCalendar(
	workspaceId: string,
	kitchenId: string,
	now = new Date()
): Promise<string | null> {
	const c = await load(workspaceId, kitchenId);
	if (!c) return null;
	const start = new Date(SCENARIO.start);
	return buildCalendar({
		...c,
		window: {
			from: day(new Date(start.getTime() - WINDOW_BEFORE_DAYS * 86_400_000)),
			to: day(new Date(start.getTime() + WINDOW_AFTER_DAYS * 86_400_000))
		},
		stamp: now.toISOString()
	});
}

/** The longest range one request may ask for. */
export const MAX_DAYS = 120;

/**
 * The picker's days for [from, to] (default: from the scenario's today, 21 days), or null when the workspace has
 * no such kitchen. `from`/`to` are YYYY-MM-DD; the range is capped at MAX_DAYS.
 */
export async function kitchenDays(
	workspaceId: string,
	kitchenId: string,
	from?: string,
	to?: string
): Promise<{ now: string; from: string; to: string; days: CalendarDay[] } | null> {
	const c = await load(workspaceId, kitchenId);
	if (!c) return null;
	const start = from ?? helsinkiDate(c.now);
	const startMs = new Date(`${start}T00:00:00Z`).getTime();
	const cap = day(new Date(startMs + (MAX_DAYS - 1) * 86_400_000));
	const end = !to ? day(new Date(startMs + 20 * 86_400_000)) : to > cap ? cap : to;
	return { now: c.now, from: start, to: end, days: calendarDays(c, start, end) };
}

/** The plan's own title: the event's name for an event plan, else "Order for <kitchen>". */
function planTitle(plan: { eventId?: string }, kitchenName: string, ports: ServicePorts): string {
	const seed = plan.eventId ? ports.events?.[plan.eventId] : undefined;
	return seed?.title ?? `Order for ${kitchenName.replace(/\s*\(fictional\)\s*$/, '')}`;
}

/**
 * One plan's dates (decide-by over its pending approval, same `dueOf` as the feed; its delivery day), or null when
 * the plan is not in this workspace. With `origin`, the file and the Google link point back at the plan.
 */
export async function planDates(
	workspaceId: string,
	planId: string,
	origin?: string,
	now = new Date()
): Promise<{
	dates: PlanDates;
	ics: string;
	google: string | null;
	decideTitle: string;
	deliveryTitle: string;
} | null> {
	const runId = await ensureRunLoaded(workspaceId);
	await realHandlers();
	const { ports } = await createServerPorts();
	return inWorkspace(workspaceId, async () => {
		const state = await ports.store.load(workspaceId, runId);
		const plan = state.plans[planId];
		if (!plan) return null;
		const kitchen = (await ports.store.kitchens(workspaceId)).find((k) => k.id === plan.kitchenId);
		const kitchenName = kitchen?.name ?? plan.kitchenId;
		const approval = Object.values(state.approvals).find(
			(a) => a.planId === plan.id && a.state === 'pending'
		);
		let decide: PlanDates['decide'] = null;
		if (approval) {
			const viewed = await withPlanView(ports, plan, state, liveApprovals(state, plan.id));
			const count = decisionsOf(viewed, approval).length;
			if (count) decide = { due: dueOf(viewed, approval) ?? SCENARIO.cutoff, count };
		}
		const dates: PlanDates = {
			kitchen: { id: plan.kitchenId, name: kitchenName },
			plan: {
				id: plan.id,
				title: planTitle(plan, kitchenName, ports as ServicePorts),
				deliverBy: plan.deliverBy
			},
			decide,
			stamp: now.toISOString()
		};
		const planUrl = origin ? `${origin}/?plan=${encodeURIComponent(plan.id)}` : undefined;
		return {
			dates,
			ics: buildPlanEvents(dates),
			google: googleDecideUrl(dates, planUrl),
			decideTitle: decideSummary(dates),
			deliveryTitle: deliverySummary(dates)
		};
	});
}

export const ICS_HEADERS = {
	'content-type': 'text/calendar; charset=utf-8',
	'content-disposition': 'inline; filename="kitchen.ics"',
	// Calendar apps poll; five minutes keeps decisions current without hammering the server.
	'cache-control': 'private, max-age=300'
};
