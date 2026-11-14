/**
 * The visitor's own kitchens (D25, D26): made with create_kitchen, owned by this browser's workspace, listed first
 * in the kitchen selector and landed on at the next visit. The server holds the kitchen; this browser keeps the
 * list of which ones are its own (per workspace), so it reads the same after a reload.
 */

export interface OwnKitchen {
	kitchenId: string;
	name: string;
	mandateWords: string;
	description?: string;
	/** The sample it was copied from; '' for a blank kitchen. */
	copiedFrom: string;
}

export interface CreatedKitchen {
	kitchenId: string;
	name: string;
	kind: string;
	city: string;
	copiedFrom: string;
	mandateWords: string;
	weeklyCapCents: number;
	createdAt: string;
}

const key = (workspace: string) => `mandate.own.${workspace}`;

export function readOwn(workspace: string): OwnKitchen[] {
	try {
		const raw = localStorage.getItem(key(workspace));
		const list = raw ? (JSON.parse(raw) as OwnKitchen[]) : [];
		return Array.isArray(list) ? list.filter((k) => k && typeof k.kitchenId === 'string') : [];
	} catch {
		return [];
	}
}

export function saveOwn(workspace: string, list: OwnKitchen[]): void {
	try {
		localStorage.setItem(key(workspace), JSON.stringify(list));
	} catch {
		/* storage blocked: the list lasts for this page */
	}
}

/** Add or replace by id, newest first. */
export function withOwn(list: OwnKitchen[], k: OwnKitchen): OwnKitchen[] {
	return [k, ...list.filter((x) => x.kitchenId !== k.kitchenId)];
}

/** The create call isn't served yet (the endpoint is missing): said plainly, never a dead end. */
export class NotYet extends Error {}

/** POST /kitchen-api/kitchen with no profile: a blank kitchen with default rules, no history, no booking. */
export async function createKitchen(
	input: { name: string; description?: string; profile?: string; city?: string },
	fetcher: typeof fetch = fetch
): Promise<{ kitchen: CreatedKitchen; roomNotice?: string }> {
	const r = await fetcher('/kitchen-api/kitchen', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(input)
	});
	if (r.status === 404 || r.status === 405) throw new NotYet('create_kitchen is not served yet');
	const body = await r.json().catch(() => null);
	if (!r.ok || !body?.kitchen?.kitchenId)
		throw new Error(body?.error?.message ?? `HTTP ${r.status}`);
	return body;
}
