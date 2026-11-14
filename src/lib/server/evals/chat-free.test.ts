/**
 * Free-text chat trials (evals/chat/free/sessions.json): messy chef messages through the chat entry with the model
 * understanding and planning, judged by evals/chat/free-check.ts on what each turn did (ops, events, plans), never on
 * its prose, except that euro figures and decision counts it states must exist in state.
 *
 * Live (opt-in, real Gemini):
 *   CHAT_LIVE=1 LLM_PROVIDER=gemini node --env-file=.env node_modules/vitest/vitest.mjs run --project server src/lib/server/evals/chat-free.test.ts
 *   CHAT_RECORD=1 also writes every model answer to evals/chat/free/replay.json; LIVE_REPEATS (default 1),
 *   LIVE_ONLY=<session prefix>, LIVE_STRICT=1 (fail on any check, not only safety). Report: scratch/chat-free-*.json.
 * Gate (offline): runs only when evals/chat/free/replay.json exists, replaying the recorded answers; a missing
 *   recording fails (re-record) rather than quietly testing the rules. Every check asserts, minus `expectFail`.
 * Safety, asserted in both modes: never an approval or a mandate write, never a commit outside a continue.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Llm } from '$lib/core/ports';
import { SCENARIO, scenarioDate } from '$lib/core/scenario';
import {
	checkFreeTurn,
	type FreeExpect,
	type FreeObserved,
	type LineFact
} from '../../../../evals/chat/free-check';
import { applyExpectFail } from '../../../../evals/check';
import type { CheckResult } from '../../../../evals/types';
import { createLlmRouter } from '../adapters/llm/router';
import { trialWorkspace } from '../agent/trial-harness';
import { runChatTurn } from '../chat/turn';
import { physical, products } from './fidelity';
import { replayBook } from './replay-llm';

interface Session {
	id: string;
	kitchen: string;
	turns: { text: string; expect: FreeExpect }[];
	expectFail?: Record<string, string[]>;
}

const dir = join(process.cwd(), 'evals', 'chat', 'free');
const REPLAY = join(dir, 'replay.json');
const env = process.env as Record<string, string | undefined>;
const live = env.CHAT_LIVE === '1' && (env.LLM_PROVIDER ?? 'fixture') !== 'fixture';
const offline = !live && existsSync(REPLAY);
const REPEATS = live ? Number(env.LIVE_REPEATS ?? 1) : 1;
const SAFETY = /\.(noAuthority|noCommit)$/;
const sessions = (
	JSON.parse(readFileSync(join(dir, 'sessions.json'), 'utf-8')) as { sessions: Session[] }
).sessions.filter((s) => !env.LIVE_ONLY || s.id.startsWith(env.LIVE_ONLY));

const categoryOf = (id: string) => products.get(id)?.category;

type Models = { understand: Llm; explain: Llm; plan: Llm };

/** The chat route's per-job models (D12), each through the one replay book: recorded live, replayed offline. */
function models(): Models {
	const book = replayBook(REPLAY);
	const record = live && env.CHAT_RECORD === '1';
	const router = live ? createLlmRouter(env as never) : null;
	const job = (name: 'chat.understand' | 'explain' | 'agent.plan') =>
		book.wrap(router?.for(name), record);
	return { understand: job('chat.understand'), explain: job('explain'), plan: job('agent.plan') };
}

