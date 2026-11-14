<script lang="ts">
	import { CalendarDays } from '@lucide/svelte';
	import { day } from '$lib/ui/format';
	import type { DayOptionView } from './types';

	/**
	 * The request's delivery date: the next days with their cut-offs for this request's products. A passed cut-off is
	 * shown disabled with its reason; a later date comes from the picker. Built against the shared DayPicker contract
	 * (value YYYY-MM-DD, onselect); its days come from the lookup, so a closed day says which product closed it.
	 */
	interface Props {
		days: DayOptionView[];
		value: string;
		busy: boolean;
		/** The kitchen's usual day, when one is known: "your usual Thursday". */
		usual?: { date: string; label: string } | null;
		onselect: (date: string) => void;
	}
	let { days, value, busy, usual = null, onselect }: Props = $props();

	const hhmm = new Intl.DateTimeFormat('en-GB', {
		timeZone: 'Europe/Helsinki',
		weekday: 'short',
		hour: '2-digit',
		minute: '2-digit'
	});
	const closesText = (iso: string) => {
		const p = Object.fromEntries(hhmm.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
		return `${p.hour}:${p.minute} ${p.weekday}`;
	};
	const shown = $derived(days.filter((d) => d.receiving || d.date === value).slice(0, 6));
	const firstOpen = $derived(days.find((d) => d.open && d.receiving)?.date ?? days[0]?.date);
	const lastClosed = $derived(shown.filter((d) => !d.open && d.receiving).at(-1));
	const chosen = $derived(days.find((d) => d.date === value));
	let later = $state('');
</script>

<div class="mt-2" data-testid="delivery-days">
	<p class="flex items-center gap-1.5 text-meta text-ink-3">
		<CalendarDays size={13} aria-hidden="true" /> Delivery day
		{#if chosen && !chosen.open}<span class="text-signoff">· {day(value)} is {chosen.reason}</span
			>{/if}
	</p>
	<div class="mt-1 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Delivery day">
		{#each shown as d (d.date)}
			{@const on = d.date === value}
			<button
				type="button"
				role="radio"
				aria-checked={on}
				disabled={busy || (!d.open && !on)}
				title={d.reason ?? (d.closes ? `order by ${closesText(d.closes)}` : '')}
				onclick={() => !on && onselect(d.date)}
				class="flex min-w-[6.5rem] flex-col items-start rounded-md border px-2.5 py-1 text-left disabled:cursor-not-allowed {on
					? d.open
						? 'border-accent bg-accent text-sheet'
						: 'border-signoff bg-signoff-wash text-ink'
					: d.open
						? 'border-rule-strong bg-sheet text-ink hover:border-accent/60'
						: 'border-rule bg-well text-ink-3'}"
				data-open={d.open || undefined}
			>
				<span class="text-body font-medium">{day(d.date)}</span>
				<span class="text-micro {on && d.open ? 'text-sheet/85' : 'text-ink-3'}">
					{#if !d.open}{d.reason?.startsWith('past')
							? 'cut-off passed'
							: 'closed'}{:else if usual?.date === d.date}{usual.label}{:else if d.closes}order by {closesText(
							d.closes
						)}{/if}
				</span>
			</button>
		{/each}
		<label
			class="flex items-center gap-1 rounded-md border border-dashed border-rule-strong px-2 text-meta text-ink-2"
		>
			Later
			<input
				type="date"
				min={firstOpen}
				bind:value={later}
				disabled={busy}
				onchange={() => later && later >= (firstOpen ?? '') && onselect(later)}
				class="h-8 bg-transparent text-body text-ink"
				aria-label="A later delivery date"
			/>
		</label>
	</div>
	{#if lastClosed?.reason && chosen?.open}
		<p class="mt-1 text-micro text-ink-2">{day(lastClosed.date)} is {lastClosed.reason}.</p>
	{/if}
</div>
