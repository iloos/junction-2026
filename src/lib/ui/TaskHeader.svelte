<script lang="ts">
	/**
	 * The procurement task in one block: what it is, how many decisions are left and by when, and how certain the
	 * cover is (each need by its weakest link, D10 words and fills). After an order it reframes: what was ordered,
	 * supplier confirmed vs awaiting, and that editing is locked. One primary action, passed in by the page.
	 */
	import type { Snippet } from 'svelte';
	import { Ban, Lock, ListTodo } from '@lucide/svelte';
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
		/** Lines that cannot be ordered at all (out, undeliverable), whether or not a substitute covers them. */
		cannot?: number;
		/** Lines that can be ordered now and their total. */
		orderable?: { lines: number; cents: number };
		/** Set once the order is placed: the header becomes the order's state. */
		ordered?: { confirmed: number; awaiting: number; cents: number } | null;
		action?: Snippet;
		/** The kitchen's other plans in this sandbox, each with a link that opens it here. */
		others?: { id: string; title: string; open: number; ordered: number; href: string }[];
	}
	let {
		title,
		meta,
		decisions,
		due,
		now = null,
		coverage,
		cannot = 0,
		orderable,
		ordered = null,
		action,
		others = []
	}: Props = $props();

	const t = $derived(needTally(coverage));
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
		<h1 id="task-h" class="text-title font-semibold tracking-[-0.01em] text-ink">{title}</h1>
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
					<a
						href={o.href}
						class="inline-flex max-w-full min-w-0 rounded-full border border-rule-strong px-2 py-0.5 text-ink hover:border-accent hover:text-accent-ink"
						title={o.title}
						><span class="max-w-[14rem] truncate">{o.title}</span><span class="shrink-0 text-ink-3"
							>&nbsp;· {o.open ? `${o.open} open` : `${o.ordered} ordered`}</span
						></a
					>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{/each}
			</nav>
		{/if}
	</div>

	<div
		class="mt-3 flex flex-col gap-3 border-t border-rule px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between md:px-5"
	>
		<div class="min-w-0">
			{#if ordered}
				<p class="flex items-center gap-2 text-display font-semibold tracking-[-0.015em] text-ink">
					<Lock size={22} aria-hidden="true" /> Ordered
				</p>
				<p class="mt-1 text-body text-ink-2">
					<span class="mono text-ink">{ordered.confirmed}</span> supplier confirmed,
					<span class="mono text-ink">{ordered.awaiting}</span> awaiting the supplier ·
					<span class="mono text-ink">{money(ordered.cents)}</span>. Editing is locked.
				</p>
			{:else}
				<p class="text-display font-semibold tracking-[-0.015em] text-ink">
					{decisionCount(decisions)}
					{#if decisions > 0}<span class="text-ink-2">before</span>
						<span class="mono whitespace-nowrap">{storyTime(due)}</span>{/if}
				</p>
				<p class="mt-1 text-body text-ink-2">
					{#if decisions > 0}{left ? `Due ${left}. ` : ''}Each decision is approved on its own.{:else}Nothing
						needs you: every open line is within the mandate.{/if}
					{#if orderable?.lines}
						<span class="text-ink"
							><span class="mono">{orderable.lines}</span> lines,
							<span class="mono">{money(orderable.cents)}</span> can be ordered now.</span
						>{/if}
				</p>
			{/if}
		</div>
		{#if action}<div class="shrink-0">{@render action()}</div>{/if}
	</div>

	{#if coverage.length}
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
</section>
