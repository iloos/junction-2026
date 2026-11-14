<script lang="ts">
	import type { Case } from './cases';

	/** One case on the wallboard: a cause in one plan, however many lines share it. */
	let { c, fresh = false }: { c: Case; fresh?: boolean } = $props();
</script>

<article class="ticket" data-tone={c.tone} class:fresh aria-label="{c.state}: {c.title}">
	<div class="edge" aria-hidden="true"></div>
	<div class="body">
		<h3>{c.title}</h3>
		{#if c.lines.length > 1}
			<ul class="lines">
				{#each c.lines.slice(0, 4) as l (l.id)}<li>{l.name} <small>{l.detail}</small></li>{/each}
				{#if c.lines.length > 4}<li class="more">and {c.lines.length - 4} more</li>{/if}
			</ul>
		{:else if c.detail}
			<p class="meta">{c.detail}</p>
		{/if}
		<div class="why">
			<span class="tier"><i class="mark" aria-hidden="true"></i>{c.state}</span>
			{#each c.causes as cause (cause)}<span class="reason">{cause}</span>{/each}
		</div>
		<p class="next">{c.owner}: {c.next}</p>
	</div>
</article>

<style>
	.ticket {
		--tone: var(--act);
		display: grid;
		grid-template-columns: 14px 1fr;
		background: var(--raise);
		border-radius: 3px 6px 6px 3px;
		overflow: hidden;
	}
	.ticket[data-tone='propose'] {
		--tone: var(--propose);
	}
	.ticket[data-tone='sign_off'] {
		--tone: var(--sign-off);
	}
	.ticket[data-tone='blocked'] {
		--tone: var(--blocked);
	}

	/* The torn, perforated stub of a kitchen ticket, in the tier's colour. */
	.edge {
		background: var(--tone);
		mask: radial-gradient(circle at 0 50%, transparent 3.5px, #000 4px) 0 0 / 100% 12px repeat-y;
	}
	.body {
		padding: 12px 16px 12px 14px;
		min-width: 0;
	}
	h3 {
		margin: 0;
		font-size: 19px;
		font-weight: 500;
		line-height: 1.3;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.meta {
		margin: 2px 0 0;
		color: var(--muted);
		font-size: 16px;
	}
	.lines {
		margin: 6px 0 0;
		padding: 0;
		list-style: none;
		font-size: 16px;
	}
	.lines small,
	.more {
		color: var(--muted);
	}
	.next {
		margin: 8px 0 0;
		color: var(--muted);
		font-size: 15px;
	}
	.why {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 8px;
		margin-top: 10px;
		font-size: 16px;
	}
	.tier {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		color: var(--tone);
		font-weight: 600;
		margin-right: 4px;
	}
	/* Shape as well as colour: square = acts, circle = confirm, diamond = sign-off, bar = blocked. */
	.mark {
		width: 10px;
		height: 10px;
		background: var(--tone);
		display: inline-block;
	}
	[data-tone='propose'] .mark {
		border-radius: 50%;
	}
	[data-tone='sign_off'] .mark {
		transform: rotate(45deg) scale(0.85);
	}
	[data-tone='blocked'] .mark {
		height: 4px;
		width: 12px;
	}
	.reason {
		padding: 1px 10px;
		border: 1px solid var(--line);
		border-radius: 999px;
		color: var(--text);
	}
	.fresh {
		animation: land 1.4s ease-out;
	}
	@keyframes land {
		0% {
			background: color-mix(in oklab, var(--tone) 28%, var(--raise));
			transform: translateX(-6px);
		}
		18% {
			transform: none;
		}
		100% {
			background: var(--raise);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.fresh {
			animation: none;
		}
	}
</style>
