<script lang="ts">
	import {
		ArrowRight,
		Check,
		CircleAlert,
		CircleHelp,
		LoaderCircle,
		OctagonX,
		Save
	} from '@lucide/svelte';
	import SourceChip from '$lib/ui/SourceChip.svelte';
	import { tick } from 'svelte';
	import { resolve } from '$app/paths';
	import SourceTag from '$lib/ui/SourceTag.svelte';
	import { day, num } from '$lib/ui/format';
	import type { MenuChange, MenuPlanResult, MenuView } from './types';
	import { measureWords } from './words';

	/**
	 * The chef's review of a menu proposal: dishes, each ingredient's amount per guest (editable), the product it
	 * resolved to or why it did not, and the rubric's issues. Every change (amounts, a product turned down, an
	 * ingredient or dish removed, a shortfall kept open) makes a new revision; accepting records the review on the
	 * server; planning hands the accepted revision to plan_event. What blocks Accept is listed next to it, each with
	 * the row it is about and what the chef can do, so Accept is always reachable.
	 */
	interface Props {
		view: MenuView;
		busy: boolean;
		plan: MenuPlanResult | null;
		/** Saves the given changes plus any amounts typed and not saved yet, as one new revision. */
		onchange: (changes: MenuChange[]) => void;
		onaccept: () => void;
		onplan: () => void;
	}
	let { view, busy, plan, onchange, onaccept, onplan }: Props = $props();

	const p = $derived(view.proposal);
	const kitchenHref = $derived(
		plan?.state === 'planned' ? resolve('/') + plan.kitchenUrl.slice(1) : null
	);
	const guests = $derived(p.brief.guests);
	/** Typed amounts by ingredient id, as text; cleared when a new revision arrives. */
	let typed = $state<Record<string, string>>({});
	let seen = $state('');
	$effect.pre(() => {
		const key = `${p.id}@${p.revision}`;
		if (key !== seen) {
			seen = key;
			typed = {};
		}
	});

	/** The part of a provenance note the chef must act on ("vegan: no allergen record — check"), if any. */
	const checkNote = (note?: string) =>
		note
			?.split('; ')
			.find((x) => x.endsWith(' check'))
			?.trim() ?? null;

	const parse = (s: string) => Number(s.replace(',', '.'));
	const edits = $derived(
		p.dishes.flatMap((d) =>
			d.ingredients.flatMap((i) => {
				const t = typed[i.id];
				if (t === undefined) return [];
				const v = parse(t);
				return Number.isFinite(v) && v >= 0 && v <= 2000 && v !== i.amountPerCover
					? [{ ingredientId: i.id, amountPerCover: v }]
					: [];
			})
		)
	);
	const invalid = $derived(
		Object.values(typed).some((t) => {
			const v = parse(t);
			return !Number.isFinite(v) || v < 0 || v > 2000;
		})
	);
	const blocks = $derived(view.issues.filter((i) => i.severity === 'block'));
	/** Rows a blocking issue is about: highlighted until it is fixed. */
	const flagged = $derived(new Set(blocks.flatMap((b) => b.targets ?? [])));
	const dishOf = (id: string) => p.dishes.find((d) => d.id === id);
	const ingredientOf = (id: string) =>
		p.dishes.flatMap((d) => d.ingredients).find((i) => i.id === id);
	const label = (id: string) => dishOf(id)?.name ?? ingredientOf(id)?.label ?? id;
	const amountChanges = $derived(edits.map((e) => ({ kind: 'amount' as const, ...e })));
	function change(c: MenuChange[]) {
		onchange([...amountChanges, ...c]);
	}
	/** Scrolls to a row and focuses its amount when it has one. */
	let lit = $state<string | null>(null);
	async function show(id: string, focusAmount = false) {
		lit = id;
		await tick();
		document
			.getElementById(`menu-row-${id}`)
			?.scrollIntoView({ behavior: 'smooth', block: 'center' });
		if (focusAmount) (document.getElementById(`amt-${id}`) as HTMLInputElement | null)?.select();
	}
	const warns = $derived(view.issues.filter((i) => i.severity === 'warn'));
	const accepted = $derived(!!p.review);
	const gramsPerGuest = $derived(
		p.dishes
			.flatMap((d) => d.ingredients)
			.filter((i) => i.unit === 'g')
			.reduce((s, i) => s + i.amountPerCover, 0)
	);
	const unresolved = $derived(
		p.dishes.flatMap((d) => d.ingredients).filter((i) => i.unresolved !== undefined).length
	);
	const total = (perGuest: number, unit: string) =>
		unit === 'pcs'
			? `${num(perGuest * guests, 1)} pcs`
			: unit === 'g'
				? measureWords((perGuest * guests) / 1000, 'kg')
				: measureWords((perGuest * guests) / 1000, 'l');
	const at = (iso: string) =>
		new Intl.DateTimeFormat('en-GB', {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit',
			timeZone: 'Europe/Helsinki'
		}).format(new Date(iso));
