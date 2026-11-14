/**
 * Chat-session trials (evals/chat/trials/*.json): scripted chef turns through the real chat entry, with human acts
 * (approve, edit) on other screens between turns, on a fresh PGlite workspace; the driver answers each clarification
 * from the trial's `answers` by field. After every step the driver observes
 * the task record, get_plan (FulfilmentView, approval), receipts and the ops written; evals/chat/check.ts judges
 * clarification, approval handoff, continuation and a truthful ledger, never the model's prose.
 *
 * The entry is E's in-process turn function: `runChatTurn(input, deps)` from `src/lib/server/chat/turn.ts`, yielding
 * the NDJSON events of POST /api/chat/turn. Until that module exists the suite is skipped with a note.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCENARIO, scenarioDate } from '$lib/core/scenario';
import {
	checkTrial,
	type ChatEvent,
	type ChatStep,
	type Observed,
	type StepExpect,
	type TaskView
} from '../../../../evals/chat/check';
import { applyExpectFail } from '../../../../evals/check';
import { trialWorkspace } from '../agent/trial-harness';

interface Trial {
	id: string;
	kitchen: string;
	/** Scenario clock (default SCENARIO.start, Monday 21:40, after the 17:00 cut-off, as on prod). */
	now?: string;
	steps: ChatStep[];
	/** How the chef answers a clarification, by field. */
	answers?: Record<string, unknown>;
	expect?: Record<string, StepExpect>;
	expectFail?: Record<string, string[]>;
}

type TurnInput = { taskId?: string } & (ChatStep extends infer S
	? S extends { chef: infer C }
		? C
		: never
	: never);
type ChatTurn = (
	input: TurnInput,
	deps: Record<string, unknown>
) => AsyncIterable<ChatEvent> | Promise<ChatEvent[]> | ChatEvent[];

const entry = import.meta.glob<{ runChatTurn?: ChatTurn }>('../chat/turn.ts');
const load = entry['../chat/turn.ts'];

const dir = join(process.cwd(), 'evals', 'chat', 'trials');
const trials = readdirSync(dir)
	.filter((f) => f.endsWith('.json'))
	.sort()
	.map((f) => JSON.parse(readFileSync(join(dir, f), 'utf-8')) as Trial);

async function collect(r: ReturnType<ChatTurn>): Promise<ChatEvent[]> {
	const v = await r;
	if (Array.isArray(v)) return v;
	const out: ChatEvent[] = [];
	for await (const e of v as AsyncIterable<ChatEvent>) out.push(e);
	return out;
}

