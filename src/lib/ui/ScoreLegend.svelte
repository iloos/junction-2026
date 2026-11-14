<script lang="ts">
	import type { Weights } from '$lib/core/contracts';

	let { weights }: { weights: Weights } = $props();
	const ORDER = ['reliability', 'price', 'finnish', 'carbon', 'organic'] as const;
	const LABEL: Record<string, string> = {
		reliability: 'Reliability',
		price: 'Price',
		finnish: 'Finnish',
		carbon: 'Carbon',
		organic: 'Organic'
	};
	const sum = $derived(ORDER.reduce((s, k) => s + (weights[k] ?? 0), 0) || 1);
</script>

<ul class="flex flex-wrap gap-x-3 gap-y-1 text-meta text-ink-2">
	{#each ORDER.filter((k) => (weights[k] ?? 0) > 0) as k (k)}
		<li class="inline-flex items-center gap-1.5">
			<span class="size-2 rounded-full" style="background: var(--color-c-{k})"></span>
			{LABEL[k]} <span class="mono text-ink">{Math.round(((weights[k] ?? 0) / sum) * 100)}%</span>
		</li>
	{/each}
</ul>
