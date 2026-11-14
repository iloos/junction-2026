<script lang="ts">
	/**
	 * The Kitchen as a basket: everything coming on each delivery day, whatever started it (the event plan, the usual
	 * order, chat, an outside agent), one line per product with its stage and where it came from. Days run down the
	 * page; the day picker jumps to a day. Grouped by source or flat by stage. Ordering and deciding stay per plan
	 * through the page's existing commands (`onorder`, `ondecide`): this view adds none. Reads /kitchen-api/basket.
	 */
	import { ArrowRight, Bot, CircleAlert, ListFilter, Rows3 } from '@lucide/svelte';
	import DayPicker from '$lib/ui/DayPicker.svelte';
	import ProductToken from '$lib/ui/ProductToken.svelte';
	import ProductThumb from '$lib/ui/ProductThumb.svelte';
	import {
		budgetSentence,
		cannotOrder,
		stageRuns,
		budgetShares,
		dayAction,
		dayHeadline,
		flatByStage,
		groupBySource,
		tokenQty,
		type Basket,
		type BasketLine,
		type BasketStage
	} from '$lib/ui/basket';
	import { day as dayLabel, money, readableName } from '$lib/ui/format';
	import { qtyText } from '$lib/ui/product-card';
	import Row from '$lib/ui/Row.svelte';
	import Ledger from '$lib/ui/Ledger.svelte';
	import { buildLedger, type ShortageNotice } from '$lib/ui/ledger';
	import { useShell } from '$lib/ui/shell/shell.svelte';
	import NothingPlanned from './NothingPlanned.svelte';

	let {
		kitchenId,
		kitchenName,
		refresh = 0,
		onorder,
		ondecide,
		onopen,
		onask
	}: {
		kitchenId: string;
		kitchenName: string;
		/** Bumped by the page after any change (a commit, an approval, a new plan) to read the basket again. */
		refresh?: string | number;
		/** Order the lines of this plan that can go now (the page's commit for that plan). */
		onorder: (planId: string) => void;
		/** Show this plan's decisions (the page's Decide panel for that plan). */
		ondecide: (planId: string) => void;
		/** Open a plan on its own (the event detail, or the plan view). */
		onopen: (planId: string) => void;
		onask: (date: string | null) => void;
	} = $props();

	let basket = $state<Basket | null>(null);
	let failed = $state(false);
	let date = $state<string | null>(null);
	let mode = $state<'source' | 'stage'>('source');

	$effect(() => {
		const id = kitchenId;
		void refresh;
		void bump;
		let gone = false;
		failed = false;
		void fetch(`/kitchen-api/basket?kitchen=${encodeURIComponent(id)}`, { cache: 'no-store' })
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
			.then((b: Basket) => {
				if (!gone) basket = b;
			})
			.catch(() => {
				if (!gone) failed = true;
			});
		return () => (gone = true);
	});

	const days = $derived(basket?.days.filter((d) => d.lines.length) ?? []);

	// Live shortage re-plans for this kitchen (moment 1): kept for this page, newest first; each re-reads the basket.
	const shell = useShell();
	let shortages = $state.raw<ShortageNotice[]>([]);
	let bump = $state(0);
	$effect(() => {
		if (!shell) return;
		return shell.events.notices((n) => {
			if (n.event.kind !== 'shortage.replanned') return;
			const d = n.event.detail as ShortageNotice;
			if (!d?.kitchens?.some((k) => k.kitchenId === kitchenId)) return;
			shortages = [d, ...shortages.filter((x) => x.shortageId !== d.shortageId)];
			bump++;
		});
	});
	const ledger = $derived(buildLedger(days, shortages, kitchenId));
	const pickedEmpty = $derived(Boolean(date && basket && !days.some((d) => d.date === date)));

	// Picking a day scrolls to it when it has lines.
	$effect(() => {
		if (!date || pickedEmpty) return;
		document
			.getElementById(`basket-${date}`)
			?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	});

	const STAGE_TONE: Record<BasketStage, string> = {
		held: 'border-signoff/50 bg-signoff-wash text-ink',
		proposed: 'border-accent/40 bg-accent-wash text-accent-ink',
		approved: 'border-rule-strong bg-sheet text-ink',
		ordered: 'border-transparent bg-ok-wash text-ink'
	};
