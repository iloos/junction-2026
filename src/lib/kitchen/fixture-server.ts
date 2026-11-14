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
import { KITCHENS } from './catalog';
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
		guests: 140,
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
	const held = s.built.plan.lines.filter((l) => l.state === 'held');
	const live = current();
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
				expiresAt: '2026-12-09T17:00:00+02:00'
			}
		];
	}
	// Lines covered by a granted approval may be committed.
	const granted = current();
	if (granted?.state === 'granted') {
		s.built.plan.lines = s.built.plan.lines.map((l) =>
			granted.lineIds.includes(l.id) && l.state === 'held' ? { ...l, state: 'eligible' } : l
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
		if (input.kitchenId !== s.kitchen.id) {
			s = initial(input.kitchenId);
		}
		if (!s.built) await rebuild(false);
		return { plan: s.built.plan };
	},
	get_plan: async () => {
		if (!s.built) await rebuild(false);
		return { plan: s.built.plan, approval: approvalOut() };
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
		return { plan: s.built.plan };
	},
	find_substitutes: async (input) => {
		checkVersion(input.planId, input.version);
		const dish = s.built.view.dishes.find((d) => d.rescue?.forLineId === input.lineId);
		const chosen =
			s.built.plan.lines.find((l) => l.substituteFor && l.needId === dish?.needId) ?? null;
		return {
			plan: s.built.plan,
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
		const next: Approval = {
			...a,
			state: input.decision === 'grant' ? 'granted' : 'denied',
			decidedBy: { kind: 'chef', id: 'chef-demo' }
		};
		s.approvals = s.approvals.map((x) => (x.id === a.id ? next : x));
		await rebuild(false);
		return { state: next.state };
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
		s.orders.set(input.idempotencyKey, { output, receipt, lines: committable, at: DEMO_CLOCK });
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

export interface FixtureSnapshot {
	plan: Plan;
	view: EventView;
	approval: Approval | null;
	lastInvalidated: Approval | null;
	orders: CommitRecord[];
	kitchen: Kitchen;
	rules: Rules;
	preset: PresetId;
	contention: boolean;
	mandateVersion: number;
}

export async function snapshot(): Promise<FixtureSnapshot> {
	if (!s.built) await rebuild(false);
	const invalid = [...s.approvals].reverse().find((a) => a.state === 'invalidated') ?? null;
	return {
		plan: s.built.plan,
		view: s.built.view,
		approval: current(),
		lastInvalidated: invalid,
		orders: [...s.orders.values()],
		kitchen: s.kitchen,
		rules: s.rules,
		preset: s.preset,
		contention: s.contention,
		mandateVersion: s.mandateVersion
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
	s = initial(kitchenId);
	await rebuild(false);
}

/** Simulator overlay: another kitchen takes 4 palvikinkku. */
export async function setContention(on: boolean) {
	s.contention = on;
	await rebuild(true, on ? 'another kitchen took 4 × 476768' : 'contention cleared');
}

export async function reset() {
	s = initial(s.kitchen.id);
	await rebuild(false);
}
