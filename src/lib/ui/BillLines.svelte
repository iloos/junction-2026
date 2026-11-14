<script lang="ts" module>
	/** One grid for every bill in the Decide and Order panels: name | qty | price, the amounts in one column. */
	export const BILL_COLS = 'grid grid-cols-[minmax(0,1fr)_auto_5.75rem] gap-x-3';
	export interface BillRow {
		id: string;
		name: string;
		/** Already worded ("13 pcs", "4 kg"). */
		qty: string;
		/** The product the row buys: its name opens the product card. */
		productId?: string;
		cents?: number | null;
	}
</script>

<script lang="ts">
	/**
	 * A short bill: a name that truncates (the whole name on hover), the quantity and the price right-aligned in
	 * tabular figures, long lists folded to the first rows and "and N more".
	 */
	import { money } from './format';
	import ProductToken from './ProductToken.svelte';

	let {
		rows,
		max = 3,
		label,
		deliverBy
	}: {
		rows: BillRow[];
		/** Rows shown before "and N more". */
		max?: number;
		/** Names the list for assistive tech. */
		label?: string;
		/** The delivery date the product cards price for. */
		deliverBy?: string;
	} = $props();

	let all = $state(false);
	const shown = $derived(all || rows.length <= max + 1 ? rows : rows.slice(0, max));
	const hidden = $derived(rows.length - shown.length);
</script>

<ul class="text-meta" aria-label={label}>
	{#each shown as r (r.id)}
		<li class="{BILL_COLS} items-baseline py-0.5">
			{#if r.productId}
				<span class="min-w-0 text-ink-2"
					><ProductToken productId={r.productId} name={r.name} {deliverBy} /></span
				>
			{:else}
				<span class="min-w-0 truncate text-ink-2" title={r.name}>{r.name}</span>
			{/if}
			<span class="mono text-right whitespace-nowrap text-ink-3 tabular-nums">{r.qty}</span>
			<span class="mono text-right text-ink tabular-nums"
				>{r.cents != null ? money(r.cents) : ''}</span
			>
		</li>
	{/each}
	{#if hidden > 0}
		<li>
			<button
				type="button"
				class="py-0.5 text-ink-2 underline underline-offset-2 hover:text-ink"
				onclick={() => (all = true)}>and {hidden} more</button
			>
		</li>
	{/if}
</ul>
