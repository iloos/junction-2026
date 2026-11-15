<script lang="ts">
	/**
	 * The compare panel behind a line's "Swap" (D28), the same on the page and in a dock card: the agent's pick and up
	 * to four alternatives as Rows (photo, one reason, price per kg or l), steer chips that re-run the search, a
	 * "something else…" search and Browse all. Picking anything is allowed and says whose choice it was; a hard rule
	 * still refuses, and the refusal names the rule. Picks go through edit_line, like every other change to a line.
	 */
	import { LoaderCircle, Search } from '@lucide/svelte';
	import { call, ToolError } from '$lib/kitchen/api';
	import Row from './Row.svelte';
	import ProductThumb from './ProductThumb.svelte';
	import { loadCard } from './product-card';
	import { money, readableName, unitWord } from './format';
	import { errorWords } from '$lib/kitchen/error-words';
	import { STEERS, pickWords, swapRows, withAlternatives, type Steer, type SwapRow } from './swap';

	let {
		planId,
		version,
		lineId,
		current,
		deliverBy,
		onchanged,
		onclose
	}: {
		planId: string;
		/** The plan version on screen: a stale view is refused, never silently applied. */
		version: number;
		lineId: string;
		current: { productId: string; name: string };
		deliverBy?: string;
		/** A pick went through: the page re-reads the plan. */
		onchanged: () => void;
		onclose?: () => void;
	} = $props();

	let rows = $state.raw<SwapRow[]>([]);
	let loading = $state(false);
	let failed = $state<string | null>(null);
	let steer = $state<Steer | null>(null);
	let query = $state('');
	let hits = $state.raw<SwapRow[]>([]);
	let picking = $state<string | null>(null);
	let refusal = $state<string | null>(null);
	let prices = $state.raw<Record<string, string>>({});

	async function rank(s: Steer | null, text?: string) {
		loading = true;
		failed = null;
		try {
			const r = await call('live', 'find_substitutes', {
				planId,
				version,
				lineId,
				apply: false,
				...(s?.rankBy ? { rankBy: s.rankBy } : {}),
				...(s?.steer || text ? { steer: { ...(s?.steer ?? {}), ...(text ? { text } : {}) } } : {})
			});
			// The pick (the agent's choice) comes sized like the alternatives, so its row has a total too.
			rows = withAlternatives(
				swapRows(r.candidates, current.productId),
				[...(r.pick ? [r.pick] : []), ...(r.alternatives ?? [])],
				current.productId
			);
		} catch (e) {
			failed =
				e instanceof ToolError && /does not send/.test(e.error.message)
					? "Comparing isn't available here yet."
					: e instanceof ToolError
						? errorWords(e.error)
						: "The alternatives didn't load.";
		} finally {
			loading = false;
		}
	}
	$effect(() => {
		void [planId, version, lineId];
		void rank(null);
	});

	// Price per kg or l for each row shown, from the product card (read once per product per page).
	$effect(() => {
		const ids = [...rows, ...hits].map((r) => r.productId).filter((id) => !(id in prices));
		for (const id of ids)
			void loadCard(id, deliverBy)
				.then((c) => {
					const cmp = c.price?.comparison;
					const v = cmp
						? `${money(cmp.cents)}/${cmp.unit}`
						: c.price
							? `${money(c.price.cents)}/${c.price.per}`
							: '';
					prices = { ...prices, [id]: v };
				})
				.catch(() => (prices = { ...prices, [id]: '' }));
	});

	function chip(s: Steer) {
		steer = steer?.id === s.id ? null : s;
		void rank(steer);
	}

	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	function search() {
		clearTimeout(searchTimer);
		const q = query.trim();
		if (q.length < 2) {
			hits = [];
			return;
		}
		searchTimer = setTimeout(async () => {
			try {
				const r = await call('live', 'search_products', { query: q, limit: 8 });
				hits = r.products
					.filter((p) => p.productId !== current.productId)
					.map((p) => ({
						productId: p.productId,
						name: p.nameFi,
						reason: p.brand ? `${p.brand}` : 'From the catalogue',
						pick: false,
						refused: null
					}));
			} catch {
				hits = [];
			}
		}, 250);
	}

	async function pick(r: SwapRow) {
		picking = r.productId;
		refusal = null;
		try {
			await call('live', 'edit_line', {
				planId,
				version,
				lineId,
				patch: { productId: r.productId }
			});
			onchanged();
			onclose?.();
		} catch (e) {
			refusal = e instanceof ToolError ? errorWords(e.error) : 'That swap did not go through.';
		} finally {
			picking = null;
		}
	}
