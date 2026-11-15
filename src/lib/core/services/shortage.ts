/**
 * Moment 1: one product runs short at Valio and every kitchen counting on it re-plans inside its own mandate. The
 * stock is shared: kitchens keep what is left in the order their plans were made, and each rescues the rest through
 * the same contention rescue as find_substitutes (its own weights, tiers and never-delegate rules). The same shortage
 * gives each kitchen a different answer: one swaps alone, one holds the swap for its chef, one finds nothing its rules
 * allow. Nothing is committed here.
 */
import type { CallContext } from '../ports';
import type { Kitchen, Line, Plan, ShortageReplanned } from '../contracts';
import { ok, type Result } from '../contracts';
import { rescueContention } from './contention';
import type { ServicePorts } from './events';

export interface ShortageInput {
	productId: string;
	/** Sales units Valio had before the shortage, and has now. */
	had: number;
	left: number;
	shortageId: string;
	/** What happened, in words; lands on the new lines and the anomalies. */
	note: string;
}

type KitchenResult = ShortageReplanned['kitchens'][number];

/** Prepared foods: ready meals and salads (173xx), frozen prepared foods (417xx), sauces and soups (219xx). */
const READY = ['173', '417', '219'];

const eur = (cents: number) => `€${(cents / 100).toLocaleString('en-GB')}`;

/** What a kitchen's rules allow the agent to do about a swap, in words. */
export function allowedBy(k: Kitchen): string {
	const m = k.mandate;
	const parts: string[] = [];
	if (k.constraints.tenderListOnly) parts.push('only tender-list products');
	if (k.constraints.allergens.freeFrom.length)
		parts.push(`must stay free from ${k.constraints.allergens.freeFrom.join(', ').toLowerCase()}`);
	const asks = m.neverDelegate.filter((r) =>
		['new_sku', 'substitute_breaks_preference', 'off_tender_list'].includes(r)
	);
	parts.push(
		asks.length
			? 'new products and unseen substitutes wait for a chef'
			: `the agent swaps alone up to ${eur(m.lineCapCents)} a line`
	);
	return `Its rules: ${parts.join('; ')}.`;
}

const qtyOf = (l: Line | undefined) => (l ? { qty: l.qty.value, unit: l.qty.unit } : null);

function diff(before: Plan, after: Plan): KitchenResult['changed'] {
	const was = new Map(before.lines.map((l) => [l.id, l]));
	const now = new Map(after.lines.map((l) => [l.id, l]));
	const out: KitchenResult['changed'] = [];
	for (const id of new Set([...was.keys(), ...now.keys()])) {
		const a = was.get(id);
		const b = now.get(id);
		const qa = a && a.qty.value > 0 ? a : undefined;
		const qb = b && b.qty.value > 0 ? b : undefined;
		if (!qa && !qb) continue;
		if (qa && qb && qa.qty.value === qb.qty.value && qa.productId === qb.productId) continue;
		const l = (qb ?? qa)!;
		out.push({
			lineId: id,
			productId: l.productId,
			productName: l.productName ?? l.productId,
			was: qtyOf(qa),
			now: qtyOf(qb)
		});
	}
	return out;
}

const waiting = (p: Plan) =>
	p.lines.filter((l) => l.qty.value > 0 && l.state !== 'committed' && l.state === 'held').length;

