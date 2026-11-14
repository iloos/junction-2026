<script lang="ts">
	/**
	 * A need's coverage as a ruler: the partition of the required amount, most certain first, up to the "needed"
	 * mark; whatever packs add beyond the need spills past the mark, hatched. Data: FulfilmentView (server-derived).
	 */
	import type { FulfilmentView } from '$lib/core/contracts';
	import { BUCKETS, EXCESS, coverageHeadline, coverageSentence, segments } from './coverage';

	let { f, compact = false }: { f: FulfilmentView; compact?: boolean } = $props();

	const geo = $derived(segments(f));
	const head = $derived(coverageHeadline(f));
	const sentence = $derived(coverageSentence(f));
	const hint = (k: string) =>
		k === 'excess' ? EXCESS.hint : (BUCKETS.find((b) => b.key === k)?.hint ?? '');
</script>

<div class="cov" class:compact>
	<div class="track" role="img" aria-label={sentence}>
		{#each geo.parts as s (s.key)}
			<span
				class="seg {s.key}"
				style="width: {(s.width * 100).toFixed(2)}%"
				title="{s.label}: {s.value} {f.required.unit} ({hint(s.key)})"
			></span>
		{/each}
		<span class="mark" style="left: {(geo.requiredAt * 100).toFixed(2)}%" aria-hidden="true"></span>
	</div>
	{#if !compact}
		<p class="head tone-{head.tone}">{head.text}</p>
	{/if}
</div>

<style>
	.cov {
		display: grid;
		gap: 3px;
		min-width: 0;
	}
	.track {
		position: relative;
		display: flex;
		height: 8px;
		border-radius: 2px;
		background: var(--color-well);
		box-shadow: inset 0 0 0 1px var(--color-rule);
	}
	.compact .track {
		height: 6px;
	}
	.seg {
		height: 100%;
		transition: width 300ms ease;
	}
	.seg + .seg {
		box-shadow: inset 1px 0 0 var(--color-sheet);
	}
	.supplierConfirmed {
		background: var(--color-ok);
	}
	.awaitingSupplier {
		background: repeating-linear-gradient(
			-45deg,
			var(--color-ok) 0 3px,
			color-mix(in oklch, var(--color-ok) 35%, var(--color-sheet)) 3px 6px
		);
	}
	.plannedKnown {
		background: var(--color-accent);
	}
	.plannedUnknown {
		background: repeating-linear-gradient(
			-45deg,
			var(--color-signoff) 0 3px,
			var(--color-signoff-wash) 3px 6px
		);
	}
	.unresolved {
		background: var(--color-out-wash);
		box-shadow: inset 0 0 0 1px var(--color-out);
	}
	.excess {
		background: repeating-linear-gradient(
			90deg,
			var(--color-rule-strong) 0 1px,
			transparent 1px 4px
		);
	}
	.mark {
		position: absolute;
		top: -3px;
		bottom: -3px;
		width: 2px;
		margin-left: -1px;
		background: var(--color-ink);
	}
	.head {
		font-size: 11.5px;
		line-height: 1.3;
		color: var(--color-ink-3);
	}
	.tone-unresolved {
		color: var(--color-out);
	}
	.tone-plannedUnknown {
		color: var(--color-signoff);
	}
	@media (prefers-reduced-motion: reduce) {
		.seg {
			transition: none;
		}
	}
</style>
