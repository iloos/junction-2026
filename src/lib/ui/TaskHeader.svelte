<script lang="ts">
	/**
	 * The procurement task in one block: what it is, how many decisions are left and by when, and how certain the
	 * cover is (each need by its weakest link, D10 words and fills). After an order it reframes: what was ordered,
	 * supplier confirmed vs awaiting, and that editing is locked. One primary action, passed in by the page.
	 */
	import type { Snippet } from 'svelte';
	import { Popover } from 'bits-ui';
	import { Ban, ChevronDown, Lock, ListTodo, X } from '@lucide/svelte';
	import type { FulfilmentView } from '$lib/core/contracts';

	import { BUCKETS, needTally } from './coverage';
	import { decisionCount } from './decisions';
	import { money, storyTime } from './format';

	interface Props {
		title: string;
		/** e.g. "Sat 12 Dec · buffet · delivery Thu 10 Dec". */
		meta?: string;
		decisions: number;
		/** ISO time the decisions are due (decisionsDue). */
		due: string;
		/** Scenario "now", for the time left. */
		now?: Date | null;
		coverage: readonly FulfilmentView[];
		/** More about the cover (the event against a normal week), folded under the cover line. */
		coverMore?: Snippet;
		/** Lines that cannot be ordered at all (out, undeliverable), whether or not a substitute covers them. */
		cannot?: number;
		/** Lines that can be ordered now and their total. */
		orderable?: { lines: number; cents: number };
		/** Set once the order is placed: the header becomes the order's state. */
		ordered?: { confirmed: number; awaiting: number; cents: number } | null;
		/** Lines not ordered and still orderable or decidable (a partial order keeps them open). */
		openLines?: number;
		action?: Snippet;
		/** Order what can go now (the page's own commit): the header's "can be ordered now" is the action itself. */
		onorder?: () => void;
		busy?: boolean;
		/** The kitchen's other plans in this sandbox, each with a link that opens it here. */
		others?: { id: string; title: string; open: number; ordered: number; href: string }[];
		/** Hide an "Also open" task from this browser's list. */
		ondismiss?: (id: string) => void;
		/** Cancel what is still open on that task (its lines to zero). Resolves true when done. */
		oncancel?: (id: string) => Promise<boolean>;
		/** Title, sentence and cover only: the page's action bar carries the decisions and the order (D29). */
		compact?: boolean;
		/** The group's collapse control (D30): the header owns it, with aria-expanded and aria-controls. */
		collapse?: { expanded: boolean; controls: string; ontoggle: () => void };
	}
	let {
		compact = false,
		collapse,
		title,
		meta,
		decisions,
		due,
		now = null,
		coverage,
		coverMore,
		cannot = 0,
		orderable,
		ordered = null,
		openLines = 0,
		action,
		onorder,
		busy = false,
		others = [],
		ondismiss,
		oncancel
	}: Props = $props();
	/** The "Also open" chip whose menu is open, and the one being confirmed for cancelling. */
	let menuFor = $state<string | null>(null);
	let cancelling = $state<string | null>(null);

	const t = $derived(needTally(coverage));
	/** The deadline in one short phrase for a phone: "Tue 15:00". */
	const shortDue = $derived(storyTime(due).replace(/\s\d{1,2}\s\w{3},/, ''));
	const left = $derived.by(() => {
		if (!now) return '';
		const ms = new Date(due).getTime() - now.getTime();
		if (ms <= 0) return 'past due';
		const h = Math.floor(ms / 3600_000);
		return h >= 48
			? `in ${Math.round(h / 24)} days`
			: h >= 1
				? `in ${h} h`
				: `in ${Math.ceil(ms / 60_000)} min`;
	});
	/** Each need by its weakest link, least certain last; the words and fills are BUCKETS' own (D10). */
	const TALLY = BUCKETS.map((b) => ({ k: b.key, cls: b.cls, word: b.label.toLowerCase() }));
</script>

