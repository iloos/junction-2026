<script lang="ts">
	import type { ActorKind, OpEnvelope } from '$lib/core/contracts';
	import type { LogEntry } from './stream.svelte';
	import { ACTOR, opPlanId, opSummary, type Names } from './labels';

	/**
	 * The op log as swimlanes: one lane per actor, one mark per op in seq order. Shapes say what happened (plan,
	 * quote, rescue, approval, commit, anomaly), red marks a refused commit, ticks on the axis mark each new plan
	 * version, and commits that landed on the same receipt are joined: a retry never makes a second order.
	 */
	let { log, names }: { log: LogEntry[]; names: Names } = $props();

	const LANE_ORDER: ActorKind[] = [
		'chef',
		'approver',
		'kitchen_agent',
		'external_agent',
		'system',
		'job'
	];
	const STEP = 26;
	const LANE = 40;
	const LEFT = 128;
	const TOP = 28;

	type Mark = {
		seq: number;
		x: number;
		lane: number;
		kind:
			| 'plan'
			| 'edit'
			| 'quote'
			| 'rescue'
			| 'approval'
			| 'commit'
			| 'refused'
			| 'anomaly'
			| 'other';
		title: string;
		receipt?: string;
		version?: number;
		planId?: string;
	};

	const ops = $derived(
		log
			.filter((e): e is Extract<LogEntry, { kind: 'op' }> => e.kind === 'op')
			.map((e) => e.envelope)
			.sort((a, b) => a.seq - b.seq)
	);
	const lanes = $derived(LANE_ORDER.filter((k) => ops.some((o) => o.actor.kind === k)));

	function kindOf(env: OpEnvelope): Mark['kind'] {
		const op = env.op;
		switch (op.type) {
			case 'CreatePlan':
				return 'plan';
			case 'EditLine':
				return 'edit';
			case 'RecordOffer':
				return 'quote';
			case 'ProposeSubstitute':
				return 'rescue';
			case 'RecordApproval':
				return 'approval';
			case 'CommitOrder':
				return op.outcome.result === 'committed' ? 'commit' : 'refused';
			case 'RecordAnomaly':
				return 'anomaly';
			default:
				return 'other';
		}
	}

	const marks = $derived(
		ops.map((env, i): Mark => {
			const op = env.op;
			return {
				seq: env.seq,
				x: LEFT + i * STEP + STEP / 2,
				lane: lanes.indexOf(env.actor.kind),
				kind: kindOf(env),
				title: `#${env.seq} ${ACTOR[env.actor.kind]}: ${opSummary(env, names)}`,
				receipt:
					op.type === 'CommitOrder' && op.outcome.result === 'committed'
						? op.outcome.receipt.id
						: undefined,
				version: 'baseVersion' in op ? (op.baseVersion as number) + 1 : undefined,
				planId: opPlanId(env)
			};
		})
	);

	/** A tick where a plan's version changes (the version an op produced). */
	const ticks = $derived.by(() => {
		const last: Record<string, number> = {};
		const out: { x: number; label: string }[] = [];
		for (const m of marks) {
			if (!m.planId || m.version === undefined) continue;
			if (last[m.planId] !== m.version) out.push({ x: m.x, label: `v${m.version}` });
			last[m.planId] = m.version;
		}
		return out;
	});

	/** Commits that share a receipt: the first, and every later one that replayed it. */
	const sameReceipt = $derived.by(() => {
		const byReceipt: Record<string, Mark[]> = {};
		for (const m of marks) if (m.receipt) (byReceipt[m.receipt] ??= []).push(m);
		return Object.values(byReceipt).filter((g) => g.length > 1);
	});

	const width = $derived(LEFT + Math.max(ops.length, 8) * STEP + 24);
	const height = $derived(TOP + Math.max(lanes.length, 1) * LANE + 12);
	const y = (lane: number) => TOP + lane * LANE + LANE / 2;
</script>