</script>

{#snippet lineRow(l: BasketLine, chip: string | null)}
	<Row lead={qtyText(tokenQty(l.qty))} value={money(l.lineCents)} class="border-t border-rule/60">
		<span class="flex items-start gap-2"
			><ProductThumb productId={l.productId} /><ProductToken
				productId={l.productId}
				name={l.productName}
				wrap
			/></span
		>
		{#snippet sub()}
			{#if chip}<span class="mr-1 rounded-full bg-well px-1.5 py-px text-micro text-ink-2"
					>{chip}</span
				>{/if}{[l.need, l.substituteFor && `replaces ${readableName(l.substituteFor)}`]
				.filter(Boolean)
				.join(' · ')}
		{/snippet}
	</Row>
{/snippet}

{#snippet stageGroups(lines: BasketLine[], chipOf: ((l: BasketLine) => string) | null)}
	{#each stageRuns(lines) as r (r.stage)}
		<li class="border-t border-rule first:border-t-0">
			<ul aria-label="{r.words}, {r.lines.length} lines">
				<Row head value={money(r.cents)}>
					<span
						class="inline-flex items-center gap-1.5 rounded-full border px-2 py-px {STAGE_TONE[
							r.stage
						]}">{r.words}</span
					><span class="ml-2 text-ink-3"
						>{r.lines.length} line{r.lines.length === 1 ? '' : 's'}</span
					>
				</Row>
				{#each r.lines as l (l.lineId)}
					{@render lineRow(l, chipOf?.(l) ?? null)}
				{/each}
			</ul>
		</li>
	{/each}
{/snippet}

<div class="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start">
	<aside class="lg:sticky lg:top-4">
		<DayPicker {kitchenId} bind:value={date} label="Jump to a delivery day" />
	</aside>

	<div class="flex min-w-0 flex-col gap-5">
		{#if basket}<Ledger {ledger} {ondecide} {onorder} />{/if}
		<div class="flex flex-wrap items-center justify-between gap-2">
			<h1 class="text-title font-semibold tracking-[-0.015em] text-ink">Basket</h1>
			<div
				class="inline-flex rounded-md border border-rule-strong p-0.5 text-meta"
				role="radiogroup"
				aria-label="Arrange lines"
			>
				{#each [['source', 'By source', ListFilter], ['stage', 'By stage', Rows3]] as const as [m, label, Icon] (m)}
					<button
						type="button"
						role="radio"
						aria-checked={mode === m}
						class="inline-flex h-7 items-center gap-1 rounded px-2.5 {mode === m
							? 'bg-ink text-sheet'
							: 'text-ink-2 hover:text-ink'}"
						onclick={() => (mode = m)}><Icon size={13} aria-hidden="true" />{label}</button
					>
				{/each}
			</div>
		</div>

		{#if (basket as { truncated?: boolean } | null)?.truncated}
			<p class="text-meta text-ink-3">
				This sandbox has a long history; older plans may be missing here.
			</p>
		{/if}
		{#if failed}
			<p class="rounded-md border border-rule p-3 text-body text-ink-2" role="alert">
				The basket didn't load. The plan on its own still works from its tab.
			</p>
		{:else if !basket}
			<div class="h-48 animate-pulse rounded-lg bg-well/60" aria-label="Loading the basket"></div>
		{:else if !days.length || pickedEmpty}
			<NothingPlanned
				showDays={false}
				{kitchenId}
				{kitchenName}
				bind:date
				onplanned={onopen}
				{onask}
			/>
		{:else}
			{#each days as d (d.date)}
				{@const action = dayAction(d)}
				{@const shares = budgetShares(d)}
				{@const cannot = cannotOrder(d)}
				<section
					id="basket-{d.date}"
					class="scroll-mt-4 rounded-lg border bg-sheet {d.date === date
						? 'border-accent'
						: 'border-rule'}"
					aria-labelledby="basket-{d.date}-h"
				>
					<header class="flex flex-col gap-1 border-b border-rule px-4 py-3">
						<h2 id="basket-{d.date}-h" class="text-heading font-semibold text-ink">
							{dayHeadline(d)}
						</h2>
						{#if action}
							<p class="flex items-start gap-1.5 text-body text-ink">
								<CircleAlert size={15} class="mt-0.5 shrink-0 text-signoff" aria-hidden="true" />
								{action}
							</p>
						{/if}
						{#if shares}
							<div class="mt-1 flex items-center gap-2">
								<div
									class="relative h-1.5 w-full max-w-[220px] overflow-hidden rounded-full bg-well"
									aria-hidden="true"
								>
									<span
										class="absolute inset-y-0 left-0 bg-accent/30"
										style="width:{shares.ifAll * 100}%"
									></span>
									<span
										class="absolute inset-y-0 left-0 bg-accent"
										style="width:{shares.ordered * 100}%"
									></span>
								</div>
								<span class="text-meta text-ink-2">{budgetSentence(d)}</span>
							</div>
						{/if}
						{#if cannot}
							<details class="text-meta text-ink-2">
								<summary class="cursor-pointer text-ink-2 hover:text-ink"
									>{cannot.headline}: Valio can't supply them as listed</summary
								>
								<ul class="mt-1 list-disc pl-5 text-ink-3">
									{#each cannot.names as n (n)}<li>{n}</li>{/each}
								</ul>
							</details>
						{/if}
					</header>

					{#if mode === 'source'}
						{#each groupBySource(d) as g (g.source.planId)}
							<div class="border-t border-rule first:border-t-0">
								<div
									class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 bg-paper/60 px-3 py-2"
								>
									<button
										type="button"
										class="inline-flex min-w-0 items-center gap-2 text-left hover:underline"
										onclick={() => onopen(g.source.planId)}
									>
										<span class="rounded-full bg-ink px-2 py-0.5 text-micro font-medium text-sheet"
											>{g.chip}</span
										>
										<span class="truncate text-meta text-ink-2"
											>{g.lines.length} line{g.lines.length === 1 ? '' : 's'} · {money(
												g.cents
											)}</span
										>
									</button>
									<span class="flex flex-wrap gap-2">
										{#if g.held}
											<button
												type="button"
												class="inline-flex h-8 items-center rounded-md border border-rule-strong px-3 text-meta font-medium text-ink hover:border-accent"
												onclick={() => ondecide(g.source.planId)}>Decide · {g.held} waiting</button
											>
										{/if}
										{#if g.orderable}
											<button
												type="button"
												class="inline-flex h-8 items-center gap-1 rounded-md bg-accent px-3 text-meta font-medium text-sheet hover:bg-accent-ink"
												onclick={() => onorder(g.source.planId)}
												>Order {g.orderable} line{g.orderable === 1 ? '' : 's'} now<ArrowRight
													size={13}
													aria-hidden="true"
												/></button
											>
										{/if}
									</span>
								</div>
								<ul>
									{@render stageGroups(g.lines, null)}
								</ul>
							</div>
						{/each}
					{:else}
						{@const chips = new Map(flatByStage(d).map((x) => [x.line.lineId, x.chip]))}
						<ul>
							{@render stageGroups(d.lines, (l) => chips.get(l.lineId) ?? '')}
						</ul>
					{/if}
				</section>
			{/each}
			<button
				type="button"
				class="inline-flex h-10 items-center justify-center gap-2 self-start rounded-md border border-rule-strong bg-sheet px-4 text-body text-ink hover:border-accent"
				onclick={() => onask(date)}
			>
				<Bot size={16} aria-hidden="true" />
				{date ? `Add something for ${dayLabel(date)}` : 'Add something: ask the agent'}
			</button>
		{/if}
	</div>
</div>
