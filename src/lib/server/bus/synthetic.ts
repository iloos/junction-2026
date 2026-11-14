/**
 * The scripted, simulated run across the three demo kitchens that /ops shows in its "Simulated run" view
 * (ws-synth). Every op is a valid OpEnvelope that `applyOps` accepts; product ids and names
 * are real Valio catalogue rows from fixtures/seeds, quantities and prices are invented.
 * Everything here carries provenance `simulator` and is labelled simulated in the UI.
 */
import type {
	Actor,
	Line,
	Op,
	OpEnvelope,
	Plan,
	ServerEvent,
	SimEvent,
	Tier
} from '$lib/core/contracts';

import { SYNTH_WORKSPACE } from '$lib/server/demo/workspaces';
export { SYNTH_WORKSPACE };

export const SYNTH_PRODUCTS: Record<string, string> = {
	'462490': 'HK Viljaporsaan Juhlakinkku potkalla 6-8 kg',
	'462150': 'Lohifilee C-leikattu 10 kg',
	'462016': 'Kirjolohifilee C-leikattu 10 kg',
	'462447': 'Saarioinen Lanttulaatikko 2,8 kg',
	'463876': 'Aimo Sinappisilli MSC 2,5/1,25 kg',
	'464201': 'Valio kevytmaito laktoositon 1 l',
	'464249': 'Valio ruokakerma 15 % laktoositon 1 l',
	'475214': 'SPL annosperuna veitsikuorittu 10 kg',
	'467464': 'Kieku vapaan kanan muna S90 4320 g',
	'463860': 'Atria Rosolli 2,5 kg',
	'461210': 'Saarioinen Porkkanalaatikko 6 × 400 g',
	'473482': 'Vaasan Tähtitorttu 40 × 60 g'
};

const sim = { source: 'simulator' as const, note: 'synthetic ops stream' };
const A = {
	hotelAgent: { kind: 'kitchen_agent', id: 'agent:k-hotel' },
	lounasAgent: { kind: 'kitchen_agent', id: 'agent:k-lounas' },
	lounasChef: { kind: 'chef', id: 'chef:k-lounas' },
	external: { kind: 'external_agent', id: 'ext:judge-claude' },
	approver: { kind: 'approver', id: 'approver:k-central' },
	system: { kind: 'system', id: 'simulator' }
} satisfies Record<string, Actor>;

type LineSpec = {
	id: string;
	productId: string;
	qty: number;
	unit: string;
	rounding?: string;
	cents: number;
	state?: Line['state'];
	tier?: Tier;
	reasons?: Line['reasons'];
	substituteFor?: string;
};

const line = (s: LineSpec, quoted: boolean): Line => ({
	id: s.id,
	productId: s.productId,
	qty: { value: s.qty, unit: s.unit, ...(s.rounding ? { rounding: s.rounding } : {}) },
	state: quoted ? (s.state ?? 'eligible') : 'proposed',
	...(quoted ? { tier: s.tier ?? 'act' } : {}),
	reasons: quoted ? (s.reasons ?? []) : [],
	offer: null,
	lineCents: quoted ? s.cents : null,
	...(s.substituteFor ? { substituteFor: s.substituteFor } : {}),
	provenance: sim
});

const HOTEL: LineSpec[] = [
	{
		id: 'h-ham',
		productId: '462490',
		qty: 21,
		unit: 'KG',
		rounding: '19.6 kg → 3 × 7 kg lot',
		cents: 23_100
	},
	{
		id: 'h-salmon',
		productId: '462150',
		qty: 20,
		unit: 'KG',
		rounding: '11.5 kg → 2 × 10 kg lot',
		cents: 39_800,
		state: 'unorderable',
		tier: 'propose',
		reasons: ['BELOW_LOT', 'INSUFFICIENT_STOCK']
	},
	{
		id: 'h-casserole',
		productId: '462447',
		qty: 6,
		unit: 'ST',
		cents: 8_340,
		state: 'held',
		tier: 'sign_off',
		reasons: ['new_sku', 'unknown']
	},
	{ id: 'h-herring', productId: '463876', qty: 4, unit: 'ST', cents: 6_120 },
	{ id: 'h-milk', productId: '464201', qty: 60, unit: 'ST', cents: 7_080 }
];
const LOUNAS: LineSpec[] = [
	{ id: 'l-milk', productId: '464201', qty: 120, unit: 'ST', cents: 14_160 },
	{
		id: 'l-cream',
		productId: '464249',
		qty: 48,
		unit: 'ST',
		cents: 12_960,
		state: 'held',
		tier: 'propose',
		reasons: ['CAP_EXCEEDED.line']
	},
	{ id: 'l-potato', productId: '475214', qty: 8, unit: 'ST', cents: 9_200 },
	{ id: 'l-eggs', productId: '467464', qty: 3, unit: 'KI', cents: 11_400 }
];
const CENTRAL: LineSpec[] = [
	{ id: 'c-rosolli', productId: '463860', qty: 12, unit: 'ST', cents: 11_880 },
	{ id: 'c-carrot', productId: '461210', qty: 10, unit: 'KI', cents: 15_900 },
	{ id: 'c-tart', productId: '473482', qty: 6, unit: 'KI', cents: 10_440 }
].map((l) => ({
	...l,
	state: 'held' as const,
	tier: 'sign_off' as const,
	reasons: ['external_agent_needs_approval' as const]
}));
const TROUT: LineSpec = {
	id: 'h-trout',
	productId: '462016',
	qty: 10,
	unit: 'KG',
	rounding: '9 kg → 1 × 10 kg lot',
	cents: 17_900,
	state: 'held',
	tier: 'propose',
	reasons: ['substitute_breaks_preference'],
	substituteFor: '462150'
};

