/**
 * STUB tool handlers: an in-memory stand-in for the core-db lane's services, so REST, MCP, OpenAPI and
 * the routine agent work end to end before the real store exists. Data comes from fixtures/seeds/
 * (Christmas buffet, kitchens) plus the eval s5 basket; every value carries provenance `seed` and the
 * note "stub". Mandate checks here are a simplified copy of D6 and are not the source of truth.
 * Swap: `src/lib/server/tools/handlers.ts` imports one handlers object.
 */
import {
	Kitchen,
	err,
	ok,
	type Actor,
	type ApprovalState,
	type AvailabilityKind,
	type DomainError,
	type Line,
	type LineReason,
	type Offer,
	type Plan,
	type Product,
	type Provenance,
	type Result,
	type Tier
} from '$lib/core/contracts';
import { requestHash, termsHash } from '$lib/core/hash';
import type { CallContext, ToolHandlers } from '$lib/core/ports';
import buffet from '../../../../fixtures/seeds/christmas-buffet-140.json';
import kitchensSeed from '../../../../fixtures/seeds/kitchens.json';

const SEED_REF = 'fixtures/seeds/christmas-buffet-140.json';
const prov = (note = 'stub handler'): Provenance => ({ source: 'seed', ref: SEED_REF, note });

// ---------- stub catalogue ----------

interface StubItem {
	productId: string;
	name: string;
	salesUnit: string;
	lotStep: number;
	priceCents: number | null;
	availability: { kind: string; amount?: number | null; logisticModel?: string | null };
	origin?: string;
	reliability?: number;
	/** Substitute candidates from the seed, best first. */
	subs: string[];
}

type SeedAvail = { kind: string; amount?: number | null; logisticModel?: string | null };
type SeedCand = {
	productId: string;
	productName: string;
	lotStep?: number;
	priceCents?: number;
	availability: SeedAvail;
	origin?: string;
	reliability?: number;
	order?: { unit: string };
};

function buildCatalogue(): Map<string, StubItem> {
	const items = new Map<string, StubItem>();
	const put = (it: StubItem) => {
		if (!items.has(it.productId)) items.set(it.productId, it);
	};
	const rescue = buffet.rescue as unknown as Record<
		string,
		{ chosen?: SeedCand & { salesUnit?: string }; alternatives?: SeedCand[] }
	>;
	for (const d of buffet.dishes) {
		const r = Object.entries(rescue).find(([k]) => k.endsWith(`-${d.productId}`))?.[1];
		const cands = [
			...(r?.chosen?.productId ? [r.chosen] : []),
			...(r?.alternatives ?? []),
			...((d.candidates ?? []) as SeedCand[])
		];
		put({
			productId: d.productId,
			name: d.productName,
			salesUnit: d.salesUnit,
			lotStep: d.lotStep ?? 1,
			priceCents: d.priceCents,
			availability: d.availability,
			subs: cands.map((c) => c.productId)
		});
		for (const c of cands)
			put({
				productId: c.productId,
				name: c.productName,
				salesUnit: (c as { salesUnit?: string }).salesUnit ?? c.order?.unit ?? 'ST',
				lotStep: c.lotStep ?? 1,
				priceCents: c.priceCents ?? null,
				availability: c.availability,
				origin: c.origin,
				reliability: c.reliability,
				subs: []
			});
	}
	// Eval s5 basket (prices from its notes). Names are placeholders: the static catalogue has the real ones.
	put({
		productId: '470418',
		name: '(stub) Valio product 470418',
		salesUnit: 'ST',
		lotStep: 1,
		priceCents: 2520,
		availability: { kind: 'unlimited', logisticModel: 'Stock' },
		subs: []
	});
	put({
		productId: '472186',
		name: '(stub) Valio product 472186',
		salesUnit: 'ST',
		lotStep: 1,
		priceCents: 263,
		availability: { kind: 'unlimited', logisticModel: 'Stock' },
		subs: []
	});
	return items;
}