</script>

{#snippet option(r: SwapRow, mine: boolean)}
	<Row
		icon
		value={r.total
			? money(r.total.cents)
			: prices[r.productId] || (r.pick ? 'price on order' : null)}
		class="border-t border-rule/60"
	>
		{#snippet lead()}<ProductThumb productId={r.productId} size={32} />{/snippet}
		<span class={r.refused ? 'text-ink-3' : 'text-ink'}>{readableName(r.name)}</span>
		{#snippet sub()}
			{#if r.total}<span class="mono text-ink-2"
					>{r.total.qty
						? `${r.total.qty.value} ${unitWord(r.total.qty.unit, r.total.qty.value)} · `
						: ''}{r.per ? `${money(r.per.cents)}/${r.per.per}` : prices[r.productId]}</span
				><br />{/if}
			{#if r.refused}<span class="text-out">Can't pick: {r.refused}</span>{:else}{r.reason}{/if}
		{/snippet}
		{#snippet end()}
			{#if !r.refused}
				<button
					type="button"
					class="inline-flex h-8 items-center gap-1 rounded-md px-3 text-meta font-medium disabled:opacity-50 {r.pick &&
					!mine
						? 'bg-accent text-sheet hover:bg-accent-ink'
						: 'border border-rule-strong text-ink hover:border-accent'}"
					disabled={!!picking}
					onclick={() => pick(r)}
				>
					{#if picking === r.productId}<LoaderCircle
							size={13}
							class="animate-spin"
							aria-hidden="true"
						/>{/if}
					Use · {mine ? 'your choice' : pickWords(r).toLowerCase()}
				</button>
			{/if}
		{/snippet}
	</Row>
{/snippet}

<section
	class="rounded-lg border border-rule bg-sheet"
	aria-label="Swap {readableName(current.name)}"
>
	<header class="flex flex-wrap items-baseline justify-between gap-2 px-3 pt-3">
		<p class="text-body font-semibold text-ink">
			Swap <span class="font-normal text-ink-2">{readableName(current.name)}</span>
		</p>
		{#if onclose}<button
				type="button"
				class="text-meta text-ink-2 underline underline-offset-2 hover:text-ink"
				onclick={onclose}>Close</button
			>{/if}
	</header>

	<div class="flex flex-wrap gap-1.5 px-3 pt-2" role="group" aria-label="Steer the search">
		{#each STEERS as s (s.id)}
			<button
				type="button"
				aria-pressed={steer?.id === s.id}
				disabled={loading}
				class="rounded-full border px-2.5 py-0.5 text-meta disabled:opacity-40 {steer?.id === s.id
					? 'border-ink bg-ink text-sheet'
					: 'border-rule-strong text-ink-2 hover:text-ink'}"
				onclick={() => chip(s)}>{s.label}</button
			>
		{/each}
	</div>

	<div class="mt-2" aria-busy={loading}>
		{#if failed}
			<p class="border-t border-rule px-3 py-3 text-meta text-ink-2" role="status">{failed}</p>
		{:else if loading && !rows.length}
			<p class="flex items-center gap-2 border-t border-rule px-3 py-3 text-meta text-ink-2">
				<LoaderCircle size={14} class="animate-spin" aria-hidden="true" /> Finding alternatives…
			</p>
		{:else if !rows.length}
			<p class="border-t border-rule px-3 py-3 text-meta text-ink-2">
				No alternative found. Search for something else below.
			</p>
		{:else}
			<ul>
				{#each rows as r (r.productId)}{@render option(r, false)}{/each}
			</ul>
		{/if}
	</div>

	<div class="border-t border-rule px-3 py-2.5">
		<label
			class="flex items-center gap-2 rounded-md border border-rule bg-sheet px-2 py-1.5 text-body"
		>
			<Search size={15} class="text-ink-3" aria-hidden="true" />
			<input
				class="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-3"
				placeholder="Something else… (Enter steers) or browse all products"
				bind:value={query}
				oninput={search}
				onkeydown={(e) => {
					// Enter steers the alternatives by the chef's own words; typing alone browses the catalogue.
					if (e.key === 'Enter' && query.trim().length >= 2) void rank(steer, query.trim());
				}}
			/>
		</label>
	</div>
	{#if hits.length}
		<ul aria-label="Search results">
			{#each hits as r (r.productId)}{@render option(r, true)}{/each}
		</ul>
	{/if}
	{#if refusal}
		<p class="border-t border-rule px-3 py-2 text-meta text-out" role="alert">{refusal}</p>
	{/if}
</section>