const total = (ls: LineSpec[]) => ls.reduce((s, l) => s + l.cents, 0);

/** One step of the script: an op (with actor and via) or a simulator event. */
type Step = { op: Op; actor: Actor; via: string; key?: string } | { sim: Omit<SimEvent, 'simAt'> };

/**
 * Build the scripted run. `simStart` is the simulator clock at the first step; each step advances it
 * by 7 simulated minutes. `wall(i)` gives the wall-clock time stamped on step i.
 */
export function syntheticRun(opts: {
	runId: string;
	startSeq: number;
	simStart?: Date;
	wall?: (i: number) => Date;
}): ServerEvent[] {
	const { runId, startSeq } = opts;
	const scope = { workspaceId: SYNTH_WORKSPACE, runId };
	const simStart = opts.simStart ?? new Date('2026-12-10T07:30:00+02:00');
	const wall = opts.wall ?? ((i: number) => new Date(simStart.getTime() + i * 2000));
	const deliverBy = '2026-12-12';
	const plan = (id: string, kitchenId: string, specs: LineSpec[], by: Actor): Plan => ({
		...scope,
		id,
		kitchenId,
		version: 0,
		state: 'draft',
		deliverBy,
		needs: [],
		lines: specs.map((s) => line(s, false)),
		totalCents: null,
		termsHash: null,
		createdBy: by
	});
	const terms = (p: string, v: number) => `synthetic:${p}:v${v}`;
	const approval = (
		id: string,
		planId: string,
		planVersion: number,
		lineIds: string[],
		tier: Tier,
		state: 'pending' | 'granted',
		requestedBy: Actor,
		decidedBy?: Actor
	) => ({
		...scope,
		id,
		planId,
		planVersion,
		termsHash: terms(planId, planVersion),
		mandateVersion: 1,
		lineIds,
		tier,
		state,
		requestedBy,
		...(decidedBy ? { decidedBy } : {}),
		expiresAt: new Date(simStart.getTime() + 6 * 3600_000).toISOString()
	});
	const order = (
		id: string,
		planId: string,
		planVersion: number,
		kitchenId: string,
		specs: LineSpec[],
		by: Actor,
		at: Date,
		authority: 'mandate' | { approvalId: string },
		/** Lines the approval lists; the others stood on the mandate. Default: all of them. */
		approved: string[] = specs.map((s) => s.id)
	) => ({
		...scope,
		id,
		planId,
		planVersion,
		kitchenId,
		lines: specs.map((s) => ({
			lineId: s.id,
			productId: s.productId,
			qty: { value: s.qty, unit: s.unit },
			unitCents: Math.round(s.cents / s.qty),
			lineCents: s.cents,
			authority:
				authority !== 'mandate' && approved.includes(s.id) ? authority : ('mandate' as const)
		})),
		totalCents: total(specs),
		termsHash: terms(planId, planVersion),
		deliverBy,
		committedBy: by,
		committedAt: at.toISOString(),
		idempotencyKey: `${id}-commit`,
		authority
	});
	const receipt = (id: string, orderId: string, specs: LineSpec[], at: Date) => ({
		...scope,
		id,
		orderId,
		confirmed: specs.map((s) => ({
			productId: s.productId,
			qty: { value: s.qty, unit: s.unit },
			lineId: s.id
		})),
		awaitingSupplier: [],
		at: at.toISOString(),
		provenance: sim
	});
	const simAtOf = (i: number) => new Date(simStart.getTime() + i * 7 * 60_000).toISOString();
	const hotelV2 = [...HOTEL, TROUT];

	const steps: Step[] = [
		{
			op: { type: 'CreatePlan', plan: plan('p-hotel', 'k-hotel', HOTEL, A.hotelAgent) },
			actor: A.hotelAgent,
			via: 'agent:plan_event'
		},
		{
			op: { type: 'CreatePlan', plan: plan('p-lounas', 'k-lounas', LOUNAS, A.lounasAgent) },
			actor: A.lounasAgent,
			via: 'agent:quote'
		},
		{
			op: { type: 'CreatePlan', plan: plan('p-central', 'k-central', CENTRAL, A.external) },
			actor: A.external,
			via: 'mcp:place_order',
			key: 'ext-001'
		},
		{
			sim: {
				kind: 'atp.changed',
				productId: '462150',
				detail: { before: '40 kg', after: '9 kg', deliveryDay: 'Sat 12 Dec' },
				label: 'Salmon fillet for Saturday drops from 40 kg to 9 kg'
			}
		},
		{
			op: {
				type: 'RecordOffer',
				planId: 'p-hotel',
				baseVersion: 0,
				offers: [],
				lines: HOTEL.map((s) => line(s, true)),
				planState: 'held',
				totalCents: total(HOTEL),
				termsHash: terms('p-hotel', 1)
			},
			actor: A.hotelAgent,
			via: 'agent:quote'
		},
		{
			op: {
				type: 'RecordOffer',
				planId: 'p-lounas',
				baseVersion: 0,
				offers: [],
				lines: LOUNAS.map((s) => line(s, true)),
				planState: 'held',
				totalCents: total(LOUNAS),
				termsHash: terms('p-lounas', 1)
			},
			actor: A.lounasAgent,
			via: 'agent:quote'
		},
		{
			sim: {
				kind: 'contention.detected',
				productId: '462490',
				detail: { requestedKg: 140, availableKg: 98, kitchens: 3 },
				label: 'Three kitchens want 140 kg of Christmas ham; 98 kg left'
			}
		},
		{
			op: {
				type: 'RecordOffer',
				planId: 'p-central',
				baseVersion: 0,
				offers: [],
				lines: CENTRAL.map((s) => line(s, true)),
				planState: 'held',
				totalCents: total(CENTRAL),
				termsHash: terms('p-central', 1)
			},
			actor: A.external,
			via: 'mcp:quote',
			key: 'ext-002'
		},
		{
			op: {
				type: 'RecordAnomaly',
				anomaly: {
					...scope,
					id: 'an-salmon',
					kind: 'below_lot',
					productId: '462150',
					planId: 'p-hotel',
					message: '9 kg left is below the 10 kg lot: salmon cannot be ordered for Saturday',
					detectedAt: simAtOf(8),
					provenance: sim
				}
			},
			actor: A.system,
			via: 'simulator'
		},
		{
			op: {
				type: 'ProposeSubstitute',
				planId: 'p-hotel',
				baseVersion: 1,
				forLineId: 'h-salmon',
				kind: 'product',
				lines: [line(TROUT, false)],
				candidates: [
					{ productId: '462016', rank: 1, rejectedReasons: [], fromValioRule: true },
					{ productId: '462150', rank: null, rejectedReasons: ['BELOW_LOT'], fromValioRule: false }
				]
			},
			actor: A.hotelAgent,
			via: 'agent:find_substitutes'
		},
		{
			op: {
				type: 'RecordOffer',
				planId: 'p-hotel',
				baseVersion: 2,
				offers: [],
				lines: hotelV2.map((s) => line(s, true)),
				planState: 'held',
				totalCents: total(hotelV2),
				termsHash: terms('p-hotel', 3)
			},
			actor: A.hotelAgent,
			via: 'agent:quote'
		},
		{
			op: {
				type: 'RecordApproval',
				approval: approval(
					'ap-central',
					'p-central',
					1,
					CENTRAL.map((l) => l.id),
					'sign_off',
					'pending',
					A.external
				)
			},
			actor: A.external,
			via: 'mcp:approve',
			key: 'ext-003'
		},
		{
			op: {
				type: 'RecordApproval',
				approval: approval(
					'ap-lounas',
					'p-lounas',
					1,
					['l-cream'],
					'propose',
					'pending',
					A.lounasAgent
				)
			},
			actor: A.lounasAgent,
			via: 'agent:approve'
		},
		{
			op: {
				type: 'RecordApproval',
				approval: approval(
					'ap-lounas',
					'p-lounas',
					1,
					['l-cream'],
					'propose',
					'granted',
					A.lounasAgent,
					A.lounasChef
				)
			},
			actor: A.lounasChef,
			via: 'kitchen:approve'
		},
		{
			op: {
				type: 'CommitOrder',
				outcome: {
					result: 'committed',
					order: order(
						'o-lounas',
						'p-lounas',
						1,
						'k-lounas',
						LOUNAS,
						A.lounasChef,
						wall(14),
						{ approvalId: 'ap-lounas' },
						['l-cream']
					),
					receipt: receipt('r-lounas', 'o-lounas', LOUNAS, wall(14))
				}
			},
			actor: A.lounasChef,
			via: 'kitchen:commit_order'
		},
		{
			sim: {
				kind: 'cutoff.closed',
				detail: { deliveryDay: 'Sat 12 Dec', temperature: 'chilled' },
				label: 'Cut-off closed for chilled Saturday deliveries'
			}
		},
		{
			op: {
				type: 'CommitOrder',
				outcome: {
					result: 'failed',
					planId: 'p-hotel',
					idempotencyKey: 'o-hotel-commit',
					error: {
						code: 'FORBIDDEN',
						message: 'line h-casserole needs an approval to commit',
						retryable: false
					}
				}
			},
			actor: A.hotelAgent,
			via: 'agent:commit_order'
		},
		{
			op: {
				type: 'RecordApproval',
				approval: approval(
					'ap-central',
					'p-central',
					1,
					CENTRAL.map((l) => l.id),
					'sign_off',
					'granted',
					A.external,
					A.approver
				)
			},
			actor: A.approver,
			via: 'kitchen:approve'
		},
		{
			op: {
				type: 'CommitOrder',
				outcome: {
					result: 'committed',
					order: order('o-central', 'p-central', 1, 'k-central', CENTRAL, A.approver, wall(18), {
						approvalId: 'ap-central'
					}),
					receipt: receipt('r-central', 'o-central', CENTRAL, wall(18))
				}
			},
			actor: A.approver,
			via: 'kitchen:commit_order'
		}
	];

	return steps.map((s, i): ServerEvent => {
		const seq = startSeq + i;
		if ('sim' in s) return { kind: 'sim', seq, ...scope, event: { ...s.sim, simAt: simAtOf(i) } };
		const envelope: OpEnvelope = {
			...scope,
			seq,
			at: wall(i).toISOString(),
			actor: s.actor,
			via: s.via,
			...(s.key ? { idempotencyKey: s.key } : {}),
			op: s.op
		};
		return { kind: 'op', seq, envelope };
	});
}

