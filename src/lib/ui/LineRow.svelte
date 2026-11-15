<script lang="ts">
	/**
	 * One purchase line as a compact row: product, what it buys, price, authority, Why. Expanding shows the pack
	 * basis (physical amount, unit and comparison price, rounding). A substitute always carries its caption,
	 * "replaces X because Y", so a swap is never silent.
	 */
	import { ChevronRight, CornerDownRight, Info } from '@lucide/svelte';
	import type { Line } from '$lib/core/contracts';

	import StateChip from './StateChip.svelte';
	import ProductThumb from './ProductThumb.svelte';
	import SwapPanel from './SwapPanel.svelte';
	import { ChevronDown, Repeat } from '@lucide/svelte';
	import { Popover } from 'bits-ui';
	import AgentMark from './AgentMark.svelte';
	import DietMarks from './DietMarks.svelte';
	import type { Marks } from './diet';
	import { lineBasis, lotSentence } from './coverage';
	import { money, unitWord } from './format';

	interface Props {
		line: Line;
		name: string;
		/** The product in English ("oat drink for coffee, 1 l"), when the catalogue has it: a muted second line. */
		gloss?: string;
		/** A granted approval covers this line (core keeps it `held` until ordered). */
		approved?: boolean;
		/** The row just changed: tint lands and fades. */
		flash?: boolean;
		/** For a substitute: the product it replaces and why, in plain words. */
		/** For a substitute: the product it replaces and why, and why the agent picked this one (≤3 words). */
		replaces?: { name: string; because: string; picked?: string | null };
		/** The product's diet and allergen marks (G, L, M…). */
		diet?: Marks;
		/** An agent last changed this line (proposed or edited it). */
		by?: 'kitchen_agent' | 'external_agent';
		expanded?: boolean;
		onwhy?: () => void;
		/** Offer "Swap" (D28): the plan on screen, and what to do after a pick (re-read). */
		swap?: { planId: string; version: number; deliverBy?: string; onchanged: () => void };
		/** Change this line's amount in its sales units (edit_line); absent when it can't change. */
		onqty?: (qty: number) => void;
		/** What the web says about allergens for a product with no record: evidence only, linked to its source. */
		web?: { text: string; host: string; url: string; unsure?: boolean } | null;
		/** Open the compare panel (Swap pressed on the collapsed dish row). */
		swapOpen?: boolean;
		/** This line's own decision (D23): Accept / Reject, or a sign-off one by one. */
		decide?: {
			state: 'pending' | 'granted' | 'denied';
			signOff: boolean;
			/** What rejecting costs, in one line ("Graavilohi loses cover"). */
			cost: string;
			busy?: boolean;
			onaccept: () => void;
			onreject: () => void;
			/** Put a rejected line back to waiting (absent until the core can reopen a decision). */
			onundo?: () => void;
		};
	}
	let {
		line: l,
		name,
		gloss,
		approved = false,
		flash = false,
		replaces,
		by,
		diet,
		expanded = $bindable(false),
		onwhy,
		swap,
		decide,
		swapOpen = false,
		onqty,
		web = null
	}: Props = $props();
	let swapping = $state(false);
	let chipMenu = $state(false);
	$effect(() => {
		if (swapOpen) swapping = true;
	});

	const rejected = $derived(l.state === 'rejected' || l.state === 'unorderable');
	/** The chef rejected it (a denied decision): it stays in place, struck, until undone. */
	const denied = $derived(decide?.state === 'denied');
	const b = $derived(lineBasis(l.qty, l.view));
	/** A lot step that buys well over the need is said on the row, not only in the detail. */
	const lot = $derived(lotSentence(l.qty.rounding));
	const hasDetail = $derived(!rejected && !!(b.physical || b.unitPrice || l.qty.rounding));
</script>

<div
	class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 rounded-[5px] py-0.5 sm:grid-cols-[minmax(0,1fr)_88px_minmax(0,auto)] lg:grid-cols-[minmax(0,1fr)_88px_37.5rem] {flash
		? 'landed'
		: ''}"
