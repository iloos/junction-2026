/**
 * Demand from a chef-reviewed menu proposal (A4): one need per dish ingredient, guests × amount per guest ÷ yield, in
 * kg, l or pieces. Each need carries its lineage (proposal, revision, dish, ingredient), so edits, substitutes and the
 * Why chain address it by id, never by label or position; two dishes with the same name stay two needs. Pure and
 * deterministic: no model, no catalogue. An ingredient without a product stays a need with its reason, never dropped.
 */
import type { MenuProposal, Need } from '../contracts';
import { canonicalJson, sha256Hex } from '../hash';

export interface MenuNeed {
	need: Need;
	/** The pinned product, when the proposal names one. */
	productId?: string;
	/** Why nothing can be bought for it yet (no product, or a query nobody resolved). */
	unresolved?: string;
}

/**
 * The digest a chef review binds to: the canonical proposal without its status and review record, so a review covers
 * exactly these dishes, amounts and brief. The menu store writes the same digest (server/menu/store.ts).
 */
export async function menuDigest(p: MenuProposal): Promise<string> {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { status, review, ...terms } = p;
	return sha256Hex(canonicalJson(terms));
}

/** A need id that carries the ingredient's stable id (and its dish's, when the ingredient id doesn't already). */
export function menuNeedId(dishId: string, ingredientId: string): string {
	return ingredientId.startsWith(`${dishId}.`) ? ingredientId : `${dishId}.${ingredientId}`;
}

const PER: Record<'g' | 'ml' | 'pcs', { unit: Need['amount']['unit']; factor: number }> = {
	g: { unit: 'kg', factor: 1000 },
	ml: { unit: 'l', factor: 1000 },
	pcs: { unit: 'pcs', factor: 1 }
};

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** A plan's chef edits of amounts per guest, by need id (where the need's amount differs from the proposal's). */
export function menuOverrides(needs: readonly Need[]): Record<string, number> {
	const out: Record<string, number> = {};
	for (const n of needs)
		if (n.source && n.dish && n.dish.gServed !== n.dish.defaultGServed) out[n.id] = n.dish.gServed;
	return out;
}

/** `overrides` are chef edits of an ingredient's amount per guest, by need id. */
export function menuDemand(p: MenuProposal, overrides: Record<string, number> = {}): MenuNeed[] {
	const out: MenuNeed[] = [];
	for (const dish of p.dishes) {
		// A dish for some of the guests (a split course) is sized for them only.
		const guests = dish.guests ?? p.brief.guests;
		for (const g of dish.ingredients) {
			const id = menuNeedId(dish.id, g.id);
			const per = overrides[id] ?? g.amountPerCover;
			const y = g.yield ?? 1;
			const { unit, factor } = PER[g.unit];
			const value = round3((guests * per) / y / factor);
			const yieldText = g.yield === undefined ? ' (yield 1 assumed)' : y !== 1 ? ` ÷ ${y}` : '';
			const claims = dish.claimedCompatible.length
				? `; claims ${dish.claimedCompatible.join(', ')}`
				: '';
			const need: Need = {
				id,
				label: `${dish.name} · ${g.label}`,
				kind: 'dish',
				source: { proposalId: p.id, revision: p.revision, dishId: dish.id, ingredientId: g.id },
				amount: { value, unit },
				dish: {
					gServed: per,
					defaultGServed: g.amountPerCover,
					guests,
					yield: y,
					formula: `${per} ${g.unit} × ${guests}${yieldText} = ${value} ${unit}`
				},
				provenance: {
					source: overrides[id] !== undefined ? 'user' : g.provenance.source,
					ref: `menu ${p.id} r${p.revision}`,
					note: `${dish.name}${claims}`
				}
			};
			const unresolved =
				g.unresolved ?? (g.productId ? undefined : `"${g.query}" is not matched to a product yet`);
			out.push({
				need: unresolved ? { ...need, unresolved } : need,
				...(g.productId ? { productId: g.productId } : {}),
				...(unresolved ? { unresolved } : {})
			});
		}
	}
	return out;
}