async function play(s: Session, m: Models): Promise<CheckResult[]> {
	const w = await trialWorkspace();
	const now = new Date(SCENARIO.start);
	w.env.ports.clock = { now: () => now };
	const kitchen = (await w.env.ports.store.kitchens(w.env.workspaceId)).find(
		(k) => k.id === s.kitchen
	)!;
	const chef = w.ctx('chef');
	const deps = {
		handlers: w.handlers,
		ctx: chef,
		ports: w.env.ports,
		workspaceId: w.env.workspaceId,
		kitchen,
		today: scenarioDate(now),
		env,
		// As the chat route wires it: the model reads, words and plans; the planner is the chat's own default.
		llm: m.understand,
		models: m
	};
	const results: CheckResult[] = [];
	let taskId: string | undefined;
	const taskOf = async () =>
		taskId ? ((await w.env.ports.tasks?.get(w.env.workspaceId, taskId)) ?? null) : null;
	const primary = (t: Awaited<ReturnType<typeof taskOf>>) =>
		t?.plans.find((p) => p.role === 'primary')?.planId ?? null;

	for (const [i, turn] of s.turns.entries()) {
		const before = await taskOf();
		const receiptsBefore = Object.keys((await w.state()).receipts).length;
		const opsBefore = w.ops.length;
		const events: FreeObserved['events'] = [];
		try {
			for await (const e of runChatTurn({ text: turn.text, taskId }, deps as never)) {
				const x = e as {
					type: string;
					field?: string;
					text?: string;
					question?: string;
					taskId?: string;
				};
				events.push({ type: x.type, field: x.field, text: x.text ?? x.question });
				if (typeof x.taskId === 'string') taskId = x.taskId;
			}
		} catch (err) {
			results.push({ key: `${i}.turn`, pass: false, detail: (err as Error).message.slice(0, 200) });
			continue;
		}
		const after = await taskOf();
		const st = await w.state();
		const planAfter = primary(after);
		const plan = planAfter ? st.plans[planAfter] : undefined;
		const facts = (id: string): Omit<LineFact, 'state' | 'cents'> => {
			const p = products.get(id);
			return {
				productId: id,
				category: p?.category ?? '?',
				freeFrom: p?.freeFrom ?? [],
				kg: null,
				l: null
			};
		};
		const lines: LineFact[] = (plan?.lines ?? []).map((l) => ({
			...facts(l.productId),
			kg: physical(l.productId, l.qty.value, l.qty.unit, 'kg'),
			l: physical(l.productId, l.qty.value, l.qty.unit, 'l'),
			state: l.state,
			cents: l.lineCents ?? 0
		}));
		const mine = new Set(after?.plans.map((p) => p.planId) ?? []);
		const plans = Object.values(st.plans).filter((p) => mine.has(p.id));
		const orders = Object.values(st.orders).filter((o) => mine.has(o.planId));
		const moneyCents = [
			...plans.map((p) => p.totalCents ?? 0),
			...plans.flatMap((p) => p.lines.map((l) => l.lineCents ?? 0)),
			...orders.map((o) => o.totalCents ?? 0),
			after?.ledger?.committedCents ?? 0,
			plans.reduce((a, p) => a + (p.totalCents ?? 0), 0)
		];
		const o: FreeObserved = {
			text: turn.text,
			events,
			ops: w.ops.slice(opsBefore).map((e) => ({
				type: e.op.type,
				state: e.op.type === 'RecordApproval' ? e.op.approval.state : undefined
			})),
			taskState: after?.state ?? null,
			planBefore: primary(before),
			planAfter,
			deliverBy: plan?.deliverBy ?? null,
			lines,
			moneyCents,
			decisionsLeft: after?.ledger?.decisionsLeft ?? null,
			receiptsBefore,
			receiptsAfter: Object.keys(st.receipts).length
		};
		results.push(...checkFreeTurn(`${i}`, o, turn.expect, categoryOf));
	}
	return results;
}

describe.skipIf(!live && !offline)('free-text chat', () => {
	const report: Record<string, unknown>[] = [];
	for (const s of sessions)
		it(s.id, { timeout: 600_000 }, async () => {
			for (let r = 0; r < REPEATS; r++) {
				const results = applyExpectFail(await play(s, models()), s.expectFail);
				const failed = results.filter((x) => !x.pass);
				report.push({
					session: s.id,
					repeat: r,
					failed: failed.map((x) => `${x.key}: ${x.detail}`)
				});
				console.log(
					`${failed.length ? '✗' : '✓'} ${s.id}#${r} ${results.length - failed.length}/${results.length}` +
						failed.map((x) => `\n    ✗ ${x.key}: ${x.detail}`).join('')
				);
				// Safety always; the rest in the gate (deterministic replay) or under LIVE_STRICT.
				const must =
					live && env.LIVE_STRICT !== '1' ? failed.filter((x) => SAFETY.test(x.key)) : failed;
				expect(must).toEqual([]);
			}
		});
	it.runIf(live)('writes the report', () => {
		mkdirSync('scratch', { recursive: true });
		const f = join('scratch', `chat-free-${Date.now()}.json`);
		writeFileSync(
			f,
			JSON.stringify({ provider: env.LLM_PROVIDER, repeats: REPEATS, report }, null, 1)
		);
		console.log(`report → ${f}`);
		expect(report.length).toBeGreaterThan(0);
	});
});

it.runIf(!live && !offline)('free-text chat waits for a recording', () => {
	console.log(
		`~ free-text chat: ${sessions.length} sessions wait for evals/chat/free/replay.json (CHAT_LIVE=1 CHAT_RECORD=1 pnpm eval:live)`
	);
	expect(sessions.length).toBeGreaterThan(0);
});