async function play(t: Trial, turn: ChatTurn): Promise<Observed[]> {
	const w = await trialWorkspace();
	const now = new Date(t.now ?? SCENARIO.start);
	w.env.ports.clock = { now: () => now };
	const today = scenarioDate(now);
	const kitchen = (await w.env.ports.store.kitchens(w.env.workspaceId)).find(
		(k) => k.id === t.kitchen
	)!;
	const chef = w.ctx('chef');
	const deps = {
		handlers: w.handlers,
		ctx: chef,
		ports: w.env.ports,
		workspaceId: w.env.workspaceId,
		kitchen,
		today
	};
	const observed: Observed[] = [];
	let taskId: string | undefined;
	const getTask = async () =>
		taskId ? ((await w.env.ports.tasks?.get(w.env.workspaceId, taskId)) ?? null) : null;

	/** State after one turn or human act. */
	async function observe(
		step: ChatStep,
		stepIndex: number,
		events: ChatEvent[],
		opsBefore: number,
		human?: { ok: boolean; detail: string }
	) {
		const task = await getTask();
		const s = await w.state();
		const plans: Observed['plans'] = [];
		for (const ref of task?.plans ?? []) {
			const v = await w.handlers.get_plan(chef, { planId: ref.planId });
			if (!v.ok) continue;
			plans.push({
				id: ref.planId,
				deliverBy: v.value.plan.deliverBy,
				lines: v.value.plan.lines.map((l) => ({ state: l.state, reasons: l.reasons })),
				approval: v.value.approval
					? { id: v.value.approval.id, state: v.value.approval.state }
					: null,
				needs: (v.value.plan.view?.fulfilment ?? []).map((f) => ({ ...f, needId: f.needId }))
			});
		}
		observed.push({
			step,
			stepIndex,
			human,
			events,
			task: (task as unknown as TaskView) ?? null,
			plans,
			receipts: Object.values(s.receipts).map((r) => {
				const o = s.orders[r.orderId];
				return {
					id: r.id,
					planId: o?.planId ?? '?',
					idempotencyKey: o?.idempotencyKey ?? r.id,
					totalCents: o?.totalCents ?? 0
				};
			}),
			ops: w.ops.slice(opsBefore).map((e) => ({
				type: e.op.type,
				actor: e.actor.kind,
				initiatedBy: e.initiatedBy?.kind,
				state: e.op.type === 'RecordApproval' ? e.op.approval.state : undefined
			}))
		});
	}

	for (const [n, step] of t.steps.entries()) {
		let opsBefore = w.ops.length;
		const primary = (await getTask())?.plans.find((p) => p.role === 'primary')?.planId;
		if ('chef' in step) {
			const events = await collect(turn({ ...step.chef, taskId }, deps));
			taskId ??= events.map((e) => e.taskId).find((x): x is string => typeof x === 'string');
			await observe(step, n, events, opsBefore);
			// The chef answers each clarification from the trial's answers, as a person would, up to 4 rounds.
			for (let round = 0; round < 4; round++) {
				const p = (await getTask())?.pending;
				const value = p?.kind === 'clarify' ? t.answers?.[p.field] : undefined;
				if (p?.kind !== 'clarify' || value === undefined) break;
				opsBefore = w.ops.length;
				const answer = { answer: { field: p.field, value } };
				await observe(
					{ chef: answer },
					n,
					await collect(turn({ ...answer, taskId }, deps)),
					opsBefore
				);
			}
			continue;
		}
		// A human act on another screen; one that fails is reported, never skipped silently.
		let human = { ok: false, detail: 'no primary plan to act on' };
		if (primary && step.human === 'approve') {
			const v = await w.handlers.get_plan(chef, { planId: primary });
			const a = v.ok ? v.value.approval : null;
			const r = a
				? await w.handlers.approve(chef, {
						approvalId: a.id,
						planVersion: a.planVersion,
						termsHash: a.termsHash,
						decision: 'grant'
					})
				: null;
			human = r?.ok
				? { ok: true, detail: 'approved' }
				: { ok: false, detail: r ? r.error.code : 'no approval' };
		} else if (primary && step.human === 'edit') {
			const plan = (await w.state()).plans[primary];
			const line = plan?.lines.find((l) => !step.lineId || l.id === step.lineId);
			const r =
				plan && line
					? await w.handlers.edit_line(chef, {
							planId: plan.id,
							version: plan.version,
							lineId: line.id,
							patch: { qty: step.qty ?? line.qty.value + 1 }
						})
					: null;
			human = r?.ok
				? { ok: true, detail: `qty of ${line!.id}` }
				: { ok: false, detail: r ? r.error.code : 'no line' };
		}
		await observe(step, n, [], opsBefore, human);
	}
	return observed;
}

describe.skipIf(!load)('chat sessions', () => {
	for (const t of trials)
		it(t.id, { timeout: 180_000 }, async () => {
			const mod = await load!();
			expect(mod.runChatTurn, 'src/lib/server/chat/turn.ts exports runChatTurn').toBeTypeOf(
				'function'
			);
			const results = applyExpectFail(
				checkTrial(await play(t, mod.runChatTurn!), t.expect),
				t.expectFail
			);
			const failed = results.filter((r) => !r.pass);
			console.log(
				`${failed.length ? '✗' : '✓'} ${t.id} ${results.length - failed.length}/${results.length}` +
					failed.map((r) => `\n    ✗ ${r.key}: ${r.detail}`).join('')
			);
			expect(failed).toEqual([]);
		});
});

it.runIf(!load)('chat sessions wait for the chat entry', () => {
	console.log(
		`~ chat sessions: ${trials.length} trials wait for src/lib/server/chat/turn.ts (runChatTurn)`
	);
	expect(trials.length).toBeGreaterThan(0);
});
