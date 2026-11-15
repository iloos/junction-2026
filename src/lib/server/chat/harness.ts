/**
 * The chat as an agent (CHAT_HARNESS=llm): one model loop per turn over the same tools, schemas, gate and server
 * instructions an outside MCP client gets, in process, as the chef. The model reads the chef's words with the whole
 * conversation, calls tools (at most 8 per turn), and answers with a typed reply `{text, chips}`. Code adds a steer
 * (what is held and why, what the plan still needs, the kitchen's delivery days) and the cards the dock already shows
 * (menu, decision, ledger) from the task, so the page and the dock read the same state.
 *
 * The model never approves and never accepts a menu: those are the chef's taps on code-made chips ("Plan this menu",
 * the decision card), and the mandate gate holds what it holds whatever the model asks. On any model failure the turn
 * is today's script (`runChatTurn`), unchanged.
 */
import { z } from 'zod';
import { toolSchemas, type Plan, type ToolName } from '$lib/core/contracts';
import type { Task } from '$lib/core/contracts/task';
import type { Llm, ToolHandlers } from '$lib/core/ports';
import type { ServicePorts } from '$lib/core/services/events';
import type { StepRecord } from '$lib/server/agent/loop';
import { createGetContext } from '$lib/server/agent/get-context';
import { mcpInstructions } from '$lib/server/tools/mcp';
import { serveTool, toolsFor } from '$lib/server/tools/serve';
import { readTask } from '$lib/server/tasks/outcome';
import type { ChatEvent, ChatTurnInput } from '$lib/ui/chat/types';
import { blankTask, runChatTurn, stepEvents, storeOf, taskView, type ChatDeps } from './turn';

/** The tools the chat agent may call: the outside agent's set minus approval and mandate changes. */
export const HARNESS_TOOLS: readonly ToolName[] = [
	'search_products',
	'quote',
	'place_order',
	'plan_event',
	'propose_menu',
	'revise_menu',
	'find_substitutes',
	'edit_line',
	'get_plan',
	'explain_line',
	'check_recall',
	'lookup_facts',
	'find_outside',
	'commit_order'
];

const MAX_STEPS = 8;
const HISTORY = 24;

export const harnessOn = (env: Record<string, string | undefined> | undefined) =>
	env?.CHAT_HARNESS === 'llm';

const Chip = z.object({
	label: z.string().min(1).max(80),
	say: z.string().min(1).max(200),
	kind: z.enum(['product', 'amount', 'day', 'action', 'other']).optional(),
	productId: z.string().max(64).optional()
});
const Action = z.union([
	z.object({ tool: z.string(), input: z.record(z.string(), z.unknown()) }),
	z.object({ text: z.string().min(1).max(700), chips: z.array(Chip).max(6).default([]) })
]);

/**
 * The ask: what the chef intends, gathered before (and while) it becomes line items. One dish needs many products and
 * a quality wish may match none, so the ask is kept apart from the plan's lines. It changes nothing in the kitchen.
 */
