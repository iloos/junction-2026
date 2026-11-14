/**
 * Model choice per LLM job, opt-in only (real Gemini calls, a few cents):
 *   LLM_BENCH=1 node --env-file=.env node_modules/vitest/vitest.mjs run --project server src/lib/server/evals/llm-models.test.ts
 * Options: BENCH_JOBS=parse,menu,plan,explain (default all), BENCH_CELLS=<model:thinking,…>.
 *
 * Each cell (model × thinking level) runs the job on real inputs: request.parse on the fidelity and paraphrase order
 * texts, menu.propose on the two golden briefs, agent.plan on three agent goals, explain on three "why" prompts. Per
 * cell: p50/p95 latency per call, schema-valid rate and the existing checks' pass rate. A JSON report goes to
 * scratch/llm-models-<time>.json. Never part of the gate.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Llm } from '$lib/core/ports';
import { scenarioDate } from '$lib/core/scenario';
import { geminiKey, geminiLlm, type ThinkingLevel } from '../adapters/llm';
import { runGoal } from '../agent';
import { llmPlanner } from '../agent/loop';
import { trialWorkspace } from '../agent/trial-harness';
import { goldenBrief } from '../menu/golden';
import { proposeMenu } from '../menu/proposal';
import { blocks } from '../menu/rubric';
import { memoryMenuStore } from '../menu/store';
import { parseRequest } from '../request/parse';
import { createDbPorts } from '../store/db-ports';
import { cases, checkBasket, FIDELITY_NOW } from './fidelity';

const env = process.env as Record<string, string | undefined>;
const on = env.LLM_BENCH === '1';
const key = geminiKey(env as never);

type Cell = { model: string; thinking: ThinkingLevel };
const CELLS: Cell[] = (
	env.BENCH_CELLS ?? 'gemini-3.5-flash-lite:minimal,gemini-3.8-flash:low,gemini-4-hydrogen:low'
)
	.split(',')
	.map((c) => {
		const [model, thinking] = c.split(':');
		return { model, thinking: thinking as ThinkingLevel };
	});
const JOBS = (env.BENCH_JOBS ?? 'parse,menu,plan,explain').split(',');

interface Run {
	ok: boolean;
	valid: boolean;
	ms: number[];
	tokens: number;
	note?: string;
}

/** An Llm that records each call's latency, tokens and whether its JSON parsed. */
function recorder(cell: Cell, maxTokens: number) {
	const base = geminiLlm(key!, undefined, cell.model, cell.thinking);
	const calls: { ms: number; tokens: number; json: boolean | null }[] = [];
	const llm: Llm = {
		async generate(req) {
			const t0 = performance.now();
			const r = await base.generate({ ...req, maxTokens: Math.max(req.maxTokens, maxTokens) });
			let json: boolean | null = null;
			if (req.json)
				try {
					JSON.parse(r.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
					json = true;
				} catch {
					json = false;
				}
			calls.push({
				ms: Math.round(performance.now() - t0),
				tokens: r.tokens.in + r.tokens.out,
				json
			});
			return r;
		}
	};
	return { llm, calls };
}

const pct = (xs: number[], p: number) => {
	if (!xs.length) return 0;
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

// --- inputs -------------------------------------------------------------------------------------------------

interface Phrased {
	text: string;
	deliverBy?: string;
	physical?: { unit: string; min: number; max: number };
}
const paraphrase = (
	JSON.parse(readFileSync(join(process.cwd(), 'evals', 'paraphrase', 'cases.json'), 'utf-8')) as {
		intents: { kind: string; sameAs?: string; texts?: Record<string, string[]> }[];
	}
).intents;
const PARSE_TEXTS: Phrased[] = [
	...cases.map((c) => ({
		text: c.text,
		deliverBy: c.expect.deliverBy,
		physical: c.expect.physical
	})),
	...paraphrase
		.filter((i) => i.kind === 'order' && i.texts)
		.flatMap((i) => {
			const c = cases.find((x) => x.id === i.sameAs);
			return [i.texts!.fi?.[0], i.texts!.en?.[1]]
				.filter((t): t is string => !!t)
				.map((text) => ({ text, physical: c?.expect.physical }));
		})
].slice(0, 10);

/** Physical amount of a parsed item in the case's unit, when the units line up (kg/g, l/dl/ml). */
function physical(qty: number | null, unit: string | null, want: string): number | null {
	if (qty === null || !unit) return null;
	const u = unit.toLowerCase();
	const f: Record<string, Record<string, number>> = {
		kg: { kg: 1, g: 0.001 },
		l: { l: 1, dl: 0.1, ml: 0.001, cl: 0.01 }
	};
	return f[want]?.[u] !== undefined ? qty * f[want][u] : null;
}

interface Goal {
	id: string;
	goal: string;
	after?: string[];
	expect: { intent: string; status?: string[]; commits?: number };
}
const goalsFile = (
	JSON.parse(readFileSync(join(process.cwd(), 'evals', 'agent', 'goals.json'), 'utf-8')) as {
		goals: Goal[];
	}
).goals;
const goalById = new Map(goalsFile.map((g) => [g.id, g]));
const butter = cases[0];
/** Two goal trials (one with its prerequisite) and one fidelity case judged on its basket, as live-planner does. */
const PLAN_GOALS: (Goal & { fidelity?: (typeof cases)[number] })[] = [
	goalById.get('g2-routine-order')!,
	goalById.get('g3-inspect')!,
	{
		id: `fidelity-${butter.id}`,
		goal: butter.agentText ?? butter.text,
		expect: { intent: 'routine_order' },
		fidelity: butter
	}
];

const Explain = z.object({
	headline: z.string().min(5).max(160),
	reasons: z.array(z.string().min(3)).min(1).max(5),
	trade_off: z.string().min(3)
});
const EXPLAIN_PROMPTS = [
	'Salmon is out for a 140-guest hotel Christmas buffet. Ranked: Finnish rainbow trout (fit 3.4/4, price -8%, carbon -20%, origin FI), Icelandic char (fit 3.1/4, reliability 0.6), frozen Chilean salmon (fit 2.4/4, carbon +60%). Explain why trout is recommended.',
	'A line of 28 kg Christmas ham is held: Valio states no stock quantity (Terminal item), the substitute HK Palvikinkku covers 19.5 kg of 27 kg, and the order needs sign-off over €800 a line. Explain to the chef why it is held and what to decide.',
	'Gemini flagged Lohi-perunalaatikko (salmon potato casserole) as possibly breaking the kitchen rule "label allergens on the buffet" with p 0.51; the catalogue declares no allergens for it. Explain the caution and what the chef should check.'
];
const EXPLAIN_SYSTEM =
	'You explain a purchasing decision to a head chef in plain English. Use only the facts given. Answer JSON: {"headline": string (one sentence), "reasons": string[] (2-4 short), "trade_off": string}.';

// --- jobs ---------------------------------------------------------------------------------------------------

async function benchParse(cell: Cell): Promise<Run[]> {
	const out: Run[] = [];
	for (const p of PARSE_TEXTS) {
		const { llm, calls } = recorder(cell, 600);
		const r = await parseRequest(p.text, { today: '2026-12-07', llm, llmKind: 'gemini' }).catch(
			(e) => ({ error: String(e) }) as never
		);
		const valid = r?.parser?.kind === 'gemini' && !r.parser.fallback;
		const notes: string[] = [];
		if (!valid) notes.push(`fallback: ${r?.parser?.fallback ?? 'error'}`);
		if (r?.items?.length !== 1) notes.push(`${r?.items?.length ?? 0} items`);
		if (p.deliverBy && r?.deliverBy !== p.deliverBy) notes.push(`date ${r?.deliverBy}`);
		if (p.physical) {
			const it = r?.items?.[0];
			const v = physical(it?.qty ?? null, it?.unit ?? null, p.physical.unit);
			if (v === null || v < p.physical.min || v > p.physical.max)
				notes.push(`amount ${it?.qty} ${it?.unit}`);
		}
		out.push({
			ok: valid && notes.length === 0,
			valid,
			ms: calls.map((c) => c.ms),
			tokens: calls.reduce((s, c) => s + c.tokens, 0),
			...(notes.length ? { note: `${p.text}: ${notes.join(', ')}` } : {})
		});
	}
	return out;
}

async function benchMenu(cell: Cell, reps: number): Promise<Run[]> {
	const out: Run[] = [];
	const ports = await createDbPorts();
	for (let n = 0; n < reps; n++)
		for (const name of ['five-star', 'christmas']) {
			const { llm, calls } = recorder(cell, 4000);
			const r = await proposeMenu({
				kitchenId: 'k-hotel',
				workspaceId: 'ws-bench',
				brief: goldenBrief(name),
				store: memoryMenuStore(),
				catalog: ports.ports.catalog,
				now: new Date(),
				llm
			});
			const valid = r.fallback === undefined;
			const blocking = blocks(r.issues);
			out.push({
				ok: valid && blocking.length === 0,
				valid,
				ms: calls.map((c) => c.ms),
				tokens: calls.reduce((s, c) => s + c.tokens, 0),
				...(valid && !blocking.length
					? {}
					: { note: `${name}: ${r.fallback ?? JSON.stringify(blocking).slice(0, 160)}` })
			});
		}
	return out;
}

async function benchPlan(cell: Cell, reps: number): Promise<Run[]> {
	const out: Run[] = [];
	for (let n = 0; n < reps; n++)
		for (const g of PLAN_GOALS) {
			const w = await trialWorkspace();
			// The fidelity case's dates are relative to its own clock.
			if (g.fidelity) w.env.ports.clock = { now: () => FIDELITY_NOW };
			const today = scenarioDate(w.env.ports.clock.now());
			const { llm, calls } = recorder(cell, Number(env.BENCH_PLAN_MAX ?? 600));
			for (const pre of g.after ?? [])
				await runGoal({
					goal: goalById.get(pre)!.goal,
					principal: w.principal({ id: `bench-${pre}-${n}` }),
					handlers: w.handlers,
					planner: llmPlanner(llm),
					source: { ...w.source, today: () => today }
				});
			const before = w.ops.length;
			const run = await runGoal({
				goal: g.goal,
				principal: w.principal({ id: `bench-${g.id}-${n}` }),
				handlers: w.handlers,
				planner: llmPlanner(llm),
				source: { ...w.source, today: () => today }
			});
			const st = await w.state();
			expect(Object.values(st.approvals).filter((a) => a.decidedBy)).toHaveLength(0);
			const commits = w.ops.slice(before).filter((x) => x.op.type === 'CommitOrder').length;
			const fails = [
				...(run.outcome?.intent === g.expect.intent ? [] : [`intent ${run.outcome?.intent}`]),
				...(!('status' in g.expect) ||
				!g.expect.status ||
				g.expect.status.includes(run.outcome?.status ?? '')
					? []
					: [`status ${run.outcome?.status}`]),
				...(!('commits' in g.expect) ||
				g.expect.commits === undefined ||
				commits === g.expect.commits
					? []
					: [`commits ${commits}`]),
				...(g.fidelity
					? checkBasket(g.fidelity, 'agent', {
							plans: Object.values(st.plans),
							error: `stopped ${run.stopped}`
						})
							.filter((r) => !r.pass)
							.map((r) => `${r.key}: ${r.detail}`)
					: [])
			];
			const valid = calls.every((c) => c.json !== false);
			out.push({
				ok: valid && fails.length === 0,
				valid,
				ms: calls.map((c) => c.ms),
				tokens: calls.reduce((s, c) => s + c.tokens, 0),
				...(fails.length || !valid
					? {
							note: `${g.id}: ${[...fails, ...(valid ? [] : ['bad JSON'])].join(', ')} [${run.stopped}]`
						}
					: {})
			});
		}
	return out;
}

async function benchExplain(cell: Cell, reps: number): Promise<Run[]> {
	const out: Run[] = [];
	for (let n = 0; n < reps; n++)
		for (const prompt of EXPLAIN_PROMPTS) {
			const { llm, calls } = recorder(cell, Number(env.BENCH_EXPLAIN_MAX ?? 400));
			const r = await llm
				.generate({
					system: EXPLAIN_SYSTEM,
					prompt,
					maxTokens: Number(env.BENCH_EXPLAIN_MAX ?? 400),
					json: true
				})
				.catch((e) => ({ text: `error: ${String(e?.message ?? e)}` }));
			let parsed: z.infer<typeof Explain> | null;
			try {
				const p = Explain.safeParse(
					JSON.parse(r.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''))
				);
				parsed = p.success ? p.data : null;
			} catch {
				parsed = null;
			}
			// Grounded: the headline names the product the prompt is about.
			const subject = ['trout', 'ham', 'casserole'][EXPLAIN_PROMPTS.indexOf(prompt)];
			const grounded = !!parsed && new RegExp(subject, 'i').test(JSON.stringify(parsed));
			out.push({
				ok: !!parsed && grounded,
				valid: !!parsed,
				ms: calls.map((c) => c.ms),
				tokens: calls.reduce((s, c) => s + c.tokens, 0),
				...(parsed && grounded ? {} : { note: r.text.slice(0, 120) })
			});
		}
	return out;
}

describe.skipIf(!on || !key)('LLM model choice per job (live)', () => {
	const report: Record<string, unknown>[] = [];
	for (const job of JOBS)
		for (const cell of CELLS)
			it(`${job} · ${cell.model}:${cell.thinking}`, { timeout: 1_200_000 }, async () => {
				const runs =
					job === 'parse'
						? await benchParse(cell)
						: job === 'menu'
							? await benchMenu(cell, 5)
							: job === 'plan'
								? await benchPlan(cell, 3)
								: await benchExplain(cell, 3);
				const ms = runs.flatMap((r) => r.ms);
				const row = {
					job,
					model: cell.model,
					thinking: cell.thinking,
					runs: runs.length,
					calls: ms.length,
					p50: pct(ms, 50),
					p95: pct(ms, 95),
					valid: runs.filter((r) => r.valid).length,
					pass: runs.filter((r) => r.ok).length,
					tokensPerRun: Math.round(runs.reduce((s, r) => s + r.tokens, 0) / runs.length),
					notes: runs.flatMap((r) => (r.note ? [r.note] : [])).slice(0, 6)
				};
				report.push(row);
				mkdirSync(join(process.cwd(), 'scratch'), { recursive: true });
				writeFileSync(
					join(process.cwd(), 'scratch', `llm-models-${env.BENCH_TAG ?? 'run'}.json`),
					JSON.stringify(report, null, 1)
				);
				expect(runs.length).toBeGreaterThan(0);
			});
});
