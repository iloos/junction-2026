<script lang="ts">
	/**
	 * A kitchen with nothing planned for the day in view: pick the delivery day, plan its usual order (U's
	 * UsualOrder, a suggestion until the chef plans it), or ask the agent for that day. Planning opens the new plan.
	 * Used before a kitchen's first plan and for an empty day in the Basket.
	 */
	import { Bot } from '@lucide/svelte';
	import DayPicker from '$lib/ui/DayPicker.svelte';
	import UsualOrder from '$lib/ui/UsualOrder.svelte';
	import { day, money } from '$lib/ui/format';
	import { usualHeadline, type UsualSummary } from '$lib/ui/usual';

	let {
		kitchenId,
		kitchenName,
		date = $bindable(null),
		onplanned,
		onask,
		notes = null,
		onnotes,
		embedded = false,
		blank = false,
		showDays = true
	}: {
		kitchenId: string;
		kitchenName: string;
		/** The delivery day in view (YYYY-MM-DD); null until picked (UsualOrder then uses the next receiving day). */
		date?: string | null;
		/** A plan was made from the usual order: the page opens it. */
		onplanned: (planId: string) => void;
		/** Open the agent, scoped to this day when one is picked. */
		onask: (date: string | null) => void;
		/** The chef's description from joining (D15): shown and editable; it changes no rule. */
		notes?: string | null;
		onnotes?: (notes: string) => void;
		/** Inside another screen (below a booked event): no title of its own, no mandate quote. */
		embedded?: boolean;
		/** A new kitchen of your own (D25): no history, no booking. The agent is the way in. */
		blank?: boolean;
		/** Its own delivery-day calendar. False inside a screen that already has one (the Basket): one per screen. */
		showDays?: boolean;
	} = $props();
	let card = $state<UsualOrder | null>(null);
	let setUp = $state(false);
	let editingNotes = $state(false);
	let draftNotes = $state('');
	let usual = $state<UsualSummary | null>(null);
</script>

<div class="flex flex-col gap-6">
	{#if !embedded}<div>
			<p class="text-meta text-ink-3">{kitchenName}</p>
			<h1 class="mt-1 text-title font-semibold tracking-[-0.015em] text-ink">
				{blank
					? 'Your kitchen is set up. Tell the agent what you need.'
					: usual
						? usualHeadline(usual, (c) => money(c, { whole: true }))
						: date
							? `Nothing planned for ${day(date)}`
							: 'Nothing planned yet'}
			</h1>
			<p class="mt-1 max-w-[60ch] text-body text-ink-2">
				{blank
					? 'Say it as you would to a supplier ("40 kg of potatoes for Friday"); the agent finds the products, prices them and orders within your rules. It learns your usual order as you go.'
					: usual
						? `Your agent read this kitchen's order history for ${day(usual.deliveryDate)}. Pick another delivery day, or tell the agent what you need.`
						: 'Pick a delivery day. Start from what this kitchen usually orders that day, or tell the agent what you need.'}
			</p>
			{#if blank}
				<div class="mt-3 flex flex-wrap gap-2">
					<button
						type="button"
						class="inline-flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-body font-medium text-sheet hover:bg-accent-ink"
						onclick={() => onask(date)}
						><Bot size={16} aria-hidden="true" />Tell the agent what you need</button
					>
					<button
						type="button"
						class="inline-flex h-10 items-center rounded-md border border-rule-strong px-4 text-body text-ink hover:border-accent"
						aria-expanded={setUp}
						onclick={() => (setUp = !setUp)}>Set up a usual order</button
					>
				</div>
			{:else if usual && !usual.planned}
				<button
					type="button"
					class="mt-3 inline-flex h-10 items-center rounded-md bg-accent px-4 text-body font-medium text-sheet hover:bg-accent-ink disabled:opacity-50"
					disabled={usual.planning || !usual.lines}
					onclick={() => card?.plan()}>{usual.planning ? 'Planning…' : 'Plan this order'}</button
				>
			{/if}
			{#if notes || editingNotes}
				<div class="mt-3 max-w-[60ch] rounded-md bg-well/60 px-3 py-2 text-meta text-ink-2">
					{#if editingNotes}
						<label for="np-notes" class="font-medium text-ink">Your notes</label>
						<textarea
							id="np-notes"
							bind:value={draftNotes}
							rows="2"
							maxlength="500"
							class="mt-1 w-full rounded border border-rule-strong bg-sheet px-2 py-1 text-body text-ink"
						></textarea>
						<button
							type="button"
							class="mt-1 text-accent-ink underline underline-offset-2"
							onclick={() => {
								onnotes?.(draftNotes.trim());
								editingNotes = false;
							}}>Save</button
						>
					{:else if notes}
						<span class="font-medium text-ink">Your notes:</span>
						{notes}
						<button
							type="button"
							class="ml-1 text-accent-ink underline underline-offset-2"
							onclick={() => ((draftNotes = notes ?? ''), (editingNotes = true))}>Edit</button
						>
						<span class="block text-micro text-ink-3"
							>The agent's rules don't change with them.</span
						>
					{/if}
				</div>
			{/if}
		</div>{/if}

	<div
		class="grid gap-6 md:items-start {showDays
			? 'md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]'
			: ''}"
	>
		<div class="flex flex-col gap-3 {showDays ? '' : 'sm:flex-row'}">
			{#if showDays}<DayPicker {kitchenId} bind:value={date} label="Delivery day" />{/if}
			{#if !blank}
				<button
					type="button"
					class="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-rule-strong bg-sheet px-4 text-body font-medium text-ink hover:border-accent"
					onclick={() => onask(date)}
				>
					<Bot size={16} aria-hidden="true" />
					{date ? `Ask the agent for ${day(date)}` : 'Ask the agent'}
				</button>
			{/if}
		</div>
		{#if !blank || setUp}
			{#key `${kitchenId}|${date ?? ''}`}
				<UsualOrder
					bind:this={card}
					primary={embedded || !usual}
					{kitchenId}
					date={date ?? undefined}
					onplanned={(r) => onplanned(r.planId)}
					onsummary={(s) => (usual = s)}
				/>
			{/key}
		{/if}
	</div>
</div>
