/**
 * The Kitchen page's door to usual orders (/kitchen-api/usual), in one browser's workspace: read the usual order
 * for a kitchen and day, search the catalogue for a top-up, and plan the chef's confirmed lines. Planning acts as
 * the chef through `place_order` and the shared gate (serveTool), like the screen's other tool calls.
 */
import { visitorKey } from '$lib/server/auth/visitor-key';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import type { Kitchen } from '$lib/core/contracts';
import type { HistoryWindow, PeriodOverride, PeriodOverrides } from '$lib/core/patterns/usual';
import { contextFor } from '$lib/server/auth';
import { inWorkspace } from '$lib/server/adapters/simulator/overlay';
import { ensureRunLoaded } from '$lib/server/demo/reset';
import { createServerPorts } from '$lib/server/store/server-ports';
import { handlers, realHandlers } from '$lib/server/tools/handlers';
import { ToolFailed } from '$lib/server/request/run';
import { planUsualOrder, readUsualOrder, type UsualOrderView } from './usual';

const UNIT = { d: 'days', w: 'weeks', m: 'months' } as const;

/** "12w", "3m", "30d" → a window or override period; null when it doesn't read. */
export function parsePeriod(s: string | null | undefined): HistoryWindow | null {
	const m = /^(\d{1,3})([dwm])$/.exec((s ?? '').trim());
	if (!m || Number(m[1]) < 1) return null;
	return { n: Number(m[1]), unit: UNIT[m[2] as keyof typeof UNIT] };
}

/** `every=<productId>:<period>` entries → per-product overrides (session-only: nothing stores them). */
export function parseOverrides(entries: readonly string[]): PeriodOverrides | undefined {
	const products: Record<string, PeriodOverride> = {};
	for (const e of entries) {
		const [id, p] = e.split(':');
		const period = parsePeriod(p);
		if (/^\d{6}$/.test(id ?? '') && period) products[id] = { every: period.n, unit: period.unit };
	}
	return Object.keys(products).length ? { products } : undefined;
}

async function inKitchen<T>(
	workspaceId: string,
	kitchenId: string,
	fn: (ports: Awaited<ReturnType<typeof createServerPorts>>['ports'], k: Kitchen) => Promise<T>
): Promise<T | null> {
	await ensureRunLoaded(workspaceId);
	await realHandlers();
	const { ports } = await createServerPorts();
	const k = (await ports.store.kitchens(workspaceId)).find((x) => x.id === kitchenId);
	if (!k) return null;
	return inWorkspace(workspaceId, () => fn(ports, k));
}

export interface UsualRead extends UsualOrderView {
	kitchenName: string;
	deliveryDays: string[];
}

/** The usual order for a kitchen and day in this workspace, or null when it has no such kitchen. */
export function readUsual(
	workspaceId: string,
	kitchenId: string,
	o: { date?: string; window?: HistoryWindow; overrides?: PeriodOverrides } = {}
): Promise<UsualRead | null> {
	return inKitchen(workspaceId, kitchenId, async (ports, k) => ({
		...(await readUsualOrder(ports, k, {
			deliveryDate: o.date,
			window: o.window,
			overrides: o.overrides
		})),
		kitchenName: k.name,
		deliveryDays: [...k.deliveryDays]
	}));
}

export interface TopUpHit {
	productId: string;
	name: string;
	unit: string;
	lotStep: number;
}

/** Catalogue search for a top-up line: food only, our short names. Read-only. */
export async function searchTopUp(workspaceId: string, q: string): Promise<TopUpHit[]> {
	if (q.trim().length < 2) return [];
	await realHandlers();
	const { ports } = await createServerPorts();
	const found = await inWorkspace(workspaceId, () =>
		ports.catalog.search(q.trim().slice(0, 60), { limit: 8, foodOnly: true })
	);
	return found.map((p) => ({
		productId: p.productId,
		name: p.nameShort?.value ?? p.nameFi,
		unit: p.salesUnit,
		lotStep: p.lotStep
	}));
}

export const PlanBody = z.object({
	kitchenId: z.string().min(1).max(40),
	deliveryDate: z.iso.date(),
	lines: z
		.array(
			z.object({
				productId: z.string().regex(/^\d{6}$/),
				qty: z.number().positive().max(100_000),
				unit: z.string().min(1).max(8)
			})
		)
		.min(1)
		.max(80),
	nonce: z.string().max(64).optional()
});

export type PlanResult =
	| {
			ok: true;
			planId: string;
			version: number;
			state: string;
			approvalId: string | null;
			summary: string | null;
	  }
	| { ok: false; status: number; error: { code: string; message: string } };

/** Plan the chef's confirmed usual order: `place_order` as the chef, through the gate. */
export async function planUsual(
	workspaceId: string,
	body: unknown,
	/** The browser's visitor: the kitchens it made take its writes; in the shared room only those (D24). */
	visitor?: { own: string; presenter?: boolean }
): Promise<PlanResult> {
	const parsed = PlanBody.safeParse(body);
	if (!parsed.success)
		return {
			ok: false,
			status: 400,
			error: { code: 'INVALID_INPUT', message: 'kitchen, delivery day and at least one line' }
		};
	const b = parsed.data;
	try {
		const r = await inKitchen(workspaceId, b.kitchenId, async () => {
			// The usual-order door: the plan records it (Plan.origin, server-set, never from the request).
			const ctx = {
				...contextFor('chef', 'kitchen-ui', 'kitchen', env, workspaceId),
				origin: 'usual' as const,
				...(visitor ? { visitor: visitorKey(visitor.own) } : {}),
				...(visitor?.presenter ? { sharedRoom: false } : {})
			};
			return planUsualOrder(
				handlers,
				ctx,
				{ kitchenId: b.kitchenId, deliveryDate: b.deliveryDate, lines: [] },
				{ lines: b.lines, nonce: b.nonce }
			);
		});
		if (!r)
			return {
				ok: false,
				status: 404,
				error: { code: 'NOT_FOUND', message: 'no such kitchen in this sandbox' }
			};
		return {
			ok: true,
			planId: r.plan.id,
			version: r.plan.version,
			state: r.plan.state,
			approvalId: r.approvalId,
			summary: r.meta?.summary ?? null
		};
	} catch (e) {
		if (e instanceof ToolFailed)
			return {
				ok: false,
				status: 409,
				// The gate's own words, without the tool and code prefix.
				error: { code: e.code, message: e.message.replace(/^\w+: \S+ /, '') }
			};
		throw e;
	}
}
