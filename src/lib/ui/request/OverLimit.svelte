<script lang="ts">
	import { Scale, CalendarRange, Pencil } from '@lucide/svelte';
	import { day, money, num } from '$lib/ui/format';
	import type { DayOptionView, LookupView } from './types';

	/**
	 * An order too large to place: the honest reason (the size checks) and the useful ways forward. Over the hard limit
	 * no approval can pass it, so the choices are the most this kitchen allows, the same amount split across delivery
	 * days, or a changed request; raising the mandate stays a sentence, since only the mandate's owner can.
	 */
	interface Props {
		lookup: LookupView;
		/** Nothing was placed yet: the choices apply. */
		held: boolean;
		busy: boolean;
		/** Portions of a dish, when the request is one; else amounts are scaled. */
		portions: number | null;
		/** The items' amounts, when not a dish: the most allowed is said in them. */
		amounts?: { qty: number | null; unit: string; what: string }[];
		/** The delivery date of this order. */
		date: string;
		/** Scale every amount by `factor` (≤ 1): the most allowed. */
		onmax: (factor: number) => void;
		/** Order the first of `parts` deliveries now: this share of the amount on `date`. */
		onsplit: (factor: number, date: string, plan: { date: string }[]) => void;
		onchange: () => void;
		/** Under the hard limit but unusually large: place it for approval. */
		onplace: () => void;
	}
	let {
		lookup,
		held,
		busy,
		portions,
		amounts = [],
		date,
		onmax,
		onsplit,
		onchange,
		onplace
	}: Props = $props();
	const most = (q: number, unit: string) => {
		const step = unit === 'kg' || unit === 'l' ? 10 : 1;
		return Math.floor(q * factor * step) / step;
	};

	/** Headroom for rounding up to whole packs, so the scaled order lands under the limit. */
	const HEADROOM = 0.97;
	const hard = $derived(lookup.hardLimit);
	const factor = $derived(hard ? (hard.limitCents / hard.totalCents) * HEADROOM : 1);
	const maxPortions = $derived(portions !== null ? Math.floor(portions * factor) : null);
	const parts = $derived(hard ? Math.ceil(1 / factor) : 1);
	const days = $derived.by((): DayOptionView[] => {
		const open = (lookup.days ?? []).filter((d) => d.open && d.receiving && d.date >= date);
		return open.slice(0, parts);
	});
	const each = $derived(portions !== null ? Math.ceil(portions / parts) : null);
</script>

<div class="mt-3 rounded-lg border border-out/35 bg-out-wash px-3 py-2.5 text-body" role="alert">
	<p class="font-medium text-out">
		{hard ? 'Over the hard limit' : 'Unusually large order'}{held ? ': nothing placed yet' : ''}
	</p>
	<ul class="mt-1 space-y-0.5 text-ink">
		{#each lookup.sanity as w (w)}<li>· {w}.</li>{/each}
	</ul>
	{#if held}
		<div class="mt-2 grid gap-1.5 sm:grid-cols-3" data-testid="over-limit-options">
			{#if hard}
				<button
					type="button"
					disabled={busy}
					onclick={() => onmax(factor)}
					class="flex flex-col items-start gap-0.5 rounded-md border border-rule-strong bg-sheet px-3 py-2 text-left hover:border-accent/60 disabled:opacity-50"
				>
					<span class="flex items-center gap-1.5 font-medium text-ink"
						><Scale size={14} aria-hidden="true" /> Order the most this kitchen allows</span
					>
					<span class="text-meta text-ink-2"
						>{maxPortions !== null
							? `${num(maxPortions)} portions`
							: amounts.length && amounts.every((a) => a.qty !== null)
								? amounts
										.map((a) => `${num(most(a.qty!, a.unit), 1)} ${a.unit} ${a.what}`)
										.join(', ')
								: `${num(factor * 100, 0)}% of each amount`}, about {money(
							hard.limitCents * HEADROOM,
							{ whole: true }
						)}</span
					>
				</button>
				{#if parts > 1 && days.length === parts}
					<button
						type="button"
						disabled={busy}
						onclick={() => onsplit(1 / parts, days[0].date, days)}
						class="flex flex-col items-start gap-0.5 rounded-md border border-rule-strong bg-sheet px-3 py-2 text-left hover:border-accent/60 disabled:opacity-50"
					>
						<span class="flex items-center gap-1.5 font-medium text-ink"
							><CalendarRange size={14} aria-hidden="true" /> Split across {parts} delivery days</span
						>
						<span class="text-meta text-ink-2"
							>{days.map((d) => day(d.date)).join(', ')}{each !== null
								? `: about ${num(each)} portions each`
								: ''}. Orders the first now.</span
						>
					</button>
				{/if}
			{:else}
				<button
					type="button"
					disabled={busy}
					onclick={onplace}
					class="flex flex-col items-start gap-0.5 rounded-md border border-rule-strong bg-sheet px-3 py-2 text-left hover:border-accent/60 disabled:opacity-50"
				>
					<span class="font-medium text-ink">Place it for approval</span>
					<span class="text-meta text-ink-2"
						>The head chef approves it before anything is ordered</span
					>
				</button>
			{/if}
			<button
				type="button"
				disabled={busy}
				onclick={onchange}
				class="flex flex-col items-start gap-0.5 rounded-md border border-rule-strong bg-sheet px-3 py-2 text-left hover:border-accent/60 disabled:opacity-50"
			>
				<span class="flex items-center gap-1.5 font-medium text-ink"
					><Pencil size={14} aria-hidden="true" /> Change the request</span
				>
				<span class="text-meta text-ink-2">Edit the amount or the item above</span>
			</button>
		</div>
		{#if hard}<p class="mt-2 text-meta text-ink-2">
				To order all of it at once, the kitchen's mandate would have to be raised first: only its
				owner can do that.
			</p>{/if}
	{/if}
</div>