const CATALOGUE = buildCatalogue();
const KITCHENS = new Map(
	kitchensSeed.kitchens.map((k) => {
		const parsed = Kitchen.parse(k);
		return [parsed.id, parsed];
	})
);

function toProduct(it: StubItem): Product {
	return {
		productId: it.productId,
		nameFi: it.name,
		category: '00000',
		categoryGroup: '00',
		isFood: true,
		vendor: 'Valio Aimo',
		origin: it.origin,
		labels: [],
		temperatureClass: 'unknown',
		salesUnit: it.salesUnit,
		baseUnit: it.salesUnit,
		packs: [],
		lotStep: it.lotStep,
		catchWeight: it.salesUnit === 'KG' && it.lotStep > 0.01,
		reliability: it.reliability,
		allergens: { contains: [], mayContain: [], declared: false },
		freeFrom: [],
		diet: [],
		valioSubstitutes: [],
		dataQualityFlags: ['stub']
	};
}

function toOffer(it: StubItem, deliverBy: string | null): Offer {
	const a = it.availability;
	const kind: AvailabilityKind =
		a.kind === 'unlimited' ? 'known' : ((a.kind as AvailabilityKind) ?? 'unknown');
	return {
		productId: it.productId,
		price:
			it.priceCents == null
				? null
				: {
						unitCents: it.priceCents,
						comparison: null,
						taxRate: 0.135,
						validTo: null,
						provenance: prov()
					},
		availability: {
			kind,
			amount: kind === 'known' ? (a.kind === 'unlimited' ? null : (a.amount ?? null)) : null,
			logisticModel: (a.logisticModel as 'Stock' | 'Terminal' | null | undefined) ?? null,
			availableDate: deliverBy,
			closingTime: null,
			raw: a,
			provenance: prov()
		}
	};
}

// ---------- in-memory workspace ----------

interface CommitOut {
	orderId: string;
	receiptId: string;
	totalCents: number;
	committedLineIds: string[];
	awaitingSupplier: string[];
}

interface Approval {
	id: string;
	planId: string;
	planVersion: number;
	termsHash: string;
	state: ApprovalState;
	lineIds: string[];
	tier: Tier;
}
interface Space {
	plans: Map<string, Plan>;
	approvals: Map<string, Approval>;
	/** place_order idempotency: key → request hash + plan id. */
	placed: Map<string, { hash: string; planId: string; approvalId: string | null }>;
	/** commit idempotency: key → plan id + receipt. */
	commits: Map<string, { planId: string; out: CommitOut }>;
	weekSpent: Map<string, number>;
	mandateVersion: Map<string, number>;
	seq: number;
}
const spaces = new Map<string, Space>();
function space(ctx: CallContext): Space {
	const k = `${ctx.workspaceId}/${ctx.runId}`;
	let s = spaces.get(k);
	if (!s) {
		s = {
			plans: new Map(),
			approvals: new Map(),
			placed: new Map(),
			commits: new Map(),
			weekSpent: new Map(),
			mandateVersion: new Map(),
			seq: 0
		};
		spaces.set(k, s);
	}
	return s;
}
/** Test helper: forget all stub state. */
export function resetStub() {
	spaces.clear();
}

/** Every stub id starts with `stub-`, so the fallback can route follow-up calls on stub plans here. */
const id = (s: Space, prefix: string) => `stub-${prefix}-${++s.seq}`;
const actorOf = (ctx: CallContext): Actor => ctx.actor;
const forbidden = (ctx: CallContext, scope: string) =>
	!ctx.scopes.includes(scope) ? err('FORBIDDEN', `${ctx.actor.kind} lacks scope ${scope}`) : null;

// ---------- line evaluation (simplified mandate) ----------

function newLine(
	s: Space,
	productId: string,
	qty: number,
	unit: string,
	provenance: Provenance,
	extra: Partial<Line> = {}
): Line {
	return {
		id: id(s, 'line'),
		productId,
		qty: { value: qty, unit },
		state: 'proposed',
		reasons: [],
		offer: null,
		lineCents: null,
		provenance,
		...extra
	};
}

