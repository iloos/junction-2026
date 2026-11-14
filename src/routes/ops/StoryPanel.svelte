<script lang="ts">
	import { CHIP, type StoryStep } from './story';

	/**
	 * "What happened to this problem": its ops in order, each with who did it, one sentence and what it changed.
	 * "Technical detail" opens the op itself in the trace drawer; the seq is the engine room's.
	 */
	let {
		title,
		steps,
		hidden,
		time,
		ondetail
	}: {
		title: string;
		steps: StoryStep[];
		hidden: number;
		time: (iso: string) => string;
		ondetail: (seq: number) => void;
	} = $props();
</script>

<section class="story" aria-label="What happened to this problem">
	<h2>What happened</h2>
	<p class="for">{title}</p>
	{#if steps.length}
		<ol>
			{#each steps as st (st.seq)}
				<li data-tone={st.tone}>
					<span class="tm">{time(st.at)}</span>
					<i class="pip" aria-hidden="true"></i>
					<div class="bd">
						<span class="chip" data-chip={st.chip}
							>{CHIP[st.chip]}{st.door ? ` · ${st.door}` : ''}</span
						>
						<p class="what">{st.what}</p>
						<p class="then">{st.then}</p>
						<button class="more" onclick={() => ondetail(st.seq)}
							>Technical detail <span class="seq sys-only">op {st.seq}</span></button
						>
					</div>
				</li>
			{/each}
		</ol>
	{:else}
		<p class="none">No op of this run touches it yet.</p>
	{/if}
	{#if hidden}
		<p class="hidden">
			{hidden} other op{hidden === 1 ? '' : 's'} on this plan without a sentence here; the engine room
			lists every op.
		</p>
	{/if}
</section>

<style>
	.story {
		background: var(--panel);
		border-radius: 8px;
		padding: 18px 20px 12px;
		min-width: 0;
	}
	h2 {
		margin: 0;
		font-family: var(--cond);
		font-size: 24px;
		font-weight: 600;
	}
	.for {
		margin: 2px 0 10px;
		color: var(--muted);
		font-size: 15px;
	}
	ol {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li {
		--tone: var(--faint);
		display: grid;
		grid-template-columns: 44px 14px minmax(0, 1fr);
		gap: 0 10px;
		padding: 12px 0;
		border-top: 1px solid var(--line);
	}
	li[data-tone='bad'] {
		--tone: var(--blocked);
	}
	li[data-tone='warn'] {
		--tone: var(--sign-off);
	}
	li[data-tone='ok'] {
		--tone: var(--done);
	}
	.tm {
		font-family: var(--mono);
		font-size: 13px;
		color: var(--faint);
		padding-top: 3px;
	}
	.pip {
		width: 9px;
		height: 9px;
		margin-top: 7px;
		border-radius: 50%;
		background: var(--tone);
	}
	.chip {
		display: inline-block;
		padding: 0 8px;
		border: 1px solid var(--line);
		border-radius: 999px;
		font-family: var(--mono);
		font-size: 12.5px;
		color: var(--muted);
	}
	.chip[data-chip='valio'] {
		color: var(--propose);
	}
	.chip[data-chip='outside'] {
		color: var(--outside);
	}
	.chip[data-chip='chef'],
	.chip[data-chip='approver'] {
		color: var(--text);
	}
	.what {
		margin: 6px 0 0;
		font-size: 16px;
	}
	.then {
		margin: 2px 0 0;
		color: var(--tone);
		font-size: 15px;
	}
	li[data-tone='plain'] .then {
		color: var(--muted);
	}
	.then::before {
		content: '→ ';
	}
	.more {
		margin-top: 4px;
		padding: 0;
		background: none;
		border: 0;
		color: var(--muted);
		font: inherit;
		font-size: 14px;
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
	}
	.more:hover {
		color: var(--text);
	}
	.seq {
		font-family: var(--mono);
		font-size: 12.5px;
		color: var(--faint);
		text-decoration: none;
	}
	.none,
	.hidden {
		color: var(--muted);
		font-size: 14px;
	}
</style>
