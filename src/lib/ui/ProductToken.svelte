<script lang="ts">
	/**
	 * A product as a line reads it: the quantity as its own chip ("10 × 1 l", "2.38 kg"), then the product's readable
	 * name and its diet marks. Click or tap opens the product card (a popover; a bottom sheet on a phone): pack, price
	 * ex VAT, availability in words, allergens and diet marks, origin, Valio's own substitutes and the public Valio
	 * Aimo listing when one is confirmed. Raw ids only with the System layer on.
	 */
	import { Dialog, Popover } from 'bits-ui';
	import { ExternalLink, X } from '@lucide/svelte';
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import DietMarks from './DietMarks.svelte';
	import { marksOf, type Marks } from './diet';
	import { money, readableName, storyTime } from './format';
	import { loadCard, qtyText, type ProductCard } from './product-card';
	import { useShell } from './shell/shell.svelte';

	interface Props {
		productId: string;
		/** The catalogue name (Valio's nameFi); shown through readableName. */
		name: string;
		/** The normalised short name, when the page has it. */
		short?: string | null;
		/** What the line buys: a count of packs ("10 × 1 l") or an amount ("2.38 kg"). Absent: name only. */
		qty?: { count: number; pack?: string } | { amount: number; unit: string };
		/** Diet marks the page already has; else the card's record fills them once opened. */
		marks?: Marks;
		/** Delivery date the card's price and availability are for (YYYY-MM-DD); default the scenario's today. */
		deliverBy?: string;
		/** A verified product photo the page already has (ProductListing.imageUrl); else the card's, once opened. */
		imageUrl?: string;
		/** Replaces the default diet mark (e.g. a page's own badge). */
		mark?: Snippet;
		/** Extra classes on the token. */
		class?: string;
		/** Let a long name wrap instead of truncating (rows that have the width to say it all). */
		wrap?: boolean;
	}
	let {
		productId,
		name,
		short,
		qty,
		marks,
		deliverBy,
		imageUrl,
		mark,
		class: cls = '',
		wrap = false
	}: Props = $props();

	const shell = useShell();
	const system = $derived(shell?.system ?? false);
	const offline = $derived(page.url.pathname.startsWith('/offline'));
	const label = $derived(readableName(name, short));

	let open = $state(false);
	let phase = $state<'idle' | 'loading' | 'error' | 'done'>('idle');
	let card = $state.raw<ProductCard | null>(null);
	let failure = $state('');
	$effect(() => {
		if (!open || offline || phase !== 'idle') return;
		phase = 'loading';
		loadCard(productId, deliverBy).then(
			(c) => {
				card = c;
				phase = 'done';
			},
			(e) => {
				failure = String(e?.message ?? e);
				phase = 'error';
			}
		);
	});
	const shownMarks = $derived(marks ?? (card ? marksOf(card.diet) : undefined));

	// A phone gets a bottom sheet; anything wider a popover beside the token.
	let narrow = $state(false);
	$effect(() => {
		const mq = window.matchMedia('(max-width: 640px)');
		narrow = mq.matches;
		const on = () => (narrow = mq.matches);
		mq.addEventListener('change', on);
		return () => mq.removeEventListener('change', on);
	});

	const AVAIL_TONE: Record<string, string> = {
		known: 'text-ok',
		unknown: 'text-ink-2',
		out: 'text-out',
		undeliverable: 'text-undeliv',
		blocked: 'text-out',
		none: 'text-ink-3'
	};
</script>

