/**
 * find_substitutes (PRODUCT ★3, D6 ranking). Candidate pool: Valio's own rules, the event seed's hand-checked
 * candidates and rescue options for that dish, and same-category catalog products only for dishes the seed does not
 * know. Each candidate is sized
 * from the dish's served amount and its own yield and pack, checked by the shared validator, and ranked.
 *
 * Three things are kept apart:
 *  - the recommendation (`chosen`): rank 1 under the rules used, never a rejected candidate;
 *  - the plan's current substitute (`saved`): what will be bought until something is applied;
 *  - applying: replaces `saved` with the recommendation, re-quotes, and so voids the approval.
 * With no qualifying product the seed's make-in-house recipe is recommended (sign-off); otherwise kind `none`.
 */
import {
	err,
	ok,
	type Line,
	type LineReason,
	type PendingOp,
	type Plan,
	type Result,
	type ToolInput,
	type ToolOutput
} from '../contracts';
import {
	makeInHouseQty,
	rescueFor,
	seedEntryFor,
	sizeDirect,
	sizeFor,
	type PoolEntry,
	type SeedDish
} from '../demand';
import { draftFromLine, recalledProducts, type DraftLine } from '../mandate/tier';
import { rankCandidates, supplyOf, type Fit } from '../rank/rank';
import type { CallContext, DecideQuestion } from '../ports';
import { prefetch, requote, type ServicePorts } from './events';
import { pending } from './orders';

/* eslint-disable @typescript-eslint/no-explicit-any -- seed candidate/rescue entries are loose JSON */
type Loose = any;

/** How many top-ranked survivors get a recipe-fit question. */
const FIT_TOP_N = 3;
/** With a batching Decide, every survivor up to this many is asked fit, constraint and origin in one call. */
const BATCH_MAX = 12;
const FIT_TIMEOUT_MS = 4000;
/** P(violates) above this, from a calibrated answer, rejects the candidate. A Decide answer never clears a rejection. */
const VIOLATES_P = 0.5;

type RescueCandidate = { productId: string; name: string; origin?: string };
type RescueAsk = {
	dish: string;
	original: string;
	/** The kitchen's hard constraints, as words Gemini reads (free-from allergens, labels). */
	hardConstraints: string[];
	candidates: RescueCandidate[];
};
type Rescue = { fit: Map<string, Fit>; violates: Map<string, number> };

function race<T>(p: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return Promise.race([
		p,
		new Promise<never>(
			(_, reject) => (timer = setTimeout(() => reject(new Error('fit timeout')), FIT_TIMEOUT_MS))
		)
	]).finally(() => clearTimeout(timer));
}

const FIT_RUBRIC =
	'4 = the same dish, guests would not notice; 3 = a close variant; 2 = acceptable with a note; 1 = a different dish; 0 = unsuitable';

/** The batch for one rescued line: per candidate `c{i}_fit` (0–4), `c{i}_violates` and `c{i}_fi`, one shared context. */
export function rescueQuestions(q: RescueAsk): DecideQuestion[] {
	const context = JSON.stringify({
		dish: q.dish,
		planned_product: q.original,
		hard_constraints: q.hardConstraints,
		candidates: q.candidates.map((c, i) => ({
			ref: `c${i}`,
			name: c.name,
			origin: c.origin ?? 'unknown'
		}))
	});
	return q.candidates.flatMap((c, i): DecideQuestion[] => [
		{
			id: `c${i}_fit`,
			kind: 'score',
			question: `How well does candidate c${i} ("${c.name}") work for the dish "${q.dish}" on a Finnish Christmas buffet, in place of "${q.original}"?`,
			rubric: FIT_RUBRIC,
			max: 4,
			context
		},
		{
			id: `c${i}_violates`,
			kind: 'yes_no',
			question: `Does candidate c${i} ("${c.name}") break any of the kitchen's hard constraints listed in hard_constraints?`,
			context
		},
		{
			id: `c${i}_fi`,
			kind: 'yes_no',
			question: `Is candidate c${i} ("${c.name}") a product of Finnish origin?`,
			context
		}
	]);
}

