// Compares a scenario's `expect` with the end state a gate adapter reports. Pure: no I/O.
// Every expect key must have a checker; an unknown key fails, so a typo can't pass silently.
import type { CheckResult, EndState, LineView } from './types.ts';

type Obj = Record<string, unknown>;
type Checker = (want: unknown, end: EndState) => CheckResult[];

const ok = (key: string, detail = 'ok'): CheckResult => ({ key, pass: true, detail });
const fail = (key: string, detail: string): CheckResult => ({ key, pass: false, detail });
const show = (v: unknown) => JSON.stringify(v);

/** Every element of `want` appears in `have` in order (not necessarily adjacent). */
function subsequence(want: string[], have: string[]): boolean {
	let i = 0;
	for (const h of have) if (i < want.length && h === want[i]) i++;
	return i === want.length;
}

const LINE_SCALARS = [
	'qty',
	'unit',
	'state',
	'tier',
	'priceCents',
	'lineCents',
	'deliveryDate',
	'substituteFor',
	'closingTime'
] as const;

/** Matches one expected line against the lines with its productId; returns what differed. */
function matchLine(key: string, want: Obj, lines: LineView[]): CheckResult {
	const id = String(want.productId);
	const candidates = lines.filter((l) => l.productId === id);
	if (candidates.length === 0) return fail(key, `${id}: no line`);
	const problems: string[][] = candidates.map((l) => {
		const p: string[] = [];
		for (const f of LINE_SCALARS)
			if (want[f] !== undefined && want[f] !== l[f])
				p.push(`${f} ${show(l[f])} ≠ ${show(want[f])}`);
		if (want.needKg !== undefined && Math.abs(Number(want.needKg) - Number(l.needKg)) > 0.01)
			p.push(`needKg ${l.needKg} ≠ ${want.needKg}`);
		for (const r of (want.reasons as string[] | undefined) ?? [])
			if (!l.reasons.includes(r)) p.push(`missing reason ${r} (has ${show(l.reasons)})`);
		if (want.notState !== undefined && l.state === want.notState) p.push(`state is ${l.state}`);
		for (const r of (want.notReasons as string[] | undefined) ?? [])
			if (l.reasons.includes(r)) p.push(`has reason ${r}`);
		if (want.historyStates && !subsequence(want.historyStates as string[], l.historyStates ?? []))
			p.push(`historyStates ${show(l.historyStates)} lacks ${show(want.historyStates)}`);
		if (
			want.historyReasons &&
			!subsequence(want.historyReasons as string[], l.historyReasons ?? [])
		)
			p.push(`historyReasons ${show(l.historyReasons)} lacks ${show(want.historyReasons)}`);
		return p;
	});
	const best = problems.reduce((a, b) => (b.length < a.length ? b : a));
	return best.length === 0 ? ok(key, id) : fail(key, `${id}: ${best.join('; ')}`);
}

const linesIn =
	(pick: (end: EndState) => LineView[], key: string): Checker =>
	(want, end) =>
		(want as Obj[]).map((w) => matchLine(`${key}[${w.productId}]`, w, pick(end)));

const inState =
	(state: string, key: string): Checker =>
	(want, end) =>
		(want as Obj[]).map((w) => matchLine(`${key}[${w.productId}]`, { ...w, state }, end.lines));

const exact =
	(key: string, get: (end: EndState) => unknown): Checker =>
	(want, end) => {
		const have = get(end);
		return [show(have) === show(want) ? ok(key) : fail(key, `${show(have)} ≠ ${show(want)}`)];
	};

const sameSet = (a: unknown[], b: unknown[]) =>
	show([...a].map(String).sort()) === show([...b].map(String).sort());