/** What each simulated agent is doing, for its run's title in the trace drawer. */
const SIM_GOALS: Record<string, string> = {
	'agent:k-hotel': 'Simulated: the hotel kitchen agent plans and orders its buffet',
	'agent:k-lounas': "Simulated: the lunch restaurant's agent runs its weekly order",
	'ext:judge-claude': 'Simulated: an outside agent orders for the central kitchen'
};

/**
 * Trace events for one op of the simulated run, so the trace drawer and its run graph show the simulated agents
 * at work: a planned step before the op and the tool's result after it. Only agent ops get traces; people's
 * ops don't. Every trace names its run `sim:<actor>` and carries `simulated: true`.
 */
export function simTraces(
	env: OpEnvelope,
	n: number
): { before: ServerEvent[]; after: ServerEvent[] } {
	if (env.actor.kind !== 'kitchen_agent' && env.actor.kind !== 'external_agent')
		return { before: [], after: [] };
	const scope = { workspaceId: env.workspaceId, runId: env.runId };
	const agentRun = `sim:${env.actor.id}`;
	const goal = SIM_GOALS[env.actor.id] ?? 'Simulated agent run';
	const tool = env.via.split(':').pop() ?? env.via;
	const failed = env.op.type === 'CommitOrder' && env.op.outcome.result === 'failed';
	const why: Record<string, string> = {
		CreatePlan: 'draft the order from the week’s needs',
		RecordOffer: 'get live terms and check every line against the mandate',
		ProposeSubstitute: 'an item is out: find a substitute within the rules',
		RecordApproval: 'ask a person for the lines it may not order alone',
		CommitOrder: 'commit what the mandate and approvals allow'
	};
	const trace = (step: 'step' | 'tool', data: Record<string, unknown>): ServerEvent => ({
		kind: 'trace',
		...scope,
		at: env.at,
		step,
		data: { agentRun, goal, simulated: true, ...data }
	});
	return {
		before: [trace('step', { n, tool, why: why[env.op.type] ?? '' })],
		after: [
			trace('tool', {
				tool,
				ok: !failed,
				ms: 40 + ((env.seq * 37) % 160),
				...(failed && env.op.type === 'CommitOrder' && env.op.outcome.result === 'failed'
					? { code: env.op.outcome.error.code }
					: {})
			})
		]
	};
}

/** The closing trace of each simulated agent's run, after the script's last op. */
export function simDone(scope: { workspaceId: string; runId: string }, at: string): ServerEvent[] {
	return Object.entries(SIM_GOALS).map(([id, goal]) => ({
		kind: 'trace' as const,
		...scope,
		at,
		step: 'done' as const,
		data: {
			agentRun: `sim:${id}`,
			goal,
			simulated: true,
			stopped: 'done',
			summary: 'Simulated run: scripted steps, real catalogue products, invented quantities.'
		}
	}));
}
