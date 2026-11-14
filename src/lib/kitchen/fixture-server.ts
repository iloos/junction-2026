import type { DietFacts } from '$lib/ui/diet';
import { withFixtureView } from './fixture-view';
import type {
	Approval,
	DomainError,
	Kitchen,
	Line,
	Plan,
	Receipt,
	ToolInput,
	ToolName,
	ToolOutput
} from '$lib/core/contracts';
import { termsHash } from '$lib/core/hash';
import { SCENARIO, scenarioClock } from '$lib/core/scenario';
import { KITCHENS } from './catalog';
import { eventFor } from './events';
import {
	buildEvent,
	rulesFor,
	type Built,
	type EventView,
	type PresetId,
	type Rules
} from './fixture-plan';

/**
 * An in-browser stand-in for `POST /api/tools/<name>`: the same inputs and outputs as the tool registry,
 * backed by the pure builder. It keeps what a server would keep (version, approvals, orders by idempotency key)
 * so the journey (edit → approve exact terms → commit → retry) behaves like the real gate.
 */

export class ToolError extends Error {
	constructor(public error: DomainError) {
		super(error.message);
	}
}

const fail = (code: DomainError['code'], message: string, retryable = false): never => {
	throw new ToolError({ code, message, retryable });
};

export interface CommitRecord {
	output: ToolOutput<'commit_order'>;
	receipt: Receipt;
	lines: Line[];
	at: string;
	/** The idempotency key the order was placed with: a retry resends it and gets the same receipt. */
	key?: string;
}

interface State {
	kitchen: Kitchen;
	preset: PresetId;
	rules: Rules;
	grams: Record<string, number>;
	guests: number;
	contention: boolean;
	weekSpentCents: number;
	version: number;
	mandateVersion: number;
	committed: Record<string, Line>;
	approvals: Approval[];
	orders: Map<string, CommitRecord>;
	built: Built;
	hash: string | null;
	seq: number;
	orderSeq: number;
}

const DEMO_CLOCK = '2026-12-07T21:40:00+02:00';

function initial(kitchenId = 'k-hotel'): State {
	const kitchen = KITCHENS.find((k) => k.id === kitchenId) ?? KITCHENS[0];
	const rules = rulesFor(kitchen, 'kitchen');
	const s: State = {
		kitchen,
		preset: 'kitchen',
		rules,
		grams: {},
		guests: eventFor(kitchen.id)?.guests.estimate ?? 140,
		contention: false,
		weekSpentCents: 248_000,
		version: 1,
		mandateVersion: 1,
		committed: {},
		approvals: [],
		orders: new Map(),
		built: null as unknown as Built,
		hash: null,
		seq: 0,
		orderSeq: 0
	};
	return s;
}

let s = initial();

async function rebuild(bump: boolean, summary?: string) {
	if (bump) s.version += 1;
	s.built = buildEvent({
		kitchen: s.kitchen,
		eventId: eventFor(s.kitchen.id)?.id,
		rules: s.rules,
		grams: s.grams,
		scenario: { guests: s.guests, contention: s.contention, weekSpentCents: s.weekSpentCents },
		version: s.version,
		committed: s.committed
	});
	const terms = s.built.plan.lines
		.filter((l) => l.state === 'eligible' || l.state === 'held')
		.map((l) => ({
			productId: l.productId,
			qty: l.qty.value,
			unit: l.qty.unit,
			unitCents: l.offer?.price?.unitCents ?? 0
		}));
	s.hash = await termsHash({ deliverBy: s.built.plan.deliverBy, lines: terms });
	s.built.plan.termsHash = s.hash;

	// Any change voids approvals bound to an older version (D6).
	if (bump)
		s.approvals = s.approvals.map((a) =>
			(a.state === 'pending' || a.state === 'granted') &&
			a.planVersion !== s.version &&
			!consumed(a)
				? {
						...a,
						state: 'invalidated',
						reason: summary ? `plan changed: ${summary}` : 'plan changed'
					}
				: a
		);
	// Lines the chef denied at this version stay held without being asked again.
	const denied = new Set(
		s.approvals
			.filter((a) => a.state === 'denied' && a.planVersion === s.version)
			.flatMap((a) => a.lineIds)
	);
	const held = s.built.plan.lines.filter((l) => l.state === 'held' && !denied.has(l.id));
	const live =
		s.approvals.find((a) => a.state === 'pending' && a.planVersion === s.version) ?? current();
	if (held.length && !live) {
		s.seq += 1;
		s.approvals = [
			...s.approvals,
			{
				workspaceId: 'ws-demo',
				runId: 'run-fixture',
				id: `apr-${String(s.seq).padStart(3, '0')}`,
				planId: s.built.plan.id,
				planVersion: s.version,
				termsHash: s.hash,
				mandateVersion: s.mandateVersion,
				lineIds: held.map((l) => l.id),
				tier: held.some((l) => l.tier === 'sign_off') ? 'sign_off' : 'propose',
				state: 'pending',
				requestedBy: { kind: 'kitchen_agent', id: 'agent-kitchen' },
				expiresAt: SCENARIO.cutoff
			}
		];
	}
	// Lines covered by any granted approval at this version may be committed (groups are granted one at a time).
	const grantedIds = new Set(
		s.approvals
			.filter((a) => a.state === 'granted' && a.planVersion === s.version)
			.flatMap((a) => a.lineIds)
	);
	if (grantedIds.size) {
		s.built.plan.lines = s.built.plan.lines.map((l) =>
			grantedIds.has(l.id) && l.state === 'held' ? { ...l, state: 'eligible' } : l
		);
		s.built.plan.state = 'ready';
	}
}