<section aria-labelledby="task-h" class="rounded-lg border border-rule bg-sheet">
	<div class="px-4 pt-3.5 md:px-5">
		<div class="flex items-start gap-2">
			<h1 id="task-h" class="min-w-0 flex-1 text-title font-semibold tracking-[-0.01em] text-ink">
				{title}
			</h1>
			{#if collapse}
				<button
					type="button"
					aria-expanded={collapse.expanded}
					aria-controls={collapse.controls}
					aria-label={collapse.expanded ? `Collapse ${title}` : `Expand ${title}`}
					class="grid size-8 shrink-0 place-items-center rounded-md text-ink-2 hover:bg-well hover:text-ink"
					onclick={collapse.ontoggle}
					><ChevronDown
						size={16}
						class="transition-transform {collapse.expanded ? '' : '-rotate-90'}"
						aria-hidden="true"
					/></button
				>
			{/if}
		</div>
		{#if meta}<p class="text-meta text-ink-2">{meta}</p>{/if}
		{#if others.length}
			<nav
				aria-label="Other tasks in this kitchen"
				class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-ink-2"
			>
				<ListTodo size={13} class="text-ink-3" aria-hidden="true" />
				<span class="text-ink-3">Also open:</span>
				{#each others as o (o.id)}
					<!-- The page builds the href with resolve(). -->
					<!-- eslint-disable svelte/no-navigation-without-resolve -->
					<span
						class="inline-flex max-w-full min-w-0 items-center rounded-full border border-rule-strong text-ink"
					>
						<a
							href={o.href}
							class="inline-flex min-w-0 rounded-l-full py-0.5 pl-2 hover:text-accent-ink {ondismiss ||
							oncancel
								? 'pr-1'
								: 'rounded-r-full pr-2'}"
							title={o.title}
							><span class="max-w-[14rem] truncate">{o.title}</span><span
								class="shrink-0 text-ink-3"
								>&nbsp;· {o.open ? `${o.open} open` : `${o.ordered} ordered`}</span
							></a
						>
						{#if ondismiss || oncancel}
							<Popover.Root
								open={menuFor === o.id}
								onOpenChange={(v) => {
									menuFor = v ? o.id : null;
									cancelling = null;
								}}
							>
								<Popover.Trigger
									class="grid size-6 place-items-center rounded-r-full text-ink-3 hover:text-ink"
									aria-label="Hide or cancel: {o.title}"
									><X size={13} aria-hidden="true" /></Popover.Trigger
								>
								<Popover.Portal>
									<Popover.Content
										sideOffset={4}
										align="start"
										class="z-50 w-[min(280px,calc(100vw-24px))] rounded-lg border border-rule bg-sheet p-2 text-meta text-ink-2 shadow-lg"
									>
										{#if cancelling === o.id}
											<p class="px-1 text-ink">
												Cancel the {o.open} open {o.open === 1 ? 'line' : 'lines'}? They go to zero
												and nothing is bought.{o.ordered
													? ` The ${o.ordered} ordered ${o.ordered === 1 ? 'line stays' : 'lines stay'} ordered.`
													: ''}
											</p>
											<div class="mt-2 flex gap-2">
												<button
													type="button"
													class="h-8 flex-1 rounded-md bg-ink px-3 font-medium text-sheet disabled:opacity-50"
													disabled={busy}
													onclick={async () => {
														if (await oncancel?.(o.id)) menuFor = null;
													}}>Cancel the lines</button
												>
												<button
													type="button"
													class="h-8 rounded-md px-3 hover:bg-well hover:text-ink"
													onclick={() => (cancelling = null)}>Keep</button
												>
											</div>
										{:else}
											{#if ondismiss}
												<button
													type="button"
													class="block w-full rounded-md px-2 py-1.5 text-left hover:bg-well hover:text-ink"
													onclick={() => {
														ondismiss(o.id);
														menuFor = null;
													}}>Hide from this list</button
												>
											{/if}
											{#if oncancel && o.open}
												<button
													type="button"
													class="block w-full rounded-md px-2 py-1.5 text-left hover:bg-well hover:text-ink"
													onclick={() => (cancelling = o.id)}
													>Cancel its {o.open} open {o.open === 1 ? 'line' : 'lines'}…</button
												>
											{/if}
										{/if}
									</Popover.Content>
								</Popover.Portal>
							</Popover.Root>
						{/if}
					</span>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{/each}
			</nav>
		{/if}
	</div>

	{#if !compact}<div
			class="mt-3 flex flex-col gap-3 border-t border-rule px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between md:px-5"
		>
			<div class="min-w-0">
				{#if ordered && (decisions > 0 || openLines > 0)}
					<!-- A partial order: what went, and what still needs the chef; only ordered lines are locked. -->
					<p class="text-display font-semibold tracking-[-0.015em] text-ink">
						<span class="mono">{ordered.confirmed + ordered.awaiting}</span>
						{ordered.confirmed + ordered.awaiting === 1 ? 'line' : 'lines'} ordered
						<span class="text-ink-2">·</span>
						{decisions > 0 ? `${decisionCount(decisions)} left` : `${openLines} open`}
					</p>
					<p class="mt-1 text-body text-ink-2">
						<span class="mono text-ink">{money(ordered.cents)}</span> ordered:
						<span class="mono text-ink">{ordered.confirmed}</span> supplier confirmed,
						<span class="mono text-ink">{ordered.awaiting}</span> awaiting the supplier. Ordered lines
						are locked; the rest can still change.
					</p>
				{:else if ordered}
					<p
						class="flex items-center gap-2 text-display font-semibold tracking-[-0.015em] text-ink"
					>
						<Lock size={22} aria-hidden="true" /> Ordered
					</p>
					<p class="mt-1 text-body text-ink-2">
						<span class="mono text-ink">{ordered.confirmed}</span> supplier confirmed,
						<span class="mono text-ink">{ordered.awaiting}</span> awaiting the supplier ·
						<span class="mono text-ink">{money(ordered.cents)}</span>. Editing is locked.
					</p>
				{:else}
					<p class="text-title font-semibold tracking-[-0.015em] text-ink sm:text-display">
						{decisionCount(decisions)}
						{#if decisions > 0}<span class="text-ink-2">before</span>
							<!-- One line on a phone ("Tue 15:00"); the full date in the big mono from sm. -->
							<span class="mono whitespace-nowrap sm:hidden">{shortDue}</span><span
								class="mono hidden whitespace-nowrap sm:inline">{storyTime(due)}</span
							>{/if}
					</p>
					<p class="mt-1 text-body text-ink-2">
						{#if decisions > 0}{left ? `Due ${left}. ` : ''}Each decision is approved on its own.{:else}Nothing
							needs you: every open line is within the mandate.{/if}
						{#if orderable?.lines && !onorder}
							<span class="text-ink"
								><span class="mono">{orderable.lines}</span> lines,
								<span class="mono">{money(orderable.cents)}</span> can be ordered now.</span
							>{/if}
					</p>
					{#if orderable?.lines && onorder}
						<!-- What can go now is the action, up here where it is seen; primary only when nothing needs the chef. -->
						<button
							type="button"
							class="mt-2.5 inline-flex h-10 items-center gap-2 rounded-md px-4 text-body font-medium disabled:opacity-50 {decisions >
							0
								? 'border border-accent text-accent-ink hover:bg-accent-wash'
								: 'bg-accent text-sheet hover:bg-accent-ink'}"
							disabled={busy}
							onclick={onorder}
							>Order {orderable.lines}
							{orderable.lines === 1 ? 'line' : 'lines'} now ·
							<span class="mono">{money(orderable.cents)}</span></button
						>
					{/if}
				{/if}
			</div>
			{#if action}<div class="shrink-0">{@render action()}</div>{/if}
		</div>{/if}

	{#if coverage.length}
		{#if coverMore}
			<details class="group border-t border-rule px-4 py-2 md:px-5">
				<summary class="flex cursor-pointer list-none items-center gap-2">
					<ul
						class="flex flex-wrap gap-x-4 gap-y-1 text-meta text-ink-2"
						aria-label="Dishes by how certain their cover is"
					>
						{#each TALLY as x (x.k)}
							{#if t[x.k] > 0}
								<li class="flex items-center gap-1.5">
									<span class="{x.cls} h-2.5 w-4 rounded-[2px]" aria-hidden="true"></span>
									<span class="mono text-ink">{t[x.k]}</span>
									{t[x.k] === 1 ? 'need' : 'needs'}
									{x.word}
								</li>
							{/if}
						{/each}
						{#if cannot > 0}
							<li class="flex items-center gap-1.5">
								<Ban size={13} class="text-sup-missing" aria-hidden="true" />
								<span class="mono text-ink">{cannot}</span>
								{cannot === 1 ? 'product' : 'products'} can't be ordered
							</li>
						{/if}
					</ul>
					<ChevronDown
						size={14}
						class="ml-auto shrink-0 text-ink-3 transition-transform group-open:rotate-180"
						aria-hidden="true"
					/><span class="sr-only">More about the cover</span>
				</summary>
				<div class="mt-1.5 text-meta text-ink-2">{@render coverMore()}</div>
			</details>
		{:else}
			<ul
				class="flex flex-wrap gap-x-4 gap-y-1 border-t border-rule px-4 py-2.5 text-meta text-ink-2 md:px-5"
				aria-label="Dishes by how certain their cover is"
			>
				{#each TALLY as x (x.k)}
					{#if t[x.k] > 0}
						<li class="flex items-center gap-1.5">
							<span class="{x.cls} h-2.5 w-4 rounded-[2px]" aria-hidden="true"></span>
							<span class="mono text-ink">{t[x.k]}</span>
							{t[x.k] === 1 ? 'need' : 'needs'}
							{x.word}
						</li>
					{/if}
				{/each}
				{#if cannot > 0}
					<li class="flex items-center gap-1.5">
						<Ban size={13} class="text-sup-missing" aria-hidden="true" />
						<span class="mono text-ink">{cannot}</span>
						{cannot === 1 ? 'product' : 'products'} can't be ordered
					</li>
				{/if}
			</ul>
		{/if}
	{/if}
</section>
