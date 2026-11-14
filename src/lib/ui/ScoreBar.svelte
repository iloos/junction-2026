<script lang="ts">
	import type { ScoreBreakdown } from '$lib/core/contracts';

	let { score, max = 1 }: { score: ScoreBreakdown; max?: number } = $props();

	const ORDER = ['reliability', 'price', 'finnish', 'carbon', 'organic'] as const;
	const LABEL: Record<string, string> = {
		reliability: 'Reliability',
		price: 'Price',
		finnish: 'Finnish',
		carbon: 'Carbon',
		organic: 'Organic'
	};
	const parts = $derived(
		ORDER.filter((k) => score.components[k] && score.components[k].weight > 0).map((k) => ({
			key: k,
			value: score.components[k].utility * score.components[k].weight,
			utility: score.components[k].utility,
			weight: score.components[k].weight
		}))
	);
	const title = $derived(
		parts
			.map(
				(p) =>
					`${LABEL[p.key]}: ${p.utility.toFixed(2)} × ${Math.round(p.weight * 100)}% = ${p.value.toFixed(2)}`
			)
			.join('\n') + `\nTotal ${score.total.toFixed(2)}`
	);
</script>

<div class="flex items-center gap-2" {title}>
	<div
		class="relative flex h-2 w-28 overflow-hidden rounded-full bg-well"
		role="img"
		aria-label={title}
	>
		{#each parts as p (p.key)}
			<span
				class="h-full transition-[width] duration-300 ease-out"
				style="width: {(p.value / max) * 100}%; background: var(--color-c-{p.key})"
			></span>
		{/each}
	</div>
	<span class="mono w-8 text-right text-meta text-ink">{score.total.toFixed(2)}</span>
</div>