/** Quote every line, apply line/order/weekly caps and the external-agent rule, set states and hash. */
async function quotePlan(s: Space, plan: Plan, ctx: CallContext): Promise<Plan> {
	const k = KITCHENS.get(plan.kitchenId);
	const m = k?.mandate;
	const lines: Line[] = plan.lines.map((l) => {
		if (l.state === 'committed') return l;
		const it = CATALOGUE.get(l.productId);
		const offer = it ? toOffer(it, plan.deliverBy) : null;
		const reasons: LineReason[] = [];
		let state: Line['state'] = 'eligible';
		let tier: Tier | undefined = 'act';
		const kind = offer?.availability.kind;
		const lineCents = offer?.price ? Math.round(offer.price.unitCents * l.qty.value) : null;
		if (!offer) {
			state = 'rejected';
			reasons.push('NOT_FOUND');
			tier = undefined;
		} else if (kind === 'out' || kind === 'undeliverable') {
			state = 'unorderable';
			reasons.push(kind);
			tier = undefined;
		} else if (kind === 'unknown') {
			state = 'held';
			reasons.push('UNKNOWN_REQUIRED');
			tier = 'propose';
		}
		if (state === 'eligible' && m && lineCents != null && lineCents > m.lineCapCents) {
			state = 'held';
			tier = 'sign_off';
			reasons.push('CAP_EXCEEDED.line');
		}
		if (l.substituteFor && state === 'eligible' && m?.neverDelegate.includes('new_sku')) {
			state = 'held';
			tier = 'propose';
			reasons.push('new_sku');
		}
		return { ...l, offer, lineCents, state, tier, reasons };
	});
	const buyable = lines.filter((l) => l.state === 'eligible' || l.state === 'held');
	const total = buyable.reduce((a, l) => a + (l.lineCents ?? 0), 0);
	const holdAll = (reason: LineReason) => {
		for (const l of buyable) {
			l.state = 'held';
			l.tier = 'sign_off';
			if (!l.reasons.includes(reason)) l.reasons.push(reason);
		}
	};
	if (m && total > m.orderCapCents) holdAll('CAP_EXCEEDED.order');
	if (m && (s.weekSpent.get(plan.kitchenId) ?? 0) + total > m.weeklyCapCents)
		holdAll('CAP_EXCEEDED.weekly');
	if (ctx.actor.kind === 'external_agent') holdAll('external_agent_needs_approval');

	const hash = await termsHash({
		deliverBy: plan.deliverBy,
		lines: buyable.map((l) => ({
			productId: l.productId,
			qty: l.qty.value,
			unit: l.qty.unit,
			unitCents: l.offer?.price?.unitCents ?? 0
		}))
	});
	return {
		...plan,
		lines,
		totalCents: total,
		termsHash: hash,
		state: lines.some((l) => l.state === 'held') ? 'held' : 'ready'
	};
}

/** Invalidate open approvals for the plan and open a new one when lines are held. */
function reapprove(s: Space, plan: Plan): string | null {
	for (const a of s.approvals.values())
		if (a.planId === plan.id && a.state === 'pending') a.state = 'invalidated';
	const held = plan.lines.filter((l) => l.state === 'held');
	if (!held.length || !plan.termsHash) return null;
	const a: Approval = {
		id: id(s, 'appr'),
		planId: plan.id,
		planVersion: plan.version,
		termsHash: plan.termsHash,
		state: 'pending',
		lineIds: held.map((l) => l.id),
		tier: held.some((l) => l.tier === 'sign_off') ? 'sign_off' : 'propose'
	};
	s.approvals.set(a.id, a);
	return a.id;
}

/** The newest pending or granted approval for the plan, else the newest of any state. */
function latestApproval(s: Space, planId: string): Approval | null {
	let last: Approval | null = null;
	let live: Approval | null = null;
	for (const a of s.approvals.values())
		if (a.planId === planId) {
			last = a;
			if (a.state === 'pending' || a.state === 'granted') live = a;
		}
	return live ?? last;
}