const Part = z.object({
	words: z.string().max(120),
	amount: z.number().optional(),
	unit: z.string().max(20).optional(),
	/** Origin, brand, organic, price level: wishes, which may match no product. */
	quality: z.string().max(80).optional(),
	productId: z.string().max(64).optional(),
	status: z.enum(['open', 'asking', 'fixed', 'checked', 'planned', 'held', 'ordered']).optional()
});
const Draft = z.object({
	occasion: z.string().max(120).optional(),
	date: z.string().max(20).optional(),
	guests: z.number().int().nonnegative().optional(),
	/** "20 vegan / 40 veg / 60 rest": each group's count and diet; the counts add up to the guests. */
	splits: z
		.array(z.object({ guests: z.number().int().nonnegative(), diet: z.string().max(40) }))
		.max(8)
		.optional(),
	dishes: z
		.array(
			z.object({
				name: z.string().max(80),
				course: z.string().max(30).optional(),
				guests: z.number().int().nonnegative().optional(),
				diet: z.string().max(60).optional(),
				ingredients: z.array(Part).max(20).optional()
			})
		)
		.max(12)
		.optional(),
	/** Products asked for directly, outside any dish. */
	items: z.array(Part).max(30).optional(),
	restrictions: z.array(z.string().max(60)).max(12).optional(),
	/** What the chef has settled and what is still open, in short words. */
	fixed: z.array(z.string().max(80)).max(12).optional(),
	open: z.array(z.string().max(80)).max(12).optional(),
	stage: z.enum(['gathering', 'converting', 'placed']).optional()
});
type Draft = z.infer<typeof Draft>;
const UPDATE_DRAFT = {
	name: 'update_draft',
	description:
		'Replace the ask (your working memory, shown to the chef): occasion, date, guests and splits, dishes with their guests, diet and ingredients, direct items with amount and unit, qualities, restrictions, what is fixed and what is open, and the stage. Changes nothing in the kitchen; call it whenever the ask changes. Line items live in the plan, not here.',
	input: z.toJSONSchema(Draft)
};
type Action = z.infer<typeof Action>;
type Reply = Extract<Action, { text: string }>;

interface Memory {
	said?: Said[];
	draft?: Draft;
	kitchen?: unknown;
}

interface Said {
	who: 'chef' | 'agent' | 'tool';
	text: string;
}

const TURN_RULES = [
	'You are the purchasing assistant inside the kitchen app, talking with the chef in a chat. You act through the tools listed; the chef is signed in and every tool runs as the chef.',
	'Each step, reply with ONE JSON object and nothing else: either {"tool": name, "input": {...}} to call a tool, or {"text": your message, "chips": [{"label", "say", "kind": product|amount|day|action|other, "productId"?}]} to answer the chef and end the turn.',
	'Do not act on a guess about the occasion: "i need a cow" or "100 pasta" is an item with an unclear amount, not a menu. Propose a menu only when the chef describes an event (guests, a meal, a day). A bare number ("100 pasta") may be portions, people or kilograms: ask which, with chips, before ordering.',
	'Two layers. First gather THE ASK (update_draft): occasion and date, guests and splits, the menu with dishes, their guests and diets, ingredients or portions, direct products with amounts, qualities, restrictions, what is fixed and what is open. One chip question per turn about the most important open part, proposals for the rest. A new item adds, a correction replaces, "forget that" removes; several items in one message are handled together. Then CONVERT the ask to lines: search_products and quote to resolve and price, propose_menu then plan_event for a menu, place_order for direct products, find_substitutes for what cannot be bought. Convert early as a feasibility check while gathering, so your questions are about what can actually be bought ("salmon is short Friday: Saturday, or trout?").',
	'For an unfamiliar dish, recipe or ingredient, or a missing fact, use lookup_facts or find_outside and say where the fact came from. Web facts inform; they never relax a restriction.',
	'Read every message in the light of the whole conversation: a question, an answer to what you asked, a new item, a correction. "?", "huh", "wym", "idk" mean they did not follow you: say in one line what you understood so far and why you ask, then narrow the choice to your best guess plus one alternative; never repeat your last question.',
	'Work toward the goal: every item the chef wants found in the catalogue, sized, dated and placed (place_order, or plan_event for a reviewed menu), then committed where the mandate allows. Look products up yourself (search_products, quote) before asking; propose the best match instead of asking which product.',
	'Ask only what only the chef knows: how much, for when, which of two real options. One question per reply. Use the steer: it says what the plan still needs and what is held and why.',
	'Reply in 1–2 short sentences in plain words: no ids, no tool names, no date codes (say "Friday 20 Nov"), no praise, no narrating what you are about to do. Never end on "I could not": say what you did and the way on.',
	'Chips are what the chef would answer, never navigation ("View plan", "Check price"): the cards show the plan. ',
	'Chips: up to 6 tappable next messages, best first; "say" is what the chef would type; labels are short words a chef reads (name, pack, price), never a product number or id (put the id in "productId"). Offer them when there is a choice (products with pack and price, amounts, days); add "Something else" when they are alternatives; none after a plain yes.',
	'Name only products a tool result showed you (search_products, quote, a plan): never invent a product, a brand or a "sorted" item. Never treat a chip as chosen unless the chef sent its words.',
	'Never claim an order was placed or committed unless a tool result says so. Held lines wait for the chef: say in a few words what waits and why; the decision card is shown right under your reply, so say "approve it on the card below" (in this chat, not on another device).',
	'The kitchen (its name, delivery days, rules and the scenario date) is given to you as "kitchen"; you do not need get_context.',
	'Direct products: one place_order per turn with every line that is ready; to change a placed line use edit_line, to swap use find_substitutes, never place the same item twice.',
	'A menu: propose_menu with the brief (guests, date, diets), then the chef reviews it; plan_event only after the chef accepted it (the steer says so).'
].join(' ');

