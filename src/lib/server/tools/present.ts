import type { Plan, ResultMeta, ToolName } from '$lib/core/contracts';
import { nextActionFor } from '$lib/server/agent/next-action';

/**
 * ResultMeta for tool outputs: one sentence, the suggested next call and, when lines wait for a chef, a deep
 * link to the exact plan. Built only from typed fields (counts, states, ids, cents), never from product
 * names, supplier text or web text, so a catalogue string can't steer a client's next step. Words follow
 * D10: "supplier confirmed" only for lines a commit receipt backs; a plan's committed lines are "ordered"
 * (the plan alone doesn't say which await the supplier). The services decide; this text only describes.
 */

type Obj = Record<string, unknown>;
const euros = (cents: number | null | undefined) =>
	cents === null || cents === undefined ? 'no total yet' : `€${(cents / 100).toFixed(2)}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Kitchen screen deep link to one plan version; approving still needs a chef session there. */
export function approvalUrl(plan: Pick<Plan, 'kitchenId' | 'id' | 'version'>): string {
	const q = new URLSearchParams({
		kitchen: plan.kitchenId,
		plan: plan.id,
		v: String(plan.version)
	});
	return `/?${q}`;
}

function planMeta(plan: Plan, approvalPending: boolean): ResultMeta {
	const n = (s: string) => plan.lines.filter((l) => l.state === s).length;
	const held = n('held');
	const out = plan.lines.filter(
		(l) =>
			l.state === 'unorderable' &&
			!plan.lines.some((x) => x.substituteFor === l.productId && x.state !== 'unorderable')
	);
	const eligible = n('eligible');
	const committed = n('committed');
	const parts = [
		`Plan ${plan.id} v${plan.version} (${plan.kitchenId}): ${plural(plan.lines.length, 'line')}, ${euros(plan.totalCents)}`,
		eligible ? `${eligible} within the mandate` : '',
		held ? `${held} held for a chef` : '',
		out.length ? `${out.length} unorderable without a substitute` : '',
		committed ? `${committed} ordered` : ''
	].filter(Boolean);
	const fulfilment = plan.view?.fulfilment;
	if (fulfilment?.length) {
		const open = fulfilment.filter((f) => f.status === 'uncovered' || f.status === 'partial');
		parts.push(`${plural(open.length, 'need')} not fully covered of ${fulfilment.length}`);
	}
	const summary = `${parts.join('; ')}.`.slice(0, 400);
	const meta: ResultMeta = { summary };
	if (held || approvalPending) meta.approvalUrl = approvalUrl(plan);
	const next = nextActionFor(plan, { approvalPending });
	if (next.tool)
		meta.nextAction = {
			tool: next.tool,
			why: next.text.slice(0, 200),
			...(next.args ? { args: next.args } : {})
		};
	return meta;
}

/** The meta for one successful output, or undefined when the tool has nothing to add. */
export function presentMeta(
	tool: ToolName,
	input: unknown,
	value: unknown
): ResultMeta | undefined {
	const v = (value ?? {}) as Obj;
	const i = (input ?? {}) as Obj;
	switch (tool) {
		case 'search_products': {
			const products = (v.products ?? []) as { productId: string }[];
			return {
				summary: `${plural(products.length, 'catalogue product')} matched.`,
				...(products.length
					? {
							nextAction: {
								tool: 'quote',
								why: 'get live price and availability before ordering',
								args: { productIds: products.slice(0, 5).map((p) => p.productId) }
							}
						}
					: {})
			};
		}
		case 'quote': {
			const offers = (v.offers ?? []) as { availability: { kind: string }; price: unknown }[];
			const notFound = ((v.notFound ?? []) as unknown[]).length;
			const usable = offers.filter(
				(o) => o.price && !['out', 'blocked', 'undeliverable'].includes(o.availability.kind)
			).length;
			return {
				summary: `${plural(offers.length, 'offer')}: ${usable} priced and deliverable${notFound ? `, ${notFound} unknown id(s)` : ''}.`
			};
		}
		case 'plan_event':
		case 'place_order':
		case 'edit_line':
		case 'find_substitutes':
			return planMeta(v.plan as Plan, typeof v.approvalId === 'string');
		case 'get_plan': {
			const a = v.approval as { state?: string } | null | undefined;
			return planMeta(v.plan as Plan, a?.state === 'pending');
		}
		case 'explain_line': {
			const steps = ((v.steps ?? []) as unknown[]).length;
			return { summary: `${plural(steps, 'reason step')} for line ${String(i.lineId ?? '')}.` };
		}
		case 'approve':
			return { summary: `Approval ${String(i.approvalId ?? '')} is ${String(v.state)}.` };
		case 'commit_order': {
			const committed = ((v.committedLineIds ?? []) as unknown[]).length;
			const waiting = ((v.awaitingSupplier ?? []) as unknown[]).length;
			return {
				summary: `Ordered ${plural(committed, 'line')} for ${euros(v.totalCents as number)}, receipt ${String(v.receiptId)}: ${committed - waiting} supplier confirmed, ${waiting} awaiting supplier.`,
				nextAction: {
					tool: 'get_plan',
					why: 'see what is still held or unresolved',
					args: { planId: i.planId }
				}
			};
		}
		case 'set_mandate':
			return { summary: `Mandate is now version ${String(v.mandateVersion)}.` };
		case 'lookup_facts': {
			const n = ((v.facts ?? []) as unknown[]).length;
			return {
				summary: `${plural(n, 'web fact')} with sources${v.cached ? ' (cached)' : ''}; catalogue facts still win.`
			};
		}
		case 'find_outside': {
			const n = ((v.options ?? []) as unknown[]).length;
			return {
				summary: `${plural(n, 'option')} outside the catalogue, for the chef; never ordered.`
			};
		}
		case 'check_recall': {
			const notices = (v.notices ?? []) as { match?: string }[];
			const gtin = notices.filter((x) => x.match === 'gtin').length;
			return {
				summary: `${plural(notices.length, 'recall notice')} checked; ${gtin} cite this product by GTIN.`
			};
		}
		case 'get_context':
			return undefined;
	}
}
