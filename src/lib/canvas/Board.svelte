<script lang="ts">
	import {
		ChevronDown,
		ChevronRight,
		CircleCheck,
		CircleHelp,
		TriangleAlert
	} from '@lucide/svelte';
	import { qty } from '$lib/ui/format';
	import ProductRow from './ProductRow.svelte';
	import DietMarks from '$lib/ui/DietMarks.svelte';
	import { rollUp } from '$lib/ui/diet';
	import type { CanvasGroup, CanvasItem } from './model';

	let {
		groups,
		selected,
		onselect,
		compact = false,
		deliverBy,
		changed
	}: {
		groups: CanvasGroup[];
		selected: string | null;
		onselect: (id: string) => void;
		compact?: boolean;
		deliverBy?: string;
		changed?: ReadonlySet<string>;
	} = $props();
	let folded = $state<Record<string, boolean>>({});
	const words = (item: CanvasItem) =>
		item.status === 'shortfall' || item.status === 'partial'
			? 'Shortfall'
			: item.currentLines.length && item.currentLines.every((l) => l.state === 'committed')
				? 'Ordered'
				: item.status === 'unknown'
					? 'Supply unknown'
					: item.status === 'rescued'
						? 'Replacement planned'
						: 'Planned';
</script>

<div class:compact class="board" role="region" aria-label="Recipe and ingredient canvas">
	{#each groups as group (group.id)}
		<section class="recipe" aria-label={group.label}>
			<button
				class="recipe-heading"
				aria-expanded={!folded[group.id]}
				onclick={() => (folded = { ...folded, [group.id]: !folded[group.id] })}
			>
				{#if folded[group.id]}<ChevronRight size={16} />{:else}<ChevronDown size={16} />{/if}
				<span class="grow text-heading font-medium">{group.label}</span>
				<span class="mono text-meta text-ink-3">{group.items.length}</span>
			</button>
			{#if !folded[group.id]}
				<div class="ingredient-list">
					{#each group.items as item (item.id)}
						<article
							class="ingredient"
							class:chosen={selected === item.id}
							class:landed={item.lines.some((line) => changed?.has(line.id))}
							aria-label={item.label}
						>
							<button
								class="ingredient-select"
								aria-pressed={selected === item.id}
								onclick={() => onselect(item.id)}
								data-need-id={item.id}
							>
								<span class="flex items-start gap-2">
									{#if item.status === 'shortfall' || item.status === 'partial'}<TriangleAlert
											class="mt-0.5 shrink-0 text-out"
											size={16}
										/>{:else if item.status === 'unknown'}<CircleHelp
											class="mt-0.5 shrink-0 text-signoff"
											size={16}
										/>{:else}<CircleCheck class="mt-0.5 shrink-0 text-accent" size={16} />{/if}
									<span class="min-w-0 grow font-medium">{item.label}</span>
								</span>
								<span class="mt-2 flex flex-wrap items-center justify-between gap-2 text-meta">
									<span class="mono tabular-nums">{qty(item.amount.value, item.amount.unit)}</span>
									<span class="text-ink-2">{words(item)}</span>
								</span>
							</button>
							{#if !compact}
								<div class="ingredient-products">
									{#each item.currentLines as line (line.id)}
										<div
											class="mt-3 flex items-start justify-between gap-3 border-t border-rule pt-2 text-meta"
										>
											<ProductRow
												productId={line.productId}
												name={line.name}
												cents={line.lineCents}
												{deliverBy}
											/>
										</div>
									{/each}
									<div class="mt-2 flex flex-wrap gap-2">
										{#if item.currentLines.length}<DietMarks
												marks={rollUp(item.currentLines.map((line) => line.marks))}
											/>{/if}
									</div>
								</div>
							{/if}
						</article>
					{/each}
				</div>
			{/if}
		</section>
	{/each}
</div>

<style>
	.board {
		display: flex;
		align-items: flex-start;
		gap: 24px;
		overflow: auto;
		min-height: 520px;
		max-height: calc(100dvh - 260px);
		padding: 24px;
		background: var(--color-well);
		scrollbar-color: var(--color-rule-strong) transparent;
		scroll-padding: 24px;
	}
	.recipe {
		flex: 0 0 288px;
		min-width: 0;
	}
	.recipe-heading {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		text-align: left;
		padding: 0 0 12px;
		border-bottom: 1px solid var(--color-rule-strong);
	}
	.ingredient-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding-top: 16px;
	}
	.recipe:only-child {
		flex: 1;
	}
	.recipe:only-child .ingredient-list {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		align-items: start;
	}
	.compact .recipe:only-child .ingredient-list {
		grid-template-columns: repeat(auto-fill, minmax(216px, 1fr));
	}
	.ingredient {
		display: block;
		width: 100%;
		text-align: left;
		border: 1px solid var(--color-rule-strong);
		border-radius: 12px;
		background: var(--color-sheet);
		overflow-wrap: anywhere;
	}
	.ingredient-select {
		display: block;
		width: 100%;
		padding: 16px;
		text-align: left;
		border-radius: 12px;
		cursor: pointer;
	}
	.ingredient-select:hover {
		background: var(--color-accent-wash);
	}
	.ingredient-products {
		padding: 0 16px 16px;
	}
	.ingredient.chosen {
		border-color: var(--color-accent);
		background: var(--color-accent-wash);
		outline: 1px solid var(--color-accent);
	}
	button:focus-visible,
	.board:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 3px;
	}
	.compact .recipe {
		flex-basis: 248px;
	}
	@media (prefers-reduced-motion: reduce) {
		.ingredient.landed {
			animation: none;
		}
	}
	@media (max-width: 767px) {
		.recipe:only-child .ingredient-list,
		.compact .recipe:only-child .ingredient-list {
			grid-template-columns: 1fr;
		}
		.board {
			flex-direction: column;
			max-height: none;
			min-height: 0;
			padding: 16px;
			gap: 24px;
			overflow: visible;
		}
		.recipe,
		.compact .recipe {
			flex: none;
			width: 100%;
		}
	}
</style>
