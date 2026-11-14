<script lang="ts" module>
	export interface ReceiptView {
		receiptId: string;
		orderId: string;
		key: string;
		totalCents: number;
		lines: number;
		/** Lines the supplier has not confirmed a quantity for (Terminal). */
		awaiting: number;
		/** This receipt came back for a repeated key. */
		replayed?: boolean;
	}
</script>

<script lang="ts">
	/**
	 * What an order did: lines ordered, supplier confirmed vs awaiting the supplier (D10: awaiting is not cover),
	 * and the idempotent retry: the same key returns the same receipt, never a second order.
	 */
	import { Lock, RotateCcw } from '@lucide/svelte';
	import { money } from './format';

	interface Props {
		receipt: ReceiptView;
		/** Orders on this plan: stays 1 after a retry. */
		orders: number;
		busy?: boolean;
		onretry?: () => void;
	}
	let { receipt: r, orders, busy = false, onretry }: Props = $props();
	const confirmed = $derived(r.lines - r.awaiting);
</script>

<section
	class="rounded-lg border border-sup-confirmed/40 bg-sheet px-3.5 py-3 text-meta"
	aria-label="Receipt {r.receiptId}"
>
	<header class="flex items-baseline justify-between gap-2">
		<p class="flex items-center gap-1.5 text-body font-semibold text-ink">
			<Lock size={14} aria-hidden="true" /> Ordered · receipt {r.receiptId}
		</p>
		<p class="mono text-body font-medium text-ink">{money(r.totalCents)}</p>
	</header>
	<ul class="mt-2 grid gap-1">
		<li class="flex items-center gap-2 text-ink">
			<span class="h-2.5 w-4 rounded-[2px] supply-confirmed" aria-hidden="true"></span>
			<span class="mono">{confirmed}</span>
			{confirmed === 1 ? 'line' : 'lines'} supplier confirmed
		</li>
		{#if r.awaiting > 0}
			<li class="flex items-center gap-2 text-ink">
				<span class="h-2.5 w-4 rounded-[2px] supply-awaiting" aria-hidden="true"></span>
				<span class="mono">{r.awaiting}</span>
				awaiting the supplier: no quantity confirmed, not counted as cover
			</li>
		{/if}
	</ul>
	<p class="mt-1.5 text-ink-3">The supplier is simulated; nothing is sent to Valio.</p>
	{#if r.replayed}
		<p class="mt-2 font-medium text-ink">
			Same key, same receipt. No second order: {orders}
			{orders === 1 ? 'order' : 'orders'} on this plan.
		</p>
	{/if}
	{#if onretry}
		<button
			type="button"
			class="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-rule-strong px-2.5 font-medium text-ink hover:bg-well disabled:opacity-50"
			disabled={busy}
			onclick={onretry}
		>
			<RotateCcw size={13} aria-hidden="true" /> Send the same order again
		</button>
	{/if}
	<p class="sys-only mono mt-1.5 truncate text-micro text-ink-3" title={r.key}>
		{r.orderId} · idempotency key {r.key}
	</p>
</section>