>
	<div class="flex min-w-0 items-start gap-2">
		<ProductThumb productId={l.productId} size={32} />
		<div class="min-w-0 flex-1">
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
					class="min-w-0 break-words {rejected || denied
						? 'text-ink-3 line-through decoration-ink-3/60'
						: 'text-ink'}"
					title={gloss ? `${name} · ${gloss}` : name}>{name}</span
				>{#if diet}<DietMarks marks={diet} />{/if}
			</button>
			{#if gloss}<p class="truncate text-meta text-ink-3" title={gloss}>{gloss}</p>{/if}
			{#if replaces}
				<p class="text-meta text-ink-2">
					{#if replaces.picked}<span class="text-ink">Picked: {replaces.picked}</span> · replaces{:else}Replaces{/if}
					<span class="text-ink">{replaces.name}</span> ({replaces.because}){#if by}
						&nbsp;· <AgentMark {by} />{/if}
				</p>
			{:else if by}<p><AgentMark {by} /></p>
			{/if}
			<p class="mono text-micro text-ink-3">
				{#if rejected}<span class="font-sans"
						><span class="sys-only mono">{l.productId} · </span>Not ordered</span
					>{:else if onqty && l.state !== 'committed'}{#if b.physical && !expanded}<span
							class="text-ink-3">{b.physical}</span
						>{/if}{:else}<span class="text-ink">{b.buys}</span>{#if b.physical && !expanded}<span
							class="text-ink-2"
						>
							{b.physical}</span
						>{/if}{/if}
			</p>
			{#if lot && !rejected}<p class="text-meta text-ink-2">{lot}</p>{/if}
			{#if web}
				<!-- eslint-disable svelte/no-navigation-without-resolve -- an outside source page -->
				<p class="text-meta text-ink-3">
					{web.unsure ? 'Web, may describe another product' : 'Web'}: {web.text} ·
					<a
						href={web.url}
						target="_blank"
						rel="noopener noreferrer"
						class="underline underline-offset-2">{web.host}</a
					>
				</p>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			{/if}
			{#if decide?.state === 'denied'}
				<p class="text-meta text-ink-3">Not ordered: {decide.cost}</p>
			{:else if decide?.state === 'pending' && decide.signOff}
				<p class="mt-0.5 text-meta text-signoff">
					Needs your sign-off with its group. If rejected: {decide.cost}.
				</p>
			{/if}
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
	</div>
	<span class="mono text-right text-body {rejected ? 'text-ink-3' : 'text-ink'}">
		{rejected ? '—' : money(l.lineCents)}
	</span>
	<span
		class="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1 sm:justify-end lg:justify-start"
	>
		{#if onqty && !rejected && !denied && l.state !== 'committed'}
			<!-- The line's amount (D23): one compact control, the unit as its suffix. -->
			<span
				class="inline-flex h-8 w-[7.5rem] shrink-0 items-center justify-between rounded-md border border-rule-strong bg-sheet text-meta"
				role="group"
				aria-label="Amount of {name}"
			>
				<button
					type="button"
					class="grid h-full w-7 place-items-center rounded-l-md text-ink-2 hover:bg-well hover:text-ink disabled:opacity-40"
					aria-label="One less"
					disabled={l.qty.value <= 0}
					onclick={() => onqty(Math.max(0, l.qty.value - 1))}>−</button
				>
				<span class="mono px-1 whitespace-nowrap text-ink tabular-nums"
					>{l.qty.value}
					<span class="font-sans text-ink-2">{unitWord(l.qty.unit, l.qty.value)}</span></span
				>
				<button
					type="button"
					class="grid h-full w-7 place-items-center rounded-r-md text-ink-2 hover:bg-well hover:text-ink"
					aria-label="One more"
					onclick={() => onqty(l.qty.value + 1)}>+</button
				>
			</span>
		{/if}
		{#if decide?.state === 'pending' && !decide.signOff}
			<!-- The chip is the line's control (D29): Accept · Reject · Swap · Why, at the chip, by click or keyboard. -->
			<Popover.Root bind:open={chipMenu}>
				<Popover.Trigger
					class="inline-flex shrink-0 items-center gap-0.5 rounded-full pr-1 hover:bg-auth-wash focus-visible:outline-2 focus-visible:outline-auth"
					aria-label="Needs approval: Accept, Reject, Swap or Why"
					><StateChip
						state={l.state}
						tier={l.tier}
						reasons={l.reasons}
						{approved}
						view={l.view}
					/><ChevronDown size={13} class="text-auth" aria-hidden="true" /></Popover.Trigger
				>
				<Popover.Portal>
					<Popover.Content
						sideOffset={4}
						align="end"
						class="z-50 w-44 rounded-lg border border-rule bg-sheet p-1 text-body shadow-lg"
					>
						<div role="menu" aria-label="Line actions">
							<button
								type="button"
								role="menuitem"
								class="block w-full rounded-md px-3 py-1.5 text-left text-accent-ink hover:bg-well"
								disabled={decide.busy}
								onclick={() => {
									chipMenu = false;
									decide?.onaccept();
								}}>Accept</button
							>
							<button
								type="button"
								role="menuitem"
								class="block w-full rounded-md px-3 py-1.5 text-left hover:bg-well"
								disabled={decide.busy}
								onclick={() => {
									chipMenu = false;
									decide?.onreject();
								}}
								>Reject<span class="block text-micro text-ink-3">Not ordered: {decide.cost}</span
								></button
							>
							{#if swap}<button
									type="button"
									role="menuitem"
									class="block w-full rounded-md px-3 py-1.5 text-left hover:bg-well"
									onclick={() => {
										chipMenu = false;
										swapping = true;
									}}>Swap…</button
								>{/if}
							{#if onwhy}<button
									type="button"
									role="menuitem"
									class="block w-full rounded-md px-3 py-1.5 text-left hover:bg-well"
									onclick={() => {
										chipMenu = false;
										onwhy?.();
									}}>Why</button
								>{/if}
						</div>
					</Popover.Content>
				</Popover.Portal>
			</Popover.Root>
		{:else if !denied}
			<StateChip state={l.state} tier={l.tier} reasons={l.reasons} {approved} view={l.view} />
		{/if}
		{#if decide?.state === 'pending' && decide.signOff}
			<button
				type="button"
				class="inline-flex h-8 shrink-0 items-center rounded-md border border-rule-strong px-3 text-meta text-ink hover:border-out disabled:opacity-50"
				disabled={decide.busy}
				title="Not ordered: {decide.cost}"
				onclick={decide.onreject}>Reject</button
			>
		{/if}
		{#if decide?.state === 'pending' && !decide.signOff}
			<!-- The separate buttons where they fit; on a phone the chip menu carries them. -->
			<span class="hidden shrink-0 gap-1.5 sm:inline-flex">
				<button
					type="button"
					class="inline-flex h-8 items-center rounded-md border border-accent px-3 text-meta font-medium text-accent-ink hover:bg-accent-wash disabled:opacity-50"
					disabled={decide.busy}
					onclick={decide.onaccept}>Accept</button
				>
				<button
					type="button"
					class="inline-flex h-8 items-center rounded-md border border-rule-strong px-3 text-meta text-ink hover:border-out disabled:opacity-50"
					disabled={decide.busy}
					title="Not ordered: {decide.cost}"
					onclick={decide.onreject}>Reject</button
				>
			</span>
		{:else if decide?.state === 'denied'}
			<span
				class="inline-flex shrink-0 items-center rounded-full border border-rule-strong bg-well px-2 py-0.5 text-micro font-medium text-ink-2"
				>Rejected · not ordered</span
			>
			{#if decide.onundo}
				<button
					type="button"
					class="inline-flex h-8 shrink-0 items-center rounded-md px-2 text-meta text-ink-2 underline underline-offset-2 hover:text-ink disabled:opacity-50"
					disabled={decide.busy}
					onclick={decide.onundo}>Undo</button
				>
			{/if}
		{/if}
		{#if swap && !rejected && !denied && l.state !== 'committed'}
			<button
				type="button"
				class="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-meta text-ink-2 hover:bg-well hover:text-ink"
				aria-expanded={swapping}
				onclick={() => (swapping = !swapping)}><Repeat size={13} aria-hidden="true" />Swap</button
			>
		{/if}
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
{#if swap && swapping}
	<div class="mt-1 mb-2">
		<SwapPanel
			planId={swap.planId}
			version={swap.version}
			lineId={l.id}
			current={{ productId: l.productId, name }}
			deliverBy={swap.deliverBy}
			onchanged={swap.onchanged}
			onclose={() => (swapping = false)}
		/>
	</div>
{/if}
