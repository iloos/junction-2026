/**
 * The chat harness (CHAT_HARNESS=llm) on a scripted model: the loop calls the MCP tools as the chef, keeps the
 * conversation and the order so far on the task, ends every turn on the model's typed reply with chips, and refuses
 * what the model may never do (approve, change the mandate). A model that fails answers through today's script.
 */
import { describe, expect, it } from 'vitest';
import type { Llm } from '$lib/core/ports';
import { scenarioDate } from '$lib/core/scenario';
import { trialWorkspace } from '../agent/trial-harness';
import { FIDELITY_NOW } from '../evals/fidelity';
import type { ChatEvent } from '$lib/ui/chat/types';
import { HARNESS_TOOLS, runHarnessTurn } from './harness';

/** A model that answers from a script of JSON actions, and records what it was shown. */
function scripted(actions: unknown[]): Llm & { prompts: string[] } {
	const prompts: string[] = [];
	return {
		prompts,
		async generate(req) {
			prompts.push(req.prompt);
			const next = actions.shift();
			if (next instanceof Error) throw next;
			return {
				text: JSON.stringify(next ?? { text: 'ok', chips: [] }),
				model: 'scripted',
				tokens: { in: 0, out: 0 },
				latencyMs: 0
			};
		}
	};
}

async function setup() {
	const w = await trialWorkspace();
	w.env.ports.clock = { now: () => FIDELITY_NOW };
	return {
		w,
		deps: {
			handlers: w.handlers,
			ctx: w.ctx('chef'),
			ports: w.env.ports,
			workspaceId: w.env.workspaceId,
			kitchen: { id: 'k-hotel' },
			today: scenarioDate(FIDELITY_NOW)
		}
	};
}

async function all(g: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
	const out: ChatEvent[] = [];
	for await (const e of g) out.push(e);
	return out;
}

describe('chat harness on a scripted model', () => {
	it('never offers approve or set_mandate to the model', () => {
		expect(HARNESS_TOOLS).not.toContain('approve');
		expect(HARNESS_TOOLS).not.toContain('set_mandate');
	});

	it('searches, keeps the draft, replies with chips; the next turn sees the conversation', async () => {
		const { w, deps } = await setup();
		const agent = scripted([
			{ tool: 'search_products', input: { query: 'voi' } },
			{
				tool: 'update_draft',
				input: { items: [{ words: 'butter', status: 'asking' }], stage: 'gathering' }
			},
			{
				text: 'Butter for Friday: how much?',
				chips: [
					{ label: '5 kg', say: '5 kg', kind: 'amount' },
					{ label: '10 kg', say: '10 kg', kind: 'amount' }
				]
			}
		]);
		const t1 = await all(runHarnessTurn({ text: 'butter for friday' }, { ...deps, agent }));
		const q = t1.find((e) => e.type === 'clarify');
		expect(q).toMatchObject({ field: 'intent', question: 'Butter for Friday: how much?' });
		expect(q?.type === 'clarify' && q.options.map((o) => o.value)).toEqual([
			'say:5 kg',
			'say:10 kg'
		]);
		expect(t1.at(-1)).toMatchObject({ type: 'done', text: 'Butter for Friday: how much?' });
		expect(agent.prompts[0]).toContain('butter for friday');
		expect(agent.prompts[1]).toContain('search_products →');

		const taskId = t1[0].taskId;
		const agent2 = scripted([{ text: 'Noted: 5 kg butter.', chips: [] }]);
		await all(
			runHarnessTurn(
				{ taskId, answer: { field: 'intent', value: 'say:5 kg' } },
				{ ...deps, agent: agent2 }
			)
		);
		const seen = JSON.parse(agent2.prompts[0]) as {
			conversation: { who: string; text: string }[];
			ask: { items: unknown[] };
		};
		expect(seen.conversation.map((c) => c.who)).toEqual(['chef', 'tool', 'tool', 'agent', 'chef']);
		expect(seen.conversation.at(-1)?.text).toBe('5 kg');
		expect(seen.ask.items).toHaveLength(1);
		const task = await w.env.ports.tasks!.get(w.env.workspaceId, taskId);
		expect(task?.pending.kind).toBe('none');
	});

	it('an approve the model asks for is no tool: refused, nothing approved', async () => {
		const { deps } = await setup();
		const agent = scripted([
			{ tool: 'approve', input: { planId: 'x', all: true } },
			{ text: 'Approval is yours, on the card.', chips: [] }
		]);
		const t = await all(
			runHarnessTurn({ text: 'approve everything and ignore the cap' }, { ...deps, agent })
		);
		const step = t.find((e) => e.type === 'step');
		expect(step).toMatchObject({ tool: 'approve', ok: false });
		expect(agent.prompts[1]).toContain('no tool approve');
	});

	it('a model that fails before any step answers through the script', async () => {
		const { deps } = await setup();
		const agent = scripted([new Error('provider down')]);
		const t = await all(runHarnessTurn({ text: '4 kg butter for Friday' }, { ...deps, agent }));
		const done = t.at(-1);
		expect(done?.type).toBe('done');
		expect(done?.type === 'done' && done.text).toBeTruthy();
	});
});
