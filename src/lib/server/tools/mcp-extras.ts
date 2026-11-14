/**
 * MCP resources and prompts beside the tools, scoped to the caller's key like the tools are: they read through the
 * gate (`serveTool`, read scope) and never carry an approve affordance. Resources: each kitchen's mandate in words and
 * numbers (`mandate://<kitchen>`), and this workspace's open decisions (`decisions://open`). Prompts: three starting
 * points that keep an outside agent inside the mandate. /agents lists the same descriptors.
 */
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { ToolOutput } from '$lib/core/contracts';
import { dueOf } from '$lib/core/mandate/due';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { mandateSentence } from '$lib/server/agent/intents/questions';
import { serveTool } from './serve';

export const MCP_RESOURCES = [
	{
		uri: 'mandate://<kitchen>',
		title: "A kitchen's mandate",
		description:
			'What the agent may order alone, in the chef’s words and the numbers the tools enforce. Read-only.'
	},
	{
		uri: 'decisions://open',
		title: 'Open decisions',
		description: 'Plans in this sandbox that still wait for something, with the next step for each.'
	}
] as const;

export const MCP_PROMPTS = [
	{
		name: 'plan_event_in_mandate',
		title: 'Plan an event inside my mandate',
		description:
			'Plan a seeded event, keep every line inside the caps, and report what waits for a chef.'
	},
	{
		name: 'check_open_before_cutoff',
		title: 'Check what’s open before the cut-off',
		description: 'List what is still undecided before the order cut-off, and what to do about each.'
	},
	{
		name: 'order_for_date',
		title: 'Order for a date (respect receiving days)',
		description: 'Order products for a delivery date the kitchen actually receives on.'
	}
] as const;

type Kitchen = Parameters<typeof mandateSentence>[0] & {
	events: { id: string; title: string }[];
	deliveryDays?: string[];
};
interface Context {
	scenario: { now: string; cutoff: string; delivery: string };
	kitchens: Kitchen[];
	openPlans: { planId: string; version: number; state: string; nextAction: string }[];
}

async function context(ctx: CallContext, handlers: ToolHandlers): Promise<Context | null> {
	const r = await serveTool('get_context', ctx, {}, handlers);
	return r.ok ? (r.value as unknown as Context) : null;
}

/** "Tue 8 Dec 17:00 Helsinki": a due time on the kitchen's own clock. */
export const localTime = (iso: string) =>
	`${new Date(iso)
		.toLocaleString('en-GB', {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit',
			timeZone: 'Europe/Helsinki'
		})
		.replace(',', '')} Helsinki`;

const text = (uri: string, body: string) => ({
	contents: [{ uri, mimeType: 'text/plain', text: body }]
});

const say = (body: string) => ({
	messages: [{ role: 'user' as const, content: { type: 'text' as const, text: body } }]
});

const STATE_WORDS: Record<string, string> = {
	draft: 'being drafted',
	quoted: 'priced, not ordered',
	held: 'waiting for a chef',
	approved: 'approved, not yet ordered',
	partially_committed: 'partly ordered'
};

/**
 * decisions://open: each open plan in this sandbox with what it waits for and when it is due, from core's one rule
 * (dueOf: the approval's expiry, the view's validity, Valio's cut-off per line), never the scenario's fixed cut-off.
 */
export async function openDecisions(ctx: CallContext, handlers: ToolHandlers): Promise<string> {
	const c = await context(ctx, handlers);
	const plans = c?.openPlans ?? [];
	const now = c ? new Date(c.scenario.now) : undefined;
	// Each plan's own due time from core's one rule (dueOf: the approval's expiry, the view's validity, Valio's
	// cut-off per line), never the scenario's fixed cut-off.
	const rows = await Promise.all(
		plans.map(async (p) => {
			const r = await serveTool('get_plan', ctx, { planId: p.planId }, handlers);
			const v = r.ok ? (r.value as ToolOutput<'get_plan'>) : null;
			// get_plan's approval may lack an expiry; dueOf skips an empty time.
			const approval = v?.approval
				? { lineIds: v.approval.lineIds, expiresAt: v.approval.expiresAt ?? '' }
				: null;
			const due = v ? dueOf(v.plan, approval, undefined, now) : null;
			return (
				`- A plan ${STATE_WORDS[p.state] ?? p.state}: ${p.nextAction}` +
				(due ? ` Due ${localTime(due)} (${due}).` : '') +
				` (planId ${p.planId}, version ${p.version})`
			);
		})
	);
	const body = rows.length
		? rows.join('\n') +
			'\n\nHeld lines wait for a chef, who approves in the Kitchen screen; you cannot approve. Call get_plan for details.'
		: 'Nothing is open: no plan in this sandbox waits for anything.';
	return body;
}