const CHECKERS: Record<string, Checker> = {
	lines: linesIn((e) => e.lines, 'lines'),
	needsAfterEdit: linesIn((e) => e.linesAfterEdit ?? e.lines, 'needsAfterEdit'),
	rejected: inState('rejected', 'rejected'),
	unorderable: inState('unorderable', 'unorderable'),

	notProposed: (want, end) =>
		(want as string[]).map((id) => {
			const pickable = end.lines.filter((l) => l.productId === id && l.pickable);
			return pickable.length === 0
				? ok(`notProposed[${id}]`)
				: fail(`notProposed[${id}]`, 'shown as a pickable option');
		}),

	rank: (want, end) => {
		const { need, first } = want as { need: string; first: string };
		const order = end.ranking[need] ?? [];
		return [
			order[0] === first ? ok('rank') : fail('rank', `${need}: first ${show(order[0])} ≠ ${first}`)
		];
	},

	availabilityKinds: (want, end) =>
		Object.entries(want as Record<string, string>).map(([id, kind]) =>
			end.availabilityKinds[id] === kind
				? ok(`availabilityKinds[${id}]`)
				: fail(`availabilityKinds[${id}]`, `${show(end.availabilityKinds[id])} ≠ ${kind}`)
		),

	wordingMustDiffer: (want, end) => {
		const words = (want as string[]).map((k) => end.wording[k]);
		const distinct = new Set(words.map((w) => w?.trim().toLowerCase())).size === words.length;
		return [
			words.every(Boolean) && distinct
				? ok('wordingMustDiffer')
				: fail('wordingMustDiffer', show(words))
		];
	},

	approvalStates: (want, end) => [
		subsequence(want as string[], end.approvalStates)
			? ok('approvalStates')
			: fail('approvalStates', `${show(end.approvalStates)} lacks ${show(want)}`)
	],

	commitResults: (want, end) =>
		(want as Obj[]).map((w) => {
			const key = `commitResults[${w.idempotencyKey}]`;
			const a = end.attempts.find(
				(x) => x.action === 'commit' && x.idempotencyKey === w.idempotencyKey
			);
			if (!a) return fail(key, 'no attempt');
			if (a.result !== w.result) return fail(key, `result ${a.result} ≠ ${w.result}`);
			if (w.error && a.error !== w.error) return fail(key, `error ${a.error} ≠ ${w.error}`);
			if (w.retryable !== undefined && a.retryable !== w.retryable)
				return fail(key, `retryable ${a.retryable}`);
			return ok(key);
		}),

	errors: (want, end) =>
		(want as Obj[]).map((w) => {
			const key = `errors[${w.error}]`;
			const a = end.attempts.find(
				(x) =>
					x.result === 'error' &&
					x.error === w.error &&
					(w.productId === undefined || x.productId === w.productId) &&
					(w.idempotencyKey === undefined || x.idempotencyKey === w.idempotencyKey)
			);
			if (!a) return fail(key, `no ${w.error} attempt matching ${show(w)}`);
			return w.retryable !== undefined && a.retryable !== w.retryable
				? fail(key, `retryable ${a.retryable}`)
				: ok(key);
		}),

	plans: (want, end) =>
		(want as Obj[]).map((w) => {
			const key = `plans[${w.key}]`;
			const o = end.plans.find((x) => x.key === w.key);
			if (!o) return fail(key, 'no plan');
			const p: string[] = [];
			if (w.totalCents !== undefined && o.totalCents !== w.totalCents)
				p.push(`totalCents ${o.totalCents}`);
			if (w.minTotalCents !== undefined && o.totalCents < Number(w.minTotalCents))
				p.push(`totalCents ${o.totalCents} < ${w.minTotalCents}`);
			if (w.state !== undefined && o.state !== w.state) p.push(`state ${o.state}`);
			if (w.tier !== undefined && o.tier !== w.tier) p.push(`tier ${o.tier}`);
			if (w.states && !subsequence(w.states as string[], o.states))
				p.push(`states ${show(o.states)}`);
			for (const r of (w.reasons as string[] | undefined) ?? [])
				if (!o.reasons.includes(r)) p.push(`missing ${r}`);
			return p.length ? fail(key, p.join('; ')) : ok(key);
		}),

	attempts: (want, end) =>
		(want as Obj[]).map((w) => {
			const key = `attempts[${w.step}]`;
			const a = end.attempts.find((x) => x.step === w.step);
			if (!a) return fail(key, 'no attempt at that step');
			const p: string[] = [];
			for (const f of ['action', 'result', 'error', 'retryable', 'applied', 'kind'] as const)
				if (w[f] !== undefined && w[f] !== a[f]) p.push(`${f} ${show(a[f])} ≠ ${show(w[f])}`);
			for (const id of (w.chosen as string[] | undefined) ?? [])
				if (!a.chosen?.includes(id)) p.push(`chosen ${show(a.chosen)} lacks ${id}`);
			for (const id of (w.notChosen as string[] | undefined) ?? [])
				if (a.chosen?.includes(id)) p.push(`chosen ${show(a.chosen)} has ${id}`);
			if (w.closingNotBefore !== undefined) {
				const min = new Date(String(w.closingNotBefore)).getTime();
				const early = (a.closingTimes ?? []).filter((t) => new Date(t).getTime() < min);
				if (!a.closingTimes?.length) p.push('no closing times');
				if (early.length)
					p.push(`cut-offs before ${w.closingNotBefore}: ${show(early.slice(0, 3))}`);
			}
			return p.length ? fail(key, p.join('; ')) : ok(key);
		}),

	approval: (want, end) => {
		const w = want as { state?: string; covers?: string[]; excludes?: string[] } | null;
		const a = end.approval ?? null;
		if (w === null)
			return [a === null ? ok('approval', 'none open') : fail('approval', `open: ${show(a)}`)];
		if (!a) return [fail('approval', 'none open')];
		const p: string[] = [];
		if (w.state !== undefined && a.state !== w.state) p.push(`state ${a.state} ≠ ${w.state}`);
		for (const id of w.covers ?? []) if (!a.productIds.includes(id)) p.push(`lacks ${id}`);
		for (const id of w.excludes ?? []) if (a.productIds.includes(id)) p.push(`binds ${id}`);
		return [p.length ? fail('approval', p.join('; ')) : ok('approval')];
	},

	orderLines: (want, end) =>
		(want as Obj[]).map((w) => {
			const key = `orderLines[${w.productId}]`;
			const l = (end.orderLines ?? []).find((x) => x.productId === w.productId);
			if (!l) return fail(key, 'not ordered');
			return w.authority === undefined || l.authority === w.authority
				? ok(key)
				: fail(key, `authority ${l.authority} ≠ ${w.authority}`);
		}),

	previousRunKept: (want, end) => {
		const kept = (end.previousRunOps ?? 0) > 0;
		return [
			kept === want
				? ok('previousRunKept', `${end.previousRunOps ?? 0} ops`)
				: fail('previousRunKept', `${end.previousRunOps ?? 0} ops`)
		];
	},

	receipts: exact('receipts', (e) => e.receipts.length),
	duplicateReceipts: exact('duplicateReceipts', (e) => {
		const keys = e.receipts.map((r) => r.idempotencyKey).filter(Boolean);
		return keys.length - new Set(keys).size;
	}),
	sameReceiptOnRetry: (want, end) => {
		const byKey = new Map<string, Set<string>>();
		for (const a of end.attempts)
			if (a.action === 'commit' && a.result === 'receipt' && a.idempotencyKey && a.receiptId)
				byKey.set(a.idempotencyKey, (byKey.get(a.idempotencyKey) ?? new Set()).add(a.receiptId));
		const retried = [...byKey.values()];
		const same = retried.length > 0 && retried.every((s) => s.size === 1);
		return [
			same === want ? ok('sameReceiptOnRetry') : fail('sameReceiptOnRetry', show([...byKey]))
		];
	},
	weekSpentCents: exact('weekSpentCents', (e) => e.weekSpentCents),

	residualShortfall: (want, end) => {
		const w = want as Obj[];
		if (w.length === 0)
			return [
				end.residualShortfall.length === 0
					? ok('residualShortfall')
					: fail('residualShortfall', show(end.residualShortfall))
			];
		return w.map((x) => {
			const r = end.residualShortfall.find((y) => y.dish === x.dish);
			const key = `residualShortfall[${x.dish}]`;
			if (!r) return fail(key, 'missing');
			const off = ['kg', 'pieces'].filter(
				(f) => x[f] !== undefined && Math.abs(Number(x[f]) - Number(r[f])) > 0.01
			);
			return off.length ? fail(key, `${off.join(',')} ${show(r)}`) : ok(key);
		});
	},
	unconfirmedCover: (want, end) => [
		sameSet(want as string[], end.unconfirmedCover)
			? ok('unconfirmedCover')
			: fail('unconfirmedCover', `${show(end.unconfirmedCover)} ≠ ${show(want)}`)
	],

	ops: (want, end) => {
		const { mustInclude = [], mustNotInclude = [] } = want as {
			mustInclude?: Obj[];
			mustNotInclude?: Obj[];
		};
		const matches = (pat: Obj) =>
			end.ops.some((o) => Object.entries(pat).every(([k, v]) => (o as Obj)[k] === v));
		return [
			...mustInclude.map((p) =>
				matches(p) ? ok(`ops+${show(p)}`) : fail(`ops+${show(p)}`, 'not in op log')
			),
			...mustNotInclude.map((p) =>
				matches(p) ? fail(`ops-${show(p)}`, 'present in op log') : ok(`ops-${show(p)}`)
			)
		];
	},
	valioCalls: (want, end) =>
		((want as { neverInclude: string[] }).neverInclude ?? []).map((id) =>
			end.valioCallIds.includes(id)
				? fail(`valioCalls[${id}]`, 'sent to Valio')
				: ok(`valioCalls[${id}]`)
		),
	why: (want, end) => {
		const { productId, steps } = want as { productId: string; steps: string[] };
		const shown = end.why[productId] ?? [];
		return [
			shown.length >= steps.length
				? ok('why', `${shown.length} steps`)
				: fail('why', `${shown.length} of ${steps.length} steps shown`)
		];
	},
	tools: (want, end) =>
		((want as { externalAgentMustNotHave: string[] }).externalAgentMustNotHave ?? []).map((t) =>
			end.externalAgentTools.includes(t)
				? fail(`tools[${t}]`, 'external agent has it')
				: ok(`tools[${t}]`)
		),
	timing: (want, end) => {
		const max = (want as { recomputeMs: number }).recomputeMs;
		return [
			end.recomputeMs !== undefined && end.recomputeMs <= max
				? ok('timing', `${end.recomputeMs} ms`)
				: fail('timing', `${end.recomputeMs ?? 'unmeasured'} ms > ${max}`)
		];
	},
	labels: (want, end) =>
		(want as { productId: string; mustSay: string }[]).map((w) => {
			const said = end.lines
				.filter((l) => l.productId === w.productId)
				.flatMap((l) => l.labels ?? []);
			return said.some((s) => s.toLowerCase().includes(w.mustSay.toLowerCase()))
				? ok(`labels[${w.productId}]`)
				: fail(`labels[${w.productId}]`, `no "${w.mustSay}" in ${show(said)}`);
		})
};

