<script lang="ts">
	/**
	 * A make-in-house strategy: one preparation whose ingredient lines are all required (AND), not five separate
	 * products. It counts as covered only when every ingredient is; the bracket and the count say so. Ingredient
	 * supply alone does not establish kitchen labour or equipment (VOCABULARY), and the card says that too.
	 */
	import type { Snippet } from 'svelte';
	import { ChefHat } from '@lucide/svelte';
	import type { Line } from '$lib/core/contracts';
	import { supplyOf } from '$lib/core/rank/rank';
	import { money } from './format';
	import AgentMark from './AgentMark.svelte';

	interface Props {
		/** What is being made, e.g. the dish name. */
		title: string;
		lines: Line[];
		/** Renders one ingredient line (the kitchen passes a LineRow with its Why handler). */
		row: Snippet<[Line]>;
		/** The product the whole recipe replaces, said once for the group (not on every ingredient). */
		replaces?: { name: string; because: string };
		/** An agent proposed this recipe. */
		by?: 'kitchen_agent' | 'external_agent';
	}
	let { title, lines, row, replaces, by }: Props = $props();

	/**
	 * An ingredient is ready when it can be bought and Valio states its stock: the line's own supply certainty from
	 * core (its view's unknown-stock cover, else supplyOf on its offer), never a rule of this card's own.
	 */
	const blocked = (l: Line) =>
		l.state === 'rejected' ||
		l.state === 'unorderable' ||
		l.view?.blockedReason?.detail === 'stock' ||
		l.view?.blockedReason?.detail === 'qty';
	const unstated = (l: Line) =>
		l.view ? l.view.unknownStockCover.value > 0 : supplyOf(l.offer) === 'unknown_stock';
	const ready = (l: Line) => !blocked(l) && !unstated(l);
	const n = $derived(lines.length);
	const ok = $derived(lines.filter(ready).length);
	const quiet = $derived(lines.filter((l) => !blocked(l) && unstated(l)).length);
	const cents = $derived(lines.reduce((s, l) => s + (l.lineCents ?? 0), 0));
</script>

<section
	class="rounded-lg border border-rule bg-sheet px-3 py-2.5"
	aria-label="Make in house: {title}"
>
	<header class="flex items-baseline justify-between gap-3">
		<p class="flex items-center gap-1.5 text-body font-semibold text-ink">
			<ChefHat size={15} class="text-accent" aria-hidden="true" /> Make in house · {title}
		</p>
		<p class="mono text-body text-ink">{money(cents)}</p>
	</header>
	{#if replaces}
		<p class="mt-0.5 text-meta leading-snug text-ink-2">
			Replaces <span class="text-ink">{replaces.name}</span>: {replaces.because}{#if by}
				&nbsp;· <AgentMark {by} />{/if}
		</p>
	{/if}
	<p class="mt-0.5 text-meta text-ink-2">
		Needs all {n} ingredients.
		<span class={ok === n ? 'text-ink' : 'font-medium text-signoff'}
			>{ok === n
				? `All ${n} have a stated stock.`
				: quiet
					? `Valio doesn't state stock for ${quiet} of ${n}.`
					: `${ok} of ${n} can be bought.`}</span
		>
	</p>
	<div class="mt-2 grid grid-cols-[14px_minmax(0,1fr)] gap-x-2">
		<div
			class="relative row-span-full rounded-l-[3px] border-y-2 border-l-2 border-ink-3"
			aria-hidden="true"
		>
			<span
				class="absolute top-1/2 -left-[9px] -translate-y-1/2 -rotate-90 bg-sheet px-0.5 text-micro font-semibold text-ink-3"
				>AND</span
			>
		</div>
		<ul class="space-y-1.5">
			{#each lines as l (l.id)}<li>{@render row(l)}</li>{/each}
		</ul>
	</div>
	<p class="mt-2 text-micro text-ink-3">
		Covered only when every ingredient is. Labour and equipment are not checked.
	</p>
</section>
