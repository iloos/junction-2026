/**
 * A visitor's own kitchen (D24 room mode, D25 blank kitchens). Copied from the workspace's sample kitchen of the asked
 * profile (its rules, usual order and delivery days; history follows the profile), never linked: editing one never
 * changes the other. Without a profile it is blank: default rules the chef can edit, no usual order, no history.
 * The kitchen is owned by the visitor who made it, and the gate (handlers.ts) refuses anyone else's writes on it.
 */
import type { CallContext } from '../ports';
import {
	err,
	ok,
	type Kitchen,
	type KitchenCreated,
	type Mandate,
	type Result,
	type ToolInput
} from '../contracts';
import { sha256Hex } from '../hash';
import type { ServicePorts } from './events';

/** Default rules for a blank kitchen: modest caps; new products and allergen changes wait for a chef. */
export const BLANK_MANDATE: Mandate = {
	version: 1,
	words:
		'Order alone up to €500 a line, €2,000 an order and €5,000 a week. Never change an allergen. Ask me before any new product.',
	lineCapCents: 50_000,
	orderCapCents: 200_000,
	weeklyCapCents: 500_000,
	neverDelegate: ['allergen_change', 'new_sku']
};

/** The mandate in one sentence, for the room view and the picker. */
export const mandateWords = (k: Kitchen) => k.mandate.words;

export function createdOf(k: Kitchen, createdAt: string): KitchenCreated {
	return {
		kitchenId: k.id,
		name: k.name,
		kind: k.kind,
		city: k.city,
		copiedFrom: k.copiedFrom ?? '',
		mandateWords: mandateWords(k),
		weeklyCapCents: k.mandate.weeklyCapCents,
		createdAt
	};
}

export async function createKitchen(
	ports: ServicePorts,
	ctx: CallContext,
	input: ToolInput<'create_kitchen'>
): Promise<Result<{ kitchen: KitchenCreated }>> {
	if (!ctx.visitor)
		return err('FORBIDDEN', 'only a visitor in the browser can make a kitchen of their own', {
			sub: 'store_owner'
		});
	if (!ports.store.addKitchen) return err('PROVIDER_UNAVAILABLE', 'this store cannot add kitchens');
	const kitchens = await ports.store.kitchens(ctx.workspaceId);
	// The sample to copy: a seeded kitchen (no owner) of that kind; the first seeded kitchen is the blank's skeleton.
	const samples = kitchens.filter((k) => !k.owner);
	const sample = input.profile
		? samples.find((k) => k.kind === input.profile || k.profile === input.profile)
		: undefined;
	if (input.profile && !sample)
		return err('INVALID_INPUT', `no sample kitchen of kind ${input.profile}`, {
			detail: { kinds: [...new Set(samples.map((k) => k.kind))] }
		});
	const skeleton = sample ?? samples[0] ?? kitchens[0];
	if (!skeleton) return err('NOT_FOUND', 'this workspace has no sample kitchens to start from');

	const now = ports.clock.now().toISOString();
	const id = `k-v-${(await sha256Hex(`${ctx.workspaceId}|${ctx.visitor}|${input.name}|${now}`)).slice(0, 6)}`;
	if (kitchens.some((k) => k.id === id)) return err('DUPLICATE', `kitchen ${id} exists`);
	const copy: Kitchen = structuredClone(skeleton);
	const kitchen: Kitchen = sample
		? {
				...copy,
				id,
				name: input.name,
				city: input.city ?? copy.city,
				mandate: { ...copy.mandate, version: 1 },
				copiedFrom: sample.id,
				owner: ctx.visitor
			}
		: {
				...copy,
				id,
				profile: 'blank',
				kind: 'blank',
				name: input.name,
				city: input.city ?? '',
				constraints: {
					origin: [],
					allergens: { freeFrom: [], unknownCounts: 'hold' },
					tenderListOnly: false,
					labels: []
				},
				mandate: structuredClone(BLANK_MANDATE),
				usualProducts: [],
				copiedFrom: undefined,
				owner: ctx.visitor
			};
	if (!sample) delete kitchen.copiedFrom;
	if (input.description) kitchen.description = input.description;
	await ports.store.addKitchen(ctx.workspaceId, kitchen);
	return ok({ kitchen: createdOf(kitchen, now) });
}