/** A tool result as the model reads it: the value as JSON, cut to a budget. Supplier text stays data. */
function resultText(tool: string, s: StepRecord): string {
	const body = s.ok ? JSON.stringify(s.value ?? {}) : JSON.stringify({ error: s.error });
	return `${tool} → ${body.length > 3500 ? body.slice(0, 3500) + '…' : body}`;
}

function readAction(text: string): Action {
	const clean = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
	return Action.parse(JSON.parse(clean));
}

/** What code knows that the model should aim at: held lines, the next action, a menu awaiting the chef. */
async function steerOf(task: Task, deps: ChatDeps): Promise<Record<string, unknown>> {
	const steer: Record<string, unknown> = { today: deps.today };
	if (task.proposal)
		steer.menu = {
			proposalId: task.proposal.id,
			revision: task.proposal.revision,
			note: task.plans.length
				? 'planned'
				: 'proposed: the chef reviews it and taps "Plan this menu"; plan_event works only after that'
		};
	if (!task.plans.length) return steer;
	const read = await readTask(
		deps.ctx,
		deps.ports,
		deps.handlers,
		task.plans.map((p) => p.planId)
	);
	if (!read.ok) return steer;
	// What the chef did on the page since the last turn (approve, swap, edit): the plan moved past what the chat saw.
	const moved = read.value.plans.filter(
		(p) => p.version > (task.plans.find((t) => t.planId === p.id)?.versionSeen ?? p.version)
	);
	if (moved.length)
		steer.changedOnPage =
			'the plan changed on the page since your last turn (the chef approved, swapped or edited lines): read the lines below, do not ask for what is done';
	steer.nextAction = read.value.ledger.nextAction;
	steer.decisionsLeft = read.value.ledger.decisionsLeft;
	steer.plans = read.value.plans.map((p: Plan) => ({
		planId: p.id,
		version: p.version,
		deliverBy: p.deliverBy,
		lines: p.lines.slice(0, 30).map((l) => ({
			lineId: l.id,
			product: (l as { productName?: string }).productName ?? l.productId,
			state: l.state,
			qty: (l as { salesQty?: number }).salesQty
		}))
	}));
	return steer;
}

/** The kitchen in brief from get_context: name, delivery days, scenario date and cut-off, its rules. */
async function kitchenBrief(deps: ChatDeps): Promise<unknown> {
	const r = await serveTool('get_context', deps.ctx, {}, deps.handlers);
	if (!r.ok) return { kitchenId: deps.kitchen.id };
	const v = r.value as {
		scenario?: unknown;
		kitchens?: { id: string; name: string; deliveryDays?: string[]; [k: string]: unknown }[];
	};
	const k = v.kitchens?.find((x) => x.id === deps.kitchen.id);
	const full = { scenario: v.scenario, kitchen: k ?? { id: deps.kitchen.id } };
	return JSON.stringify(full).length > 2500
		? { scenario: v.scenario, kitchen: { id: k?.id, name: k?.name, deliveryDays: k?.deliveryDays } }
		: full;
}

