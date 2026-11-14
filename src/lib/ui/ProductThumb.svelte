<script lang="ts">
	/**
	 * A product's photo in a fixed slot at the front of a row: the same size, radius and alignment everywhere (plan,
	 * Basket, decision cards, dock cards, compare). Read as soon as the row nears the screen; never an empty slot: a
	 * photo that isn't this exact product says "Pack may differ", and no photo shows a placeholder that says so.
	 */
	import { Package } from '@lucide/svelte';
	import { page } from '$app/state';
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
	const offline = $derived(page.url.pathname.startsWith('/offline'));

	$effect(() => {
		const id = productId;
		if (imageUrl) {
			thumb = { imageUrl, match: 'gtin' };
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
	const label = $derived(
		thumb === null
			? 'No photo'
			: thumb && !exact
				? 'Photo of a similar product: pack may differ'
				: ''
	);
</script>

<span
	bind:this={el}
	class="relative inline-grid shrink-0 place-items-center overflow-hidden rounded-md border border-rule bg-well"
	style="width: {size}px; height: {size}px"
	title={label || undefined}
>
	{#if thumb}
		<img
			src={thumb.imageUrl}
			alt=""
			loading={eager ? 'eager' : 'lazy'}
			decoding="async"
			class="size-full bg-sheet object-contain {exact ? '' : 'opacity-80'}"
		/>
		{#if !exact}
			<span
				class="absolute right-0 bottom-0 rounded-tl bg-sheet/90 px-0.5 text-micro leading-none text-ink-2"
				aria-hidden="true">≈</span
			>
		{/if}
	{:else}
		<Package size={Math.round(size * 0.45)} class="text-ink-3" aria-hidden="true" />
	{/if}
	{#if label}<span class="sr-only">{label}</span>{/if}
</span>
