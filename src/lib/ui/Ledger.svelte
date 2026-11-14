<script lang="ts">
	/**
	 * "Your kitchen's week, handled": the Kitchen's first read. What needs you (one row, one action each), what your
	 * agent did and why, and what is coming. Rows are the one Row primitive; a live shortage re-plan lands at the top
	 * of what the agent did and flashes.
	 */
	import {
		CalendarClock,
		CircleAlert,
		Hand,
		PackageCheck,
		Repeat,
		Sparkles,
		Truck
	} from '@lucide/svelte';
	import Row from './Row.svelte';
	import type { Ledger, LedgerEntry, LedgerKind } from './ledger';

	let {
		ledger,
		ondecide,
		onorder,
		busy = false
	}: {
		ledger: Ledger;
		ondecide: (planId: string) => void;
		onorder: (planId: string) => void;
		busy?: boolean;
	} = $props();

	const ICON: Record<LedgerKind, typeof Hand> = {
		decide: Hand,
		order: PackageCheck,
		swap: Repeat,
		shortage: CircleAlert,
		ordered: PackageCheck,
		planned: Sparkles,
		delivery: Truck
	};
	const TONE: Record<LedgerKind, string> = {
		decide: 'text-signoff',
		order: 'text-accent',
		swap: 'text-accent',
		shortage: 'text-out',
		ordered: 'text-ok',
		planned: 'text-ink-3',
		delivery: 'text-ink-3'
	};
	const nothing = $derived(!ledger.needsYou.length && !ledger.done.length && !ledger.coming.length);
</script>

{#snippet entry(e: LedgerEntry)}
	{@const Icon = ICON[e.kind]}
	<Row
		icon
		value={e.value ?? null}
		flash={e.fresh}
		class="border-t border-rule/60 first:border-t-0"
	>
		{#snippet lead()}<Icon
				size={16}
				class="translate-y-0.5 {TONE[e.kind]}"
				aria-hidden="true"
			/>{/snippet}
		<span class="text-ink">{e.text}</span>
		{#snippet sub()}{#if e.why}{e.why}{/if}{/snippet}
		{#snippet end()}
			{#if e.kind === 'decide' && e.planId}
				<button
					type="button"
					class="inline-flex h-8 items-center rounded-md border border-signoff/60 bg-signoff-wash px-3 text-meta font-medium text-ink hover:border-signoff"
					onclick={() => ondecide(e.planId!)}>Decide</button
				>
			{:else if e.kind === 'order' && e.planId}
				<button
					type="button"
					class="inline-flex h-8 items-center rounded-md bg-accent px-3 text-meta font-medium text-sheet hover:bg-accent-ink disabled:opacity-50"
					disabled={busy}
					onclick={() => onorder(e.planId!)}>Order</button
				>
			{/if}
		{/snippet}
	</Row>
{/snippet}

{#snippet group(title: string, entries: LedgerEntry[], Icon: typeof Hand)}
	{#if entries.length}
		<section aria-label={title}>
			<h3
				class="flex items-center gap-1.5 border-t border-rule bg-paper/60 px-3 py-1.5 text-meta font-medium text-ink-2"
			>
				<Icon size={13} aria-hidden="true" />{title}
			</h3>
			<ul>
				{#each entries as e (e.id)}{@render entry(e)}{/each}
			</ul>
		</section>
	{/if}
{/snippet}

<section class="overflow-hidden rounded-lg border border-rule bg-sheet" aria-labelledby="ledger-h">
	<header class="px-3 py-2.5">
		<h2 id="ledger-h" class="text-heading font-semibold text-ink">Your kitchen's week, handled</h2>
		<p class="text-meta text-ink-2">
			Your agent buys for this kitchen under your rules. This is what it did and what it needs from
			you.
		</p>
	</header>
	{#if nothing}
		<p class="border-t border-rule px-3 py-3 text-body text-ink-2">
			Nothing yet this week. Ask the agent, or plan a usual order.
		</p>
	{:else}
		{@render group(
			ledger.needsYou.length === 1 ? 'Needs you' : `Needs you · ${ledger.needsYou.length}`,
			ledger.needsYou,
			Hand
		)}
		{@render group('Done by your agent', ledger.done, Sparkles)}
		{@render group('Coming', ledger.coming, CalendarClock)}
	{/if}
</section>