/** A granted approval whose lines are all committed has done its job. */
function consumed(a: Approval): boolean {
	return a.state === 'granted' && a.lineIds.every((id) => s.committed[id]);
}

function current(): Approval | null {
	return (
		[...s.approvals]
			.reverse()
			.find((a) => (a.state === 'pending' || a.state === 'granted') && !consumed(a)) ?? null
	);
}

function approvalOut(): ToolOutput<'get_plan'>['approval'] {
	const a = current();
	return a
		? {
				id: a.id,
				state: a.state,
				planVersion: a.planVersion,
				termsHash: a.termsHash,
				lineIds: a.lineIds,
				tier: a.tier
			}
		: null;
}

function checkVersion(planId: string, version: number) {
	if (planId !== s.built.plan.id) fail('NOT_FOUND', `plan ${planId}`);
	if (version !== s.version)
		fail('STALE_VERSION', `plan is at v${s.version}, you sent v${version}`, true);
}

// ───────────────────────────── tools ─────────────────────────────

type Handler<N extends ToolName> = (input: ToolInput<N>) => Promise<ToolOutput<N>>;

const handlers: { [N in ToolName]?: Handler<N> } = {
	plan_event: async (input) => {
		// The offline kitchen plans seeded events only; a kitchen without one starts from the chat.
		if (!eventFor(input.kitchenId))
			fail(
				'NOT_FOUND',
				`${input.kitchenId} has no event to plan: its first plan comes from the chat`
			);
		if (input.kitchenId !== s.kitchen.id) {
			s = initial(input.kitchenId);
		}
		if (!s.built) await rebuild(false);
		return { plan: withFixtureView(s.built.plan, s.approvals) };
	},
	get_plan: async () => {
		if (!s.built) await rebuild(false);
		return { plan: withFixtureView(s.built.plan, s.approvals), approval: approvalOut() };
	},
	edit_line: async (input) => {
		checkVersion(input.planId, input.version);
		const dish = s.built.view.dishes.find((d) => d.needId === input.needId);
		if (input.patch.gramsPerGuest !== undefined) {
			if (!dish) fail('NOT_FOUND', `need ${input.needId}`);
			const g = Math.round(input.patch.gramsPerGuest);
			if (g < 1 || g > 1000) fail('INVALID_INPUT', 'grams per guest must be 1–1000');
			if (dish!.lineIds.some((id) => s.committed[id]))
				fail('INVALID_INPUT', 'committed lines cannot change');
			const before = dish!.gServed;
			s.grams = { ...s.grams, [dish!.id]: g };
			await rebuild(true, `${dish!.nameFi} ${before} → ${g} g/guest`);
		}
		return { plan: withFixtureView(s.built.plan, s.approvals) };
	},
	find_substitutes: async (input) => {
		checkVersion(input.planId, input.version);
		const dish = s.built.view.dishes.find((d) => d.rescue?.forLineId === input.lineId);
		const chosen =
			s.built.plan.lines.find((l) => l.substituteFor && l.needId === dish?.needId) ?? null;
		return {
			plan: withFixtureView(s.built.plan, s.approvals),
			kind: chosen ? ('product' as const) : ('none' as const),
			chosen: chosen ? [chosen] : [],
			applied: false,
			saved: chosen ? [chosen] : [],
			candidates: []
		};
	},
	explain_line: async (input) => ({ steps: s.built.view.why[input.lineId] ?? [] }),
	approve: async (input) => {
		const a = s.approvals.find((x) => x.id === input.approvalId);
		if (!a) return fail('NOT_FOUND', `approval ${input.approvalId}`);
		if (a.state === 'invalidated')
			fail('STALE_VERSION', `approval was invalidated: ${a.reason ?? 'plan changed'}`);
		if (input.planVersion !== a.planVersion || a.planVersion !== s.version)
			fail(
				'STALE_VERSION',
				`approval is bound to v${a.planVersion}; the plan is at v${s.version}`,
				true
			);
		if (input.termsHash !== a.termsHash || a.termsHash !== s.hash)
			fail('TERMS_CHANGED', 'the terms you saw are not the terms now');
		if (a.state !== 'pending') fail('INVALID_INPUT', `approval is ${a.state}`);
		// A subset decides those lines only; the rest move to a new pending approval on the same terms (core rule).
		const decide = input.lineIds ?? a.lineIds;
		if (decide.some((id) => !a.lineIds.includes(id)))
			fail('INVALID_INPUT', 'lineIds must belong to this approval');
		const rest = a.lineIds.filter((id) => !decide.includes(id));
		const next: Approval = {
			...a,
			lineIds: decide,
			state: input.decision === 'grant' ? 'granted' : 'denied',
			decidedBy: { kind: 'chef', id: 'chef-demo' }
		};
		let remaining: Approval | null = null;
		if (rest.length) {
			s.seq += 1;
			remaining = {
				...a,
				id: `apr-${String(s.seq).padStart(3, '0')}`,
				lineIds: rest,
				state: 'pending'
			};
		}
		s.approvals = [
			...s.approvals.map((x) => (x.id === a.id ? next : x)),
			...(remaining ? [remaining] : [])
		];
		await rebuild(false);
		return { state: next.state, remainingApprovalId: remaining?.id ?? null };
	},
	commit_order: async (input) => {
		const prior = s.orders.get(input.idempotencyKey);
		if (prior) return prior.output;
		checkVersion(input.planId, input.version);
		const committable = s.built.plan.lines.filter(
			(l) => l.state === 'eligible' && (!input.lineIds || input.lineIds.includes(l.id))
		);
		if (!committable.length)
			fail('INVALID_INPUT', 'nothing to commit: every open line is held for approval');
		const total = committable.reduce((sum, l) => sum + (l.lineCents ?? 0), 0);
		s.orderSeq += 1;
		const n = String(s.orderSeq).padStart(3, '0');
		const orderId = `ord-${n}`;
		const receiptId = `rcpt-${n}`;
		const known = committable.filter((l) => l.offer?.availability.kind === 'known');
		const unknown = committable.filter((l) => l.offer?.availability.kind !== 'known');
		const receipt: Receipt = {
			workspaceId: 'ws-demo',
			runId: 'run-fixture',
			id: receiptId,
			orderId,
			confirmed: known.map((l) => ({ productId: l.productId, qty: l.qty })),
			awaitingSupplier: unknown.map((l) => ({ productId: l.productId, qty: l.qty })),
			at: DEMO_CLOCK,
			provenance: { source: 'simulator', note: 'local simulated commitment' }
		};
		const output: ToolOutput<'commit_order'> = {
			orderId,
			receiptId,
			totalCents: total,
			committedLineIds: committable.map((l) => l.id),
			awaitingSupplier: unknown.map((l) => l.id)
		};
		for (const l of committable) s.committed[l.id] = { ...l, state: 'committed' };
		s.orders.set(input.idempotencyKey, {
			output,
			receipt,
			lines: committable,
			at: DEMO_CLOCK,
			key: input.idempotencyKey
		});
		await rebuild(true, `committed ${orderId}`);
		return output;
	},
	set_mandate: async (input) => {
		if (input.kitchenId !== s.kitchen.id) fail('NOT_FOUND', `kitchen ${input.kitchenId}`);
		s.mandateVersion += 1;
		s.rules = {
			...s.rules,
			mandateVersion: s.mandateVersion,
			...(input.lineCapCents !== undefined ? { lineCapCents: input.lineCapCents } : {}),
			...(input.orderCapCents !== undefined ? { orderCapCents: input.orderCapCents } : {}),
			...(input.weeklyCapCents !== undefined ? { weeklyCapCents: input.weeklyCapCents } : {}),
			...(input.weights ? { weights: input.weights } : {})
		};
		await rebuild(true, `mandate v${s.mandateVersion}`);
		return { mandateVersion: s.mandateVersion };
	}
};

