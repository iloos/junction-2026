<script lang="ts">
	import { enhance } from '$app/forms';
	import type { TraceRun } from './stream.svelte';

	let {
		runs,
		open = $bindable(false),
		canRun
	}: { runs: TraceRun[]; open?: boolean; canRun: boolean } = $props();

	let starting = $state(false);
	let message = $state('');
	let panel: HTMLElement | undefined = $state();

	$effect(() => {
		if (open) panel?.focus();
	});

	const num = (v: unknown) => (typeof v === 'number' ? v : null);
	const str = (v: unknown) => (typeof v === 'string' ? v : '');
	const clock = (iso: string) =>
		new Date(iso).toLocaleTimeString('en-GB', {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	const STOPPED: Record<string, string> = {
		done: 'Finished',
		max_steps: 'Stopped at the 8-step limit',
		deadline: 'Stopped at the deadline',
		planner_error: 'Planner failed',
		cancelled: 'Stopped by a person',
		unsupported: 'Not something this agent does'
	};
	/** GoalOutcome.status in words, with the tone it reads in. */
	const OUTCOME: Record<string, { word: string; tone: 'done' | 'warn' | 'bad' }> = {
		fulfilled: { word: 'Goal met', tone: 'done' },
		partial: { word: 'Partly met', tone: 'warn' },
		awaiting_user: { word: 'Waiting for a person', tone: 'warn' },
		blocked: { word: 'Blocked', tone: 'bad' },
		unsupported: { word: 'Not supported', tone: 'bad' }
	};
</script>

<svelte:window onkeydown={(e) => open && e.key === 'Escape' && (open = false)} />

{#if open}
	<button class="scrim" aria-label="Close agent traces" onclick={() => (open = false)}></button>
	<aside class="drawer" aria-label="Agent traces" tabindex="-1" bind:this={panel}>
		<header>
			<h2>Agent traces</h2>
			<button class="close" onclick={() => (open = false)}>Close</button>
		</header>
		<p class="lede">
			Every step the kitchen agent takes and every model call it makes, with timing and tokens. Live
			only: runs that started before you opened this page are not shown.
		</p>

		{#if canRun}
			<form
				method="POST"
				action="?/runAgent"
				use:enhance={() => {
					starting = true;
					message = '';
					return async ({ result }) => {
						starting = false;
						if (result.type === 'failure')
							message = String((result.data as { message?: string })?.message ?? 'Could not start');
					};
				}}
			>
				<button class="run" disabled={starting}>
					{starting ? 'Starting' : 'Run the routine agent'}
				</button>
				<span class="hint">Plans the Christmas buffet for 140 at the hotel, at most 8 steps.</span>
				{#if message}<p class="msg" role="status">{message}</p>{/if}
			</form>
		{/if}

		{#each runs as run (run.id)}
			<section class="run-block">
				<header class="run-head">
					<h3>{run.goal || 'Agent run'}</h3>
					<div class="meta">
						<span class="mono">{clock(run.startedAt)}</span>
						{#if run.done}
							<span class:warn={run.done.stopped !== 'done'}
								>{STOPPED[run.done.stopped] ?? run.done.stopped}</span
							>
						{:else}
							<span class="live">Running</span>
							{#if canRun}
								<form method="POST" action="?/cancelAgent" use:enhance class="stop">
									<input type="hidden" name="id" value={run.id} />
									<button>Stop</button>
								</form>
							{/if}
						{/if}
					</div>
					{#if run.done?.outcome}
						{@const o = run.done.outcome}
						<p class="outcome" data-tone={OUTCOME[o.status]?.tone ?? 'warn'}>
							<b>{OUTCOME[o.status]?.word ?? o.status}</b>
							{#if o.nextAction}<span>Next: {o.nextAction}</span>{/if}
							{#if o.reason}<span class="reason">{o.reason}</span>{/if}
						</p>
					{/if}
				</header>
				<ol>
					{#each run.steps as s, i (i)}
						{#if s.step === 'step'}
							<li class="plan">
								<span class="n">{num(s.data.n)}</span>
								<div>
									<p><b class="mono">{str(s.data.tool)}</b></p>
									<p class="why">{str(s.data.why)}</p>
								</div>
							</li>
						{:else if s.step === 'tool'}
							<li class="result" class:bad={s.data.ok === false}>
								<span class="n"></span>
								<p>
									{s.data.ok === false ? `Failed: ${str(s.data.code)}` : 'Done'}
									<span class="mono">{num(s.data.ms)} ms</span>
									{#if str(s.data.result)}<details class="digest">
											<summary
												>{str(s.data.result).slice(0, 90)}{str(s.data.result).length > 90
													? '…'
													: ''}</summary
											><code>{str(s.data.result)}</code>
										</details>{/if}
								</p>
							</li>
						{:else if s.step === 'error'}
							<li class="result bad">
								<span class="n"></span>
								<p>{str(s.data.error)}</p>
							</li>
						{:else}
							<li class="model">
								<span class="n"></span>
								<p>
									<span class="mono">{str(s.data.model) || str(s.data.source) || s.step}</span>
									{#if num(s.data.tokensIn) !== null}
										<span>{num(s.data.tokensIn)} in, {num(s.data.tokensOut)} out</span>
									{/if}
									{#if num(s.data.latencyMs) !== null}<span>{num(s.data.latencyMs)} ms</span>{/if}
									{#if str(s.data.error)}<span class="err">{str(s.data.error)}</span>{/if}
								</p>
							</li>
						{/if}
					{/each}
				</ol>
				{#if run.done?.summary}<p class="summary">{run.done.summary}</p>{/if}
			</section>
		{:else}
			<p class="none">No agent has run since this page opened.</p>
		{/each}
	</aside>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		background: rgb(5 12 20 / 0.55);
		border: 0;
		z-index: 10;
	}
	.drawer {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		width: min(640px, 100vw);
		overflow-y: auto;
		background: var(--panel);
		border-left: 1px solid var(--line);
		padding: 24px 28px 40px;
		z-index: 11;
		animation: slide 220ms ease-out;
		outline: none;
	}
	@keyframes slide {
		from {
			transform: translateX(40px);
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.drawer {
			animation: none;
		}
	}
	.drawer > header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}
	h2 {
		margin: 0;
		font-family: var(--cond);
		font-size: 30px;
		font-weight: 600;
	}
	.close {
		background: none;
		border: 1px solid var(--line);
		color: var(--text);
		border-radius: 6px;
		padding: 6px 14px;
		font: inherit;
		font-size: 16px;
		cursor: pointer;
	}
	.lede {
		color: var(--muted);
		font-size: 16px;
		margin: 8px 0 20px;
		max-width: 60ch;
	}
	form {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 14px;
		margin-bottom: 24px;
	}
	.run {
		padding: 10px 18px;
		border-radius: 6px;
		border: 0;
		background: var(--text);
		color: var(--bg);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.run:disabled {
		opacity: 0.6;
		cursor: progress;
	}
	.hint {
		color: var(--muted);
		font-size: 15px;
	}
	.msg {
		flex-basis: 100%;
		margin: 0;
		color: var(--sign-off);
		font-size: 16px;
	}

	.run-block {
		border-top: 1px solid var(--line);
		padding: 16px 0;
	}
	.run-head h3 {
		margin: 0;
		font-size: 19px;
		font-weight: 500;
	}
	.run-head .meta {
		margin: 4px 0 10px;
		display: flex;
		gap: 14px;
		color: var(--muted);
		font-size: 15px;
	}
	.live {
		color: var(--done);
	}
	.stop {
		display: inline;
	}
	.stop button {
		background: transparent;
		border: 1px solid var(--blocked);
		color: var(--blocked);
		border-radius: 6px;
		padding: 0 10px;
		font: inherit;
		font-size: 15px;
		cursor: pointer;
	}
	.outcome {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 12px;
		margin: 0 0 10px;
		padding: 8px 12px;
		border-left: 3px solid var(--done);
		background: var(--raise);
		font-size: 16px;
		color: var(--text);
	}
	.outcome[data-tone='warn'] {
		border-color: var(--sign-off);
	}
	.outcome[data-tone='bad'] {
		border-color: var(--blocked);
	}
	.outcome .reason {
		color: var(--muted);
		flex-basis: 100%;
	}
	.warn {
		color: var(--sign-off);
	}
	ol {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li {
		display: grid;
		grid-template-columns: 28px 1fr;
		gap: 10px;
		padding: 3px 0;
		font-size: 16px;
	}
	li p {
		margin: 0;
	}
	.n {
		font-family: var(--mono);
		color: var(--faint);
		text-align: right;
	}
	.plan {
		margin-top: 8px;
	}
	.why {
		color: var(--muted);
	}
	.result p,
	.model p {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 12px;
		color: var(--muted);
	}
	.result.bad p {
		color: var(--blocked);
	}
	.model p {
		color: var(--propose);
		font-size: 15px;
	}
	.digest summary {
		cursor: pointer;
		overflow-wrap: anywhere;
	}
	.digest code {
		display: block;
		margin-top: 6px;
		max-height: 240px;
		overflow: auto;
		font-family: var(--mono);
		font-size: 13px;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.digest {
		color: var(--faint);
		flex-basis: 100%;
	}
	.err {
		color: var(--blocked);
	}
	.mono {
		font-family: var(--mono);
	}
	.summary {
		margin: 12px 0 0 38px;
		padding-left: 12px;
		border-left: 2px solid var(--done);
		font-size: 16px;
	}
	.none {
		color: var(--muted);
	}
</style>
