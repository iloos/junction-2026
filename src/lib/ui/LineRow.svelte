<script lang="ts">
	/**
	 * One purchase line as a compact row: product, what it buys, price, authority, Why. Expanding shows the pack
	 * basis (physical amount, unit and comparison price, rounding). A substitute always carries its caption,
	 * "replaces X because Y", so a swap is never silent.
	 */
	import { ChevronRight, CornerDownRight, Info } from '@lucide/svelte';
	import type { Line } from '$lib/core/contracts';

	import StateChip from './StateChip.svelte';
	import AgentMark from './AgentMark.svelte';
	import { lineBasis, lotSentence } from './coverage';
	import { money } from './format';

	interface Props {
		line: Line;
		name: string;
		/** A granted approval covers this line (core keeps it `held` until ordered). */
		approved?: boolean;
		/** The row just changed: tint lands and fades. */
		flash?: boolean;
		/** For a substitute: the product it replaces and why, in plain words. */
		replaces?: { name: string; because: string };
		/** An agent last changed this line (proposed or edited it). */
		by?: 'kitchen_agent' | 'external_agent';
		expanded?: boolean;
		onwhy?: () => void;
	}
	let {
		line: l,
		name,
		approved = false,
		flash = false,
		replaces,
		by,
		expanded = $bindable(false),
		onwhy
	}: Props = $props();

	const rejected = $derived(l.state === 'rejected' || l.state === 'unorderable');
	const b = $derived(lineBasis(l.qty, l.view));
	/** A lot step that buys well over the need is said on the row, not only in the detail. */
	const lot = $derived(lotSentence(l.qty.rounding));
	const hasDetail = $derived(!rejected && !!(b.physical || b.unitPrice || l.qty.rounding));
</script>

<div
	class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 rounded-[5px] py-0.5 sm:grid-cols-[minmax(0,1fr)_88px_minmax(0,auto)] {flash
		? 'landed'
		: ''}"
>
	<div class="min-w-0">
		<button
			type="button"
			class="flex w-full min-w-0 items-baseline gap-1.5 text-left text-body disabled:cursor-default"
			aria-expanded={hasDetail ? expanded : undefined}
			disabled={!hasDetail}
			onclick={() => (expanded = !expanded)}
		>
			{#if replaces}<CornerDownRight
					size={13}
					class="shrink-0 translate-y-0.5 text-accent"
					aria-hidden="true"
				/>{:else if hasDetail}<ChevronRight
					size={13}
					class="shrink-0 translate-y-0.5 text-ink-3 transition-transform {expanded
						? 'rotate-90'
						: ''}"
					aria-hidden="true"
				/>{/if}
			<span
				class="truncate {rejected ? 'text-ink-3 line-through decoration-ink-3/60' : 'text-ink'}"
				title={name}>{name}</span
			>
		</button>
		{#if replaces}
			<p class="text-meta text-ink-2">
				Replaces <span class="text-ink">{replaces.name}</span>: {replaces.because}{#if by}
					· <AgentMark {by} />{/if}
			</p>
		{:else if by}<p><AgentMark {by} /></p>
		{/if}
		<p class="mono text-micro text-ink-3">
			{#if rejected}<span class="font-sans">{l.productId} · not ordered</span>{:else}<span
					class="text-ink">{b.buys}</span
				>{#if b.physical && !expanded}<span class="text-ink-2"> {b.physical}</span>{/if}{/if}
		</p>
		{#if lot && !rejected}<p class="text-meta text-ink-2">{lot}</p>{/if}
		{#if expanded && hasDetail}
			<dl class="mono mt-0.5 grid grid-cols-[auto_1fr] gap-x-2 text-micro text-ink-2">
				{#if b.physical}<dt class="font-sans text-ink-3">Buys</dt>
					<dd>{b.buys} {b.physical}</dd>{/if}
				{#if b.unitPrice}<dt class="font-sans text-ink-3">Price</dt>
					<dd>{b.comparison ? `${b.unitPrice} · ${b.comparison}` : b.unitPrice}</dd>{/if}
				{#if l.qty.rounding}<dt class="font-sans text-ink-3">Rounding</dt>
					<dd class="font-sans">{l.qty.rounding}</dd>{/if}
			</dl>
		{/if}
	</div>
	<span class="mono text-right text-body {rejected ? 'text-ink-3' : 'text-ink'}">
		{rejected ? '—' : money(l.lineCents)}
	</span>
	<span class="col-span-2 flex items-center justify-between gap-2 sm:col-span-1 sm:justify-end">
		<StateChip state={l.state} tier={l.tier} reasons={l.reasons} {approved} view={l.view} />
		{#if onwhy}
			<button
				type="button"
				class="grid size-7 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-well hover:text-ink"
				aria-label="Why this line"
				title="Why"
				onclick={onwhy}><Info size={15} /></button
			>
		{/if}
	</span>
</div>