async function rescueDecide(ports: ServicePorts, q: RescueAsk): Promise<Rescue> {
	const out: Rescue = { fit: new Map(), violates: new Map() };
	if (!ports.decide.batch || q.candidates.length === 0) return out;
	try {
		const a = await race(ports.decide.batch(rescueQuestions(q)));
		q.candidates.forEach((c, i) => {
			const fit = a[`c${i}_fit`];
			const v = a[`c${i}_violates`];
			const fi = a[`c${i}_fi`];
			if (fit)
				out.fit.set(c.productId, {
					score: Math.max(0, Math.min(4, Number(fit.value))),
					source: fit.source,
					model: fit.model,
					latencyMs: fit.latencyMs,
					confidence: fit.source === 'rules' ? undefined : fit.confidence,
					note: fi?.p !== undefined ? `Finnish origin p ${fi.p.toFixed(2)}` : undefined
				});
			// Only a calibrated answer (Gemini or its recorded replay) carries p; a rules guess never rejects.
			if (v?.p !== undefined) out.violates.set(c.productId, v.p);
		});
	} catch {
		// No answer: the deterministic ranking stands.
	}
	return out;
}

async function recipeFit(
	ports: ServicePorts,
	q: { dish: string; original: string; candidates: { productId: string; name: string }[] }
): Promise<Map<string, Fit>> {
	const out = new Map<string, Fit>();
	await Promise.all(
		q.candidates.map(async (c) => {
			try {
				const d = await race(
					ports.decide.score({
						question: `How well does "${c.name}" work for the dish "${q.dish}" on a Finnish Christmas buffet, in place of "${q.original}"?`,
						rubric: FIT_RUBRIC,
						context: `Dish: ${q.dish}. Planned product: ${q.original}. Candidate: ${c.name}.`,
						max: 4
					})
				);
				out.set(c.productId, {
					score: Math.max(0, Math.min(4, d.value)),
					source: d.source,
					model: d.model,
					latencyMs: d.latencyMs
				});
			} catch {
				// No fit for this candidate: it is ranked on the criteria alone.
			}
		})
	);
	return out;
}

function unsizedReason(o: { availability: { kind: string } } | undefined): string {
	const k = o?.availability.kind;
	return k === 'out' || k === 'undeliverable' || k === 'blocked' ? k : 'UNKNOWN_REQUIRED';
}

const sameLines = (a: { productId: string; qty: { value: number } }[], b: typeof a) =>
	a.length === b.length &&
	a.every((x) => b.some((y) => y.productId === x.productId && y.qty.value === x.qty.value));