</script>

<section
	class="mt-3 rounded-lg border border-rule-strong bg-sheet text-body"
	aria-label="Menu proposal"
	data-testid="menu-review"
>
	<header class="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-rule px-3 py-2.5">
		<h3 class="text-heading font-semibold">Menu proposal</h3>
		<span class="text-body text-ink-2"
			>{p.brief.title} · {guests} guests · {day(p.brief.date)} · revision {p.revision}</span
		>
		<span class="ml-auto flex items-center gap-1.5">
			<SourceTag source={p.provenance.source === 'llm' ? 'llm' : 'team_estimate'} compact />
			{#if accepted}<span
					class="inline-flex h-5 items-center gap-1 rounded-full bg-accent px-2 text-micro font-medium text-sheet"
					><Check size={12} aria-hidden="true" />Accepted</span
				>{/if}
		</span>
	</header>
	<p class="px-3 pt-2 text-meta text-ink-3">
		{p.provenance.source === 'llm'
			? `Dishes and amounts proposed by ${view.model}.`
			: 'Dishes and amounts from the team’s templates.'}
		Every amount is an estimate until you change it; products come from the Valio catalogue.
		{#if view.fallback}<span class="text-signoff">The model was not used: {view.fallback}.</span
			>{/if}
	</p>

	{#if blocks.length || warns.length}
		<ul class="mx-3 mt-2 space-y-1 text-body" aria-label="Checks">
			{#if blocks.length && !accepted}<li
					class="flex gap-2 rounded-md border border-out/30 bg-out-wash px-2.5 py-1.5 text-ink"
				>
					<OctagonX size={14} class="mt-0.5 shrink-0 text-out" aria-hidden="true" />
					{blocks.length} thing{blocks.length === 1 ? '' : 's'} to fix before accepting: listed next to
					Accept below, each with what you can do.
				</li>{/if}
			{#each warns as i (i.id)}<li class="flex gap-2 px-2.5 py-0.5 text-ink-2">
					<CircleAlert size={14} class="mt-0.5 shrink-0 text-signoff" aria-hidden="true" />{i.text}
				</li>{/each}
		</ul>
	{/if}

	{#if p.open.length}
		<div
			class="mx-3 mt-2 rounded-md border border-signoff/30 bg-signoff-wash px-2.5 py-1.5 text-body"
		>
			<p class="font-medium text-ink">Open on this menu</p>
			<ul class="mt-0.5 space-y-0.5 text-ink-2">
				{#each p.open as o (o.id)}<li>· {o.text}</li>{/each}
			</ul>
		</div>
	{/if}

	<ol class="mt-2 divide-y divide-rule">
		{#each p.dishes as d (d.id)}
			{@const g = view.grounding?.[d.id]}
			<li
				id="menu-row-{d.id}"
				class="px-3 py-2.5 {flagged.has(d.id) ? 'bg-out-wash' : ''} {lit === d.id
					? 'ring-2 ring-out/50 ring-inset'
					: ''}"
				data-flagged={flagged.has(d.id) || undefined}
			>
				<p class="flex flex-wrap items-baseline gap-x-2">
					<b class="font-medium">{d.name}</b>
					{#if d.course}<span class="text-meta text-ink-3">{d.course}</span>{/if}
					{#each d.claimedCompatible as c (c)}<span
							class="rounded border border-accent/30 bg-accent-wash px-1.5 text-micro text-accent-ink"
							title="Claimed by the proposal; the allergen records are checked when planned"
							>{c}</span
						>{/each}
				</p>
				{#if g}
					<div class="mt-0.5 text-meta text-ink-2" data-testid="dish-grounding">
						{#if g.state === 'pending'}
							<span class="inline-flex items-center gap-1"
								><LoaderCircle size={12} class="animate-spin" aria-hidden="true" />Looking for
								sourced recipes…</span
							>
						{:else if g.state === 'failed'}
							No sourced recipe found (the lookup failed).
						{:else}
							<span class="flex flex-wrap items-center gap-1.5">
								{#if g.matchedSources.length}
									Matches {g.matchedSources.length} sourced recipe{g.matchedSources.length === 1
										? ''
										: 's'} ({g.matchedSources.map((s) => s.host).join(', ')})
									{#each g.matchedSources as s (s.url)}<SourceChip
											api="exa"
											cache={g.source}
											at={g.at}
											href={s.url}
											label={s.host}
										/>{/each}
								{:else}
									No sourced recipe found{g.compared.length
										? ` (compared ${g.compared.length})`
										: ''}
								{/if}
							</span>
							{#each g.modelOnly as m (m)}
								<span class="flex items-center gap-1 text-signoff"
									><CircleHelp size={12} aria-hidden="true" />the model added {m}, which no source
									has</span
								>
							{/each}
							{#if g.sourceOnly.length}
								<details class="mt-0.5">
									<summary class="cursor-pointer text-ink-3">sources also use…</summary>
									<span class="text-ink-2">{g.sourceOnly.join(', ')}</span>
								</details>
							{/if}
						{/if}
					</div>
				{/if}
				<ul class="mt-1.5 space-y-1.5">
					{#each d.ingredients as i (i.id)}
						{@const mine = i.provenance.source === 'user'}
						<li
							id="menu-row-{i.id}"
							class="grid grid-cols-[1fr_auto] items-start gap-x-3 rounded-md {flagged.has(i.id)
								? '-mx-1.5 bg-out-wash px-1.5'
								: ''} {lit === i.id ? 'ring-2 ring-out/50' : ''}"
							data-flagged={flagged.has(i.id) || undefined}
						>
							<div class="min-w-0 text-body">
								<span class="text-ink">{i.label}</span>
								{#if i.productId}
									<span class="block truncate text-meta text-ink-2"
										>{view.products[i.productId] ?? i.productId}
										<span class="mono text-ink-3">{i.productId}</span></span
									>
								{:else}
									<span class="block text-meta text-signoff"
										>unresolved: {i.unresolved ?? i.query}</span
									>
								{/if}
								{#if checkNote(i.provenance.note)}
									<span
										class="mt-0.5 flex items-center gap-1 text-micro text-signoff"
										data-testid="ingredient-check"
										><CircleHelp size={12} aria-hidden="true" />{checkNote(i.provenance.note)}</span
									>
								{/if}
								{#if !accepted}
									<span class="mt-0.5 flex flex-wrap gap-x-3 text-micro">
										{#if i.productId}<button
												type="button"
												disabled={busy}
												class="text-ink-3 underline hover:text-ink disabled:opacity-40"
												onclick={() => change([{ kind: 'unresolve', ingredientId: i.id }])}
												>Not this product</button
											>{/if}
										<button
											type="button"
											disabled={busy}
											class="text-ink-3 underline hover:text-out disabled:opacity-40"
											onclick={() => change([{ kind: 'removeIngredient', ingredientId: i.id }])}
											>Remove</button
										>
									</span>
								{/if}
							</div>
							<div class="flex items-center gap-1.5 text-body">
								<label class="sr-only" for="amt-{i.id}">{i.label}, {i.unit} per guest</label>
								<input
									id="amt-{i.id}"
									inputmode="decimal"
									disabled={busy || accepted}
									value={typed[i.id] ?? String(i.amountPerCover)}
									oninput={(e) => (typed = { ...typed, [i.id]: e.currentTarget.value })}
									class="num h-8 w-16 rounded-md border bg-sheet px-1.5 text-right {typed[i.id] !==
										undefined && parse(typed[i.id]) !== i.amountPerCover
										? 'border-accent'
										: 'border-rule-strong'} disabled:bg-well"
								/>
								<span class="w-24 text-ink-2"
									>{i.unit}/guest
									<span class="block text-micro text-ink-3"
										>{mine ? 'your amount' : 'estimate'} · {total(
											typed[i.id] !== undefined && Number.isFinite(parse(typed[i.id]))
												? parse(typed[i.id])
												: i.amountPerCover,
											i.unit
										)}</span
									></span
								>
							</div>
						</li>
					{/each}
				</ul>
			</li>
		{/each}
	</ol>

	<footer class="border-t border-rule bg-well px-3 py-2.5">
		<p class="text-body text-ink-2">
			{num(gramsPerGuest, 0)} g of food per guest{unresolved
				? ` · ${unresolved} ingredient${unresolved === 1 ? '' : 's'} without a product yet (shown, not dropped)`
				: ''}
		</p>
		{#if accepted && p.review}
			<p class="mt-1 text-body text-ink">
				Accepted by the chef, {at(p.review.at)}: these estimates may be planned. It verifies no
				allergen and approves no spending.
			</p>
		{/if}
		{#if blocks.length && !accepted}
			<div
				class="mt-2 rounded-md border border-out/35 bg-sheet px-2.5 py-2"
				role="region"
				aria-label="To fix before accepting"
				data-testid="menu-blocks"
			>
				<p class="font-medium text-out">
					{blocks.length} thing{blocks.length === 1 ? '' : 's'} to fix before accepting:
				</p>
				<ol class="mt-1 space-y-2">
					{#each blocks as b (b.id)}
						{@const fixes = b.fixes ?? []}
						<li class="text-body text-ink">
							<span class="flex gap-1.5"
								><OctagonX
									size={14}
									class="mt-0.5 shrink-0 text-out"
									aria-hidden="true"
								/>{b.text}</span
							>
							<span class="mt-1 ml-5 flex flex-wrap gap-1.5">
								{#each b.targets ?? [] as t (t)}
									<button
										type="button"
										class="h-8 rounded-md border border-rule-strong px-2 text-meta text-ink-2 hover:text-ink"
										onclick={() => show(t, fixes.includes('amount'))}
										>{fixes.includes('amount') ? 'Change the amount of' : 'Show'} {label(t)}</button
									>
									{#if fixes.includes('removeIngredient') && ingredientOf(t)}<button
											type="button"
											disabled={busy}
											class="h-8 rounded-md border border-out/40 px-2 text-meta text-out hover:bg-out-wash disabled:opacity-40"
											onclick={() => change([{ kind: 'removeIngredient', ingredientId: t }])}
											>Remove {label(t)}</button
										>{/if}
									{#if fixes.includes('removeDish') && dishOf(t)}<button
											type="button"
											disabled={busy}
											class="h-8 rounded-md border border-out/40 px-2 text-meta text-out hover:bg-out-wash disabled:opacity-40"
											onclick={() => change([{ kind: 'removeDish', dishId: t }])}
											>Remove {label(t)}</button
										>{/if}
								{/each}
								{#if fixes.includes('keepOpen')}<button
										type="button"
										disabled={busy}
										class="h-8 rounded-md border border-signoff/50 px-2 text-meta text-ink hover:bg-signoff-wash disabled:opacity-40"
										title="Accept the menu knowing this is not met; it stays listed as open"
										onclick={() => change([{ kind: 'keepOpen', issueId: b.id, text: b.text }])}
										>Keep as an open item</button
									>{/if}
							</span>
						</li>
					{/each}
				</ol>
			</div>
		{/if}
		<div class="mt-2 flex flex-wrap gap-2">
			{#if !accepted}
				<button
					type="button"
					disabled={busy || !edits.length || invalid}
					onclick={() => change([])}
					class="inline-flex h-10 items-center gap-1.5 rounded-md border border-rule-strong bg-sheet px-3 text-body text-ink hover:border-accent/50 disabled:opacity-40"
				>
					<Save size={15} aria-hidden="true" /> Save {edits.length || ''} amount{edits.length === 1
						? ''
						: 's'}
				</button>
				<button
					type="button"
					disabled={busy || edits.length > 0 || invalid || blocks.length > 0}
					onclick={onaccept}
					class="inline-flex h-10 items-center gap-1.5 rounded-md bg-accent px-4 text-body font-medium text-sheet hover:bg-accent-ink disabled:opacity-40"
					title={blocks.length
						? 'Fix the items listed above first'
						: edits.length
							? 'Save your amounts first'
							: undefined}
				>
					<Check size={15} aria-hidden="true" /> Accept this menu
				</button>
			{:else if !plan}
				<button
					type="button"
					disabled={busy}
					onclick={onplan}
					class="inline-flex h-10 items-center gap-1.5 rounded-md bg-accent px-4 text-body font-medium text-sheet hover:bg-accent-ink disabled:opacity-40"
				>
					Plan it <ArrowRight size={15} aria-hidden="true" />
				</button>
			{/if}
		</div>
		<!-- eslint-disable svelte/no-navigation-without-resolve -- kitchen deep link with query, built from resolve('/') -->
		{#if plan?.state === 'planned'}
			<p class="mt-2 text-body text-ink" data-testid="menu-planned">
				Planned: {plan.plan.needs.length} needs, {plan.plan.lines.length} lines.
				<a
					href={kitchenHref}
					class="inline-flex items-center gap-1 font-medium text-accent-ink underline"
					>Open the plan in your Kitchen <ArrowRight size={14} aria-hidden="true" /></a
				>
			</p>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{/if}
	</footer>
</section>
