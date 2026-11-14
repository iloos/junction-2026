<script lang="ts">
	import { ArrowRight, Check, CircleAlert, OctagonX, Save } from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import SourceTag from '$lib/ui/SourceTag.svelte';
	import { day, num } from '$lib/ui/format';
	import type { MenuPlanResult, MenuView } from './types';
	import { measureWords } from './words';

	/**
	 * The chef's review of a menu proposal: dishes, each ingredient's amount per guest (editable), the product it
	 * resolved to or why it did not, and the rubric's issues. Saving amounts makes a new revision; accepting records
	 * the review on the server; planning hands the accepted revision to plan_event.
	 */
	interface Props {
		view: MenuView;
		busy: boolean;
		plan: MenuPlanResult | null;
		onedit: (edits: { ingredientId: string; amountPerCover: number }[]) => void;
		onaccept: () => void;
		onplan: () => void;
	}
	let { view, busy, plan, onedit, onaccept, onplan }: Props = $props();

	const p = $derived(view.proposal);
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
			{#each blocks as i (i.id)}<li
					class="flex gap-2 rounded-md border border-out/30 bg-out-wash px-2.5 py-1.5 text-ink"
				>
					<OctagonX size={14} class="mt-0.5 shrink-0 text-out" aria-hidden="true" />{i.text}
				</li>{/each}
			{#each warns as i (i.id)}<li class="flex gap-2 px-2.5 py-0.5 text-ink-2">
					<CircleAlert size={14} class="mt-0.5 shrink-0 text-signoff" aria-hidden="true" />{i.text}
				</li>{/each}
		</ul>
	{/if}

	<ol class="mt-2 divide-y divide-rule">
		{#each p.dishes as d (d.id)}
			<li class="px-3 py-2.5">
				<p class="flex flex-wrap items-baseline gap-x-2">
					<b class="font-medium">{d.name}</b>
					{#if d.course}<span class="text-meta text-ink-3">{d.course}</span>{/if}
					{#each d.claimedCompatible as c (c)}<span
							class="rounded border border-accent/30 bg-accent-wash px-1.5 text-micro text-accent-ink"
							title="Claimed by the proposal; the allergen records are checked when planned"
							>{c}</span
						>{/each}
				</p>
				<ul class="mt-1.5 space-y-1.5">
					{#each d.ingredients as i (i.id)}
						{@const mine = i.provenance.source === 'user'}
						<li class="grid grid-cols-[1fr_auto] items-start gap-x-3">
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
		<div class="mt-2 flex flex-wrap gap-2">
			{#if !accepted}
				<button
					type="button"
					disabled={busy || !edits.length || invalid}
					onclick={() => onedit(edits)}
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
						? 'Fix the red checks first'
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
		{#if plan?.state === 'planned'}
			<p class="mt-2 text-body text-ink" data-testid="menu-planned">
				Planned: {plan.plan.needs.length} needs, {plan.plan.lines.length} lines.
				<a
					href={resolve('/') + plan.kitchenUrl.slice(1)}
					class="inline-flex items-center gap-1 font-medium text-accent-ink underline"
					>Open the plan in your Kitchen <ArrowRight size={14} aria-hidden="true" /></a
				>
			</p>
		{:else if plan?.state === 'next'}
			<p
				class="mt-2 rounded-md border border-rule bg-sheet px-2.5 py-1.5 text-body text-ink-2"
				data-testid="menu-planning-next"
			>
				<b class="font-medium text-ink">Planning: next.</b>
				{plan.message}
			</p>
		{/if}
	</footer>
</section>