export async function findSubstitutes(
	ports: ServicePorts,
	ctx: CallContext,
	input: ToolInput<'find_substitutes'>
): Promise<Result<ToolOutput<'find_substitutes'>>> {
	const kitchens = await ports.store.kitchens(ctx.workspaceId);
	const pre = await ports.store.load(ctx.workspaceId, ctx.runId);
	const plan0 = pre.plans[input.planId];
	const recalled = recalledProducts(pre);
	const line = plan0?.lines.find((l) => l.id === input.lineId);
	if (!plan0 || !line) return err('NOT_FOUND', `line ${input.lineId}`);
	if (plan0.version !== input.version)
		return err('STALE_VERSION', `plan is at v${plan0.version}, not v${input.version}`);
	const kitchen = kitchens.find((k) => k.id === plan0.kitchenId);
	if (!kitchen) return err('NOT_FOUND', `kitchen ${plan0.kitchenId}`);
	const saved = plan0.lines.filter(
		(l) => l.substituteFor === line.productId && l.needId === line.needId
	);
	if (saved.some((l) => l.state === 'committed') && input.apply)
		return err('STALE_VERSION', 'the substitute for this dish is already committed');
	const apply = input.apply ?? (!input.weights && !input.requireOrigin && saved.length === 0);
	const rankKitchen = input.weights ? { ...kitchen, weights: input.weights } : kitchen;

	const seed = plan0.eventId ? ports.events?.[plan0.eventId] : undefined;
	const need = plan0.needs.find((n) => n.id === line.needId);
	const dish: SeedDish | undefined = seed?.dishes.find((d) => d.dish === need?.label);
	const rescue = rescueFor(seed, line.productId);
	const servedKg =
		need && need.amount.unit === 'kg' ? need.amount.value * (dish?.yield ?? 1) : null;

	// Pool: catalog (Valio rules first, then same category) + the seed's candidates and rescue products.
	const pool = new Map<string, PoolEntry>();
	const add = (e: PoolEntry) => {
		if (e.productId === line.productId) return;
		const prev = pool.get(e.productId);
		pool.set(e.productId, {
			...prev,
			...e,
			fromValioRule: (prev?.fromValioRule ?? false) || e.fromValioRule
		});
	};
	const seedIds = [
		...((dish as Loose)?.candidates ?? []),
		...(rescue?.alternatives ?? []),
		...(rescue?.chosen?.productId ? [rescue.chosen] : [])
	].map((c: Loose) => c.productId as string);
	// A dish the event seed knows (hand-checked candidates or a rescue) takes only those and Valio's own rules.
	// Same-category neighbours are the catalog's first ids in a broad group (a graham pie for a swede casserole,
	// kidney for a ham), so they are a pool only where nobody has said what the dish can be.
	const dishKnown = seedIds.length > 0 || rescue != null;
	for (const c of await ports.catalog.candidates(line.productId, 12))
		if (c.fromValioRule || !dishKnown)
			add({ productId: c.productId, fromValioRule: c.fromValioRule, yield: dish?.yield });
	for (const id of seedIds) add(seedEntryFor(seed, need?.label ?? '', line.productId, id));

	const ids = [...pool.keys()];
	// The seed's make-in-house recipe, and its ingredients' offers: D8 prefers it to a product of unknown supply.
	const recipe =
		rescue?.chosen?.kind === 'make_in_house' && need?.amount.unit === 'kg' ? rescue.chosen : null;
	const recipeIds: string[] = ((recipe?.ingredients ?? []) as Loose[]).map((g) => g.productId);
	const [products, { offers }] = await Promise.all([
		ports.catalog.get(ids),
		ports.catalog.offers([...new Set([...ids, ...recipeIds])], plan0.deliverBy)
	]);
	const sized = new Map<string, Line['qty']>();
	const unsized: string[] = [];
	for (const [id, e] of pool) {
		const p = products.get(id);
		// A direct need ("1 l milk") is sized to its physical amount (F10): 1 l → 2 × 0.5 l, never 1 × 0.5 l.
		const s = !p
			? null
			: need?.kind === 'direct'
				? ((q) => (q ? { qty: q } : null))(sizeDirect(p, need.amount))
				: sizeFor(p, e, servedKg, line);
		if (s) sized.set(id, s.qty);
		else unsized.push(id);
	}
	const ranked = rankCandidates({
		kitchen: rankKitchen,
		candidates: [...sized].map(([productId, qty]) => ({
			productId,
			fromValioRule: pool.get(productId)!.fromValioRule,
			qty: qty.value
		})),
		products,
		offers: new Map(offers.map((o) => [o.productId, o])),
		recalled
	});
	// Gemini judges what code can't, outside the lock. Recipe fit (0–4, D6 w_fit) reorders survivors. With a batching
	// Decide, one call per rescued line also asks each survivor's hard-constraint check (a calibrated "violates"
	// rejects it and never un-rejects anything) and Finnish origin (shown as evidence). A failure leaves the code
	// ranking. Without batching, fit only reorders survivors, so fewer than two means no call.
	const survivorsRanked = ranked.filter((r) => r.rank !== null).sort((a, b) => a.rank! - b.rank!);
	const asked = (n: number) =>
		survivorsRanked.slice(0, n).map((r) => ({
			productId: r.productId,
			name: products.get(r.productId)?.nameFi ?? r.productId,
			origin: products.get(r.productId)?.origin ?? undefined
		}));
	const judged: Rescue = ports.decide.batch
		? await rescueDecide(ports, {
				dish: need?.label ?? line.productId,
				original: line.productName ?? line.productId,
				hardConstraints: [
					...kitchen.constraints.allergens.freeFrom.map((a) => `free from ${a}`),
					...kitchen.constraints.labels.map((l) => `label ${l}`)
				],
				candidates: asked(BATCH_MAX)
			})
		: {
				fit: await recipeFit(ports, {
					dish: need?.label ?? line.productId,
					original: line.productName ?? line.productId,
					candidates: survivorsRanked.length > 1 ? asked(FIT_TOP_N) : []
				}),
				violates: new Map()
			};
	const fit = judged.fit;
	if (fit.size)
		ranked.splice(
			0,
			ranked.length,
			...rankCandidates({
				kitchen: rankKitchen,
				candidates: [...sized].map(([productId, qty]) => ({
					productId,
					fromValioRule: pool.get(productId)!.fromValioRule,
					qty: qty.value
				})),
				products,
				offers: new Map(offers.map((o) => [o.productId, o])),
				recalled,
				fit
			})
		);
	const vetoed = ranked.filter(
		(r) => r.rank !== null && (judged.violates.get(r.productId) ?? 0) > VIOLATES_P
	);
	for (const r of vetoed) {
		r.rank = null;
		r.score = undefined;
		r.rejectedReasons = [
			`FORBIDDEN.gemini_constraint_p${judged.violates.get(r.productId)!.toFixed(2)}` as const
		];
	}
	if (vetoed.length) {
		let n = 1;
		for (const r of ranked.filter((x) => x.rank !== null).sort((a, b) => a.rank! - b.rank!))
			r.rank = n++;
	}
	if (input.requireOrigin) {
		for (const r of ranked)
			if (r.rank !== null && products.get(r.productId)?.origin !== input.requireOrigin) {
				r.rank = null;
				r.score = undefined;
				r.rejectedReasons = ['origin_required'];
			}
		let n = 1;
		for (const r of ranked.filter((x) => x.rank !== null).sort((a, b) => a.rank! - b.rank!))
			r.rank = n++;
	}
	const nameOf = (id: string) => products.get(id)?.nameFi;
	const candidates = [
		...ranked.map((r) => ({
			productId: r.productId,
			productName: nameOf(r.productId),
			rank: r.rank,
			score: r.score,
			rejectedReasons: r.rejectedReasons as string[],
			fromValioRule: r.fromValioRule
		})),
		...unsized.map((productId) => ({
			productId,
			productName: nameOf(productId),
			rank: null,
			// Availability is the true reason when it already excludes the product; otherwise it can't be sized.
			rejectedReasons: [unsizedReason(offers.find((o) => o.productId === productId))],
			fromValioRule: pool.get(productId)!.fromValioRule
		}))
	];

	// The recommendation under these rules. D8: a product whose supply Valio does not confirm loses to the seed's
	// recipe when every ingredient is known stock for the amount it needs; it stays listed, ranked and labelled.
	const top = ranked.filter((r) => r.rank !== null).sort((a, b) => a.rank! - b.rank!)[0];
	const recipeKnownStock =
		recipe !== null &&
		recipeIds.length > 0 &&
		((recipe.ingredients ?? []) as Loose[]).every((g) => {
			const o = offers.find((x) => x.productId === g.productId);
			const a = o?.availability;
			const qty = makeInHouseQty(g, need!.amount.value).value;
			return (
				supplyOf(o) === 'known_stock' &&
				!recalled.has(g.productId) &&
				(a?.amount == null || a.amount >= qty)
			);
		});
	const best = top && (top.supply === 'known_stock' || !recipeKnownStock) ? top : undefined;
	let kind: 'product' | 'make_in_house' | 'none' = 'product';
	let labourNote: string | undefined;
	let drafts: DraftLine[] = [];
	if (best)
		drafts = [
			{
				id: `${line.id}-sub-${best.productId}`,
				needId: line.needId,
				productId: best.productId,
				qty: sized.get(best.productId)!,
				substituteFor: line.productId,
				strategy: { id: `${line.needId}:sub:${best.productId}`, kind: 'substitute' },
				provenance: {
					source: 'valio_static',
					note: `substitute for ${line.productId}, rank 1 of ${ranked.filter((r) => r.rank).length}`
				}
			}
		];
	else if (recipe && need) {
		kind = 'make_in_house';
		labourNote = rescue.chosen.recipe?.labour;
		const extra: LineReason[] = ['allergen_change'];
		drafts = (rescue.chosen.ingredients as Loose[]).map((g) => ({
			id: `${line.id}-mih-${g.productId}`,
			needId: line.needId,
			productId: g.productId,
			qty: makeInHouseQty(g, need.amount.value),
			substituteFor: line.productId,
			strategy: { id: `${line.needId}:mih`, kind: 'make_in_house' },
			extraReasons: extra,
			provenance: {
				source: 'team_estimate',
				ref: 'fixtures/seeds/christmas-buffet-140.json',
				note: rescue.chosen.recipe?.provenance ?? 'make in house'
			}
		}));
	} else kind = 'none';
	const residual = kind === 'none' && need ? need.amount : undefined;
	const proposedOf = (d: DraftLine): Line => ({
		...d,
		productName: nameOf(d.productId),
		state: 'proposed',
		reasons: [],
		offer: null,
		lineCents: null
	});
	const base = { kind, candidates, labourNote, residual, saved };

	// Preview, nothing to propose, or nothing would change: the plan stays as it is. An empty proposal never writes:
	// it would delete the saved rescue (and void its approval) without covering the dish, or bump the version for
	// nothing, and a caller that retries on a version change loops.
	if (!apply || drafts.length === 0 || sameLines(drafts, saved))
		return ok({ ...base, plan: plan0, chosen: drafts.map(proposedOf), applied: false });

	// Prepare outside the transaction: the open lines after the swap, and their catalogue data.
	const old = new Set(saved.map((l) => l.id));
	const proposedLines = drafts.map(proposedOf);
	const openAfter = [...plan0.lines.filter((l) => !old.has(l.id)), ...proposedLines]
		.filter((l) => l.state !== 'committed')
		.map<DraftLine>((l) => drafts.find((d) => d.id === l.id) ?? draftFromLine(l));
	const fetched = await prefetch(
		ports,
		openAfter.map((d) => d.productId),
		plan0.deliverBy
	);

	const r = await ports.store.transact<{ plan: Plan; chosen: Line[] }>(
		ctx.workspaceId,
		async (tx, state) => {
			const plan = state.plans[input.planId];
			if (!plan || plan.version !== input.version)
				return {
					error: err('STALE_VERSION', 'the plan changed while substitutes were ranked').error
				};
			const envelope = (op: PendingOp['op']) => pending(ctx, op);
			const ops: PendingOp[] = [];
			let version = plan.version;
			if (old.size) {
				// Replace, never stack: the old substitute leaves the plan before the new one is proposed.
				ops.push(
					envelope({
						type: 'EditLine',
						planId: plan.id,
						baseVersion: version,
						lines: saved.map((l) => ({ lineId: l.id, line: null })),
						summary: `replaced the substitute for ${line.productId}`
					})
				);
				version += 1;
			}
			const proposed = proposedLines;
			ops.push(
				envelope({
					type: 'ProposeSubstitute',
					planId: plan.id,
					baseVersion: version,
					forLineId: line.id,
					kind: kind === 'make_in_house' ? 'make_in_house' : 'product',
					lines: proposed,
					labourNote,
					candidates
				})
			);
			const after: Plan = {
				...plan,
				version: version + 1,
				state: 'draft',
				termsHash: null,
				lines: [...plan.lines.filter((l) => !old.has(l.id)), ...proposed]
			};
			const q = await requote(ports, ctx, tx, state, after, kitchen, openAfter, fetched);
			return {
				ops: [...ops, ...q.ops],
				value: {
					plan: q.plan,
					chosen: q.plan.lines.filter((l) => drafts.some((d) => d.id === l.id))
				}
			};
		}
	);
	return r.ok ? ok({ ...base, ...r.value.value, applied: true }) : r;
}
