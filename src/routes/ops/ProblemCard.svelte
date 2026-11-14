<script lang="ts">
	import type { Problem } from './problems';
	import { euro } from './labels';

	/**
	 * One problem, consequence first: the title says what goes wrong and for how many kitchens, then what happened,
	 * what agents already did, the money waiting and the time to cut-off. The only control is the kitchen link,
	 * because that is the only action Ops can take on it.
	 */
	let {
		p,
		selected = false,
		due,
		href,
		onselect
	}: {
		p: Problem;
		selected?: boolean;
		/** "cut-off in 16 h", already on the cases' clock. */
		due: { text: string; late: boolean; abs?: string } | null;
		href: string | null;
		onselect?: () => void;
	} = $props();

	const WAITS = {
		chef: 'Waits for the chef',
		approver: 'Waits for a named approver',
		agents: 'Agents are on it',
		operations: 'Valio operations to check'
	} as const;
</script>

<article
	class="card"
	data-tone={p.tone}
	class:selected
	aria-label={p.title}
	aria-current={selected ? 'true' : undefined}
>
	<button class="hit" onclick={onselect} aria-label="Show what happened: {p.title}"></button>
	<header>
		<i class="mark" aria-hidden="true"></i>
		<h3>{p.title}</h3>
		{#if due}
			<span class="due" class:late={due.late} title={due.abs}>{due.text}</span>
		{/if}
	</header>
	<p class="detail">{p.detail}</p>
	{#if p.already}
		<p class="already">{p.already}</p>
	{/if}
	<footer>
		{#if p.heldCents}
			<span class="money"><b>{euro(p.heldCents)}</b> waiting on a decision</span>
		{/if}
		<span class="waits">{WAITS[p.waits]}</span>
		{#if href}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- kitchen deep link with query -->
			<a class="open" {href}>Open in the kitchen</a>
		{/if}
	</footer>
</article>

<style>
	.card {
		--tone: var(--muted);
		position: relative;
		display: grid;
		gap: 6px;
		padding: 16px 20px 14px;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 8px;
	}
	.card[data-tone='blocked'] {
		--tone: var(--blocked);
	}
	.card[data-tone='sign_off'] {
		--tone: var(--sign-off);
	}
	.card[data-tone='propose'] {
		--tone: var(--propose);
	}
	.card[data-tone='quiet'] {
		--tone: var(--faint);
		background: transparent;
	}
	.card.selected {
		border-color: color-mix(in oklab, var(--tone) 70%, var(--line));
		box-shadow: inset 3px 0 0 var(--tone);
	}
	/* The whole card selects; the kitchen link sits above the hit area. */
	.hit {
		position: absolute;
		inset: 0;
		background: none;
		border: 0;
		border-radius: 8px;
		cursor: pointer;
	}
	header {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 12px;
		align-items: baseline;
	}
	/* Shape as well as colour: bar = blocked, diamond = sign-off, circle = chef, ring = quiet. */
	.mark {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--tone);
		transform: translateY(-1px);
	}
	[data-tone='blocked'] .mark {
		width: 12px;
		height: 4px;
		border-radius: 1px;
	}
	[data-tone='sign_off'] .mark {
		border-radius: 1px;
		transform: rotate(45deg) scale(0.85);
	}
	[data-tone='quiet'] .mark {
		background: none;
		box-shadow: inset 0 0 0 2px var(--faint);
	}
	h3 {
		margin: 0;
		font-size: 20px;
		font-weight: 600;
		line-height: 1.3;
	}
	[data-tone='quiet'] h3 {
		font-weight: 500;
		color: var(--muted);
	}
	.due {
		font-family: var(--mono);
		font-size: 15px;
		color: var(--tone);
		white-space: nowrap;
	}
	.due.late {
		color: var(--blocked);
	}
	.detail {
		margin: 0;
		color: var(--muted);
		font-size: 16px;
		max-width: 80ch;
	}
	.already {
		margin: 2px 0 0;
		padding-left: 12px;
		border-left: 2px solid var(--done);
		font-size: 15px;
		color: var(--text);
	}
	footer {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 18px;
		margin-top: 6px;
		font-size: 15px;
		color: var(--muted);
	}
	.money b {
		font-family: var(--mono);
		font-weight: 500;
		color: var(--text);
	}
	.open {
		position: relative;
		margin-left: auto;
		padding: 5px 12px;
		border: 1px solid var(--line);
		border-radius: 6px;
		color: var(--text);
		text-decoration: none;
	}
	.open:hover {
		border-color: var(--muted);
	}
	@media (max-width: 760px) {
		.card {
			padding: 14px 14px 12px;
		}
		header {
			grid-template-columns: auto 1fr;
		}
		.due {
			grid-column: 2;
		}
		h3 {
			font-size: 18px;
		}
		.open {
			margin-left: 0;
		}
	}
</style>