export const KNOWN_KEYS = Object.keys(CHECKERS);

/**
 * Applies a scenario's `expectFail` (finding id → result keys or key prefixes). A listed result that fails passes
 * as `expected-fail <id>`; a listed prefix whose results all pass fails, so the marker is removed once the fix
 * lands; a prefix that matches no result fails, so a typo can't hide a gap.
 */
export function applyExpectFail(
	results: CheckResult[],
	expectFail: Record<string, string[]> = {}
): CheckResult[] {
	const out = results.map((r) => ({ ...r }));
	const extra: CheckResult[] = [];
	for (const [finding, prefixes] of Object.entries(expectFail))
		for (const prefix of prefixes) {
			const hit = out.filter((r) => r.key === prefix || r.key.startsWith(`${prefix}[`));
			const key = `expectFail.${finding}[${prefix}]`;
			if (hit.length === 0) extra.push(fail(key, 'matches no result key'));
			else if (hit.every((r) => r.pass))
				extra.push(fail(key, `now passes: ${finding} looks fixed, delete this expectFail entry`));
			else
				for (const r of hit)
					if (!r.pass)
						Object.assign(r, { pass: true, detail: `expected-fail ${finding}: ${r.detail}` });
		}
	return [...out, ...extra];
}

export function checkExpect(expect: Record<string, unknown>, end: EndState): CheckResult[] {
	return Object.entries(expect).flatMap(([key, want]) =>
		CHECKERS[key] ? CHECKERS[key](want, end) : [fail(key, 'no checker for this expect key')]
	);
}
