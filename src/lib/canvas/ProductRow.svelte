<script lang="ts">
	import { page } from '$app/state';
	import { Package } from '@lucide/svelte';
	import ProductToken from '$lib/ui/ProductToken.svelte';
	import { thumbFor, type Thumb } from '$lib/ui/thumbs';
	import { money, readableName } from '$lib/ui/format';

	let {
		productId,
		name,
		deliverBy,
		cents,
		quantity,
		size = 32,
		eager = false,
		inspect = true
	}: {
		productId: string;
		name: string;
		deliverBy?: string;
		cents?: number | null;
		quantity?: string;
		size?: 32 | 40 | 64;
		eager?: boolean;
		/** Disclosure summaries use a plain name; product inspection stays a separate control. */
		inspect?: boolean;
	} = $props();
	let photoEl = $state<HTMLElement | null>(null);
	let thumb = $state.raw<Thumb | null | undefined>(undefined);
	let failed = $state(false);
	let loaded = $state(false);
	const label = $derived(readableName(name));
	const url = $derived(typeof thumb?.imageUrl === 'string' ? thumb.imageUrl.trim() : '');
	const photoState = $derived(
		failed
			? 'unavailable'
			: thumb === undefined || (url && !loaded)
				? 'loading'
				: url
					? 'ready'
					: 'missing'
	);
	const photoLabel = $derived(
		photoState === 'loading'
			? 'Loading photo'
			: photoState === 'unavailable'
				? 'Photo unavailable'
				: photoState === 'missing'
					? 'No photo'
					: thumb?.match === 'gtin'
						? 'Exact product photo'
						: thumb?.match === 'brand'
							? 'Brand image'
							: 'Pack may differ'
	);
	const caption = $derived(
		photoLabel === 'Exact product photo' || photoState === 'loading' ? '' : photoLabel
	);
	const captionText = $derived(caption ? `${quantity ? ' · ' : ''}${caption}` : '');

	// Reuse the app's batched, cached read. A grid of photos never opens product cards or performs live lookups.
	$effect(() => {
		const id = productId;
		const el = photoEl;
		const offline = page.url.pathname.startsWith('/offline');
		thumb = undefined;
		failed = false;
		loaded = false;
		if (!el) return;
		if (offline) {
			thumb = null;
			return;
		}
		let gone = false;
		const read = () =>
			thumbFor(id).then((value) => {
				if (!gone) thumb = value;
			});
		if (eager || typeof IntersectionObserver === 'undefined') {
			void read();
			return () => {
				gone = true;
			};
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					observer.disconnect();
					void read();
				}
			},
			{ rootMargin: '600px' }
		);
		observer.observe(el);
		return () => {
			gone = true;
			observer.disconnect();
		};
	});
</script>

<span class="product-row" style="--photo-size: {size}px" data-canvas-product={productId}>
	<span
		bind:this={photoEl}
		class="photo"
		role="img"
		aria-label="{label}: {photoLabel}"
		title={photoLabel}
		data-photo-product={productId}
		data-photo-state={photoState}
		data-photo-match={thumb?.match ?? 'none'}
	>
		{#if url && !failed}
			{#if !loaded}<Package size={Math.round(size * 0.45)} aria-hidden="true" />{/if}
			{#key `${productId}:${url}`}<img
					src={url}
					alt=""
					loading={eager ? 'eager' : 'lazy'}
					decoding="async"
					class:loaded
					onload={(event) => {
						if (event.currentTarget.getAttribute('src') === url) loaded = true;
					}}
					onerror={(event) => {
						if (event.currentTarget.getAttribute('src') === url) failed = true;
					}}
				/>{/key}
		{:else}<Package size={Math.round(size * 0.45)} aria-hidden="true" />{/if}
	</span>
	<span class="product-copy">
		{#if inspect}
			{#key `${productId}:${deliverBy ?? ''}`}
				<!-- The existing card owns deliberate inspection; hide its duplicate inline thumbnail, not its dialog image. -->
				<ProductToken
					{productId}
					{name}
					{deliverBy}
					wrap
					class="underline decoration-rule-strong underline-offset-2 hover:decoration-accent [&>img]:hidden"
				>
					{#snippet mark()}{/snippet}
				</ProductToken>
			{/key}
		{:else}<span class="font-medium">{label}</span>{/if}
		<span class="product-meta"
			>{#if quantity}<span class="mono tabular-nums">{quantity}</span>{/if}{captionText}</span
		>
	</span>
	{#if cents !== undefined}<span class="mono product-price tabular-nums">{money(cents)}</span>{/if}
</span>

<style>
	.product-row {
		display: grid;
		grid-template-columns: var(--photo-size) minmax(0, 1fr) auto;
		align-items: start;
		gap: 12px;
		width: 100%;
		text-align: left;
	}
	.photo {
		position: relative;
		display: grid;
		place-items: center;
		width: var(--photo-size);
		height: var(--photo-size);
		overflow: hidden;
		border: 1px solid var(--color-rule);
		border-radius: 6px;
		background: var(--color-sheet);
		color: var(--color-ink-3);
	}
	.photo img {
		position: absolute;
		inset: 0;
		opacity: 0;
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
	.photo img.loaded {
		opacity: 1;
	}
	.product-copy {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.product-meta {
		display: block;
		min-height: 16px;
		margin-top: 4px;
		color: var(--color-ink-2);
		font-size: var(--text-meta);
		line-height: var(--text-meta--line-height);
	}
	.product-price {
		text-align: right;
		white-space: nowrap;
	}
</style>