{#snippet token()}
	<!-- Only a photo the page passed: one that arrives with the card (opened later) would shift the row. Rows show
	     their photo in ProductThumb's fixed slot; the card shows it large. -->
	{#if imageUrl}<img
			src={imageUrl}
			alt=""
			loading="lazy"
			class="size-6 shrink-0 rounded-[4px] border border-rule bg-sheet object-contain"
		/>{/if}
	{#if qty}<span
			class="mono shrink-0 rounded-[5px] border border-rule bg-well px-1.5 py-px text-meta text-ink tabular-nums"
			>{qtyText(qty)}</span
		>{/if}
	<span class="min-w-0 text-ink {wrap ? 'break-words' : 'truncate'}">{label}</span>
	{#if mark}{@render mark()}{:else if shownMarks}<DietMarks marks={shownMarks} />{/if}
{/snippet}

{#snippet body()}
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0">
			<p class="text-body leading-snug font-semibold text-ink">{label}</p>
			<p class="mt-0.5 text-meta text-ink-3">
				{#if card}{[card.brand, card.origin ? `origin ${card.origin}` : 'origin not stated']
						.filter(Boolean)
						.join(' · ')}{/if}
				{#if system}<span class="mono"> · {productId}</span>{/if}
			</p>
		</div>
	</div>
	{#if offline}
		<p class="mt-2 text-meta text-ink-3">
			Product details need the server; this offline view has none.
		</p>
	{:else if phase === 'loading' || phase === 'idle'}
		<p class="mt-2 text-meta text-ink-3">Reading Valio's terms…</p>
	{:else if phase === 'error' || !card}
		<p class="mt-2 text-meta text-ink-3">No product details: {failure}</p>
	{:else}
		{@const c = card}
		{#if c.listing?.imageUrl}
			<img
				src={c.listing.imageUrl}
				alt=""
				loading="lazy"
				class="mt-2 h-28 w-full rounded-md border border-rule bg-sheet object-contain"
			/>
		{/if}
		<dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-meta">
			<dt class="text-ink-3">Pack</dt>
			<dd class="text-ink">{c.pack}</dd>
			<dt class="text-ink-3">Price</dt>
			<dd class="text-ink">
				{#if c.price}<span class="mono tabular-nums">{money(c.price.cents)}</span> per {c.price.per} ex
					VAT{#if c.price.comparison}<span class="text-ink-3"
							>&nbsp; · <span class="mono tabular-nums">{money(c.price.comparison.cents)}</span>/{c
								.price.comparison.unit}</span
						>{/if}{:else}<span class="text-ink-3">No price from Valio</span>{/if}
			</dd>
			<dt class="text-ink-3">Supply</dt>
			<dd class={AVAIL_TONE[c.availability.kind] ?? 'text-ink'}>{c.availability.words}</dd>
			<dt class="text-ink-3">Allergens</dt>
			<dd class="text-ink">
				{#if !c.diet.allergens.declared}<span class="text-signoff"
						>No allergen record from Valio</span
					>{:else}{@const m = marksOf(c.diet)}{m.contains.length
						? `Contains ${m.contains.join(', ')}`
						: 'None declared'}{m.mayContain.length
						? ` · may contain ${m.mayContain.join(', ')}`
						: ''}{/if}
				<DietMarks marks={marksOf(c.diet)} />
			</dd>
			{#if c.substitutes.length}
				<dt class="text-ink-3">Valio swaps</dt>
				<dd class="text-ink">
					{c.substitutes.map((x: { nameFi: string }) => readableName(x.nameFi)).join(' · ')}
				</dd>
			{/if}
		</dl>
		<div class="mt-3 border-t border-rule pt-2">
			{#if c.listing}
				<!-- An outside page, not an app route. -->
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				<a
					href={c.listing.pageUrl}
					target="_blank"
					rel="noopener noreferrer"
					class="inline-flex items-center gap-1.5 text-meta font-medium text-accent-ink hover:underline"
				>
					See the public listing <ExternalLink size={12} aria-hidden="true" />
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
				<p class="mt-0.5 text-micro text-ink-3">
					{c.listing.source === 'valioaimo'
						? 'valioaimo.fi · browse only; ordering stays here'
						: 'Open Food Facts · open data'} · barcode matches · checked {storyTime(
						c.listing.checkedAt
					)}
				</p>
			{:else}
				<p class="text-micro text-ink-3">{c.listingNote ?? 'No public listing found.'}</p>
			{/if}
		</div>
	{/if}
{/snippet}

{#if narrow}
	<button
		type="button"
		class="inline-flex max-w-full min-w-0 items-center gap-1.5 text-left {cls}"
		aria-haspopup="dialog"
		onclick={() => (open = true)}>{@render token()}</button
	>
	<Dialog.Root bind:open>
		<Dialog.Portal>
			<Dialog.Overlay class="fixed inset-0 z-40 bg-ink/20" />
			<Dialog.Content
				class="fixed inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-y-auto rounded-t-xl border-t border-rule bg-sheet p-4 shadow-lg outline-none"
			>
				<Dialog.Title class="sr-only">{label}</Dialog.Title>
				<Dialog.Close
					class="absolute top-3 right-3 grid size-8 place-items-center rounded-md text-ink-2 hover:bg-well"
					aria-label="Close"><X size={16} /></Dialog.Close
				>
				{@render body()}
			</Dialog.Content>
		</Dialog.Portal>
	</Dialog.Root>
{:else}
	<Popover.Root bind:open>
		<Popover.Trigger class="inline-flex max-w-full min-w-0 items-center gap-1.5 text-left {cls}"
			>{@render token()}</Popover.Trigger
		>
		<Popover.Portal>
			<Popover.Content
				sideOffset={6}
				align="start"
				class="z-50 w-[min(360px,calc(100vw-24px))] rounded-lg border border-rule bg-sheet p-3 shadow-lg"
			>
				{@render body()}
			</Popover.Content>
		</Popover.Portal>
	</Popover.Root>
{/if}
