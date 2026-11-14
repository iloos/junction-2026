<script lang="ts">
	import type { TraceRun } from './stream.svelte';
	import { reasonText, toolText } from './labels';

	/**
	 * One agent run as a graph: each step the planner chose (what and why), what the tool returned, the model
	 * calls in between, and how it ended. Bars compare durations within the run.
	 */
	let { run }: { run: TraceRun } = $props();

	const num = (v: unknown) => (typeof v === 'number' ? v : null);
	const str = (v: unknown) => (typeof v === 'string' ? v : '');

	type Node =
		| {
				kind: 'step';
				n: number | null;
				tool: string;
				why: string;
				ok?: boolean;
				code?: string;
				ms?: number;
		  }
		| { kind: 'model'; model: string; ms: number | null; tokens: string; error: string }
		| { kind: 'error'; text: string };

	const nodes = $derived.by(() => {
		const out: Node[] = [];
		for (const s of run.steps) {
			if (s.step === 'step')
				out.push({ kind: 'step', n: num(s.data.n), tool: str(s.data.tool), why: str(s.data.why) });
			else if (s.step === 'tool') {
				const last = [...out].reverse().find((x) => x.kind === 'step');
				if (last && last.kind === 'step' && last.ok === undefined) {
					last.ok = s.data.ok !== false;
					last.code = str(s.data.code);
					last.ms = num(s.data.ms) ?? undefined;
				}
			} else if (s.step === 'error') out.push({ kind: 'error', text: str(s.data.error) });
			else if (s.step === 'text' || s.step === 'decision') {
				const tin = num(s.data.tokensIn);
				out.push({
					kind: 'model',
					model: str(s.data.model) || str(s.data.source) || 'model',
					ms: num(s.data.latencyMs),
					tokens: tin !== null ? `${tin} in, ${num(s.data.tokensOut) ?? 0} out` : '',
					error: str(s.data.error)
				});
			}
		}
		return out;
	});
	const longest = $derived(
		Math.max(
			1,
			...nodes.map((n) => (n.kind === 'step' ? (n.ms ?? 0) : n.kind === 'model' ? (n.ms ?? 0) : 0))
		)
	);
	const width = (ms: number | null | undefined) => `${Math.max(2, ((ms ?? 0) / longest) * 100)}%`;
</script>

<ol class="graph" aria-label="Run graph">
	{#each nodes as node, i (i)}
		{#if node.kind === 'step'}
			<li class="node step" data-ok={node.ok === undefined ? 'pending' : node.ok}>
				<span class="dot">{node.n ?? ''}</span>
				<div class="body">
					<p class="what"><b>{toolText(node.tool)}</b></p>
					{#if node.why}<p class="why">{node.why}</p>{/if}
					<p class="result">
						{node.ok === undefined
							? 'Running'
							: node.ok
								? 'Done'
								: `Failed: ${reasonText(node.code ?? '')}`}
						{#if node.ms !== undefined}<span class="mono">{node.ms} ms</span>{/if}
					</p>
					{#if node.ms !== undefined}<span class="bar" style:width={width(node.ms)}></span>{/if}
				</div>
			</li>
		{:else if node.kind === 'model'}
			<li class="node model">
				<span class="dot" aria-hidden="true"></span>
				<div class="body">
					<p>
						Model call <span class="mono">{node.model}</span>
						{#if node.ms !== null}<span class="mono">{node.ms} ms</span>{/if}
						{#if node.tokens}<span>{node.tokens}</span>{/if}
						{#if node.error}<span class="err">{node.error}</span>{/if}
					</p>
					{#if node.ms !== null}<span class="bar model" style:width={width(node.ms)}></span>{/if}
				</div>
			</li>
		{:else}
			<li class="node error">
				<span class="dot" aria-hidden="true">!</span>
				<div class="body"><p>{node.text}</p></div>
			</li>
		{/if}
	{/each}
	{#if !nodes.length}<li class="empty">No steps yet.</li>{/if}
</ol>

<style>
	.graph {
		list-style: none;
		margin: 12px 0 0;
		padding: 0;
		position: relative;
	}
	.node {
		display: grid;
		grid-template-columns: 28px 1fr;
		gap: 12px;
		position: relative;
		padding-bottom: 14px;
	}
	/* The thread joining the steps. */
	.node:not(:last-child)::before {
		content: '';
		position: absolute;
		left: 13px;
		top: 26px;
		bottom: 0;
		width: 2px;
		background: var(--line);
	}
	.dot {
		width: 26px;
		height: 26px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		background: var(--raise);
		border: 2px solid var(--muted);
		font-family: var(--mono);
		font-size: 13px;
	}
	.step[data-ok='true'] .dot {
		border-color: var(--done);
	}
	.step[data-ok='false'] .dot,
	.error .dot {
		border-color: var(--blocked);
		color: var(--blocked);
	}
	.model .dot {
		width: 14px;
		height: 14px;
		margin: 6px;
		border-radius: 3px;
		transform: rotate(45deg);
		border-color: var(--propose);
	}
	.body {
		min-width: 0;
	}
	.body p {
		margin: 0;
	}
	.why {
		color: var(--muted);
		font-size: 15px;
	}
	.result,
	.model p {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 10px;
		color: var(--muted);
		font-size: 15px;
	}
	.step[data-ok='false'] .result,
	.err {
		color: var(--blocked);
	}
	.mono {
		font-family: var(--mono);
	}
	.bar {
		display: block;
		height: 4px;
		margin-top: 6px;
		border-radius: 2px;
		background: var(--done);
		opacity: 0.7;
	}
	.bar.model {
		background: var(--propose);
	}
	.empty {
		color: var(--muted);
	}
</style>
