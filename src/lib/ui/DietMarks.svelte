<script lang="ts">
	/**
	 * A line's, dish's or order's diet marks as a Finnish menu shows them (G, L, VL, M, VEG, VE), on one line; the
	 * allergens it contains and may contain are the tooltip. No allergen record shows as "?", never as free from.
	 */
	import { marksTitle, type Marks } from './diet';

	let { marks }: { marks: Marks } = $props();
	const title = $derived(marksTitle(marks));
	const gap = $derived(!marks.recorded);
</script>

{#if marks.codes.length || gap || marks.contains.length}
	<span
		class="inline-flex shrink-0 items-center gap-0.5 align-middle whitespace-nowrap"
		{title}
		aria-label="Diet: {title}"
	>
		{#each marks.codes as c (c)}
			<span
				class="mono rounded-[3px] border border-ok/45 px-1 text-micro leading-tight font-medium text-ok"
				>{c}</span
			>
		{/each}
		{#if gap}
			<span
				class="mono rounded-[3px] border border-dashed border-ink-3 px-1 text-micro leading-tight text-ink-3"
				>?</span
			>
		{/if}
	</span>
{/if}