<section class="timeline" aria-label="Op log timeline">
	<header>
		<h2>Timeline</h2>
		<p class="legend">
			<span><i class="k plan"></i>plan</span>
			<span><i class="k quote"></i>quote</span>
			<span><i class="k rescue"></i>rescue</span>
			<span><i class="k approval"></i>approval</span>
			<span><i class="k commit"></i>commit</span>
			<span><i class="k refused"></i>refused</span>
		</p>
	</header>
	{#if ops.length}
		<div class="scroll">
			<svg {width} {height} role="img" aria-label="{ops.length} ops by actor, oldest left">
				{#each ticks as t (t.x + t.label)}
					<line class="tick" x1={t.x} x2={t.x} y1={TOP - 6} y2={height - 8} />
					<text class="ticklabel" x={t.x} y={TOP - 10}>{t.label}</text>
				{/each}
				{#each lanes as k, i (k)}
					<line class="lane" x1={LEFT - 8} x2={width - 8} y1={y(i)} y2={y(i)} />
					<text class="lanelabel" x="0" y={y(i) + 5}>{ACTOR[k]}</text>
				{/each}
				{#each sameReceipt as g (g[0].receipt)}
					<path
						class="retry"
						d="M {g[0].x} {y(g[0].lane)} {g
							.slice(1)
							.map((m) => `L ${m.x} ${y(m.lane)}`)
							.join(' ')}"
					/>
				{/each}
				{#each marks as m (m.seq)}
					<g class="mark {m.kind}" transform="translate({m.x} {y(m.lane)})">
						<title>{m.title}</title>
						{#if m.kind === 'commit' || m.kind === 'refused'}
							<rect x="-7" y="-7" width="14" height="14" rx="2" />
						{:else if m.kind === 'approval'}
							<rect x="-6" y="-6" width="12" height="12" transform="rotate(45)" />
						{:else if m.kind === 'anomaly'}
							<path d="M 0 -8 L 8 7 L -8 7 Z" />
						{:else if m.kind === 'plan'}
							<circle r="8" />
						{:else}
							<circle r="5" />
						{/if}
					</g>
				{/each}
			</svg>
		</div>
		{#if sameReceipt.length}
			<p class="note">
				Joined commits landed on the same receipt: a retry with the same key never makes a second
				order.
			</p>
		{/if}
	{:else}
		<p class="none">No ops in this run yet.</p>
	{/if}
</section>

<style>
	.timeline {
		background: var(--panel);
		border-radius: 8px;
		padding: 18px 20px 14px;
		min-width: 0;
	}
	header {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 20px;
		align-items: baseline;
		justify-content: space-between;
	}
	h2 {
		margin: 0;
		font-family: var(--cond);
		font-size: 24px;
		font-weight: 600;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		margin: 0;
		color: var(--muted);
		font-size: 15px;
	}
	.legend span {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.k {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		display: inline-block;
		background: var(--muted);
	}
	.k.plan {
		background: var(--text);
	}
	.k.quote {
		background: var(--muted);
	}
	.k.rescue {
		background: var(--propose);
	}
	.k.approval {
		background: var(--sign-off);
		border-radius: 1px;
		transform: rotate(45deg) scale(0.85);
	}
	.k.commit {
		background: var(--done);
		border-radius: 2px;
	}
	.k.refused {
		background: var(--blocked);
		border-radius: 2px;
	}
	.scroll {
		overflow-x: auto;
		margin-top: 10px;
	}
	svg {
		display: block;
	}
	.lane {
		stroke: var(--line);
	}
	.lanelabel {
		fill: var(--muted);
		font-size: 14px;
	}
	.tick {
		stroke: var(--line);
		stroke-dasharray: 2 4;
	}
	.ticklabel {
		fill: var(--faint);
		font-family: var(--mono);
		font-size: 12px;
		text-anchor: middle;
	}
	.mark {
		fill: var(--muted);
	}
	.mark.plan {
		fill: var(--text);
	}
	.mark.rescue {
		fill: var(--propose);
	}
	.mark.approval {
		fill: var(--sign-off);
	}
	.mark.commit {
		fill: var(--done);
	}
	.mark.refused,
	.mark.anomaly {
		fill: var(--blocked);
	}
	.retry {
		fill: none;
		stroke: var(--done);
		stroke-width: 2;
		stroke-dasharray: 4 3;
	}
	.note,
	.none {
		margin: 8px 0 0;
		color: var(--muted);
		font-size: 15px;
	}
</style>