export async function fixtureCall<N extends ToolName>(
	name: N,
	input: ToolInput<N>
): Promise<ToolOutput<N>> {
	const h = handlers[name] as Handler<N> | undefined;
	if (!h) return fail('NOT_FOUND', `fixture has no tool ${name}`);
	return h(input);
}

// ───────────────────────────── fixture-only (not in the tool contract yet) ─────────────────────────────

/** Where a plan came from: the booking (event), the agent in chat, a purchase request, an outside agent (MCP/REST), the Kitchen. */
export type PlanOrigin = 'event' | 'chat' | 'request' | 'outside_agent' | 'kitchen';

export interface FixtureSnapshot {
	plan: Plan;
	view: EventView;
	approval: Approval | null;
	/** Every live decision on the plan's current version (a split approval keeps each line's own); absent on old reads. */
	approvals?: Approval[];
	lastInvalidated: Approval | null;
	orders: CommitRecord[];
	kitchen: Kitchen;
	rules: Rules;
	preset: PresetId;
	contention: boolean;
	mandateVersion: number;
	/** The scenario clock's reading when the snapshot was made (SCENARIO.start + time since the run started). */
	clock: { nowIso: string; runId: string; workspaceId?: string };
	/**
	 * What the kitchen agent did when another kitchen took stock (simulator contention), for the screen's one
	 * sentence: how many of the product were left, what it kept and what it added, and whether that needs sign-off.
	 */
	contentionRescue?: {
		productName: string;
		/** Sales units the other kitchen took from Valio's stock. */
		taken: number;
		/** What the plan's line had, and how many of the product are left for it. */
		had: number;
		left: number;
		unit: string;
		added: { name: string; qty: number; unit: string; physical: string | null }[];
		signOff: boolean;
	} | null;
	/**
	 * Lines an agent last changed (proposed a substitute, edited, or created as an outside agent's order), by line id:
	 * the page marks them "by the agent" so the agent's work reads in the same place as the chef's.
	 */
	byAgent?: Record<string, 'kitchen_agent' | 'external_agent'>;
	/** Where the plan on screen came from (its CreatePlan op), so the page can say so. */
	origin?: PlanOrigin | null;
	/** Each product's allergen record and diet claims (lib/ui/diet), for the menu codes on lines, dishes and the order. */
	diet?: Record<string, DietFacts>;
	/** Readable product names where the catalogue has a normalised one (Product.nameShort), by product id. */
	shortNames?: Record<string, string>;
	/** The kitchen's other plans in this sandbox (an agent's order, the event), for the task switcher. */
	others?: { id: string; title: string; open: number; ordered: number; version?: number }[];
}

