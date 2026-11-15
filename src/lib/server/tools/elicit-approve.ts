/**
 * D22: the chef approves from their own AI client. Over MCP, `approve` with a chef key shows the exact terms as an
 * elicitation (protocol revision 2026-07-28, multi-round-trip): the plan's version, every held line with its
 * amount and price, the total and why each waits. Only an explicit accept approves, and only those terms: the
 * echoed requestState is integrity-tagged and must still match the plan. A client that can't elicit gets the
 * approval link (D17); a sign-off decision (never-delegate) always needs the app.
 */
import {
	CLIENT_CAPABILITIES_META_KEY,
	CLIENT_INFO_META_KEY,
	inputRequired,
	inputResponse,
	type CallToolResult,
	type InputRequiredResult
} from '@modelcontextprotocol/server';
import { toolSchemas, type Plan } from '$lib/core/contracts';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import { sameTermsState, termsState } from '$lib/server/demo/chef-key';
import { approvalUrl } from './present';

type Env = Record<string, string | undefined>;

/** What the MCP handler context offers this flow (a subset of the SDK's ServerContext). */
export interface ElicitReq {
	envelope?: Record<string, unknown>;
	inputResponses?: Record<string, unknown>;
	requestState: () => unknown;
}

const text = (t: string, isError = false): CallToolResult => ({
	...(isError ? { isError: true } : {}),
	content: [{ type: 'text', text: t }]
});

const eur = (cents: number | null | undefined) =>
	cents == null ? 'no price' : `€${(cents / 100).toFixed(2)}`;

/** The exact terms in words, as the person reads them before accepting. */
export function termsMessage(plan: Plan, lineIds: string[]): string {
	const held = plan.lines.filter((l) => lineIds.includes(l.id));
	const total = held.reduce((s, l) => s + (l.lineCents ?? 0), 0);
	const rows = held.map(
		(l) =>
			`• ${l.productName ?? l.productId}: ${l.qty.value} ${l.qty.unit}, ${eur(l.lineCents)}${l.reasons.length ? ` (${l.reasons.join(', ')})` : ''}`
	);
	return [
		`Approve these ${held.length} line(s) for delivery on ${plan.deliverBy}, plan version ${plan.version}?`,
		...rows,
		`Total ${eur(total)}. Approving lets the agent order exactly these lines; nothing else.`
	].join('\n');
}

export async function approveViaElicitation(
	ctx: CallContext,
	args: unknown,
	req: ElicitReq,
	handlers: ToolHandlers,
	env: Env,
	/** The kitchen's never-delegate rules: a held line that hits one is signed in the app, never from a client. */
	neverDelegate: (kitchenId: string) => Promise<readonly string[]>,
	origin?: string
): Promise<CallToolResult | InputRequiredResult> {
	const parsed = toolSchemas.approve.input.safeParse(args);
	if (!parsed.success)
		return text(`approve: ${parsed.error.issues[0]?.message ?? 'bad input'}`, true);
	const a = parsed.data;
	const planId = /^ap-(.+)-v\d+$/.exec(a.approvalId)?.[1];
	const got = planId ? await handlers.get_plan(ctx, { planId }) : null;
	if (!got || !got.ok) return text(`approve: no plan for approval ${a.approvalId}`, true);
	const { plan, approval } = got.value as {
		plan: Plan;
		approval: { id: string; state: string; tier?: string; lineIds?: string[] } | null;
	};
	const link = `${origin ?? ''}${approvalUrl(plan)}`;
	const current =
		approval?.id === a.approvalId &&
		approval.state === 'pending' &&
		plan.version === a.planVersion &&
		plan.termsHash === a.termsHash;
	if (!current)
		return text(
			JSON.stringify({
				error: {
					code: 'STALE_VERSION',
					message: 'These terms are no longer the plan’s: read get_plan and ask again.'
				}
			}),
			true
		);
	// A never-delegate decision is signed in the app, by a person looking at it there.
	const rules = new Set(await neverDelegate(plan.kitchenId));
	const neverHere = plan.lines.some(
		(l) => (approval?.lineIds ?? []).includes(l.id) && l.reasons.some((r) => rules.has(r))
	);
	if (approval?.tier === 'sign_off' || neverHere)
		return text(
			`This decision needs a sign-off in the app (a rule the chef never delegates). Give them this link: ${link}`,
			true
		);
	const caps = req.envelope?.[CLIENT_CAPABILITIES_META_KEY] as
		{ elicitation?: unknown } | undefined;
	if (!caps?.elicitation)
		return text(
			`Your client can't show the terms for approval here. Give the chef this link to approve on their device: ${link}`
		);

	const responses = req.inputResponses;
	if (!responses || !('approve' in responses))
		return inputRequired({
			inputRequests: {
				approve: inputRequired.elicit({
					message: termsMessage(plan, approval?.lineIds ?? []),
					requestedSchema: {
						type: 'object',
						properties: {
							approve: { type: 'boolean', title: 'Approve exactly these terms', default: false }
						},
						required: ['approve']
					}
				})
			},
			requestState: termsState(env, a.approvalId, a.planVersion, a.termsHash)
		});

	const state = req.requestState();
	if (
		!sameTermsState(
			env,
			typeof state === 'string' ? state : undefined,
			a.approvalId,
			a.planVersion,
			a.termsHash
		)
	)
		return text('approve: the answer does not match the terms that were shown; ask again.', true);
	const answer = inputResponse(responses, 'approve');
	if (answer.kind !== 'elicit' || answer.action !== 'accept' || answer.content?.approve !== true)
		return text('Not approved: the chef declined. Nothing was approved or ordered.');
	const client = (req.envelope?.[CLIENT_INFO_META_KEY] as { name?: string } | undefined)?.name;
	const r = await handlers.approve(
		{ ...ctx, elicited: true, via: `mcp:${(client ?? 'client').slice(0, 40)}` },
		{ ...a, decision: 'grant' }
	);
	if (!r.ok) return text(JSON.stringify({ error: r.error }), true);
	const value = r.value as Record<string, unknown>;
	return {
		content: [{ type: 'text', text: JSON.stringify(value) }],
		structuredContent: value
	};
}