/** Re-plan every kitchen's open plan on `productId` after the catalogue already reports the lower stock. */
export async function replanShortage(
	ports: ServicePorts,
	ctx: CallContext,
	input: ShortageInput
): Promise<Result<ShortageReplanned>> {
	const [kitchens, before] = await Promise.all([
		ports.store.kitchens(ctx.workspaceId),
		ports.store.load(ctx.workspaceId, ctx.runId)
	]);
	const [product] = [...(await ports.catalog.get([input.productId])).values()];
	const productName = product?.nameFi ?? input.productId;
	const r = await rescueContention(ports, ctx, {
		productId: input.productId,
		note: input.note,
		ref: input.shortageId,
		shared: true
	});
	if (!r.ok) return r;

	const out: KitchenResult[] = [];
	for (const k of kitchens) {
		const mine = r.value.rescued.filter((x) => x.plan.kitchenId === k.id);
		const counting = Object.values(before.plans).find(
			(p) =>
				p.kitchenId === k.id &&
				p.state !== 'committed' &&
				p.lines.some((l) => l.productId === input.productId && l.qty.value > 0)
		);
		const base = { kitchenId: k.id, kitchenName: k.name, allowedBy: allowedBy(k) };
		if (!mine.length) {
			out.push({
				...base,
				planId: counting?.id ?? null,
				outcome: counting ? 'kept' : 'unaffected',
				changed: [],
				swaps: [],
				waitsForPerson: counting ? waiting(counting) : 0,
				why: counting
					? `What is left of ${productName} still covers its order.`
					: `No open order counts on ${productName}.`
			});
			continue;
		}
		const x = mine[mine.length - 1];
		const plan0 = before.plans[x.planId];
		const added = x.chosen.filter((l) => l.productId !== input.productId && l.qty.value > 0);
		const swaps = added.map((l) => ({
			fromProductId: input.productId,
			fromName: productName,
			toProductId: l.productId,
			toName: l.productName ?? l.productId,
			qty: l.qty.value,
			unit: l.qty.unit,
			...(l.view?.physical ? { physical: `${l.view.physical.value} ${l.view.physical.unit}` } : {})
		}));
		const held = added.some((l) => l.state === 'held' || l.tier === 'sign_off');
		const outcome: KitchenResult['outcome'] = !added.length ? 'short' : held ? 'held' : 'swapped';
		const top = swaps[0];
		// A rescue that buys the dish itself ready-made (cooking cream short → Saarioinen lanttulaatikko) is a move at the
		// dish, not a product swap: say it at the dish, or it reads as cream → casserole.
		const subProduct = top
			? (await ports.catalog.get([top.toProductId])).get(top.toProductId)
			: undefined;
		const isReady = (category: string | undefined) =>
			READY.some((c) => (category ?? '').startsWith(c));
		const readyMade = !!subProduct && isReady(subProduct.category) && !isReady(product?.category);
		const inHouse = !!subProduct && !isReady(subProduct.category) && isReady(product?.category);
		const dish = x.plan.needs.find(
			(n) => n.id === added.find((l) => l.productId === top?.toProductId)?.needId
		)?.label;
		const move =
			top && dish && readyMade
				? `${dish}: buying it ready-made (${top.qty} × ${top.toName}) instead of making it, since ${productName} is short`
				: top && dish && inHouse
					? `${dish}: making it in house (${top.qty} × ${top.toName}) instead of buying it ready-made, since ${productName} is short`
					: undefined;
		const why =
			move && outcome !== 'short'
				? `${move}${outcome === 'held' ? '; it waits for a chef.' : ', within its rules.'}`
				: outcome === 'short'
					? `Kept ${x.left} of ${x.had} ${productName}; nothing its rules allow covers the rest, so a chef decides.`
					: outcome === 'held'
						? `Kept ${x.left} of ${x.had} ${productName} and found ${top.toName} for the rest; it waits for a chef.`
						: `Kept ${x.left} of ${x.had} ${productName} and swapped the rest to ${top.toName}, within its rules.`;
		out.push({
			...base,
			planId: x.planId,
			outcome,
			changed: plan0 ? diff(plan0, x.plan) : [],
			swaps,
			waitsForPerson: waiting(x.plan),
			why
		});
	}
	return ok({
		shortageId: input.shortageId,
		productId: input.productId,
		productName,
		had: input.had,
		left: input.left,
		unit: product?.salesUnit ?? 'ST',
		kitchens: out
	});
}