/** The fixture's run starts when the module loads (or on reset), like a server run. */
let runStartedAt = Date.now();

export async function snapshot(): Promise<FixtureSnapshot> {
	if (!s.built) await rebuild(false);
	const invalid = [...s.approvals].reverse().find((a) => a.state === 'invalidated') ?? null;
	return {
		plan: withFixtureView(s.built.plan, s.approvals),
		view: s.built.view,
		approval: current(),
		approvals: s.approvals.filter(
			(a) => a.planVersion === s.built!.plan.version && a.state !== 'invalidated'
		),
		lastInvalidated: invalid,
		orders: [...s.orders.values()],
		kitchen: s.kitchen,
		rules: s.rules,
		preset: s.preset,
		contention: s.contention,
		mandateVersion: s.mandateVersion,
		clock: {
			nowIso: scenarioClock(runStartedAt).at(Date.now()).toISOString(),
			runId: 'run-fixture',
			workspaceId: 'browser fixture'
		}
	};
}

/** Switch the rule preset ("Same shortage. Your rules."): a mandate change, so it bumps both versions. */
export async function setPreset(preset: PresetId) {
	s.preset = preset;
	s.mandateVersion += 1;
	s.rules = rulesFor(s.kitchen, preset, s.mandateVersion);
	await rebuild(true, `rules: ${preset}`);
}

export async function setKitchen(kitchenId: string) {
	// Never stand in another kitchen's event: a kitchen without one starts from the chat.
	if (!eventFor(kitchenId))
		fail('NOT_FOUND', `${kitchenId} has no event to plan: its first plan comes from the chat`);
	s = initial(kitchenId);
	await rebuild(false);
}

/** Simulator overlay: another kitchen takes 4 palvikinkku. */
export async function setContention(on: boolean) {
	s.contention = on;
	await rebuild(true, on ? 'another kitchen took 4 × 476768' : 'contention cleared');
}

export async function reset() {
	runStartedAt = Date.now();
	s = initial(s.kitchen.id);
	await rebuild(false);
}