function getPlan(s: Space, planId: string, version?: number): Result<Plan> {
	const p = s.plans.get(planId);
	if (!p) return err('NOT_FOUND', `plan ${planId}`);
	if (version !== undefined && version !== p.version)
		return err('STALE_VERSION', `plan ${planId} is at version ${p.version}, not ${version}`, {
			detail: { currentVersion: p.version }
		});
	return ok(p);
}

const fail = (e: { ok: false; error: DomainError }) => e;

// ---------- handlers ----------

export const stubHandlers: ToolHandlers = {
	// The offline stub has no store to describe; get_context is served by the real handlers only.
	async get_context() {
		return err('NOT_FOUND', 'get_context needs the server store');
	},
	// The web tools need the web adapters and the findings on file; served by the real handlers only.
	async lookup_facts() {
		return err('PROVIDER_UNAVAILABLE', 'lookup_facts is served by the real handlers only');
	},
	async find_outside() {
		return err('PROVIDER_UNAVAILABLE', 'find_outside is served by the real handlers only');
	},
	async check_recall() {
		return err('PROVIDER_UNAVAILABLE', 'check_recall is served by the real handlers only');
	},
	async search_products(ctx, { query, limit }) {
		const f = forbidden(ctx, 'read');
		if (f) return f;
		const tokens = query
			.toLowerCase()
			.split(/\s+/)
			.filter((t) => t.length > 1);
		const scored = [...CATALOGUE.values()]
			.map((it) => {
				const name = it.name.toLowerCase();
				return { it, hits: tokens.filter((t) => name.includes(t)).length };
			})
			.filter((x) => x.hits > 0)
			.sort((a, b) => b.hits - a.hits);
		return ok({ products: scored.slice(0, limit).map((x) => toProduct(x.it)) });
	},

	async quote(ctx, { productIds, deliverBy }) {
		const f = forbidden(ctx, 'read');
		if (f) return f;
		const offers: Offer[] = [];
		const notFound: string[] = [];
		for (const pid of productIds) {
			const it = CATALOGUE.get(pid);
			if (it) offers.push(toOffer(it, deliverBy ?? null));
			else notFound.push(pid);
		}
		return ok({ offers, notFound });
	},

	async plan_event(ctx, { kitchenId, eventId }) {
		const f = forbidden(ctx, 'plan');
		if (f) return f;
		if (eventId !== buffet.id || kitchenId !== buffet.kitchenId)
			return err(
				'NOT_FOUND',
				`event ${eventId} for kitchen ${kitchenId} (stub knows ${buffet.id})`
			);
		const s = space(ctx);
		const needs: Plan['needs'] = [];
		const lines: Line[] = [];
		for (const d of buffet.dishes) {
			const needId = id(s, 'need');
			needs.push({
				id: needId,
				label: d.dish,
				amount: { value: d.needKg ?? 0, unit: 'kg' },
				provenance: prov('team estimate g/guest × guests / yield')
			});
			lines.push(
				newLine(s, d.productId, d.order.qty, d.order.unit, prov('event seed line'), {
					needId,
					qty: { value: d.order.qty, unit: d.order.unit, rounding: d.order.rounding }
				})
			);
		}
		const draft: Plan = {
			workspaceId: ctx.workspaceId,
			runId: ctx.runId,
			id: id(s, 'plan'),
			kitchenId,
			version: 1,
			state: 'draft',
			deliverBy: '2026-12-11',
			eventId,
			needs,
			lines,
			totalCents: null,
			termsHash: null,
			createdBy: actorOf(ctx)
		};
		const plan = await quotePlan(s, draft, ctx);
		s.plans.set(plan.id, plan);
		reapprove(s, plan);
		return ok({ plan });
	},

	async place_order(ctx, input) {
		const f = forbidden(ctx, 'order');
		if (f) return f;
		const s = space(ctx);
		if (!KITCHENS.has(input.kitchenId)) return err('NOT_FOUND', `kitchen ${input.kitchenId}`);
		const bad = input.lines.find((l) => !/^\d{6}$/.test(l.productId));
		if (bad) return err('INVALID_INPUT', `productId ${bad.productId} is not a six-digit Valio id`);
		const { idempotencyKey, ...payload } = input;
		const hash = await requestHash(payload);
		const idemKey = `place_order/${ctx.actor.id}/${idempotencyKey}`;
		const prior = s.placed.get(idemKey);
		if (prior) {
			if (prior.hash !== hash)
				return err('DUPLICATE', `idempotency key ${idempotencyKey} was used with another payload`);
			return ok({ plan: s.plans.get(prior.planId)!, approvalId: prior.approvalId });
		}
		const draft: Plan = {
			workspaceId: ctx.workspaceId,
			runId: ctx.runId,
			id: id(s, 'plan'),
			kitchenId: input.kitchenId,
			version: 1,
			state: 'draft',
			deliverBy: input.deliverBy,
			needs: [],
			lines: input.lines.map((l) =>
				newLine(s, l.productId, l.qty, l.unit, { source: 'user', note: `via ${ctx.via}` })
			),
			totalCents: null,
			termsHash: null,
			createdBy: actorOf(ctx),
			idempotencyKey
		};
		const plan = await quotePlan(s, draft, ctx);
		s.plans.set(plan.id, plan);
		const approvalId = reapprove(s, plan);
		s.placed.set(idemKey, { hash, planId: plan.id, approvalId });
		return ok({ plan, approvalId });
	},

	async edit_line(ctx, { planId, version, lineId, needId, patch }) {
		const f = forbidden(ctx, 'plan');
		if (f) return f;
		const s = space(ctx);
		const got = getPlan(s, planId, version);
		if (!got.ok) return fail(got);
		const plan = got.value;
		let lines: Line[];
		if (needId !== undefined) {
			// Need edit: g/guest rescales every open line of the need from the seed's g/guest.
			const need = plan.needs.find((n) => n.id === needId);
			if (!need) return err('NOT_FOUND', `need ${needId}`);
			if (patch.gramsPerGuest === undefined)
				return err('INVALID_INPUT', 'a need edit takes patch.gramsPerGuest');
			const dish = buffet.dishes.find((d) => d.dish === need.label);
			if (!dish?.gServed) return err('NOT_FOUND', `no g/guest baseline for need ${needId}`);
			const ratio = patch.gramsPerGuest / dish.gServed;
			lines = plan.lines.map((l) => {
				if (l.needId !== needId || l.state === 'committed') return l;
				const it = CATALOGUE.get(l.productId);
				const step = it?.lotStep && it.lotStep > 0 ? it.lotStep : 1;
				const qty = Math.ceil((l.qty.value * ratio) / step - 1e-9) * step;
				return {
					...l,
					qty: {
						value: qty,
						unit: l.qty.unit,
						rounding: `${dish.gServed} → ${patch.gramsPerGuest} g/guest, rounded up to lot ${step}`
					},
					provenance: { source: 'user', note: `g/guest edit by ${ctx.actor.kind}` }
				};
			});
		} else if (lineId !== undefined) {
			const line = plan.lines.find((l) => l.id === lineId);
			if (!line) return err('NOT_FOUND', `line ${lineId}`);
			if (line.state === 'committed') return err('INVALID_INPUT', `line ${lineId} is committed`);
			const edited: Line = {
				...line,
				productId: patch.productId ?? line.productId,
				qty: { value: patch.qty ?? line.qty.value, unit: line.qty.unit },
				provenance: { source: 'user', note: `edited by ${ctx.actor.kind}` }
			};
			lines = plan.lines.map((l) => (l.id === lineId ? edited : l));
		} else return err('INVALID_INPUT', 'edit_line needs lineId or needId');
		const next = await quotePlan(s, { ...plan, version: plan.version + 1, lines }, ctx);
		s.plans.set(next.id, next);
		reapprove(s, next);
		return ok({ plan: next });
	},

	async find_substitutes(ctx, { planId, version, lineId }) {
		const f = forbidden(ctx, 'plan');
		if (f) return f;
		const s = space(ctx);
		const got = getPlan(s, planId, version);
		if (!got.ok) return fail(got);
		const plan = got.value;
		const line = plan.lines.find((l) => l.id === lineId);
		if (!line) return err('NOT_FOUND', `line ${lineId}`);
		const it = CATALOGUE.get(line.productId);
		const pick = (it?.subs ?? [])
			.map((pid) => CATALOGUE.get(pid)!)
			.find((c) => c.availability.kind === 'known' || c.availability.kind === 'unlimited');
		if (!pick)
			return ok({
				plan,
				kind: 'none' as const,
				chosen: [],
				applied: false,
				saved: [],
				candidates: []
			});
		const need = plan.needs.find((n) => n.id === line.needId);
		const seedOrder = (
			buffet.rescue as unknown as Record<
				string,
				{ chosen?: { productId: string; order?: { qty: number } } }
			>
		)[`${Object.keys(buffet.rescue).find((k) => k.endsWith(`-${line.productId}`))}`]?.chosen;
		const qty =
			seedOrder?.productId === pick.productId ? (seedOrder.order?.qty ?? 1) : line.qty.value;
		const sub = newLine(
			s,
			pick.productId,
			qty,
			pick.salesUnit,
			prov('substitute from seed rescue'),
			{
				needId: need?.id,
				substituteFor: line.productId
			}
		);
		const next = await quotePlan(
			s,
			{ ...plan, version: plan.version + 1, lines: [...plan.lines, sub] },
			ctx
		);
		s.plans.set(next.id, next);
		reapprove(s, next);
		const picked = next.lines.find((l) => l.id === sub.id);
		return ok({
			plan: next,
			kind: 'product' as const,
			chosen: picked ? [picked] : [],
			applied: true,
			saved: [],
			candidates: []
		});
	},

	async get_plan(ctx, { planId }) {
		const f = forbidden(ctx, 'read');
		if (f) return f;
		const s = space(ctx);
		const got = getPlan(s, planId);
		if (!got.ok) return fail(got);
		const a = latestApproval(s, planId);
		return ok({
			plan: got.value,
			approval: a
				? {
						id: a.id,
						state: a.state,
						planVersion: a.planVersion,
						termsHash: a.termsHash,
						lineIds: a.lineIds,
						tier: a.tier
					}
				: null
		});
	},

	async explain_line(ctx, { planId, lineId }) {
		const f = forbidden(ctx, 'read');
		if (f) return f;
		const got = getPlan(space(ctx), planId);
		if (!got.ok) return fail(got);
		const line = got.value.lines.find((l) => l.id === lineId);
		if (!line) return err('NOT_FOUND', `line ${lineId}`);
		const steps = [
			{
				text: `Line for product ${line.productId}: ${line.qty.value} ${line.qty.unit}`,
				source: line.provenance.source
			},
			...(line.qty.rounding ? [{ text: `Rounding: ${line.qty.rounding}`, source: 'seed' }] : []),
			...(line.offer
				? [
						{
							text: `Availability ${line.offer.availability.kind}; price ${line.offer.price?.unitCents ?? '?'} c per ${line.qty.unit}`,
							source: line.offer.availability.provenance.source
						}
					]
				: []),
			...(line.substituteFor ? [{ text: `Replaces ${line.substituteFor}`, source: 'seed' }] : []),
			{
				text: `State ${line.state}${line.tier ? ` (${line.tier})` : ''}${line.reasons.length ? `: ${line.reasons.join(', ')}` : ''}`,
				source: 'stub mandate check'
			}
		];
		return ok({ steps });
	},

	async approve(ctx, { approvalId, planVersion, termsHash: hash, decision }) {
		const f = forbidden(ctx, 'approve');
		if (f) return f;
		const s = space(ctx);
		const a = s.approvals.get(approvalId);
		if (!a) return err('NOT_FOUND', `approval ${approvalId}`);
		if (a.state !== 'pending') return ok({ state: a.state });
		const got = getPlan(s, a.planId);
		if (!got.ok) return fail(got);
		const plan = got.value;
		if (planVersion !== plan.version || planVersion !== a.planVersion)
			return err('STALE_VERSION', `plan is at version ${plan.version}`);
		if (hash !== plan.termsHash || hash !== a.termsHash)
			return err('TERMS_CHANGED', 'terms differ from the ones this approval was opened for');
		a.state = decision === 'grant' ? 'granted' : 'denied';
		if (a.state === 'granted')
			s.plans.set(plan.id, {
				...plan,
				state: 'ready',
				lines: plan.lines.map((l) =>
					a.lineIds.includes(l.id) && l.state === 'held' ? { ...l, state: 'eligible' } : l
				)
			});
		return ok({ state: a.state });
	},

	async commit_order(ctx, { planId, version, idempotencyKey, lineIds }) {
		const f = forbidden(ctx, 'order');
		if (f) return f;
		const s = space(ctx);
		const idemKey = `commit_order/${ctx.actor.id}/${idempotencyKey}`;
		const prior = s.commits.get(idemKey);
		if (prior) {
			if (prior.planId !== planId)
				return err('DUPLICATE', `idempotency key ${idempotencyKey} committed another plan`);
			return ok(prior.out);
		}
		const got = getPlan(s, planId, version);
		if (!got.ok) return fail(got);
		const plan = got.value;
		// Approved lines are already `eligible` (approve flips the lines it covers).
		const eligible = plan.lines.filter((l) => l.state === 'eligible');
		const buy = lineIds ? eligible.filter((l) => lineIds.includes(l.id)) : eligible;
		const notBuyable = (lineIds ?? []).filter((x) => !eligible.some((l) => l.id === x));
		if (notBuyable.length)
			return err('FORBIDDEN', `lines ${notBuyable.join(', ')} are not eligible to commit`, {
				sub: 'approval_required',
				detail: { approvalId: latestApproval(s, planId)?.id ?? null }
			});
		if (!buy.length)
			return err('FORBIDDEN', `plan ${planId} has no eligible lines: held lines need an approval`, {
				sub: 'approval_required',
				detail: { approvalId: latestApproval(s, planId)?.id ?? null }
			});
		const totalCents = buy.reduce((a, l) => a + (l.lineCents ?? 0), 0);
		const ids = new Set(buy.map((l) => l.id));
		const out: CommitOut = {
			orderId: id(s, 'order'),
			receiptId: id(s, 'rcpt'),
			totalCents,
			committedLineIds: [...ids],
			// Terminal / unknown-quantity lines are ordered but not confirmed by the supplier.
			awaitingSupplier: buy.filter((l) => l.offer?.availability.kind === 'unknown').map((l) => l.id)
		};
		s.commits.set(idemKey, { planId, out });
		s.weekSpent.set(plan.kitchenId, (s.weekSpent.get(plan.kitchenId) ?? 0) + totalCents);
		const lines = plan.lines.map((l) =>
			ids.has(l.id) ? { ...l, state: 'committed' as const } : l
		);
		const open = lines.some((l) => l.state === 'eligible' || l.state === 'held');
		s.plans.set(plan.id, {
			...plan,
			version: plan.version + 1,
			state: open ? plan.state : 'committed',
			lines
		});
		return ok(out);
	},

	async set_mandate(ctx, input) {
		const f = forbidden(ctx, 'mandate:write');
		if (f) return f;
		const s = space(ctx);
		const k = KITCHENS.get(input.kitchenId);
		if (!k) return err('NOT_FOUND', `kitchen ${input.kitchenId}`);
		// Mandates are module-wide in the stub (the seed is shared); only the version is per workspace.
		if (input.lineCapCents !== undefined) k.mandate.lineCapCents = input.lineCapCents;
		if (input.orderCapCents !== undefined) k.mandate.orderCapCents = input.orderCapCents;
		if (input.weeklyCapCents !== undefined) k.mandate.weeklyCapCents = input.weeklyCapCents;
		const v = (s.mandateVersion.get(k.id) ?? k.mandate.version) + 1;
		s.mandateVersion.set(k.id, v);
		return ok({ mandateVersion: v });
	}
};