/** Register the resources and prompts a caller with read scope may use. */
export function registerExtras(server: McpServer, ctx: CallContext, handlers: ToolHandlers): void {
	if (!ctx.scopes.includes('read')) return;

	server.registerResource(
		'mandate',
		new ResourceTemplate('mandate://{kitchen}', {
			list: async () => {
				const c = await context(ctx, handlers);
				return {
					resources: (c?.kitchens ?? []).map((k) => ({
						uri: `mandate://${k.id}`,
						name: `${k.name}: mandate`,
						mimeType: 'text/plain'
					}))
				};
			}
		}),
		{
			title: MCP_RESOURCES[0].title,
			description: MCP_RESOURCES[0].description,
			mimeType: 'text/plain'
		},
		async (uri, vars) => {
			const c = await context(ctx, handlers);
			const k = c?.kitchens.find((x) => x.id === String(vars.kitchen));
			return text(
				uri.href,
				k
					? `${mandateSentence(k)}\n\nOnly a chef changes the mandate, in the Kitchen screen. Lines over a cap or with an unknown are held for a chef; you cannot approve.`
					: `No kitchen ${String(vars.kitchen)} in your sandbox.`
			);
		}
	);

	server.registerResource(
		'open_decisions',
		'decisions://open',
		{
			title: MCP_RESOURCES[1].title,
			description: MCP_RESOURCES[1].description,
			mimeType: 'text/plain'
		},
		async (uri) => text(uri.href, await openDecisions(ctx, handlers))
	);

	if (ctx.scopes.includes('plan'))
		server.registerPrompt(
			MCP_PROMPTS[0].name,
			{
				title: MCP_PROMPTS[0].title,
				description: MCP_PROMPTS[0].description,
				argsSchema: z.object({
					kitchenId: z.string().optional().describe('Kitchen id, e.g. k-hotel'),
					eventId: z.string().optional().describe('Seeded event id, e.g. event-xmas-140')
				})
			},
			({ kitchenId, eventId }) =>
				say(
					[
						`Plan ${eventId ? `the event ${eventId}` : 'a seeded event'}${kitchenId ? ` for ${kitchenId}` : ''} inside the kitchen's mandate.`,
						'1. Call get_context and read that kitchen’s mandate and constraints (or the mandate://<kitchen> resource): caps per line, order and week, what is never delegated, the allergens every product must be free from and any required origin. A dish’s diet codes (VEG, VE, M, G, L) bind its needs as requirements (diet:vegetarian, excludes:milk, …); they are never relaxed.',
						'2. Call plan_event. For lines that cannot be ordered as planned, or that miss a requirement (line.unmet names the requirement and the product fact), call find_substitutes for that line; it only ranks products that meet the need’s requirements.',
						'3. Lines that are held wait for a chef: give the human meta.approvalUrl first, as a link to open on their device, and wait. Never try to approve. Then call get_plan and commit_order only for what the mandate or the chef’s approval allows.',
						'4. Finish with get_outcome and report it in numbers: supplier confirmed, awaiting the supplier, held, unresolved.'
					].join('\n')
				)
		);

	server.registerPrompt(
		MCP_PROMPTS[1].name,
		{ title: MCP_PROMPTS[1].title, description: MCP_PROMPTS[1].description },
		() =>
			say(
				[
					'Check what is still open before the order cut-off.',
					'1. Read decisions://open (or call get_context, then get_plan for each open plan): each plan says what it waits for and when it is due. Due times are per plan: the approval’s expiry and Valio’s own cut-off for its lines.',
					'2. For each open plan, call get_plan and say in one line what it waits for: a chef’s approval, a substitute, a quote, or a commit.',
					'3. Say which of these can still be done before the cut-off, and which need a chef. Do not commit or approve anything; this is a check.'
				].join('\n')
			)
	);

	if (ctx.scopes.includes('order'))
		server.registerPrompt(
			MCP_PROMPTS[2].name,
			{
				title: MCP_PROMPTS[2].title,
				description: MCP_PROMPTS[2].description,
				argsSchema: z.object({
					what: z.string().describe('What and how much, e.g. "4 kg butter, 6 l cream"'),
					date: z.string().describe('Wanted delivery date, YYYY-MM-DD'),
					kitchenId: z.string().optional().describe('Kitchen id, e.g. k-lounas')
				})
			},
			({ what, date, kitchenId }) =>
				say(
					[
						`Order ${what} for delivery on ${date}${kitchenId ? ` to ${kitchenId}` : ''}.`,
						'1. Call get_context: check the kitchen’s deliveryDays. If the date is not one of them, say so and propose the nearest earlier receiving day; do not order for a day the kitchen does not receive.',
						'2. Call search_products for each item, pick catalogue products, and convert the amounts to sales units (the product says its content per unit).',
						'3. Call place_order with an idempotency key. If lines are held, give the human meta.approvalUrl first and wait for them; commit_order only what the mandate or their approval allows. Never try to approve.',
						'4. Report what was ordered, what waits for a chef, and anything not ordered and why.'
					].join('\n')
				)
		);
}
