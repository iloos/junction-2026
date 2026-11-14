<script lang="ts">
	import { CornerDownLeft } from '@lucide/svelte';
	import type { ParsedItemView, ReqUnit } from './types';

	/**
	 * One item of the reading, edited in place: amount, unit and the words of what to buy. Saving re-runs the lookup
	 * and order for the request as edited; the words are not read again.
	 */
	interface Props {
		item: ParsedItemView;
		busy: boolean;
		onsave: (item: ParsedItemView) => void;
		oncancel: () => void;
	}
	let { item, busy, onsave, oncancel }: Props = $props();
	const UNITS: [ReqUnit, string][] = [
		['kg', 'kg'],
		['l', 'l'],
		['pcs', 'pcs'],
		['case', 'cases'],
		['sales', 'packs']
	];
	// Seeded once from the item being edited; the form owns the values after that.
	const start = (() => item)();
	let qty = $state(start.qty === null ? '' : String(start.qty));
	let unit = $state<ReqUnit>(start.unit ?? 'kg');
	let what = $state(start.product ?? start.query);
	const value = $derived(Number(qty.replace(',', '.').replace(/\s/g, '')));
	const valid = $derived(Number.isFinite(value) && value > 0 && value <= 1e6 && what.trim() !== '');

	function save(e: SubmitEvent) {
		e.preventDefault();
		if (!valid) return;
		const w = what.trim();
		const same = w === (item.product ?? item.query);
		onsave({
			...item,
			qty: value,
			unit,
			// New words are searched as typed; unchanged words keep the reading's product and searches.
			...(same ? {} : { query: w, product: null, search: [w], text: w })
		});
	}
</script>

<form
	class="flex flex-wrap items-center gap-1.5 rounded-md border border-accent/40 bg-sheet p-1.5"
	onsubmit={save}
	data-testid="item-edit"
>
	<input
		bind:value={qty}
		inputmode="decimal"
		aria-label="Amount"
		class="num h-9 w-24 rounded-md border border-rule-strong px-2 text-body"
	/>
	<select
		bind:value={unit}
		aria-label="Unit"
		class="h-9 rounded-md border border-rule-strong bg-sheet px-2 text-body"
	>
		{#each UNITS as [u, label] (u)}<option value={u}>{label}</option>{/each}
	</select>
	<input
		bind:value={what}
		aria-label="What to buy"
		class="h-9 min-w-[8rem] flex-1 rounded-md border border-rule-strong px-2 text-body"
	/>
	<button
		type="submit"
		disabled={busy || !valid}
		class="inline-flex h-9 items-center gap-1 rounded-md bg-accent px-3 text-body font-medium text-sheet disabled:opacity-40"
		>Update <CornerDownLeft size={14} aria-hidden="true" /></button
	>
	<button type="button" class="h-9 px-2 text-body text-ink-2" onclick={oncancel}>Cancel</button>
</form>
