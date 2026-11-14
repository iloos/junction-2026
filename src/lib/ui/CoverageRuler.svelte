<script lang="ts">
	/**
	 * A need's coverage as a ruler: the partition of the required amount, most certain first, up to the "needed"
	 * mark; whatever packs add beyond the need spills past the mark, hatched. Data: FulfilmentView (server-derived).
	 */
	import type { FulfilmentView } from '$lib/core/contracts';
	import {
		BUCKETS,
		EXCESS,
		coverageHeadline,
		coverageSentence,
		needUnit,
		segments
	} from './coverage';

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
				class="seg {s.cls}"
				style="width: {(s.width * 100).toFixed(2)}%"
				title="{s.label}: {s.value} {needUnit(f)} ({hint(s.key)})"
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
		border-left: 1px solid var(--color-sheet);
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
		font-size: var(--text-micro);
		line-height: var(--text-micro--line-height);
		color: var(--color-ink-3);
	}
	.tone-unresolved {
		color: var(--color-sup-missing);
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