/** Records what a tool's output means for the task: the plan it made or touched, the menu it proposed. */
function remember(task: Task, s: StepRecord): Task {
	if (!s.ok) return task;
	const seen = (s.value ?? {}) as { plan?: Plan };
	if (seen.plan?.id && task.plans.some((p) => p.planId === seen.plan!.id))
		task = {
			...task,
			plans: task.plans.map((p) =>
				p.planId === seen.plan!.id ? { ...p, versionSeen: seen.plan!.version } : p
			)
		};
	const v = (s.value ?? {}) as { plan?: Plan; proposal?: { id: string; revision: number } };
	let t = task;
	if (v.plan?.id && !t.plans.some((p) => p.planId === v.plan!.id))
		t = {
			...t,
			plans: [
				...t.plans,
				{
					planId: v.plan.id,
					versionSeen: v.plan.version,
					role: t.plans.length ? 'touched' : 'primary'
				}
			]
		};
	if (v.proposal?.id) t = { ...t, proposal: { id: v.proposal.id, revision: v.proposal.revision } };
	return t;
}

/** The turn's reply when the loop ended without one: the model is asked for words only, no more tools. */
async function finalReply(agent: Llm, system: string, history: Said[]): Promise<Reply | null> {
	const res = await agent.generate({
		system,
		prompt:
			JSON.stringify({ conversation: history.slice(-HISTORY) }) +
			'\n\nNo tool calls are left this turn. Reply to the chef now with {"text", "chips"}: what was done, what waits and the one next question.',
		maxTokens: 600,
		json: true
	});
	const a = readAction(res.text);
	return 'text' in a ? a : null;
}

/** A chip that only points at what the cards already show ("View plan", "Review menu"): not a chef's answer. */
const NAVIGATION =
	/^(view|open|see|get|show|check|review)\b.*\b(plan|card|menu|order|link|price)s?$/i;

/** A chip as the dock shows it: the label in words (a product number is never shown), the words it sends. */
const chipOption = (c: z.infer<typeof Chip>) => ({
	label: c.label.replace(/\s*\(?\b\d{5,}\b\)?/g, '').trim() || c.say.slice(0, 80),
	value: `say:${c.say}`
});

/** The turn's chef words, from text or a `say:` chip; null for the inputs only the script handles. */
function chefWords(input: ChatTurnInput): string | null {
	if (input.text !== undefined) return input.text.trim() || null;
	const v = input.answer ? String(input.answer.value) : '';
	if (v.startsWith('say:')) return v.slice(4).trim() || null;
	return null;
}

/**
 * One chat turn through the model. Inputs the script owns (continue, approve, wait, typed slot answers on a scripted
 * task) and any model failure go to `runChatTurn`.
 */
