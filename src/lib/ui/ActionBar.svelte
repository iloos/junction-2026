<script lang="ts">
	/**
	 * The plan's one action bar (D29): sticky at the top on a desktop, at the bottom on a phone. It says what waits and
	 * carries the only bulk actions: "Accept all N · €X" for every line that may be accepted together, a note for the
	 * sign-offs (decided one by one in their group), and "Order K lines now · €Y", primary once nothing waits. After an
	 * order it says what was ordered.
	 */
	import { CircleCheck, Info, LoaderCircle } from '@lucide/svelte';
	import { money } from './format';

	let {
		waiting,
		acceptAll,
		signOff,
		order,
		ordered = null,
		due = null,
		busy = false,
		locked = false,
		note,
		blocked = null
	}: {
		/** Lines waiting for the chef, sign-offs included. */
		waiting: number;
		/** `includes`: what accepting all takes in that a reader might not expect ("the Christmas ham swap"). */
		acceptAll: { count: number; cents: number; includes?: string | null; onaccept: () => void };
		signOff: number;
		order: { lines: number; cents: number; onorder: () => void };
		ordered?: { lines: number; cents: number } | null;
		/** "Tue 8 Dec, 15:00": when the decisions are due. */
		due?: string | null;
		busy?: boolean;
		/** Viewing only (someone else's room store): the buttons show, disabled, with no spinner. */
		locked?: boolean;
		/** The price and stock note, behind ⓘ. */
		note?: string;
		/** Nothing can be ordered (e.g. the cut-off passed): said instead of "inside your rules". */
		blocked?: string | null;
	} = $props();
</script>

<div
	data-testid="action-bar"
	class="z-30 flex flex-wrap items-center gap-x-3 gap-y-2 border-rule bg-sheet/95 px-4 py-2.5 backdrop-blur max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:border-t max-lg:shadow-[0_-8px_24px_-12px_oklch(0.2_0.02_255/0.35)] lg:sticky lg:top-0 lg:rounded-lg lg:border"
	role="region"
	aria-label="Plan actions"
>
	<p class="min-w-0 flex-1 text-body text-ink">
		{#if waiting}
			<span class="font-medium"
				>{waiting} {waiting === 1 ? 'line waits' : 'lines wait'} for you</span
			>{#if due}<span class="text-ink-2">&nbsp;before {due}</span>{/if}{#if signOff}<span
					class="text-signoff"
					>&nbsp;· {signOff} {signOff === 1 ? 'needs' : 'need'} your sign-off one by one</span
				>{/if}
		{:else if ordered && !order.lines}
			<span class="inline-flex items-center gap-1.5 font-medium"
				><CircleCheck size={16} class="text-ok" aria-hidden="true" />Ordered · {ordered.lines}
				{ordered.lines === 1 ? 'line' : 'lines'}</span
			>
			<span class="mono text-ink-2"> · {money(ordered.cents)}</span>
		{:else if blocked}
			<span class="text-ink">{blocked}</span>
		{:else}
			<span class="text-ink-2">Nothing waits for you: every line is inside your rules.</span>
		{/if}
		{#if note}
			<span class="ml-1 inline-flex translate-y-0.5 text-ink-3" title={note}
				><Info size={14} aria-label={note} /></span
			>
		{/if}
	</p>
	<span class="flex flex-wrap gap-2">
		{#if busy && (acceptAll.count || order.lines)}
			<!-- While the plan updates, the buttons wait: said, with a spinner, so a press in the wait isn't lost. -->
			<span
				class="inline-flex h-10 items-center gap-2 rounded-md border border-rule-strong px-4 text-body text-ink-2"
				role="status"
				><LoaderCircle size={15} class="animate-spin" aria-hidden="true" />Updating the plan…</span
			>
		{:else if acceptAll.count}
			<button
				type="button"
				class="inline-block min-h-10 rounded-md bg-accent px-4 py-2 text-left text-body font-medium text-sheet hover:bg-accent-ink disabled:opacity-50 sm:inline-flex sm:items-center sm:py-1.5 sm:whitespace-nowrap"
				disabled={busy || locked}
				onclick={acceptAll.onaccept}
				>Accept all {acceptAll.count}{acceptAll.includes ? `, incl. ${acceptAll.includes}` : ''} ·
				<span class="mono ml-1">{money(acceptAll.cents)}</span></button
			>
		{/if}
		{#if order.lines && !busy}
			<button
				type="button"
				class="inline-flex h-10 items-center rounded-md px-4 text-body font-medium whitespace-nowrap disabled:opacity-50 {waiting
					? 'border border-accent text-accent-ink hover:bg-accent-wash'
					: 'bg-accent text-sheet hover:bg-accent-ink'}"
				disabled={busy || locked}
				onclick={order.onorder}
				>Order {order.lines}
				{order.lines === 1 ? 'line' : 'lines'} now ·
				<span class="mono ml-1">{money(order.cents)}</span></button
			>
		{/if}
	</span>
</div>
