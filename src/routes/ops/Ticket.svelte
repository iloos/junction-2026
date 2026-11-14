<script lang="ts">
	import type { Line } from '$lib/core/contracts';
	import { euro, productName, reasonText, TIER, type Names } from './labels';

	let { line, names, fresh = false }: { line: Line; names: Names; fresh?: boolean } = $props();

	const blocked = $derived(line.state === 'unorderable');
	const tone = $derived(blocked ? 'blocked' : (line.tier ?? 'act'));
	const tierWord = $derived(blocked ? 'Cannot order' : TIER[line.tier ?? 'act'].word);
</script>

<article
	class="ticket"
	data-tone={tone}
	class:fresh
	aria-label="{tierWord}: {productName(names, line.productId)}"
>
	<div class="edge" aria-hidden="true"></div>
	<div class="body">
		<h3>{productName(names, line.productId)}</h3>
		<div class="figs">
			<span class="pid">{line.productId}</span>
			<span class="qty">{line.qty.value}&nbsp;<small>{line.qty.unit}</small></span>
			<span class="money">{euro(line.lineCents)}</span>
		</div>
		{#if line.qty.rounding || line.substituteFor}
			<div class="meta">
				{#if line.qty.rounding}<span>{line.qty.rounding}</span>{/if}
				{#if line.substituteFor}<span class="sub"
						>replaces {names[line.substituteFor] ?? line.substituteFor}</span
					>{/if}
			</div>
		{/if}
		<div class="why">
			<span class="tier"><i class="mark" aria-hidden="true"></i>{tierWord}</span>
			{#each line.reasons as r (r)}<span class="reason">{reasonText(r)}</span>{/each}
		</div>
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
	.figs {
		display: grid;
		grid-template-columns: 1fr auto auto;
		gap: 16px;
		align-items: baseline;
		margin-top: 4px;
	}
	.qty,
	.money {
		font-family: var(--mono);
		font-size: 18px;
		text-align: right;
	}
	.qty small {
		color: var(--muted);
		font-size: 15px;
	}
	.money {
		color: var(--muted);
		min-width: 6.5ch;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		margin-top: 2px;
		color: var(--muted);
		font-size: 16px;
	}
	.pid {
		font-family: var(--mono);
		color: var(--faint);
	}
	.sub {
		color: var(--text);
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
