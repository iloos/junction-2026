<script lang="ts">
	/**
	 * The plan's timeline in one line (replaces the By-when chart): "Order by Tue 8 Dec, 15:00 (in 23 h) → delivery
	 * Thu 10 Dec → buffet Sat 12 Dec", with three dots on a thin line, the current step filled, the order-by step in
	 * amber once under a day away. The Stock/Terminal detail sits behind ⓘ.
	 */
	import { Info } from '@lucide/svelte';
	import { day, storyTime } from './format';

	let {
		orderBy,
		delivery,
		event = null,
		now = null,
		note = null
	}: {
		/** ISO time the order must go by. */
		orderBy: string | null;
		/** Delivery date, YYYY-MM-DD. */
		delivery: string;
		/** The event the plan is for: its name and date. */
		event?: { label: string; date: string } | null;
		now?: Date | null;
		note?: string | null;
	} = $props();

	const hoursLeft = $derived(
		orderBy && now ? (new Date(orderBy).getTime() - now.getTime()) / 3_600_000 : null
	);
	const left = $derived(
		hoursLeft === null
			? ''
			: hoursLeft <= 0
				? 'passed'
				: hoursLeft < 48
					? `in ${Math.max(1, Math.round(hoursLeft))} h`
					: `in ${Math.round(hoursLeft / 24)} days`
	);
	/** 0: ordering is open; 1: ordered or past the cut-off, waiting for delivery; 2: delivered. */
	const step = $derived(
		hoursLeft !== null && hoursLeft > 0
			? 0
			: now && now.toISOString().slice(0, 10) > delivery
				? 2
				: 1
	);
	const urgent = $derived(hoursLeft !== null && hoursLeft > 0 && hoursLeft < 24);
	const steps = $derived(
		[
			orderBy ? `Order by ${storyTime(orderBy)}${left ? ` (${left})` : ''}` : null,
			`delivery ${day(delivery)}`,
			event ? `${event.label} ${day(event.date)}` : null
		].filter((x): x is string => !!x)
	);
</script>

<p class="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-ink-2" aria-label="Timeline">
	<span class="relative inline-flex h-3 w-14 shrink-0 items-center" aria-hidden="true">
		<span class="absolute inset-x-1 h-px bg-rule-strong"></span>
		{#each steps.keys() as i (i)}
			<span
				class="relative size-2 rounded-full border {i === step
					? i === 0 && urgent
						? 'border-signoff bg-signoff'
						: 'border-accent bg-accent'
					: i < step
						? 'border-ink-3 bg-ink-3'
						: 'border-rule-strong bg-sheet'}"
				style="margin-left: {i === 0 ? 0 : 'auto'}"
			></span>
		{/each}
	</span>
	{#each steps as s, i (i)}
		{#if i > 0}<span class="text-ink-3" aria-hidden="true">→</span>{/if}
		<span class={i === 0 && urgent ? 'font-medium text-signoff' : i === step ? 'text-ink' : ''}
			>{s}</span
		>
	{/each}
	{#if note}<span class="inline-flex text-ink-3" title={note}
			><Info size={13} aria-label={note} /></span
		>{/if}
</p>