export async function* runHarnessTurn(
	input: ChatTurnInput,
	deps: ChatDeps & { agent: Llm }
): AsyncGenerator<ChatEvent, void, undefined> {
	const store = storeOf(deps.ports);
	const got = input.taskId ? await store.get(deps.workspaceId, input.taskId) : null;
	const prior = got && got.runId === deps.ctx.runId ? got : null;
	const accept = input.answer ? String(input.answer.value).match(/^accept:(.+):(\d+)$/) : null;
	const words = accept ? 'I accept this menu: plan it.' : chefWords(input);
	if (!words || (prior && !(prior.requirement as { harness?: unknown }).harness && prior.version)) {
		yield* runChatTurn(input, deps);
		return;
	}
	let task: Task = prior ?? blankTask(deps, words);
	let expected = prior ? prior.version : null;
	const kept = (task.requirement as { harness?: Memory }).harness;
	const history: Said[] = [...(kept?.said ?? []), { who: 'chef', text: words.slice(0, 600) }];
	let draft: Draft = kept?.draft ?? { stage: 'gathering' };

	// The chef's tap on "Plan this menu" is their review of that revision (D13): code accepts it, never the model.
	if (accept && deps.acceptMenu) {
		const a = await deps.acceptMenu(accept[1], Number(accept[2]));
		history.push({
			who: 'tool',
			text: a.ok
				? `the chef accepted menu ${accept[1]} revision ${accept[2]}: plan_event can use it now`
				: `the menu could not be accepted: ${a.error?.message ?? 'refused'}`
		});
	}

	// get_context lives with the agent doors (tools/handlers.ts); a handler set without it reads the same ports.
	const own = createGetContext(deps.ports as unknown as ServicePorts);
	const base = deps.handlers;
	const handlers: ToolHandlers = {
		...base,
		get_context: async (ctx, i) => {
			try {
				const r = await base.get_context(ctx, i);
				if (r.ok) return r;
			} catch {
				// the handler set has no get_context of its own
			}
			return own(ctx, i as never);
		}
	} as ToolHandlers;
	deps = { ...deps, handlers };
	const tools = toolsFor(deps.ctx).filter((t) => HARNESS_TOOLS.includes(t));
	const catalog = tools.map((t) => ({
		name: t,
		description: toolSchemas[t].description,
		input: z.toJSONSchema(toolSchemas[t].input, { io: 'input' })
	}));
	const system = `${mcpInstructions(tools)}\n\n${TURN_RULES}`;
	const steps: StepRecord[] = [];
	const calls = new Set<string>();
	let memoryKitchen: unknown = kept?.kitchen;
	let reply: Reply | null = null;
	try {
		const steer = await steerOf(task, deps);
		const kitchen = kept?.kitchen ?? (await kitchenBrief(deps));
		memoryKitchen = kitchen;
		for (let n = 1; n <= MAX_STEPS * 2 && !reply; n++) {
			const prompt = JSON.stringify({
				kitchen,
				ask: draft,
				steer,
				conversation: history.slice(-HISTORY),
				tools: [...catalog, UPDATE_DRAFT],
				stepsLeft: MAX_STEPS - steps.length
			});
			let action: Action | null = null;
			let correction = '';
			for (let attempt = 0; attempt < 2 && !action; attempt++) {
				const res = await deps.agent.generate({
					system,
					prompt: prompt + correction,
					maxTokens: 900,
					json: true
				});
				try {
					action = readAction(res.text);
				} catch (e) {
					correction = `\n\nYour previous reply was rejected (${(e as Error).message.slice(0, 200)}). Reply with one JSON object: a tool call or a reply.`;
				}
			}
			if (!action) throw new Error('the model gave no valid action');
			if ('text' in action) {
				reply = action;
				break;
			}
			if (steps.length >= MAX_STEPS) {
				history.push({ who: 'tool', text: 'no tool calls left this turn: reply to the chef now' });
				continue;
			}
			if (action.tool === 'update_draft') {
				const d = Draft.safeParse(action.input);
				if (d.success) draft = d.data;
				history.push({
					who: 'tool',
					text: d.success
						? `update_draft → the ask is kept`
						: `update_draft → rejected: ${d.error.issues[0]?.message ?? 'invalid'}`
				});
				continue;
			}
			const tool = action.tool as ToolName;
			// One menu proposal per turn (the chef reviews it next) and no call repeated with the same input.
			const call = `${tool} ${JSON.stringify(action.input)}`;
			const again =
				calls.has(call) ||
				(tool === 'propose_menu' && steps.some((x) => x.tool === 'propose_menu' && x.ok));
			calls.add(call);
			if (again) {
				history.push({
					who: 'tool',
					text:
						tool === 'propose_menu'
							? 'propose_menu → already proposed this turn: the chef reviews that menu now; reply to the chef'
							: `${tool} → the same call was already made this turn: use its result above, or reply to the chef`
				});
				continue;
			}
			const t0 = performance.now();
			const served = tools.includes(tool)
				? await serveTool(tool, deps.ctx, action.input, deps.handlers)
				: null;
			const s: StepRecord = {
				n: steps.length + 1,
				tool,
				input: action.input,
				why: '',
				ok: !!served?.ok,
				...(served?.ok ? { value: served.value } : {}),
				...(served && !served.ok
					? { error: served.error }
					: !served
						? { error: { code: 'NOT_FOUND', message: `no tool ${tool}`, retryable: false } }
						: {}),
				ms: Math.round(performance.now() - t0)
			} as StepRecord;
			steps.push(s);
			task = remember(task, s);
			history.push({ who: 'tool', text: resultText(tool, s) });
			// Read-only lookups stay out of the dock's step list; anything that changed or failed is shown.
			if (
				!['get_context', 'search_products', 'quote', 'get_plan', 'explain_line'].includes(tool) ||
				!s.ok
			)
				yield* stepEvents(task.id, [s]);
		}
		if (!reply) throw new Error('the turn ended without a reply');
	} catch (e) {
		const why = String((e as Error)?.message ?? e).slice(0, 300);
		console.error('[chat.harness] model turn failed', why);
		if (process.env.HARNESS_DEBUG === '1')
			(await import('node:fs')).appendFileSync(
				'scratch/harness-errors.txt',
				`${words} :: ${why}\n`
			);
		if (!steps.length) {
			yield* runChatTurn(input, deps);
			return;
		}
		// Work was done: one last call for the reply alone, so the chef reads what happened in the model's words.
		reply = await finalReply(deps.agent, system, history).catch(() => null);
	}
	if (!reply)
		reply = {
			text: 'I did the steps above; tell me what to do next, or ask what is open.',
			chips: [{ label: 'What is open?', say: 'What still needs my decision?' }]
		};

	// The conversation is kept on the task (presentation memory; the plan and the ledger stay the facts). Tool results
	// of past turns fold to their first line, ids kept, so the window stays small.
	const said = [...history, { who: 'agent' as const, text: reply.text }]
		.map((h) =>
			h.who === 'tool' && h.text.length > 240 ? { ...h, text: h.text.slice(0, 240) + '…' } : h
		)
		.slice(-HISTORY);
	const memory: Memory = { said, draft, kitchen: memoryKitchen };
	// Cards first: taskView shows the menu, decision and ledger only while no question is pending.
	const first = await store.put(
		{ ...task, requirement: { ...task.requirement, harness: memory }, pending: { kind: 'none' } },
		expected
	);
	if (first.ok) {
		task = first.value;
		expected = task.version;
	}
	const cards = (await taskView(task.id, { ...deps })).filter(
		(e) => e.type === 'menu' || e.type === 'decision' || e.type === 'ledger'
	);
	task = {
		...task,
		pending: reply.chips.length
			? {
					kind: 'clarify',
					field: 'intent',
					question: reply.text.slice(0, 300),
					options: reply.chips.filter((c) => !NAVIGATION.test(c.label.trim())).map(chipOption)
				}
			: { kind: 'none' },
		state: reply.chips.length ? 'awaiting_clarification' : 'open',
		updatedAt: deps.ports.clock.now().toISOString()
	};
	const saved = await store.put(task, expected);
	if (saved.ok) task = saved.value;

	for (const c of cards) yield c;
	const menu = cards.find((c) => c.type === 'menu');
	const chips = reply.chips.filter((c) => !NAVIGATION.test(c.label.trim())).map(chipOption);
	if (menu?.type === 'menu' && !menu.reviewed && !task.plans.length)
		chips.unshift({ label: 'Plan this menu', value: `accept:${menu.proposalId}:${menu.revision}` });
	if (chips.length)
		yield {
			type: 'clarify',
			taskId: task.id,
			field: 'intent',
			question: reply.text,
			options: chips.slice(0, 6)
		};
	yield {
		type: 'done',
		taskId: task.id,
		title: task.title,
		state: chips.length ? 'awaiting_clarification' : task.state,
		text: reply.text,
		canContinue: false
	};
}
