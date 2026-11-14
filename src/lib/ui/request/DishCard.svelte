<script lang="ts">
	import { ChefHat, Package, Check, CircleHelp, OctagonX, Lightbulb } from '@lucide/svelte';
	import { money, num, readableName } from '$lib/ui/format';
	import ProductToken from '$lib/ui/ProductToken.svelte';
	import type { DishInterpretation } from './types';

	/**
	 * A dish with a count: how the words were read (portions, the meat ratio as shares), then the two ways to serve
	 * it side by side, ready-made or cooked from raw, with cost per portion, lines, labour, stock certainty and
	 * whether it meets the request. The chosen one is what the lookup and order below hold; the other is one tap.
	 */
	interface Props {
		dish: DishInterpretation;
		choice: 'ready' | 'raw';
		/** Where the choice came from: the kitchen's rule, the chef's last choice, or this tap. */
		choiceFrom: string;
		busy: boolean;
		onchoose: (kind: 'ready' | 'raw') => void;
		onportions: (n: number) => void;
		/** The count was packs, not portions. */
		onpacks: () => void;
	}
	let { dish, choice, choiceFrom, busy, onchoose, onportions, onpacks }: Props = $props();
	let editing = $state(false);
	let portions = $state('');
	const value = $derived(Number(portions.replace(/[\s,]/g, '')));
</script>

<section
	class="mt-3 rounded-lg border border-accent/30 bg-accent-wash/50 px-3 py-2.5"
	data-testid="dish"
>
	<div class="flex flex-wrap items-baseline gap-x-2 text-heading">
		<ChefHat size={17} class="self-center text-accent" aria-hidden="true" />
		{#if editing}
			<form
				class="inline-flex items-center gap-1.5"
				onsubmit={(e) => {
					e.preventDefault();
					if (Number.isInteger(value) && value > 0) {
						editing = false;
						onportions(value);
					}
				}}
			>
				<input
					bind:value={portions}
					inputmode="numeric"
					aria-label="Portions"
					class="num h-8 w-24 rounded-md border border-rule-strong bg-sheet px-2 text-body"
				/>
				<button
					type="submit"
					disabled={busy}
					class="h-8 rounded-md bg-accent px-2.5 text-body font-medium text-sheet disabled:opacity-40"
					>Use</button
				>
			</form>
		{:else}
			<button
				type="button"
				class="num rounded border-b border-dashed border-ink-3 font-semibold hover:border-accent"
				disabled={busy}
				title="Change the number of portions"
				onclick={() => {
					portions = String(dish.portions);
					editing = true;
				}}>{num(dish.portions)} portions</button
			>
		{/if}
		<span>of {dish.dish.name}</span>
		<button
			type="button"
			class="text-meta text-ink-3 underline hover:text-ink"
			disabled={busy}
			onclick={onpacks}>No, {num(dish.portions)} packs</button
		>
	</div>
	<ol class="mt-1.5 space-y-0.5 text-body text-ink-2" aria-label="How the request was read">
		{#each dish.reasoning as r (r)}
			<li class="flex gap-2">
				<Lightbulb size={14} class="mt-0.5 shrink-0 text-accent" aria-hidden="true" />{r}
			</li>
		{/each}
	</ol>

	<div class="mt-3 grid gap-2 sm:grid-cols-2" aria-label="How to serve it">
		{#each dish.options as o (o.kind)}
			{@const on = o.kind === choice}
			<article
				class="flex flex-col rounded-lg border bg-sheet px-3 py-2.5 {on
					? 'border-accent ring-1 ring-accent/40'
					: 'border-rule-strong'}"
				data-testid="dish-{o.kind}"
			>
				<header class="flex items-center gap-1.5 text-body font-medium">
					{#if o.kind === 'raw'}<ChefHat size={15} aria-hidden="true" />{:else}<Package
							size={15}
							aria-hidden="true"
						/>{/if}
					{o.title}
					{#if on}<span class="ml-auto rounded bg-accent px-1.5 text-micro text-sheet"
							>ordering this</span
						>{/if}
				</header>
				<p class="num mt-1 text-title font-semibold">
					{o.perPortionCents === null ? '—' : money(o.perPortionCents)}
					<span class="text-meta font-normal text-ink-2"
						>per portion{o.complete ? '' : ', priced lines only'}</span
					>
				</p>
				<dl class="mt-1 grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-0.5 text-meta">
					<dt class="text-ink-3">Total</dt>
					<dd class="num">
						{money(o.totalCents)}{o.complete ? '' : ' so far'} · {o.lineCount} line{o.lineCount ===
						1
							? ''
							: 's'}
					</dd>
					<dt class="text-ink-3">Work</dt>
					<dd>{o.labour}</dd>
					<dt class="text-ink-3">Certainty</dt>
					<dd>{o.certainty}</dd>
					<dt class="text-ink-3">Request</dt>
					<dd
						class="flex gap-1 {o.meets.state === 'yes'
							? 'text-accent-ink'
							: o.meets.state === 'no'
								? 'text-out'
								: 'text-signoff'}"
					>
						{#if o.meets.state === 'yes'}<Check
								size={13}
								class="mt-0.5 shrink-0"
								aria-hidden="true"
							/>{:else if o.meets.state === 'no'}<OctagonX
								size={13}
								class="mt-0.5 shrink-0"
								aria-hidden="true"
							/>{:else}<CircleHelp size={13} class="mt-0.5 shrink-0" aria-hidden="true" />{/if}
						<span
							>{o.meets.state === 'yes'
								? 'meets it'
								: o.meets.state === 'no'
									? 'does not meet it'
									: 'not shown to meet it'}: {o.meets.why}</span
						>
					</dd>
				</dl>
				<details class="mt-1.5 text-meta">
					<summary class="cursor-pointer text-ink-2">What it buys</summary>
					<ul class="mt-1 space-y-1">
						{#each o.lines as l (l.key)}
							<li>
								<span class="text-ink">{l.label}</span>
								<span class="num text-ink-2">· {num(l.kg, 1)} kg</span>
								{#if l.product}<span class="block text-ink-2"
										><ProductToken
											productId={l.product.productId}
											name={l.product.name}
											qty={l.salesQty !== null ? { count: l.salesQty } : undefined}
										/> · {money(l.lineCents)}{l.stock ? ` · ${l.stock}` : ''}</span
									>{:else}<span class="block text-out">no product: {l.missing}</span>{/if}
								{#each l.filtered as f (f.name)}<span class="block text-ink-3"
										>Turned down {readableName(f.name)}: {f.reason}</span
									>{/each}
							</li>
						{/each}
					</ul>
					<p class="mt-1 text-ink-3">Source: {o.source}</p>
				</details>
				{#if !on}
					<button
						type="button"
						disabled={busy}
						onclick={() => onchoose(o.kind)}
						class="mt-auto self-start pt-2 text-body font-medium text-accent-ink underline disabled:opacity-40"
						>Order this instead</button
					>
				{:else}
					<p class="mt-auto pt-2 text-meta text-ink-3">
						{choiceFrom}
					</p>
				{/if}
			</article>
		{/each}
	</div>
</section>
