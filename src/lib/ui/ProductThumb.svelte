<script lang="ts">
	/**
	 * A product's photo in a fixed slot at the front of a row: the same size, radius and alignment everywhere (plan,
	 * Basket, decision cards, dock cards, compare). Read as soon as the row nears the screen; never an empty slot: a
	 * photo that isn't this exact product says "Pack may differ", and no photo shows a placeholder that says so.
	 */
	import {
		Beef,
		CakeSlice,
		Carrot,
		Fish,
		Milk,
		Package,
		Snowflake,
		SquareSquare
	} from '@lucide/svelte';
	import { page } from '$app/state';
	import { Popover } from 'bits-ui';
	import { thumbFor, type Thumb } from './thumbs';

	let {
		productId,
		imageUrl,
		size = 36,
		eager = false
	}: {
		productId: string;
		/** A photo the page already has; else it is read for this product. */
		imageUrl?: string;
		size?: 32 | 36 | 40;
		/** On the first screen: load at once rather than when scrolled near. */
		eager?: boolean;
	} = $props();

	let thumb = $state<Thumb | null | undefined>(undefined);
	let el = $state<HTMLElement | null>(null);
	/** The image fades in once decoded; the slot is its fixed size from first paint, so nothing shifts. */
	let loaded = $state(false);
	let big = $state(false);
	const offline = $derived(page.url.pathname.startsWith('/offline'));

	$effect(() => {
		const id = productId;
		if (imageUrl) {
			thumb = { imageUrl, match: 'gtin', label: null };
			return;
		}
		if (offline || !el) {
			thumb = offline ? null : undefined;
			return;
		}
		let gone = false;
		const read = () => thumbFor(id).then((t) => !gone && (thumb = t));
		if (eager || typeof IntersectionObserver === 'undefined') {
			void read();
			return () => (gone = true);
		}
		const io = new IntersectionObserver(
			(es) => {
				if (es.some((e) => e.isIntersecting)) {
					io.disconnect();
					void read();
				}
			},
			{ rootMargin: '600px' }
		);
		io.observe(el);
		return () => {
			gone = true;
			io.disconnect();
		};
	});

	const exact = $derived(thumb?.match === 'gtin');
	/** Said on the image (and to assistive tech) whenever it isn't this exact product's own photo. */
	const label = $derived(
		thumb === null || (thumb && !thumb.imageUrl)
			? 'No photo'
			: thumb && !exact
				? (thumb.label ?? 'Pack may differ')
				: ''
	);
	const ICONS: Record<string, typeof Package> = {
		milk: Milk,
		cheese: SquareSquare,
		butter: SquareSquare,
		fish: Fish,
		meat: Beef,
		produce: Carrot,
		bakery: CakeSlice,
		frozen: Snowflake,
		product: Package
	};
	const Icon = $derived(ICONS[thumb?.icon ?? 'product'] ?? Package);
</script>

{#snippet slot()}
	{#if thumb?.imageUrl}
		<img
			src={thumb.imageUrl}
			alt=""
			loading={eager ? 'eager' : 'lazy'}
			decoding="async"
			class="size-full bg-sheet object-contain transition-opacity duration-300 {loaded
				? exact
					? 'opacity-100'
					: 'opacity-80'
				: 'opacity-0'}"
			onload={() => (loaded = true)}
		/>
		{#if !exact}
			<span
				class="absolute right-0 bottom-0 rounded-tl bg-sheet/90 px-0.5 text-micro leading-none text-ink-2"
				aria-hidden="true">≈</span
			>
		{/if}
	{:else}
		<Icon size={Math.round(size * 0.45)} class="text-ink-3" aria-hidden="true" />
	{/if}
	{#if label}<span class="sr-only">{label}</span>{/if}
{/snippet}

<span bind:this={el} class="inline-grid shrink-0">
	{#if thumb?.imageUrl}
		<!-- A photo opens larger, with where it comes from and how it matches; Escape closes it. -->
		<Popover.Root bind:open={big}>
			<Popover.Trigger
				class="relative inline-grid shrink-0 cursor-zoom-in place-items-center overflow-hidden rounded-md border border-rule bg-well hover:border-accent focus-visible:outline-2 focus-visible:outline-accent"
				style="width: {size}px; height: {size}px"
				aria-label="Show the photo larger{label ? `: ${label}` : ''}"
				>{@render slot()}</Popover.Trigger
			>
			<Popover.Portal>
				<Popover.Content
					sideOffset={6}
					align="start"
					class="z-50 w-[min(320px,calc(100vw-24px))] rounded-lg border border-rule bg-sheet p-2 shadow-lg"
				>
					<img
						src={thumb.imageUrl}
						alt={label || 'Product photo'}
						class="aspect-square w-full rounded-md bg-sheet object-contain"
					/>
					<p class="mt-1.5 text-meta text-ink-2">
						{exact
							? "This product's own photo"
							: (thumb.label ?? 'Pack may differ')}{#if thumb.host}<span
								>&nbsp;· from {thumb.host}</span
							>{/if}
					</p>
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	{:else}
		<span
			class="relative inline-grid shrink-0 place-items-center overflow-hidden rounded-md border border-rule bg-well"
			style="width: {size}px; height: {size}px"
			title={label || undefined}>{@render slot()}</span
		>
	{/if}
</span>
